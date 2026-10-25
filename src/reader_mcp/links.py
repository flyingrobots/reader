"""The library link graph: which documents link to which, for previews and backlinks.

The graph is a rebuildable SQLite cache at `.reader/links.sqlite3`; it is never
committed and never the only copy of anything. A refresh walks `library/` with the
search indexer's rules (no dot names, no symlinks), re-parses only Markdown files
whose (size, mtime_ns) changed, and resolves every target with `Resolver`, the same
function the web reader uses when a link is clicked. It reads the vault and writes
only the cache file."""
from bisect import bisect_right
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import sqlite3
import stat
import threading
import time
from urllib.parse import unquote, urlsplit

from .metadata import parse_metadata

VERSION = '1'
MARKDOWN = ('.md', '.markdown')
MAX_MARKDOWN = 10_000        # Markdown files parsed per refresh; the rest are path-only
MAX_FILES = 100_000          # library files of any kind the walk will list
MAX_PARSE = 4 * 1024 ** 2    # larger Markdown files are path-only
MAX_TARGET = 256 * 1024 ** 2  # the same bound as WebLibrary.path
MAX_LINKS = 500_000
MAX_STORE = 256 * 1024 ** 2
MAX_INBOUND = 200
FRESHNESS_TTL = 30


class LinkError(ValueError):
    """A target that does not resolve to one library file; `reason` is stored."""
    def __init__(self, reason, message=None):
        super().__init__(message or {'missing': 'Document link is missing', 'ambiguous': 'Document link is ambiguous',
                                     'outside': 'Document link leaves library/', 'external': 'Expected a local document link',
                                     'invalid': 'Expected a local document link'}.get(reason, reason))
        self.reason = reason


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def by_name(paths):
    """Index paths by basename, and Markdown paths also by their stem."""
    index = {}
    for path in paths:
        name = path.rpartition('/')[2]
        index.setdefault(name, []).append(path)
        if name.endswith('.md'):
            index.setdefault(name[:-3], []).append(path)
    return index


class Resolver:
    """Resolve a link target exactly as a click in the web reader does.

    1. A path: relative to the source's folder; `library/…` and `/…` from the vault
       root. The path itself, then with `.md` appended.
    2. A unique work primary whose path ends with `/target` or `/target.md`.
    3. A unique library file whose path ends with `/target` or `/target.md`
       (a bare basename, or a partial path, as Obsidian resolves wikilinks).
    `exists(path)` decides whether a library file exists. Returns
    (path, fragment, method) where method is 'path' or 'name'."""

    def __init__(self, exists, files=(), primaries=()):
        self.exists = exists
        self.files = by_name(files)
        self.primaries = by_name(primaries)

    def resolve(self, source, target):
        if not isinstance(target, str) or not target or len(target) > 2000 or '\x00' in target or '\\' in target:
            raise LinkError('invalid')
        if urlsplit(target).scheme or target.startswith('//'):
            raise LinkError('external')
        path, _, fragment = target.partition('#')
        if not path:
            raise LinkError('invalid', 'A same-document fragment is not a document link')
        rooted = path.startswith('/')
        tail = path.lstrip('/')
        while tail.startswith('./'):
            tail = tail[2:]
        candidate = posixpath.normpath(tail if rooted or tail.startswith('library/') else str(PurePosixPath(source).parent / path))
        inside = candidate.startswith('library/')
        if inside:
            for option in (candidate, candidate + '.md'):
                if self.exists(option):
                    return option, fragment, 'path'
        ambiguous = False
        name = tail.rpartition('/')[2]
        for index in (self.primaries, self.files):
            matches = {p for p in index.get(name, ()) if (p.endswith('/' + tail) or p.endswith('/' + tail + '.md')) and self.exists(p)}
            if len(matches) == 1:
                return matches.pop(), fragment, 'name'
            ambiguous = ambiguous or len(matches) > 1
        raise LinkError('ambiguous' if ambiguous else 'missing' if inside or '/' not in tail else 'outside')


# Extraction ----------------------------------------------------------------

