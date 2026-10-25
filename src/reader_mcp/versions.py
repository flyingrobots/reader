"""Version explorer: an edition family plus each member's own history in the vault's git log.

Built on `editions.Editions` (which files form a family) and `changes.Changes`
(the read-only git runner: no shell, fixed environment, `GIT_OPTIONAL_LOCKS=0`,
`GIT_CEILING_DIRECTORIES` at the vault root). Git is only asked to `rev-parse`,
`log` and `cat-file`; nothing is checked out and no index, ref or temporary file
is written. Each member's history is `git log --follow`, at most 50 commits per
path and 200 for the family, with 2 s of wall time for the whole request. A
historical version is addressed only by a commit that appears in that path's own
history, so no caller-supplied revision expression ever reaches git. Content
hashes (SHA-256, the receipt format) are computed only on request, at most
32 MiB of blobs per request, and cached by immutable blob id."""
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import re
import subprocess
import threading
import time

from .changes import MAX_BLOB, Unavailable

MAX_PER_PATH = 50
MAX_TOTAL = 200
MAX_SECONDS = 2.0
MAX_HASH_BYTES = 32 * 1024**2
WORKERS = 4
CACHE_ENTRIES = 256
HASH_CACHE = 4096
COMMIT = re.compile(r'^[0-9a-f]{7,40}$')
REF = re.compile(r'^(?P<path>library/.+\.[A-Za-z0-9]{1,10})@(?P<commit>[0-9a-f]{7,40})$')
ZERO = re.compile(r'^0+$')


def blob_id(data):
    """The git blob id of `data`, so the working copy can be matched to a commit without hashing history."""
    return hashlib.sha1(b'blob %d\x00' % len(data) + data).hexdigest()


def split_ref(ref):
    """`library/x.md@3f2a1c9` -> ('library/x.md', '3f2a1c9'); a plain path -> (path, None)."""
    if not isinstance(ref, str) or len(ref) > 2100:
        raise ValueError('Expected a version reference: <path> or <path>@<commit>')
    match = REF.match(ref)
    return (match['path'], match['commit']) if match else (ref, None)


def parse_log(out):
    """Entries from `git log --format=%x1e%H%x1f%aI%x1f%an%x1f%s --raw`, newest first; deletions and merges skipped."""
    entries = []
    for record in out.decode('utf-8', 'replace').split('\x1e')[1:]:
        head, _, rest = record.partition('\n')
        fields = head.split('\x1f', 3)
        if len(fields) != 4 or not COMMIT.match(fields[0]):
            continue
        raw = next((line for line in rest.splitlines() if line.startswith(':')), None)
        if raw is None:
            continue
        meta, *paths = raw.split('\t')
        parts = meta.split()
        if len(parts) < 5 or ZERO.match(parts[3]):
            continue
        entry = {'commit': fields[0], 'short': fields[0][:7], 'date': fields[1], 'author': fields[2][:120],
                 'subject': fields[3][:200], 'blob': parts[3], 'status': parts[4][:1]}
        if parts[4].startswith(('R', 'C')) and len(paths) == 2 and not paths[0].startswith('"'):
            entry['from'] = paths[0]
        if paths and not paths[-1].startswith('"'):
            entry['at'] = paths[-1]
        entries.append(entry)
    return entries


