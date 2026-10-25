"""What changed since a reader's receipt: recover the edition they read, then diff it.

A receipt in `engagement/` records `document:<path> -> {version: sha256 of the
bytes read, at}`. When that hash differs from the current file, the bytes read
may still be in the vault's git history. They are recovered strictly read-only:
`git log` lists the commits that touched the path, `git cat-file --batch-check`
skips blobs over 4 MiB, and `git cat-file --batch` streams the rest until one
hashes to the receipt. No checkout, index, ref or temporary file is touched;
commands run without a shell, with a fixed environment, `GIT_OPTIONAL_LOCKS=0`,
at most 200 commits and 2 s of wall time. Recovered text is cached in memory
only. The diff is Python's difflib over Markdown blocks, then words."""
from collections import OrderedDict
from difflib import SequenceMatcher
import hashlib
import json
import os
import re
import subprocess
import threading
import time

MAX_COMMITS = 200
MAX_SECONDS = 2.0
MAX_BLOB = 4 * 1024**2
MAX_BLOCKS = 5000
MAX_RESPONSE = 1024**2
CACHE_ENTRIES = 64
CACHE_BYTES = 32 * 1024**2
REWORDED = 0.5
TEXT_TYPES = ('.md', '.markdown', '.txt')
FRONT = re.compile(r'^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)')
FENCE = re.compile(r'^ {0,3}(`{3,}|~{3,})')
WORD = re.compile(r'\s+|\w+|[^\w\s]', re.UNICODE)
GIT_ENV = {'PATH': '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0',
           'GIT_PAGER': 'cat', 'PAGER': 'cat', 'GIT_TERMINAL_PROMPT': '0', 'GIT_CONFIG_NOSYSTEM': '1',
           'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_ATTR_NOSYSTEM': '1', 'HOME': os.devnull}
SHA = re.compile(r'^[0-9a-f]{64}$')


class Unavailable(Exception):
    """The edition a receipt names cannot be recovered within the bounds."""


def blocks(text):
    """Markdown body blocks as (text, start, end) code-point offsets into `text`.

    Frontmatter is removed with the reader's `bodyOf` rule; blocks are separated
    by blank lines and fenced code stays whole."""
    front = FRONT.match(text)
    offset = front.end() if front else 0
    result, start, fence, position = [], None, None, offset
    lines = text[offset:].splitlines(keepends=True)
    for line in lines:
        bare = line.strip()
        if fence:
            if bare.startswith(fence) and bare.strip(fence[0]) == '':
                fence = None
        else:
            match = FENCE.match(line)
            if match:
                fence = match.group(1)
                if start is None:
                    start = position
            elif not bare:
                if start is not None:
                    result.append((text[start:position].rstrip(), start, position))
                    start = None
            elif start is None:
                start = position
        position += len(line)
    if start is not None:
        result.append((text[start:position].rstrip(), start, position))
    return [b for b in result if b[0]]


def prose(text):
    """The body as a reader sees it: blocks with whitespace collapsed (frontmatter and rewrapping are invisible)."""
    return [' '.join(b[0].split()) for b in blocks(text)]


def words(old, new):
    """Word-level opcodes: [['=', text], ['-', text], ['+', text]], adjacent runs merged."""
    a, b = WORD.findall(old), WORD.findall(new)
    out = []

    def add(op, tokens):
        if not tokens:
            return
        text = ''.join(tokens)
        if out and out[-1][0] == op:
            out[-1][1] += text
        else:
            out.append([op, text])
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == 'equal':
            add('=', a[i1:i2])
        else:
            add('-', a[i1:i2])
            add('+', b[j1:j2])
    return out


def similarity(old, new):
    return SequenceMatcher(None, old, new, autojunk=False).ratio()


def diff(old_text, new_text):
    """Block hunks between two texts, with stats; `new_start`/`new_end` index the new text."""
    old, new = blocks(old_text), blocks(new_text)
    if len(old) > MAX_BLOCKS or len(new) > MAX_BLOCKS:
        raise ValueError(f'Each side is limited to {MAX_BLOCKS:,} blocks')
    stats = {'added': 0, 'removed': 0, 'reworded': 0, 'unchanged': 0}
    hunks = []
    end = len(new_text)
    anchor = lambda j: (new[j][1], new[j][1]) if j < len(new) else (end, end)
    keys = lambda side: [' '.join(b[0].split()) for b in side]
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, keys(old), keys(new), autojunk=False).get_opcodes():
        if tag == 'equal':
            stats['unchanged'] += i2 - i1
            hunks.append({'op': 'equal', 'count': i2 - i1, 'new_start': new[j1][1], 'new_end': new[j2 - 1][2]})
            continue
        olds, news = old[i1:i2], new[j1:j2]
        k = 0
        for k in range(max(len(olds), len(news))):
            o = olds[k] if k < len(olds) else None
            n = news[k] if k < len(news) else None
            if o and n and similarity(o[0], n[0]) >= REWORDED:
                stats['reworded'] += 1
                hunks.append({'op': 'replace', 'old': o[0], 'new': n[0], 'words': words(o[0], n[0]), 'new_start': n[1], 'new_end': n[2]})
                continue
            if o:
                stats['removed'] += 1
                start, stop = (n[1], n[1]) if n else anchor(j1 + min(k, len(news)))
                hunks.append({'op': 'delete', 'old': o[0], 'new_start': start, 'new_end': stop})
            if n:
                stats['added'] += 1
                hunks.append({'op': 'insert', 'new': n[0], 'new_start': n[1], 'new_end': n[2]})
    return stats, hunks