FRONT = re.compile(r'^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)')
FENCE = re.compile(r'^ {0,3}(`{3,}|~{3,})')
INLINE_CODE = re.compile(r'(`+)((?:(?!\n[ \t]*\n)[\s\S])+?)\1')
ATX = re.compile(r'^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$', re.M)
UNDERLINE = re.compile(r'^ {0,3}(?:=+|-+)[ \t]*$')
HTML_HEADING = re.compile(r'<h([1-6])\b[^>]*>([\s\S]*?)</h\1\s*>', re.I)
# Lines that open a block other than a paragraph: list, quote, table, HTML, thematic break.
NOT_PARAGRAPH = re.compile(r' {0,3}(?:[-*+>|]|\d+[.)](?:[ \t]|$)|<[A-Za-z/!?])')
INTERRUPTS = re.compile(r' {0,3}(?:[-*+][ \t]|>|<[A-Za-z/!?])')
LIST_ITEM = re.compile(r' {0,3}(?:[-*+]|\d+[.)])(?:[ \t]|$)')
INDENTED = re.compile(r'(?: {4}|\t| {1,3}\t)')
EMBED = re.compile(r'!\[\[([^\[\]\n]+)\]\]')
WIKI = re.compile(r'\[\[([^\[\]\n]+)\]\]')
MDLINK = re.compile(r'(!?)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*(<[^<>\n]*>|(?:[^\s()]|\([^\s()]*\))+)(?:\s+(?:"[^"\n]*"|\'[^\'\n]*\'|\([^)\n]*\)))?\s*\)')
REFDEF = re.compile(r'^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^<>\n]*>|\S+)', re.M)


def spaces(text):
    return re.sub(r'[^\n]', ' ', text)


def blank_code(text):
    """Replace frontmatter, fenced, indented and inline code with spaces, keeping offsets and lines.

    An indented line opens a code block after a blank line (or at the start), unless
    it continues a list item; an indented line right after paragraph text is a lazy
    continuation, as in CommonMark."""
    front = FRONT.match(text)
    if front:
        text = spaces(front[0]) + text[front.end():]
    out, fence = [], None
    blank, indented_code, in_list = True, False, False
    for line in text.splitlines(keepends=True):
        match = FENCE.match(line)
        bare = not line.strip()
        if fence:
            out.append(spaces(line))
            if match and match[1][0] == fence[0] and len(match[1]) >= len(fence) and not line[match.end():].strip():
                fence = None
        elif not bare and INDENTED.match(line) and (indented_code or blank and not in_list):
            indented_code = True
            out.append(spaces(line))
        elif match and not (match[1][0] == '`' and '`' in line[match.end():]):
            fence, indented_code = match[1], False
            out.append(spaces(line))
        else:
            if not bare:
                indented_code = False
                if not INDENTED.match(line):
                    in_list = bool(LIST_ITEM.match(line)) or (in_list and not blank)
            out.append(line)
        blank = bare if not fence else False
    return INLINE_CODE.sub(lambda m: spaces(m[0]), ''.join(out))


def inline(markdown):
    """Text of inline Markdown, as the browser's textContent of the rendered element."""
    text = re.sub(r'<!--[\s\S]*?-->', '', markdown)
    text = EMBED.sub('', text)
    text = WIKI.sub(lambda m: (m[1].split('|', 1)[1] if '|' in m[1] else m[1]), text)
    text = re.sub(r'!\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'\[([^\]]*)\]\[[^\]]*\]', r'\1', text)
    text = re.sub(r'<[^>\n]+>', '', text)
    text = re.sub(r'(\*\*|__|\*|~~|`)', '', text)
    return re.sub(r'\s+', ' ', html.unescape(text)).strip()


