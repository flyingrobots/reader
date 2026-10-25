"""`reader demo --export-static DIR`: the demo vault as a static site (RW-42).

The exporter serves a freshly built demo vault with the real `WebServer` on loopback, requests every
GET route the web reader needs for that vault, and writes each JSON answer to a file. The page is the
ordinary web UI plus `assets/static-demo.js`, a shim that the exported `index.html` turns on with a
`<meta name="reader-static-demo">` flag. With the flag, the shim answers `/api/*` from those files,
searches a client-side keyword index, keeps highlights, comments and reading positions in the
visitor's browser storage, and labels everything that needs a running Reader as "try it locally".
Without the flag (the normal server), the shim does nothing.

The output folder must be new, empty, or an earlier export (it carries `.reader-static-demo`). Every
written text file is checked for the vault's absolute path and the user's home folder before the
export is reported as done, so a machine path can never reach a published site.
"""
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import threading
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import urlopen

MARKER = '.reader-static-demo'
MARKER_KIND = 'reader-static-demo'
FORMAT = 1
STATIC = Path(__file__).resolve().parent.parent / 'web_ui'
# Routes the shim answers itself: they describe this machine (local model, service, health, prose
# colors, speech, the voices that can make art), so their real answers are never exported.
SYNTHETIC = ('/api/local-model', '/api/service', '/api/health', '/api/prose', '/api/fonts', '/api/speak/', '/api/art/jobs', '/api/art/still')
TEXT_SUFFIXES = {'.html', '.mjs', '.js', '.css', '.json', '.webmanifest', '.md', '.txt', '.svg'}
LINK = re.compile(r'!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\b(?:href|src)\s*=\s*"([^"]+)"')
MAX_FILES = 5000
MAX_BYTES = 64 * 1024**2


def key(path, pairs):
    """The lookup key for one GET: the route and its sorted query pairs (the shim builds the same)."""
    return json.dumps([path, sorted([str(k), str(v)] for k, v in pairs if k != 'tz')], ensure_ascii=False, separators=(',', ':'))


def normal_base(value):
    value = value or '/'
    if not value.startswith('/') or '//' in value or any(part in ('.', '..') for part in value.split('/')) or re.search(r'[\s"\'<>\\]', value):
        raise ValueError('Expected a base path such as / or /reader/')
    return value if value.endswith('/') else value + '/'


def check_output(out):
    """Refuse anything but a new path, an empty folder, or an earlier export."""
    if out.is_symlink() or out.exists() and not out.is_dir():
        raise ValueError(f'{out} is not a folder Reader may export into')
    if out.is_dir() and any(out.iterdir()):
        try:
            marker = json.loads((out / MARKER).read_text())
        except (OSError, ValueError):
            marker = None
        if not isinstance(marker, dict) or marker.get('kind') != MARKER_KIND:
            raise ValueError(f'{out} is not empty and is not an earlier Reader static demo; choose a new folder')


def clear(out):
    for child in out.iterdir():
        if child.name == MARKER:
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()


class Crawler:
    """GETs from the real server, written once per key."""

    def __init__(self, base_url, out):
        self.base_url, self.out = base_url, out
        self.routes, self.bodies = {}, {}

    def get(self, route, **query):
        pairs = [(k, v) for k, v in query.items() if v is not None]
        k = key(route, pairs)
        if k in self.routes:
            return self.bodies.get(k)
        url = self.base_url + route + ('?' + urlencode(pairs, quote_via=quote) if pairs else '')
        try:
            with urlopen(url, timeout=60) as response:
                status, data = response.status, json.loads(response.read())
        except HTTPError as error:
            status, data = error.code, json.loads(error.read() or b'{}')
        art = route == '/api/art' and status == 200
        if art:
            data = static_art(data)
        self.bodies[k] = data if status == 200 else None
        self.routes[k] = [self.write(data, scrubbed=art), status]
        return self.bodies[k]

    def write(self, data, scrubbed=False):
        """One file per distinct body (many routes answer identically), named by its content."""
        body = json.dumps(data if scrubbed else scrub(data), ensure_ascii=False, separators=(',', ':')).encode()
        name = hashlib.sha256(body).hexdigest()[:20]
        folder = self.out / 'data' / 'r'
        folder.mkdir(parents=True, exist_ok=True)
        if not (folder / f'{name}.json').exists():
            (folder / f'{name}.json').write_bytes(body)
        return name