def bounded(hunks):
    """Keep whole hunks until the encoded response would pass 1 MiB."""
    kept, size = [], 2048
    for hunk in hunks:
        size += len(json.dumps(hunk, ensure_ascii=False).encode()) + 1
        if size > MAX_RESPONSE:
            return kept, True
        kept.append(hunk)
    return kept, False


class Changes:
    def __init__(self, root, git='git', clock=time.monotonic):
        self.root = os.fspath(root)
        # Only a repository at the vault root counts; never one discovered in a parent folder.
        self.env = GIT_ENV | {'GIT_CEILING_DIRECTORIES': os.path.dirname(os.path.realpath(self.root))}
        self.git = git
        self.clock = clock
        self.cache = OrderedDict()   # sha256 -> text
        self.cached_bytes = 0
        self.cache_lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(2)

    # Cache -------------------------------------------------------------------
    def remember(self, digest, data):
        with self.cache_lock:
            if digest in self.cache:
                self.cache.move_to_end(digest)
                return
            if len(data) > CACHE_BYTES:
                return
            self.cache[digest] = data
            self.cached_bytes += len(data)
            while len(self.cache) > CACHE_ENTRIES or self.cached_bytes > CACHE_BYTES:
                _, old = self.cache.popitem(last=False)
                self.cached_bytes -= len(old)

    def cached(self, digest):
        with self.cache_lock:
            if digest in self.cache:
                self.cache.move_to_end(digest)
                return self.cache[digest]
        return None

    # Git, read-only --------------------------------------------------------------
    def run(self, args, deadline, data=None):
        remaining = deadline - self.clock()
        if remaining <= 0:
            raise Unavailable('Search of the vault history ran out of time')
        try:
            done = subprocess.run([self.git, '-C', self.root, *args], input=data, capture_output=True, env=self.env,
                                  timeout=remaining, check=False, stdin=None if data is not None else subprocess.DEVNULL)
        except subprocess.TimeoutExpired as exc:
            raise Unavailable('Search of the vault history ran out of time') from exc
        except OSError as exc:
            raise Unavailable('git is not available') from exc
        if done.returncode:
            raise Unavailable('The vault has no readable git history for this file')
        return done.stdout

    def history(self, path, deadline):
        """Distinct blob ids of `path` in the newest 200 commits that touched it, newest first."""
        out = self.run(['log', '--follow', f'--max-count={MAX_COMMITS}', '--format=commit %H', '--raw', '--no-abbrev',
                        '--no-color', '--no-ext-diff', '--', path], deadline)
        blobs, commits = [], 0
        for line in out.decode('utf-8', 'replace').splitlines():
            if line.startswith('commit '):
                commits += 1
            elif line.startswith(':'):
                fields = line.split('\t', 1)[0].split()
                if len(fields) >= 5 and set(fields[3]) != {'0'} and fields[3] not in blobs:
                    blobs.append(fields[3])
        return blobs, commits

    def recover(self, path, digest):
        """Bytes of `path` whose SHA-256 is `digest`, from the vault's git history."""
        hit = self.cached(digest)
        if hit is not None:
            return hit, {'cached': True}
        if not self.slots.acquire(timeout=3):
            raise BlockingIOError('Two history searches are running; try again shortly')
        try:
            started = self.clock()
            deadline = started + MAX_SECONDS
            blobs, commits = self.history(path, deadline)
            if not blobs:
                raise Unavailable('This file has no committed history')
            sizes = {}
            for line in self.run(['cat-file', '--batch-check'], deadline, ('\n'.join(blobs) + '\n').encode()).decode().splitlines():
                parts = line.split()
                if len(parts) == 3 and parts[1] == 'blob':
                    sizes[parts[0]] = int(parts[2])
            candidates = [b for b in blobs if b in sizes and sizes[b] <= MAX_BLOB]
            skipped = sum(1 for b in blobs if sizes.get(b, 0) > MAX_BLOB)
            found = self.stream(candidates, digest, deadline)
            meta = {'commits': commits, 'blobs': len(blobs), 'skipped_large': skipped,
                    'seconds': round(self.clock() - started, 3)}
            if found is None:
                raise Unavailable('The edition you read isn’t in the vault history' + (' searched' if commits >= MAX_COMMITS else ''))
            self.remember(digest, found)
            return found, meta
        finally:
            self.slots.release()

    def stream(self, blobs, digest, deadline):
        """Hash candidate blobs in one `cat-file --batch` process; stop at the first match."""
        if not blobs:
            return None
        try:
            process = subprocess.Popen([self.git, '-C', self.root, 'cat-file', '--batch'], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=self.env)
        except OSError as exc:
            raise Unavailable('git is not available') from exc
        timer = threading.Timer(max(0.0, deadline - self.clock()), process.kill)
        timer.start()
        try:
            for blob in blobs:
                process.stdin.write(blob.encode() + b'\n')
                process.stdin.flush()
                header = process.stdout.readline().split()
                if len(header) != 3 or header[1] != b'blob':
                    continue
                size = int(header[2])
                data = process.stdout.read(size)
                process.stdout.read(1)
                if len(data) != size:
                    raise Unavailable('Search of the vault history ran out of time')
                if hashlib.sha256(data).hexdigest() == digest:
                    return data
                if self.clock() > deadline:
                    raise Unavailable('Search of the vault history ran out of time')
            return None
        except (BrokenPipeError, ValueError, OSError) as exc:
            raise Unavailable('Search of the vault history ran out of time') from exc
        finally:
            timer.cancel()
            try:
                process.stdin.close()
            except OSError:
                pass
            process.kill()
            process.wait()
            process.stdout.close()