def plain(markdown):
    """Readable text from a Markdown fragment: links become their labels, markup is dropped."""
    text = re.sub(r'<(?:br|/?p|/?div|/?li|/?tr|/?td|/?th|hr)\b[^>\n]*>', ' ', markdown, flags=re.I)
    text = re.sub(r'^ {0,3}(?:>[ \t]?)+', '', text, flags=re.M)
    text = re.sub(r'^\s*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?', '', text, flags=re.M)
    text = re.sub(r'^ {0,3}(?:#{1,6}[ \t]+|[=-]{3,}[ \t]*$|\|?[ \t]*:?-{3,}.*$)', '', text, flags=re.M)
    text = re.sub(r'^ {0,3}\[[^\]\n]+\]:.*$', '', text, flags=re.M)
    text = EMBED.sub(' ', text)
    text = inline(re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', text)).replace('|', ' ')
    return re.sub(r' ([.,;:!?])', r'\1', re.sub(r' {2,}', ' ', text)).strip()


def slug(text):
    """GitHub-style heading slug of inline Markdown; logic.mjs computes the same from textContent."""
    return re.sub(r'[^\w\- ]', '', inline(text).lower()).replace(' ', '-')


def setext(blanked):
    """(offset, text) of setext headings: the whole paragraph above a === or --- underline."""
    found, paragraph, other, position = [], None, False, 0
    for line in blanked.splitlines(keepends=True):
        text = line.rstrip('\r\n')
        if not text.strip():
            paragraph, other = None, False
        elif other:
            pass
        elif paragraph and UNDERLINE.match(text):
            found.append((paragraph[0], ' '.join(part.strip() for part in paragraph[1])))
            paragraph = None
        elif ATX.match(text):
            paragraph = None
        elif paragraph and INTERRUPTS.match(text):
            paragraph, other = None, True
        elif paragraph:
            paragraph[1].append(text)
        elif NOT_PARAGRAPH.match(text) or UNDERLINE.match(text):
            other = True
        else:
            paragraph = (position, [text])
        position += len(line)
    return found


def headings(blanked):
    """(offset, text, slug) for every ATX, setext and HTML heading, with duplicate slugs numbered.

    Matches the renderer, which slugs every rendered h1-h6 (HTML blocks included) in
    document order."""
    found = [(m.start(), m[2] or '') for m in ATX.finditer(blanked)]
    found += setext(blanked)
    found += [(m.start(), m[2]) for m in HTML_HEADING.finditer(blanked)]
    found.sort()
    seen, result = {}, []
    for offset, text in found:
        base = slug(text)
        count = seen.get(base, 0)
        seen[base] = count + 1
        result.append((offset, inline(text), base if not count else f'{base}-{count}'))
    return result


def local_target(raw):
    target = raw.strip()
    if target.startswith('<') and target.endswith('>'):
        target = target[1:-1].strip()
    target = html.unescape(target)
    if not target or target.startswith('#') or urlsplit(target).scheme or target.startswith('//'):
        return None
    try:
        return unquote(target, errors='strict')
    except UnicodeDecodeError:
        return target


def extract(text):
    """Every local link in a Markdown document: dicts of kind, raw, label, line, heading, anchor."""
    blanked = blank_code(text)
    lines = [0] + [m.end() for m in re.finditer('\n', blanked)]
    marks = headings(blanked)
    offsets = [m[0] for m in marks]
    found = []
    def add(kind, raw, label, offset):
        if raw is None:
            return
        at = bisect_right(offsets, offset) - 1
        heading = marks[at] if at >= 0 else None
        found.append({'kind': kind, 'raw': raw[:2000], 'label': inline(label)[:200], 'line': bisect_right(lines, offset),
                      'offset': offset, 'heading': heading[1] if heading else None, 'anchor': heading[2] if heading else None})
    for m in EMBED.finditer(blanked):
        add('embed', m[1].split('|')[0].strip() or None, m[1], m.start())
    rest = EMBED.sub(lambda m: spaces(m[0]), blanked)
    for m in WIKI.finditer(rest):
        target, _, label = m[1].partition('|')
        target = target.strip()
        add('wikilink', target if target and not target.startswith('#') else None, label or target, m.start())
    rest = WIKI.sub(lambda m: spaces(m[0]), rest)
    for m in MDLINK.finditer(rest):
        if '\n\n' in m[2]:
            continue
        add('embed' if m[1] else 'link', local_target(m[3]), m[2], m.start())
    rest = MDLINK.sub(lambda m: spaces(m[0]), rest)
    for m in REFDEF.finditer(rest):
        if m[1].startswith('^'):  # a footnote, not a link definition
            continue
        add('link', local_target(m[2]), m[1], m.start())
    found.sort(key=lambda link: link['offset'])
    return found


def title_of(data, path):
    """The title the reader shows: frontmatter title, else the first H1, else the file stem."""
    try:
        title = parse_metadata(data).metadata.get('title')
    except Exception:
        title = None
    if isinstance(title, str) and title.strip():
        return title.strip()[:300]
    text = data[:65536].decode('utf-8', 'replace')
    match = re.search(r'^ {0,3}#[ \t]+(.+?)[ \t#]*$', blank_code(text), re.M)
    if match:
        return inline(match[1])[:300] or PurePosixPath(path).stem.replace('-', ' ')
    return PurePosixPath(path).stem.replace('-', ' ')


def excerpt(text, fragment='', limit=320):
    """(heading, excerpt): plain text from the heading the fragment names, else from the top.

    The first H1 is skipped because the preview already shows the title."""
    blanked = blank_code(text)
    marks = headings(blanked)
    front = FRONT.match(text)
    start, heading, skip = front.end() if front else 0, None, False
    wanted = slug(unquote(fragment)) if fragment else ''
    hit = next((m for m in marks if m[2] == wanted or slug(m[1]) == wanted), None) if wanted else None
    if hit:
        start, heading, skip = hit[0], hit[1], True
    elif marks and not blanked[start:marks[0][0]].strip() and re.match(r' {0,3}#[ \t]', blanked[marks[0][0]:]):
        start, skip = marks[0][0], True
    body = text[start:]
    if skip:
        body = body.split('\n', 1)[1] if '\n' in body else ''
    body = re.sub(r'^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[ \t]*$', ' ', body, flags=re.M)
    words = plain(body[:24000])
    if len(words) > limit:
        cut = words.rfind(' ', 0, limit)
        words = words[:cut if cut > limit // 2 else limit].rstrip(' ,.;:') + '…'
    return heading, words[:600]


# The graph -----------------------------------------------------------------

SCHEMA = '''
CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, size INTEGER, mtime INTEGER, sha256 TEXT, title TEXT, scanned_at TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS links(source TEXT, target TEXT, kind TEXT CHECK(kind IN ('link','wikilink','embed')),
    fragment TEXT, heading TEXT, line INTEGER, label TEXT, raw TEXT, method TEXT, anchor TEXT);
CREATE TABLE IF NOT EXISTS unresolved(source TEXT, raw TEXT, kind TEXT, line INTEGER, reason TEXT, heading TEXT, label TEXT, anchor TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS links_target ON links(target);
CREATE INDEX IF NOT EXISTS links_source ON links(source);
CREATE INDEX IF NOT EXISTS unresolved_source ON unresolved(source);
'''


def coverage_primaries(root):
    """Work primaries from the maintained inventory, when there is one."""
    path = Path(root) / 'indexes' / 'coverage.json'
    if not path.is_file() or path.is_symlink() or path.parent.is_symlink() or path.stat().st_size > 16 * 1024 ** 2:
        return []
    works = json.loads(path.read_text()).get('works')
    return [w['primary'] for w in works if isinstance(w, dict) and isinstance(w.get('primary'), str)] if isinstance(works, list) else []


class LinkGraph:
    def __init__(self, root, db=None, primaries=None):
        self.root = Path(root).expanduser().resolve(strict=True)
        self.db = Path(db) if db else self.root / '.reader' / 'links.sqlite3'
        self.primaries = primaries or (lambda: coverage_primaries(self.root))
        self.lock = threading.Lock()
        self.fresh = (0.0, None)
        self.names = (None, None)

    # Files -------------------------------------------------------------------

    def walk(self):
        """{path: (size, mtime_ns)} for every regular library file a reader could open."""
        files = {}
        for folder, dirs, names in os.walk(self.root / 'library', followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and not (Path(folder) / d).is_symlink())
            for name in sorted(names):
                if name.startswith('.'):
                    continue
                file = Path(folder) / name
                try:
                    info = file.lstat()
                except OSError:
                    continue
                if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_TARGET:
                    continue
                files[file.relative_to(self.root).as_posix()] = (info.st_size, info.st_mtime_ns)
                if len(files) > MAX_FILES:
                    raise ValueError(f'The library has more than {MAX_FILES:,} files; the link graph refuses to scan it')
        return files

    def read(self, path, size):
        fd = os.open(self.root / path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        with os.fdopen(fd, 'rb') as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError('Not a regular file')
            return stream.read(MAX_PARSE + 1)

    # Store -------------------------------------------------------------------

    def connect(self, write=False):
        if write:
            self.db.parent.mkdir(parents=True, exist_ok=True)
            con = sqlite3.connect(self.db, timeout=30)
            con.execute('PRAGMA page_size=4096')
            con.execute(f'PRAGMA max_page_count={MAX_STORE // 4096}')
            con.execute('PRAGMA journal_mode=WAL')
            con.executescript(SCHEMA)
            version = con.execute("SELECT value FROM settings WHERE key='version'").fetchone()
            if version and version[0] != VERSION:
                with con:
                    for table in ('files', 'links', 'unresolved', 'settings'):
                        con.execute(f'DELETE FROM {table}')
            return con
        return sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True, timeout=10)

    def settings(self):
        """The last successful build's settings, or None if the graph was never built."""
        if not self.db.is_file():
            return None
        try:
            with closing(self.connect()) as con:
                rows = dict(con.execute('SELECT key, value FROM settings'))
        except sqlite3.Error:
            return None
        return rows if rows.get('version') == VERSION and rows.get('built_at') else None

    def refresh(self):
        """Bring the graph up to date; on any failure the previous graph is kept."""
        started = time.monotonic()
        with self.lock:
            current = self.walk()
            primaries = sorted(set(self.primaries()))
            fingerprint = hashlib.sha256('\n'.join(primaries).encode()).hexdigest()
            resolver = Resolver(current.__contains__, current, primaries)
            markdown = [p for p in sorted(current) if p.lower().endswith(MARKDOWN)]
            parse = set(markdown[:MAX_MARKDOWN])
            with closing(self.connect(write=True)) as con:
                stored = {p: (s, m) for p, s, m in con.execute('SELECT path, size, mtime FROM files')}
                old = dict(con.execute('SELECT key, value FROM settings'))
                removed = sorted(stored.keys() - current.keys())
                added = sorted(current.keys() - stored.keys())
                changed = sorted(p for p in current.keys() & stored.keys() if stored[p] != current[p])
                limit_changed = old.get('parse_limit') != str(MAX_MARKDOWN)
                if limit_changed:  # Rescan everything when the scan bound changes.
                    changed = sorted(current.keys() & stored.keys())
                now, parsed, rewired = stamp(), 0, 0
                with con:
                    for path in removed:
                        for table, column in (('files', 'path'), ('links', 'source'), ('unresolved', 'source')):
                            con.execute(f'DELETE FROM {table} WHERE {column}=?', (path,))
                    for path in [*added, *changed]:
                        size, mtime = current[path]
                        con.execute('DELETE FROM links WHERE source=?', (path,))
                        con.execute('DELETE FROM unresolved WHERE source=?', (path,))
                        digest = title = None
                        status = 'file'
                        if path in parse and size <= MAX_PARSE:
                            try:
                                data = self.read(path, size)
                            except (OSError, ValueError):
                                status = 'unreadable'
                            else:
                                digest, title, status = hashlib.sha256(data).hexdigest(), title_of(data, path), 'parsed'
                                self.store(con, resolver, path, data.decode('utf-8', 'replace'))
                                parsed += 1
                        elif path.lower().endswith(MARKDOWN):
                            status = 'path-only'
                        con.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?,?)',
                                    (path, size, mtime, digest, title or (PurePosixPath(path).stem.replace('-', ' ') if status != 'file' else None), now, status))
                    # Resolution by name depends on which files exist: re-resolve only what can change.
                    if added or removed or old.get('works') != fingerprint:
                        fresh = set(added) | set(changed)
                        rewired = self.reresolve(con, resolver, removed, fresh)
                    links = con.execute('SELECT count(*) FROM links').fetchone()[0]
                    if links > MAX_LINKS:
                        raise ValueError(f'The link graph would hold {links:,} links, over the {MAX_LINKS:,} limit; the previous graph is kept')
                    unresolved = con.execute('SELECT count(*) FROM unresolved').fetchone()[0]
                    documents = con.execute("SELECT count(*) FROM files WHERE status='parsed'").fetchone()[0]
                    summary = {'files': len(current), 'documents': documents, 'links': links, 'unresolved': unresolved,
                               'parsed': parsed, 'added': len(added), 'changed': len(changed), 'removed': len(removed),
                               'rewired': rewired, 'path_only': len(markdown) - documents,
                               'truncated': max(0, len(markdown) - MAX_MARKDOWN)}
                    con.executemany('INSERT OR REPLACE INTO settings VALUES (?,?)', [
                        ('version', VERSION), ('built_at', now), ('works', fingerprint), ('parse_limit', str(MAX_MARKDOWN)),
                        ('counts', json.dumps(summary))])
            self.fresh = (0.0, None)
            self.names = (None, None)
        return summary | {'seconds': round(time.monotonic() - started, 3)}

    def store(self, con, resolver, source, text):
        resolved, missing = [], []
        for link in extract(text):
            try:
                target, fragment, method = resolver.resolve(source, link['raw'])
            except LinkError as exc:
                if exc.reason != 'external':
                    missing.append((source, link['raw'], link['kind'], link['line'], exc.reason, link['heading'], link['label'], link['anchor']))
                continue
            resolved.append((source, target, link['kind'], fragment or None, link['heading'], link['line'], link['label'], link['raw'], method, link['anchor']))
        con.executemany('INSERT INTO links VALUES (?,?,?,?,?,?,?,?,?,?)', resolved)
        con.executemany('INSERT INTO unresolved VALUES (?,?,?,?,?,?,?,?)', missing)

    def reresolve(self, con, resolver, removed, fresh):
        """Re-resolve unresolved rows, name-resolved rows and rows aimed at removed files."""
        count = 0
        gone = set(removed)
        rows = con.execute("SELECT rowid, source, target, kind, heading, line, label, raw, anchor, method FROM links WHERE method='name'").fetchall()
        if gone:
            rows += [r for r in con.execute("SELECT rowid, source, target, kind, heading, line, label, raw, anchor, method FROM links WHERE method<>'name'") if r[2] in gone]
        for rowid, source, target, kind, heading, line, label, raw, anchor, _ in rows:
            if source in fresh:
                continue
            try:
                new, fragment, method = resolver.resolve(source, raw)
            except LinkError as exc:
                con.execute('DELETE FROM links WHERE rowid=?', (rowid,))
                con.execute('INSERT INTO unresolved VALUES (?,?,?,?,?,?,?,?)', (source, raw, kind, line, exc.reason, heading, label, anchor))
                count += 1
                continue
            if new != target:
                con.execute('UPDATE links SET target=?, fragment=?, method=? WHERE rowid=?', (new, fragment or None, method, rowid))
                count += 1
        for rowid, source, raw, kind, line, reason, heading, label, anchor in con.execute(
                'SELECT rowid, source, raw, kind, line, reason, heading, label, anchor FROM unresolved').fetchall():
            if source in fresh:
                continue
            try:
                target, fragment, method = resolver.resolve(source, raw)
            except LinkError as exc:
                if exc.reason != reason:
                    con.execute('UPDATE unresolved SET reason=? WHERE rowid=?', (exc.reason, rowid))
                continue
            con.execute('DELETE FROM unresolved WHERE rowid=?', (rowid,))
            con.execute('INSERT INTO links VALUES (?,?,?,?,?,?,?,?,?,?)', (source, target, kind, fragment or None, heading, line, label, raw, method, anchor))
            count += 1
        return count

    # Freshness -----------------------------------------------------------------

    def check(self):
        """Freshness for the Behind the scenes card: compares the walk with stored files."""
        files = self.walk()
        settings = self.settings()
        if not settings:
            return {'state': 'missing', 'message': 'No link graph yet. It builds itself when you first open a document, or refresh it here.', 'files': len(files)}
        with closing(self.connect()) as con:
            stored = {p: (s, m) for p, s, m in con.execute('SELECT path, size, mtime FROM files')}
        new = [p for p in files if p not in stored]
        changed = [p for p in files if p in stored and stored[p] != files[p]]
        removed = [p for p in stored if p not in files]
        counts = json.loads(settings.get('counts') or '{}')
        stale = bool(new or changed or removed)
        self.fresh = (time.monotonic(), stale)
        return {'state': 'stale' if stale else 'current', 'built_at': settings['built_at'],
                'message': f'{len(new)} new, {len(changed)} changed and {len(removed)} removed files since the last refresh.' if stale
                           else 'Every library file is in the link graph.',
                'files': len(files), 'documents': counts.get('documents'), 'links': counts.get('links'),
                'unresolved': counts.get('unresolved'), 'path_only': counts.get('path_only'),
                'new': len(new), 'changed': len(changed), 'removed': len(removed), 'examples': (new + changed + removed)[:5]}

    def stale(self):
        """Whether the library changed since the last refresh; measured at most every 30 seconds."""
        at, value = self.fresh
        if value is None or time.monotonic() - at > FRESHNESS_TTL:
            try:
                value = self.check()['state'] != 'current'
            except (OSError, ValueError, sqlite3.Error):
                value = True
            self.fresh = (time.monotonic(), value)
        return value

    def file_paths(self):
        """Library files known to the graph, for click resolution by name (a fresh walk before the first build)."""
        settings = self.settings()
        key = settings['built_at'] if settings else ('walk', int(time.monotonic() // FRESHNESS_TTL))
        if self.names[0] == key:
            return self.names[1]
        if settings:
            with closing(self.connect()) as con:
                paths = [p for (p,) in con.execute('SELECT path FROM files')]
        else:
            paths = list(self.walk())
        self.names = (key, paths)
        return paths

    # Queries -------------------------------------------------------------------

    def inbound(self, path, limit=MAX_INBOUND):
        settings = self.settings()
        if not settings:
            return None
        with closing(self.connect()) as con:
            rows = con.execute('SELECT l.source, f.title, l.line, l.heading, l.anchor FROM links l LEFT JOIN files f ON f.path=l.source '
                               'WHERE l.target=? AND l.source<>? ORDER BY l.source, l.line', (path, path)).fetchall()
            outbound = con.execute('SELECT count(*) FROM links WHERE source=? AND target<>?', (path, path)).fetchone()[0]
            unresolved = con.execute('SELECT count(*) FROM unresolved WHERE source=?', (path,)).fetchone()[0]
        groups = {}
        for source, title, line, heading, anchor in rows:
            group = groups.get(source)
            if group:
                group['count'] += 1
            else:
                groups[source] = {'source': source, 'title': title or PurePosixPath(source).stem, 'count': 1,
                                  'heading': heading, 'fragment': anchor, 'line': line}
        ordered = sorted(groups.values(), key=lambda g: (-g['count'], g['title'].casefold(), g['source']))
        return {'inbound': ordered[:limit], 'inbound_count': len(ordered), 'inbound_links': len(rows),
                'outbound_count': outbound, 'unresolved_count': unresolved, 'built_at': settings['built_at']}

    def counts(self, primaries=None):
        """Inbound and outbound link counts per document (work primaries only, when given)."""
        settings = self.settings()
        if not settings:
            return None
        with closing(self.connect()) as con:
            inbound = {t: (n, s) for t, n, s in con.execute('SELECT target, count(*), count(DISTINCT source) FROM links WHERE source<>target GROUP BY target')}
            outbound = dict(con.execute('SELECT source, count(*) FROM links WHERE source<>target GROUP BY source'))
        keys = set(primaries) if primaries is not None else inbound.keys() | outbound.keys()
        return {'counts': {p: {'inbound': inbound.get(p, (0, 0))[0], 'sources': inbound.get(p, (0, 0))[1], 'outbound': outbound.get(p, 0)}
                           for p in sorted(keys) if p in inbound or p in outbound},
                'built_at': settings['built_at']}
