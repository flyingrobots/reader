"""Edition families: originals, reading copies, numbered versions and catalog notes.

Relationships come only from what the vault already records: `reading_source` in
reading copies, `previous_version` in revisions, the `<stem>.vN.md` naming
convention, preserved `original/` folders, and catalog notes filed at
`catalog/metadata/<library-relative path>.md`. Nothing is written or repaired;
references that cannot be resolved are reported, never guessed. The index covers
Markdown files, reads at most 8 KiB of each header, and is cached in memory."""
from datetime import datetime, timezone
from hashlib import sha256
import os
import posixpath
import re
import threading
import time

from .metadata import FrontmatterError, source_frontmatter

MAX_FILES = 20_000
MAX_HEADER_BYTES = 8 * 1024
MAX_TOTAL_BYTES = 16 * 1024**2
MAX_FAMILY = 32
RECHECK = 60.0   # seconds between file-signature checks
EDGE_KEYS = (b'\nreading_source:', b'\nprevious_version:')
CLOSE_START = re.compile(rb'\A(?:\xef\xbb\xbf)?---\r?\n')
CLOSE = re.compile(rb'(?m)^---\r?\n')
CLOSE_AT_END = re.compile(rb'(?m)^---\r?\Z')
VERSION_NAME = re.compile(r'^(?P<stem>.+)\.v(?P<n>[1-9]\d{0,3})\.md$')
VERSION_FOLDER = re.compile(r'(?:^|[-_.])v(?P<n>[1-9]\d{0,3})$')
ROLE_ORDER = {'original': 0, 'version': 1, 'reading-copy': 2}


def _raw_header(path, budget):
    """Frontmatter bytes (delimiters included) within the first 8 KiB, or None.

    Reads 1 KiB at a time and stops at the closing delimiter; `budget` is a
    one-item counter of bytes still allowed for the whole build."""
    data = b''
    with open(path, 'rb') as stream:
        while len(data) < MAX_HEADER_BYTES and budget[0] > 0:
            chunk = stream.read(min(1024, MAX_HEADER_BYTES - len(data)))
            budget[0] -= len(chunk)
            data += chunk
            if len(data) >= 4 and not CLOSE_START.match(data):
                return None
            match = CLOSE.search(data, 4) or (len(chunk) < 1024 and CLOSE_AT_END.search(data, 4))
            if match:
                return data[:match.end()]
            if len(chunk) < 1024:
                return None
    return None


def _parse(raw):
    try:
        meta, _ = source_frontmatter(raw)
    except (FrontmatterError, ValueError, RecursionError):
        return {}
    return meta if isinstance(meta, dict) else {}


def _text(value, limit=2000):
    return value if isinstance(value, str) and 0 < len(value) <= limit and '\x00' not in value else None


def _library_path(value):
    """A normalized library-relative path, or None."""
    if not value or '\\' in value or value.startswith('/'):
        return None
    normal = posixpath.normpath(value)
    parts = normal.split('/')
    if not normal.startswith('library/') or any(p in ('', '.', '..') or p.startswith('.') for p in parts):
        return None
    return normal


def day_or_instant(value):
    """A frontmatter date for display: a zoned timestamp as a UTC instant (the browser shows its local
    day), anything else as its `YYYY-MM-DD` calendar date, as written."""
    text = str(value)
    if len(text) > 10:
        try:
            parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
        except ValueError:
            parsed = None
        if parsed is not None and parsed.tzinfo:
            return parsed.astimezone(timezone.utc).isoformat()
    return text[:10]