def static_art(data):
    """Art answers keep their scenes (the page draws them) but no still images, which are not exported:
    without WebGL the page shows the Artist's note instead. Everything but the scene is scrubbed; a scene's
    colors use `token` keys (theme roles), which the generic scrub would drop."""
    art = data.get('art')
    data = scrub({k: v for k, v in data.items() if k != 'art'})
    if isinstance(art, dict):
        scene = art.get('scene')
        data['art'] = {**scrub({k: v for k, v in art.items() if k != 'scene'}), 'still': None}
        if scene is not None:
            data['art']['scene'] = scene
    else:
        data['art'] = art
    data['versions'] = [{**v, 'still': None} for v in data.get('versions') or []]
    data['job'] = None
    return data


def scrub(value):
    """Machine-only fields never leave the export; file URLs point at the exported copies."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k not in ('absolute_path', 'token', 'codex')}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str) and value.startswith('/api/file?path='):
        from urllib.parse import unquote
        return 'files/' + quote(unquote(value[len('/api/file?path='):]))
    return value


def issue_windows(works, today):
    """Every window the magazine can ask for: each ISO week with a dated work, and that week widened by 7 days."""
    days = {today}
    for work in works:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', work.get('date') or ''):
            days.add(date.fromisoformat(work['date']))
    windows = set()
    for day in days:
        monday = day - timedelta(days=day.weekday())
        sunday = monday + timedelta(days=6)
        windows.add((monday.isoformat(), sunday.isoformat()))
        windows.add(((monday - timedelta(days=7)).isoformat(), sunday.isoformat()))
    return sorted(windows)


def link_targets(text):
    found = []
    for match in LINK.finditer(text):
        target = match.group(1) or match.group(2)
        if target and not re.match(r'^(?:[a-z][a-z0-9+.-]*:|#|//)', target, re.I) and target not in found:
            found.append(target)
    return found[:256]


def search_index(root):
    """Passages of library/ documents from the vault's own keyword index, for the shim's search."""
    database = root / '.reader' / 'search.v2.sqlite3'
    paths, passages, chunks, seen = [], [], [], {}
    if not database.is_file():
        return {'paths': paths, 'passages': passages, 'chunks': chunks}
    con = sqlite3.connect(f'file:{database}?mode=ro', uri=True)
    try:
        rows = con.execute("SELECT c.path, c.page, c.start_line, c.end_line, c.passage_id, p.text FROM chunks c "
                           "JOIN passages p ON p.id=c.passage_id WHERE c.path LIKE 'library/%' ORDER BY c.path, c.page, c.start_line").fetchall()
    finally:
        con.close()
    index_of = {}
    for path, page, start, end, passage, text in rows:
        if path not in index_of:
            index_of[path] = len(paths)
            paths.append(path)
        if passage not in seen:
            seen[passage] = len(passages)
            passages.append(text)
        chunks.append([index_of[path], page, start, end, seen[passage]])
    return {'paths': paths, 'passages': passages, 'chunks': chunks}


def copy_tree(source, target, skip=lambda path: False):
    for file in sorted(source.rglob('*')):
        relative = file.relative_to(source)
        if any(part.startswith('.') or part == '__pycache__' for part in relative.parts) or skip(relative) or file.is_symlink() or not file.is_file():
            continue
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, destination)


def rebase(text, base):
    """Root-absolute asset and pane URLs, rewritten for a site served under `base`."""
    return re.sub(r'''(["'(`])/(assets/|\?pane=1)''', lambda m: m.group(1) + base + m.group(2), text)


def page(base, site_url, exported_at):
    html = (STATIC / 'index.html').read_text()
    flag = json.dumps({'base': base, 'format': FORMAT, 'exported_at': exported_at})
    description = 'Try Reader, a local-first library reader, on a demo library of public-domain essays and fictional notes. Runs entirely in your browser.'
    social = [f'<meta name="description" content="{description}">',
              '<meta property="og:type" content="website">', '<meta property="og:title" content="Reader demo · The library, at your pace">',
              f'<meta property="og:description" content="{description}">', '<meta name="twitter:card" content="summary">']
    if site_url:
        social += [f'<meta property="og:url" content="{site_url}">', f'<meta property="og:image" content="{site_url}assets/icons/icon-512.png">',
                   f'<link rel="canonical" href="{site_url}">']
    csp = ("default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
           "font-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'")
    head = (f'<meta http-equiv="Content-Security-Policy" content="{csp}">\n  '
            f"<meta name=\"reader-static-demo\" content='{flag}'>\n  " + '\n  '.join(social) + '\n  '
            f'<script src="{base}assets/static-demo.js"></script>\n  ')
    html = rebase(html, base).replace('<title>Reader · The library, at your pace</title>', '<title>Reader demo · The library, at your pace</title>', 1)
    return html.replace('<link rel="icon"', head + '<link rel="icon"', 1)


def manifest(base):
    data = json.loads((STATIC / 'manifest.webmanifest').read_text())
    data.update({'id': base, 'start_url': base, 'scope': base, 'name': 'Reader demo'})
    for icon in data.get('icons', []):
        icon['src'] = rebase('"' + icon['src'], base)[1:]
    return json.dumps(data, indent=2) + '\n'


def guard(out, forbidden):
    """No exported text may name the vault's folder or the user's home folder."""
    for file in out.rglob('*'):
        if file.is_file() and file.suffix in TEXT_SUFFIXES:
            text = file.read_text(errors='ignore')
            for value in forbidden:
                if value and value in text:
                    raise ValueError(f'Refusing to publish {file.relative_to(out)}: it contains a local machine path')


def export(root, out, base='/', site_url=None, say=print):
    """Write the static demo of the demo vault at `root` into `out`. Returns a summary dict."""
    from ..web import WebLibrary, WebServer
    root, out, base = Path(root).resolve(), Path(out).expanduser().absolute(), normal_base(base)
    if site_url and not re.fullmatch(r'https://[^\s"\'<>]+/', site_url):
        raise ValueError('Expected --site-url as an https:// URL ending in /')
    check_output(out)
    out.mkdir(parents=True, exist_ok=True)
    clear(out)
    # The marker goes first, so an interrupted export can be retried into the same folder.
    (out / MARKER).write_text(json.dumps({'kind': MARKER_KIND, 'format': FORMAT}) + '\n')
    library = WebLibrary(root)
    server = WebServer(('127.0.0.1', 0), library, 'You')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        crawl = Crawler(f'http://127.0.0.1:{server.server_port}', out)
        boot = crawl.get('/api/library')
        me = boot['participant']
        crawl.get('/api/library', participant=me)
        for route in ('/api/themes', '/api/maintenance', '/api/inbox', '/api/link-counts', '/api/editions/diagnostics'):
            crawl.get(route)
        crawl.get('/api/inbox/events', after='0')
        for finished in (None, 'finished'):
            cursor = '0'
            while cursor is not None:
                data = crawl.get('/api/history', participant=me, cursor=cursor, tz='0', filter=finished)
                cursor = str(data['next_cursor']) if data and data.get('next_cursor') else None
        crawl.get('/api/queue', participant=me)
        for start, end in issue_windows(boot['works'], date.fromisoformat(boot['today'])):
            crawl.get('/api/issue', start=start, end=end)
        inbox = crawl.get('/api/inbox') or {}
        documents = [w['primary'] for w in boot['works']]
        chats, resolve = set(), {}
        pending = list(documents)
        done = set()
        while pending:
            path = pending.pop(0)
            if path in done:
                continue
            done.add(path)
            doc = crawl.get('/api/document', path=path, participant=me)
            crawl.get('/api/document', path=path)
            crawl.get('/api/preview', path=path, fragment='', participant=me)
            crawl.get('/api/queue', participant=me, current=path)
            for route in ('/api/links', '/api/standfirst', '/api/shape', '/api/editions'):
                crawl.get(route, path=path)
            crawl.get('/api/discussion', path=path, participant=me)
            artwork = crawl.get('/api/art', path=path) or {}
            for version in artwork.get('versions', []) if artwork.get('count', 0) > 1 else []:
                crawl.get('/api/art', path=path, edition=version['edition'], generation=version['generation'])
            readers = crawl.get('/api/readers', path=path, participant=me) or {}
            crawl.get('/api/next', path=path, participant=me)
            crawl.get('/api/changes', path=path, participant=me)
            for row in readers.get('readers', []):
                crawl.get('/api/changes', path=path, participant=me, against=row['participant'])
            versions = crawl.get('/api/versions', path=path, participant=me) or {}
            if versions.get('newer'):
                crawl.get('/api/changes', path=path, participant=me, successor='1')
            for member in versions.get('family', []):
                if member.get('path') and member['path'] not in done:
                    pending.append(member['path'])
            for history_path, commits in (versions.get('history') or {}).items():
                for commit in commits:
                    crawl.get('/api/version', path=history_path, commit=commit['commit'])
            for chat in (crawl.get('/api/chats', path=path) or {}).get('chats', []):
                chats.add(chat['id'])
            if doc and isinstance(doc.get('text'), str):
                table = {}
                for target in link_targets(doc['text']):
                    try:
                        table[target] = library.resolve(path, target)
                    except (ValueError, OSError):
                        table[target] = {'path': None, 'fragment': ''}
                if table:
                    resolve[path] = table
        for arrival in inbox.get('arrivals', []):
            if arrival.get('document'):
                crawl.get('/api/document', path=arrival['document'], participant=me)
                crawl.get('/api/document', path=arrival['document'])
                crawl.get('/api/preview', path=arrival['document'], fragment='', participant=me)
        for chat in sorted(chats):
            crawl.get('/api/chat', id=chat)
    finally:
        server.shutdown()
        server.server_close()
        library.close()
        thread.join(5)
    exported_at = datetime.now(timezone.utc).isoformat(timespec='seconds')
    api = out / 'data'
    (api / 'manifest.json').write_text(json.dumps({'format': FORMAT, 'participant': me, 'exported_at': exported_at, 'today': boot['today'],
                                                    'synthetic': list(SYNTHETIC), 'routes': crawl.routes}, ensure_ascii=False, separators=(',', ':')))
    (api / 'resolve.json').write_text(json.dumps(resolve, ensure_ascii=False, separators=(',', ':')))
    (api / 'search.json').write_text(json.dumps(search_index(root), ensure_ascii=False, separators=(',', ':')))
    (api / 'paths.json').write_text(json.dumps(sorted(str(p.relative_to(root)) for folder in ('library', 'inbox') for p in (root / folder).rglob('*')
                                                       if p.is_file() and not p.is_symlink() and not any(x.startswith('.') for x in p.relative_to(root).parts))))
    copy_tree(STATIC, out / 'assets', skip=lambda p: p.as_posix() in ('index.html',))
    for file in (out / 'assets').rglob('*'):
        if file.suffix in ('.mjs', '.css') and file.is_file():
            text = file.read_text()
            rebased = rebase(text, base)
            if rebased != text:
                file.write_text(rebased)
    (out / 'assets' / 'manifest.webmanifest').write_text(manifest(base))
    for folder in ('library', 'inbox'):
        copy_tree(root / folder, out / 'files' / folder)
    (out / 'index.html').write_text(page(base, site_url, exported_at))
    (out / '.nojekyll').write_text('')
    (out / 'robots.txt').write_text('User-agent: *\nAllow: /\n')
    (out / MARKER).write_text(json.dumps({'kind': MARKER_KIND, 'format': FORMAT, 'exported_at': exported_at}) + '\n')
    guard(out, [str(root), str(Path.home()), os.path.realpath(root)])
    files = [f for f in out.rglob('*') if f.is_file()]
    total = sum(f.stat().st_size for f in files)
    if len(files) > MAX_FILES or total > MAX_BYTES:
        raise ValueError(f'The export holds {len(files)} files and {total} bytes, over the {MAX_FILES} files / {MAX_BYTES // 1024**2} MiB budget')
    summary = {'out': str(out), 'base': base, 'routes': len(crawl.routes), 'files': len(files), 'bytes': total,
               'by_folder': {name: sum(f.stat().st_size for f in files if f.relative_to(out).parts[0] == name) for name in sorted({f.relative_to(out).parts[0] for f in files})}}
    say(f'Static demo: {len(files)} files, {total / 1024**2:.1f} MiB, {len(crawl.routes)} recorded routes, base path {base}')
    return summary