class Versions:
    def __init__(self, changes, clock=time.monotonic):
        self.changes = changes          # The shared read-only git runner and its environment.
        self.clock = clock
        self.lock = threading.Lock()
        self.cache = OrderedDict()      # (head, path, limit) -> entries
        self.sha = OrderedDict()        # blob id -> sha256
        self.slots = threading.BoundedSemaphore(2)

    # Git, read-only ----------------------------------------------------------
    def head(self, deadline):
        """The commit HEAD names, or None for a vault without history."""
        try:
            out = self.changes.run(['rev-parse', '-q', '--verify', 'HEAD^{commit}'], deadline).decode().strip()
        except Unavailable:
            return None
        return out if COMMIT.match(out) else None

    def log(self, head, path, limit, deadline):
        key = (head, path, limit)
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
        out = self.changes.run(['-c', 'core.quotePath=false', 'log', '--follow', f'--max-count={limit}',
                                '--format=%x1e%H%x1f%aI%x1f%an%x1f%s', '--raw', '--no-abbrev', '--no-color',
                                '--no-ext-diff', '--', path], deadline)
        entries = parse_log(out)
        with self.lock:
            self.cache[key] = entries
            while len(self.cache) > CACHE_ENTRIES:
                self.cache.popitem(last=False)
        return entries

    def histories(self, paths, deadline):
        """{path: entries} and {path: status} for every family member, in parallel within one deadline."""
        head = self.head(deadline)
        if head is None:
            return {p: [] for p in paths}, {p: 'unavailable' for p in paths}, None
        limit = max(1, min(MAX_PER_PATH, MAX_TOTAL // max(1, len(paths))))

        def one(path):
            try:
                entries = self.log(head, path, limit, deadline)
                return path, entries, 'truncated' if len(entries) >= limit else 'ok'
            except Unavailable as exc:
                return path, [], 'timeout' if 'time' in str(exc) else 'unavailable'
        with ThreadPoolExecutor(max_workers=min(WORKERS, len(paths))) as pool:
            results = list(pool.map(one, paths))
        return {p: e for p, e, _ in results}, {p: s for p, _, s in results}, head

    def sizes(self, blobs, deadline):
        out = self.changes.run(['cat-file', '--batch-check'], deadline, ('\n'.join(blobs) + '\n').encode())
        sizes = {}
        for line in out.decode().splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[1] == 'blob':
                sizes[parts[0]] = int(parts[2])
        return sizes

    def hashes(self, blobs, deadline):
        """SHA-256 of each blob (cached by blob id), within 32 MiB and the deadline; missing when out of budget."""
        result, todo = {}, []
        with self.lock:
            for blob in dict.fromkeys(blobs):
                if blob in self.sha:
                    result[blob] = self.sha[blob]
                else:
                    todo.append(blob)
        if not todo:
            return result, False
        sizes = self.sizes(todo, deadline)
        budget, chosen, partial = MAX_HASH_BYTES, [], False
        for blob in todo:
            size = sizes.get(blob)
            if size is None or size > MAX_BLOB or size > budget:
                partial = True
                continue
            budget -= size
            chosen.append(blob)
        if not chosen:
            return result, partial
        try:
            process = subprocess.Popen([self.changes.git, '-C', self.changes.root, 'cat-file', '--batch'], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=self.changes.env)
        except OSError:
            return result, True
        timer = threading.Timer(max(0.0, deadline - self.clock()), process.kill)
        timer.start()
        try:
            for blob in chosen:
                process.stdin.write(blob.encode() + b'\n')
                process.stdin.flush()
                header = process.stdout.readline().split()
                if len(header) != 3 or header[1] != b'blob':
                    partial = True
                    continue
                size = int(header[2])
                data = process.stdout.read(size)
                process.stdout.read(1)
                if len(data) != size or self.clock() > deadline:
                    partial = True
                    break
                result[blob] = hashlib.sha256(data).hexdigest()
        except (BrokenPipeError, ValueError, OSError):
            partial = True
        finally:
            timer.cancel()
            try:
                process.stdin.close()
            except OSError:
                pass
            process.kill()
            process.wait()
            process.stdout.close()
        with self.lock:
            for blob in chosen:
                if blob in result:
                    self.sha[blob] = result[blob]
            while len(self.sha) > HASH_CACHE:
                self.sha.popitem(last=False)
        return result, partial

    def blob(self, path, commit):
        """(bytes, entry) of `path` as of `commit`, which must appear in that path's own history."""
        if not isinstance(commit, str) or not COMMIT.match(commit):
            raise ValueError('Expected a commit id of 7–40 lowercase hexadecimal characters')
        if not self.slots.acquire(timeout=3):
            raise BlockingIOError('Two version lookups are running; try again shortly')
        try:
            deadline = self.clock() + MAX_SECONDS
            history, status, _ = self.histories([path], deadline)
            if status[path] == 'timeout':
                raise Unavailable('Reading the vault history ran out of time')
            matches = {e['blob']: e for e in history[path] if e['commit'].startswith(commit)}
            if not matches:
                raise ValueError('That commit is not in this document’s recent history')
            if len(matches) > 1:
                raise ValueError('That short commit id is ambiguous; use more characters')
            entry = next(e for e in history[path] if e['commit'].startswith(commit))
            size = self.sizes([entry['blob']], deadline).get(entry['blob'])
            if size is None:
                raise Unavailable('That version is not in the vault’s git objects')
            if size > MAX_BLOB:
                raise ValueError('Historical versions are limited to 4 MiB')
            data = self.changes.run(['cat-file', 'blob', entry['blob']], deadline)
            return data, entry
        finally:
            self.slots.release()

    # The explorer --------------------------------------------------------------
    def explore(self, family, current_bytes, receipts, participant, digests, with_hashes=False):
        """Combine an `Editions.family` result with history and read markers.

        `current_bytes(path)` returns a member's working-copy bytes or None;
        `digests(path)` its SHA-256 or None; `receipts` maps participant -> items."""
        if not self.slots.acquire(timeout=3):
            raise BlockingIOError('Two version lookups are running; try again shortly')
        try:
            started = self.clock()
            deadline = started + MAX_SECONDS
            paths = [e['path'] for e in family['family']]
            history, status, head = self.histories(paths, deadline)
            hashed, partial = {}, False
            if with_hashes and head:
                try:
                    hashed, partial = self.hashes([e['blob'] for p in paths for e in history[p]], deadline)
                except Unavailable:
                    partial = True
            current = {}
            for path in paths:
                data = current_bytes(path)
                current[path] = blob_id(data) if data is not None else None
            readers = {}  # (path, sha256) -> [participants]
            for name, items in receipts.items():
                for path in paths:
                    record = items.get('document:' + path)
                    if isinstance(record, dict) and isinstance(record.get('version'), str):
                        readers.setdefault((path, record['version']), []).append(name)
            out_history = {}
            for path in paths:
                rows = []
                for entry in history[path]:
                    row = {k: v for k, v in entry.items()}
                    if entry['blob'] == current[path]:
                        row['matches_current'] = True
                    if entry['blob'] in hashed:
                        row['sha256'] = hashed[entry['blob']]
                        names = readers.get((path, row['sha256']))
                        if names:
                            row['readers'] = sorted(names)
                    rows.append(row)
                out_history[path] = rows
            editions = []
            for edition in family['family']:
                path = edition['path']
                rows = out_history[path]
                digest = digests(path)
                item = dict(edition, revisions=len(rows), history=status[path],
                            uncommitted=bool(rows) and current[path] is not None and not rows[0].get('matches_current'))
                names = readers.get((path, digest)) if digest else None
                if names:
                    item['readers'] = sorted(names)
                editions.append(item)
            read = self.read_marker(family, receipts.get(participant, {}), digests, out_history, participant)
            return {'path': family['path'], 'family': editions, 'more': family.get('more', 0), 'newer': family.get('newer'),
                    'catalog': family.get('catalog'), 'history': out_history, 'history_status': status, 'read': read,
                    'git': head is not None, 'hashes': bool(with_hashes and head), 'hashes_partial': partial,
                    'stats': {'commits': sum(len(v) for v in out_history.values()), 'seconds': round(self.clock() - started, 3)},
                    'limits': {'per_path': MAX_PER_PATH, 'total': MAX_TOTAL, 'seconds': MAX_SECONDS, 'hash_bytes': MAX_HASH_BYTES}}
        finally:
            self.slots.release()

    @staticmethod
    def read_marker(family, items, digests, history, participant):
        """This participant's most relevant receipt in the family: this file first, then the newest other."""
        found = []
        for edition in family['family']:
            record = items.get('document:' + edition['path'])
            if isinstance(record, dict) and isinstance(record.get('version'), str):
                found.append((edition, record))
        if not found:
            return None
        mine = [pair for pair in found if pair[0].get('current')]
        edition, record = mine[0] if mine else max(found, key=lambda pair: str(pair[1].get('at', '')))
        marker = {'participant': participant, 'path': edition['path'], 'label': edition['label'],
                  'version': record['version'], 'at': record.get('at')}
        if record['version'] == digests(edition['path']):
            marker['where'] = 'current'
        else:
            hit = next((e for e in history.get(edition['path'], []) if e.get('sha256') == record['version']), None)
            marker['where'] = 'commit' if hit else 'earlier'
            if hit:
                marker['commit'] = hit['commit']
        return marker