class Editions:
    def __init__(self, root, clock=time.monotonic):
        self.root = os.fspath(root)
        self.clock = clock
        self.lock = threading.Lock()
        self.cache = None        # (signature, index)
        self.checked = None      # clock value of the last signature check

    # Inventory ---------------------------------------------------------------
    def scan(self):
        """(relative path, size, mtime_ns) for regular, non-symlinked Markdown files."""
        files, truncated = [], False
        for top in ('library', 'catalog/metadata'):
            base = os.path.join(self.root, top)
            if not os.path.isdir(base) or any(os.path.islink(os.path.join(self.root, *top.split('/')[:i + 1])) for i in range(top.count('/') + 1)):
                continue
            stack = [top]
            while stack:
                folder = stack.pop()
                try:
                    entries = list(os.scandir(os.path.join(self.root, folder)))
                except OSError:
                    continue
                for entry in sorted(entries, key=lambda e: e.name, reverse=True):
                    if entry.name.startswith('.') or entry.is_symlink():
                        continue
                    rel = folder + '/' + entry.name
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(rel)
                    elif entry.name.endswith('.md') and entry.is_file(follow_symlinks=False):
                        if len(files) >= MAX_FILES:
                            truncated = True
                            break
                        info = entry.stat(follow_symlinks=False)
                        files.append((rel, info.st_size, info.st_mtime_ns))
                if truncated:
                    break
        return files, truncated

    def index(self):
        """The cached family index; rescans file signatures at most once a minute."""
        with self.lock:
            now = self.clock()
            if self.cache and self.checked is not None and now - self.checked < RECHECK:
                return self.cache[1]
            started = time.perf_counter()
            files, truncated = self.scan()
            signature = sha256(repr((files, truncated)).encode()).hexdigest()
            self.checked = now
            if self.cache and self.cache[0] == signature:
                return self.cache[1]
            index = self.build(files, truncated)
            index['stats']['build_ms'] = round((time.perf_counter() - started) * 1000, 1)
            self.cache = (signature, index)
            return index

    # Edges -------------------------------------------------------------------
    def build(self, files, truncated=False):
        library = {path for path, _, _ in files if path.startswith('library/')}
        catalogs = [path for path, _, _ in files if path.startswith('catalog/metadata/')]
        budget = [MAX_TOTAL_BYTES]
        raw, meta, partial = {}, {}, truncated
        for path in sorted(library):
            if budget[0] <= 0:
                partial = True
                break
            try:
                header = _raw_header(os.path.join(self.root, path), budget)
            except OSError:
                header = None
            if header:
                raw[path] = header
                # Only headers that declare an edge need YAML now; members are parsed later.
                if any(key in header for key in EDGE_KEYS):
                    meta[path] = _parse(header)
        for path in list(meta):
            source = _library_path(_text(meta[path].get('reading_source')))
            if source and source not in library and self.regular(source):
                library.add(source)  # A non-Markdown source, such as a .log, still anchors its copy.
        parent = {p: p for p in library}

        def find(p):
            while parent[p] != p:
                parent[p] = parent[parent[p]]
                p = parent[p]
            return p

        def join(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)

        copies, previous, unresolved, originals, named = {}, {}, [], set(), set()
        for path in sorted(library):
            data = meta.get(path, {})
            source = _library_path(_text(data.get('reading_source')))
            if source and (data.get('kind') == 'reading-copy' or path.endswith('.reading.md')):
                if source in library and source != path:
                    copies[path] = source
                    join(path, source)
                else:
                    unresolved.append({'path': path, 'field': 'reading_source', 'value': data.get('reading_source')})
            value = _text(data.get('previous_version'))
            if value is not None:
                target = self.resolve_previous(path, value, library)
                if target and target != path:
                    previous[path] = target
                    join(path, target)
                else:
                    unresolved.append({'path': path, 'field': 'previous_version', 'value': value})
            elif data.get('previous_version') is not None:
                unresolved.append({'path': path, 'field': 'previous_version', 'value': str(data.get('previous_version'))[:200]})
            folder, name = posixpath.split(path)
            match = VERSION_NAME.match(name)
            if match and path not in copies:
                base = folder + '/' + match['stem'] + '.md'
                if base in library:
                    named.update((path, base))
                    join(path, base)
            if '/original/' in path:
                head, _, rest = path.partition('/original/')
                filed = head + '/' + rest
                if filed in library:
                    originals.add(path)
                    join(path, filed)
        catalog = {}
        for note in catalogs:
            target = 'library/' + note[len('catalog/metadata/'):-len('.md')]
            # Notes for non-Markdown works (PDFs, data) follow the path convention too;
            # a note whose Markdown target is missing names its document in frontmatter.
            if target.endswith('.md') and target not in library:
                try:
                    data = _parse(_raw_header(os.path.join(self.root, note), budget) or b'')
                except OSError:
                    data = {}
                inner = [data] + [data.get(k) for k in ('original_frontmatter', 'original_metadata') if isinstance(data.get(k), dict)]
                target = next((t for t in (_library_path(_text(d.get(k))) for d in inner for k in ('document_path', 'source')) if t in library), None)
            if target:
                catalog.setdefault(target, note)
        groups = {}
        for path in library:
            groups.setdefault(find(path), []).append(path)
        families = {}
        for members in groups.values():
            if len(members) > 1:
                record = sorted(members)
                for member in members:
                    families[member] = record
        versions = (set(previous) | set(previous.values()) | named) - set(copies)
        for path in families:
            if path not in meta and path in raw:
                meta[path] = _parse(raw[path])
        return {'meta': {p: {k: meta[p].get(k) for k in ('title', 'author', 'date', 'created', 'added', 'document_revision') if k in meta[p]} for p in meta if p in families},
                'families': families, 'copies': copies, 'previous': previous, 'versions': versions, 'originals': originals,
                'catalog': catalog, 'unresolved': unresolved,
                'stats': {'files': len(files), 'library': len(library), 'catalog_notes': len(catalogs),
                          'families': len({id(v) for v in families.values()}), 'unresolved': len(unresolved),
                          'header_bytes': MAX_TOTAL_BYTES - budget[0], 'partial': partial}}

    def regular(self, path):
        """A regular library file reached without crossing a symlink."""
        current = self.root
        for part in path.split('/'):
            current = os.path.join(current, part)
            if os.path.islink(current):
                return False
        return os.path.isfile(current)

    @staticmethod
    def resolve_previous(path, value, library):
        """Vault path if it starts with library/; else relative to the folder, then the bundle root."""
        if value.startswith('library/'):
            candidates = [value]
        else:
            folder = posixpath.dirname(path)
            parts = path.split('/')
            bundle = '/'.join(parts[:3]) if len(parts) > 3 else folder
            candidates = [posixpath.join(folder, value), posixpath.join(bundle, value)]
        for candidate in candidates:
            normal = _library_path(posixpath.normpath(candidate)) if '\\' not in candidate else None
            if normal and normal in library:
                return normal
        return None

    # Families ----------------------------------------------------------------
    def revision(self, index, path):
        name = posixpath.basename(path)
        match = VERSION_NAME.match(name)
        if match:
            return int(match['n'])
        folder = VERSION_FOLDER.search(posixpath.basename(posixpath.dirname(path)))
        if folder and (path in index['previous'] or path in index['previous'].values()):
            return int(folder['n'])
        declared = index['meta'].get(path, {}).get('document_revision')
        if type(declared) is int and 1 <= declared <= 9999:
            return declared
        return 1

    def describe(self, index, path, current):
        meta = index['meta'].get(path, {})
        date = next((day_or_instant(meta[k]) for k in ('date', 'created', 'added') if meta.get(k)), None)
        if path in index['copies']:
            source = index['copies'][path]
            role = 'reading-copy'
            revision = self.revision(index, source) if source in index['versions'] else None
            label = 'Reading copy' + (f' of v{revision}' if revision else '')
        elif path in index['originals']:
            role, revision, label = 'original', None, 'Preserved original'
        elif path in index['versions']:
            role = 'version'
            revision = self.revision(index, path)
            label = f'v{revision}'
        else:
            role, revision = 'original', None
            label = 'Filed copy' if any(o.replace('/original/', '/', 1) == path for o in index['originals']) else 'Original'
        entry = {'path': path, 'role': role, 'label': label}
        if revision is not None:
            entry['revision'] = revision
        if date:
            entry['date'] = date
        if isinstance(meta.get('title'), str):
            entry['title'] = meta['title'][:300]
        author = meta.get('author')
        if isinstance(author, list):
            author = ' · '.join(a for a in author if isinstance(a, str))
        if isinstance(author, str) and author:
            entry['author'] = author[:200]
        if path == current:
            entry['current'] = True
        return entry

    def family(self, path):
        index = self.index()
        members = index['families'].get(path, [path])
        entries = [self.describe(index, member, path) for member in members]
        rank = {e['path']: (e.get('revision') or (self.revision(index, index['copies'][e['path']]) if e['path'] in index['copies'] else 0)) for e in entries}
        entries.sort(key=lambda e: (rank[e['path']], ROLE_ORDER[e['role']], e['path']))
        labels = {}
        for e in entries:
            labels.setdefault(e['label'], []).append(e)
        for same in labels.values():
            if len(same) > 1:  # The same edition filed in two folders: name the folder.
                for e in same:
                    e['where'] = posixpath.basename(posixpath.dirname(e['path']))
        current = next(e for e in entries if e.get('current'))
        versions = [e for e in entries if e['role'] == 'version']
        newer = None
        if versions:
            top = max(e['revision'] for e in versions)
            mine = current.get('revision') if current['role'] == 'version' else rank[path] if current['role'] == 'reading-copy' else 0
            if (mine or 0) < top:
                folder = posixpath.dirname(path)
                best = sorted((e for e in versions if e['revision'] == top), key=lambda e: (posixpath.dirname(e['path']) != folder, e['path']))[0]
                newer = {k: best[k] for k in ('path', 'revision', 'date', 'title') if k in best}
        more = 0
        if len(entries) > MAX_FAMILY:
            keep = entries[:MAX_FAMILY]
            if current not in keep:
                keep = entries[:MAX_FAMILY - 1] + [current]
            more = len(entries) - len(keep)
            entries = keep
        return {'path': path, 'family': entries, 'more': more, 'newer': newer,
                'catalog': index['catalog'].get(path),
                'unresolved': [u for u in index['unresolved'] if u['path'] in set(members)],
                'scope': 'Markdown editions linked by reading_source, previous_version, .vN names and original/ folders.'}

    def diagnostics(self):
        index = self.index()
        return {'stats': index['stats'], 'unresolved': index['unresolved'][:200]}
