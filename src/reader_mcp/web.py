"""Loopback-only Reader web application over the existing vault contracts."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path, PurePosixPath
import posixpath
import re
import numpy as np
import secrets
import sqlite3
import threading
import time
from urllib.parse import parse_qs, quote, urlsplit

from rapidfuzz import fuzz, process

from .annotations import Annotations
from .art import ArtMissing, ArtOwned, Studio
from .browse import Browse
from .bookmarks import Bookmarks
from .display import shown
from .companions import Companions, load_settings as companion_settings
from .coding_api import CodingJobs
from .coding_jobs import JobConflict, JobsOwned
from . import llm_inventory
from .changes import MAX_BLOB, SHA, TEXT_TYPES, Changes, Unavailable, bounded, diff, prose
from .editions import Editions
from . import embeds as embed_tree
from .engagement import ONE_OFF_RECEIPTS, Engagement
from .inbox_view import InboxView, RunConflict
from .writing import NOTEBOOK, Writing, WritingConflict
from .local_model import LocalModel
from .links import LinkError, LinkGraph, Resolver, excerpt, title_of
from .magazine import Magazine
from .maintenance import COMPANION_JOBS, Maintenance
from .metadata import parse_metadata
from .prose import Prose, ProseUnavailable
from .reading_queue import ReadingQueue
from .related import DIVERSE, SAME_EDITION, VAGUE, Related, base_title
from .search import PAGE_POOL, Search, excerpt as passage_excerpt
from .shape import Shapes
from .speech import MAX_TEXT, Speech, SpeechUnavailable
from .service import Service, health
from .web_access import WebAccess
from .themes import Themes
from .voice_runner import ChatOwned, Conversations
from .versions import Versions, split_ref

STATIC = Path(__file__).with_name('web_ui')
MAX_DOCUMENT = 4 * 1024**2
SEARCH_WAIT = 8  # seconds a content or semantic search waits for one already running
MAX_ASSET = 256 * 1024**2
MAX_SPOKEN_PDF = 64 * 1024**2
FRONTMATTER = re.compile(r'\ufeff?---\r?\n.*?\r?\n---(?:\r?\n|$)', re.S)
PAGE_MODES = ('best', 'words', 'meaning')
FACETS = {'project': 'projects', 'author': 'authors', 'type': 'types'}
WORK_FIELDS = ('id', 'title', 'primary', 'authors', 'projects', 'types', 'date', 'arrival_time', 'primary_format')
DAY = r'\d{4}-\d{2}-\d{2}'
FINISHED = 0.97        # reading progress that counts as finished
SEEDS = 5              # latest opens that steer queue suggestions
SUGGESTED = 10
SUGGEST_TTL = 60       # seconds a participant's generated suggestions are reused
HISTORY_PAGE = 40
TEXT_FORMATS = ('.md', '.markdown', '.txt')
MAX_RESOLVE_BATCH = 64
mimetypes.add_type('font/woff2', '.woff2')
mimetypes.add_type('application/manifest+json', '.webmanifest')


def utc_instant(value):
    """An ISO timestamp with an explicit zone as a UTC ISO string; None for a plain date or anything else.

    Plain `YYYY-MM-DD` values are calendar dates and stay as written; only instants are converted, so
    the browser can show them (and group them by day) in its own local time zone."""
    if not isinstance(value, str) or len(value) <= 10:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc).isoformat() if parsed.tzinfo else None


def page_filters(raw):
    """Validated search-page filters: lists of facet values, a date range, read state, folder, machine files."""
    if not isinstance(raw, dict) or set(raw) - {'project', 'author', 'type', 'from', 'to', 'from_at', 'to_at', 'read', 'folder', 'machine'}:
        raise ValueError('Unknown search filter')
    f = {}
    for name in FACETS:
        values = raw.get(name) or []
        values = [values] if isinstance(values, str) else values
        if not isinstance(values, list) or len(values) > 20 or any(not isinstance(v, str) or not 0 < len(v) <= 200 for v in values):
            raise ValueError(f'Expected at most 20 {name} values of 1–200 characters')
        f[name] = sorted(set(values))
    for name in ('from', 'to'):
        value = raw.get(name) or None
        if value is not None:
            if not isinstance(value, str) or not re.fullmatch(DAY, value):
                raise ValueError(f'Expected {name} as YYYY-MM-DD')
            datetime.strptime(value, '%Y-%m-%d')
        f[name] = value
    # The browser's local midnights for `from` and the day after `to`, so works that arrived at a known
    # instant are matched by their local day rather than their UTC day.
    for name in ('from_at', 'to_at'):
        value = raw.get(name) or None
        if value is not None and (not isinstance(value, str) or len(value) > 40 or utc_instant(value) is None):
            raise ValueError(f'Expected {name} as an ISO timestamp with a time zone')
        f[name] = utc_instant(value) if value else None
    f['read'] = raw.get('read') or 'all'
    if f['read'] not in ('all', 'unread', 'read'):
        raise ValueError('Expected read all, unread or read')
    folder = raw.get('folder') or None
    if folder is not None:
        if not isinstance(folder, str) or len(folder) > 1000 or not folder.startswith('library/') or '\\' in folder or any(
                part in ('', '.', '..') or part.startswith('.') for part in folder.rstrip('/').split('/')):
            raise ValueError('Expected a normalized library folder')
        folder = folder.rstrip('/') + '/'
    f['folder'] = folder
    machine = raw.get('machine', False)
    f['machine'] = machine in (True, '1', 'true')
    if machine not in (True, False, '1', '0', 'true', 'false', None, ''):
        raise ValueError('Expected machine as a boolean')
    return f


class WorkIndex:
    """Map an indexed file to its catalog work: the work's primary or catalog path, a reading copy of
    either, or any file inside a work's bundle folder (deepest folder wins). Other files stand alone,
    described from their own frontmatter."""

    def __init__(self, works):
        self.paths, self.folders = {}, {}
        for work in works:
            for path in (work['primary'], work.get('path')):
                if path:
                    self.paths.setdefault(path, work)
            catalog = work.get('path')
            if catalog and catalog != work['primary']:
                folder = posixpath.dirname(catalog)
                if folder != 'library' and work['primary'].startswith(folder + '/'):
                    self.folders.setdefault(folder, work)

    def known(self, path):
        found = self.paths.get(path) or self.paths.get(path.replace('.reading.', '.', 1))
        if found:
            return found
        folder = posixpath.dirname(path)
        while folder not in ('library', ''):
            if folder in self.folders:
                return self.folders[folder]
            folder = posixpath.dirname(folder)
        return None

    def __call__(self, path, metadata=None):
        found = self.known(path)
        if found:
            return {k: found.get(k) for k in WORK_FIELDS} | {'authors': found.get('authors') or ['Unspecified author'],
                    'projects': found.get('projects') or ['Unspecified project'], 'types': found.get('types') or ['Unspecified type']}
        m = metadata or {}
        def strings(value):
            return [v for v in ([value] if isinstance(value, str) else value if isinstance(value, list) else []) if isinstance(v, str) and v.strip()][:20]
        raw = next((m[k] for k in ('date', 'created', 'added') if isinstance(m.get(k), str) and re.match(DAY, m[k])), None)
        day, arrival = (raw[:10], utc_instant(raw)) if raw else (None, None)
        title = m.get('title') if isinstance(m.get('title'), str) and m['title'].strip() else PurePosixPath(path).stem.replace('-', ' ')
        return {'id': path, 'title': title, 'primary': path, 'authors': strings(m.get('author')) or ['Unspecified author'],
                'projects': strings(m.get('project')) or ['Unspecified project'],
                'types': strings(m.get('type') or m.get('writing_type')) or ['Unspecified type'], 'date': day, 'arrival_time': arrival,
                'primary_format': PurePosixPath(path).suffix.lower()}


class MissingDocument(ValueError, FileNotFoundError):
    """A well-formed library path with nothing at it; the API answers 404.
    It stays a ValueError, so path validators that refuse bad paths with ValueError still refuse it."""


class WebLibrary:
    def __init__(self, root, font_fetcher=None, maintenance_runners=None, inbox_environ=None, chat_options=None, local_model=None, prose=None, service_runner=None, environ=None, writing_options=None, companions=None, art_options=None, coding_options=None):
        self.root = Path(root).expanduser().resolve(strict=True)
        self.access = WebAccess(self.root, environ)
        self.service = Service(service_runner)
        self.inbox = InboxView(self.root, environ=inbox_environ)
        self.links = LinkGraph(self.root, primaries=lambda: [w['primary'] for w in self.works()[0]])
        self.maintenance = Maintenance(self.root, maintenance_runners, links=self.links)
        self.local_model = LocalModel(self.root, self, **(local_model or {}))
        self.prose = prose or Prose()
        self.related = Related(self.root)
        self.editions = Editions(self.root)
        self.history = Changes(self.root)
        self.versions = Versions(self.history)
        self.themes = Themes(self.root, font_fetcher) if font_fetcher else Themes(self.root)
        self.engagement = Engagement(self.root)
        self.annotations = Annotations(self.root)
        self.bookmarks = Bookmarks(self.root)
        self.speech = Speech()
        self.queue = ReadingQueue(self.root, self.path)
        self.suggestions = {}
        self.engine = Search(self.root)
        self.search_lock = threading.Lock()
        self.hashes = {}
        self.embed_texts = embed_tree.Texts()
        self.magazine = Magazine(self)
        self.shapes = Shapes(self)
        self.conversations = Conversations(self.root, self.chat_document, **(chat_options or {}))
        self.writing = Writing(self.root, self.path, self.digest, **(writing_options or {}))
        self.companions = Companions(self.root, prose=self.prose, speech=self.speech, maintenance=self.maintenance,
                                     local_model=self.local_model, **(companions or {}))
        self.maintenance.runners.update(self.companions.runners())
        # Colorful set in Behind the scenes, then the copy Reader built, before PATH and the usual folders.
        tooled = self.root / '.reader/tooling/bin/colorful'
        self.prose.configured = lambda: [(o, p) for o, p in (('settings', companion_settings(self.root).get('colorful')), ('reader-tooling', str(tooled))) if p]
        self.art = Studio(self.root, self, **(art_options or {}))
        # Coding jobs (RW-44): article prompts run in registered repositories; see coding_jobs.py.
        self.jobs = CodingJobs(self.root, self.article_source, **(coding_options or {}))
        self.jobs.start()

    def path(self, value, preview=False):
        """A library file; with `preview`, also an inbox arrival file (read-only views only)."""
        if not isinstance(value, str) or '\\' in value or '\x00' in value:
            raise ValueError('Expected a library-relative path')
        parts = value.split('/')
        allowed = value.startswith('library/') or preview and value.startswith('inbox/')
        if not allowed or any(p in ('', '.', '..') or p.startswith('.') for p in parts):
            raise ValueError('Expected a normalized library-relative path')
        file = self.root / value
        if any(p.is_symlink() for p in (file, *file.parents) if p != self.root):
            raise ValueError('Library paths must not cross symlinks')
        if not file.exists():
            raise MissingDocument('No document at this path. It may have moved or been renamed.')
        if not file.is_file() or file.stat().st_size > MAX_ASSET:
            raise ValueError('Expected a regular library file of at most 256 MiB')
        return file

    def link_source(self, value):
        """A link source: a document (see `path`), or a draft that has no file yet, written as its folder with a
        trailing slash (`library/notebook/`). The folder must be a real library folder, or the scratch pad's
        notebook folder before its first save. Returns the path the resolver works from."""
        if not (isinstance(value, str) and value.startswith('library/') and value.endswith('/')):
            self.path(value, preview=True)
            return value
        folder = value[:-1]
        if '\\' in folder or '\x00' in folder or any(p in ('', '.', '..') or p.startswith('.') for p in folder.split('/')):
            raise ValueError('Expected a normalized library-relative folder')
        directory = self.root / folder
        if any(p.is_symlink() for p in (directory, *directory.parents) if p != self.root):
            raise ValueError('Library paths must not cross symlinks')
        notebook = folder == NOTEBOOK and not directory.exists() and directory.parent.is_dir()
        if not (directory.is_dir() or notebook):
            raise MissingDocument('No folder at this path.')
        return value

    def digest(self, path, preview=False):
        file = self.path(path, preview)
        before = file.stat()
        identity = (before.st_ino, before.st_mtime_ns, before.st_ctime_ns, before.st_size)
        cached = self.hashes.get(path)
        if cached and cached[0] == identity:
            return cached[1]
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        after = file.stat()
        if (after.st_ino, after.st_mtime_ns, after.st_ctime_ns, after.st_size) != identity:
            raise ValueError('Document changed while reading; reopen it')
        if len(self.hashes) >= 10000:
            self.hashes.clear()
        self.hashes[path] = (identity, digest)
        return digest

    def article_source(self, path):
        """(text, SHA-256) of a current library Markdown document, read once, for coding-job admission."""
        file = self.path(path)
        if file.suffix.lower() not in ('.md', '.markdown') or file.stat().st_size > MAX_DOCUMENT:
            raise ValueError('Coding jobs start only from library Markdown documents of at most 4 MiB')
        data = file.read_bytes()
        return data.decode('utf-8'), hashlib.sha256(data).hexdigest()

    def chat_document(self, path, inline=False):
        """Identity of a chat's document; its text only for a voice that cannot read files."""
        self.path(path)  # library documents only: unfiled inbox previews are never chat subjects
        doc = self.document(path)
        return {'path': path, 'title': str(doc['title'])[:500], 'sha256': doc['sha256'], 'text': doc['text'] if inline else None}

    def close(self):
        self.jobs.close()
        self.art.close()
        self.conversations.close()
        self.local_model.close()

    def works(self):
        path = self.root / 'indexes/coverage.json'
        if path.exists():
            if path.is_symlink() or path.parent.is_symlink() or path.stat().st_size > 16 * 1024**2:
                raise ValueError('Unsafe or oversized work inventory')
            data = json.loads(path.read_text())
            works = data['works']
            as_of = data.get('as_of')
        else:
            browse = Browse(self.root)
            works = browse.inventory(browse.settings())
            as_of = datetime.now(timezone.utc).date().isoformat()
        if not isinstance(works, list) or len(works) > 10000:
            raise ValueError('Work inventory exceeds 10,000 works')
        return works, as_of

    def bootstrap(self, participant):
        participant = self.engagement.participant(participant)
        works, as_of = self.works()
        receipts = self.engagement.receipts()
        record = next((r['items'] for r in receipts if r['participant'] == participant), {})
        voices = Counter(key[len('document:'):] for r in receipts if r['participant'] != participant
                         for key in r['items'] if key.startswith('document:'))
        open_threads = Counter()
        rows = []
        for w in works:
            path = w['primary']
            receipt = record.get('document:' + path)
            read = False
            if receipt:
                try:
                    read = self.digest(path) == receipt['version']
                except (ValueError, OSError):
                    pass
            rows.append({k: w.get(k) for k in ('id', 'title', 'primary', 'authors', 'topics', 'projects', 'types', 'date', 'arrival_time', 'date_basis', 'primary_format', 'primary_bytes')} | {
                'read': read, 'read_at': receipt['at'] if receipt else None, 'voices': voices[path]})
        pending = []
        thread_count = 0
        discussion = {'open': 0, 'resolved': 0, 'highlights': 0, 'warnings': 0, 'comments': 0}
        discussion_paths = {'open': set(), 'resolved': set()}
        for thread in self.engagement.inventory():
            thread_count += 1
            status = 'resolved' if thread.get('resolved') else 'open'
            discussion[status] += 1
            discussion_paths[status].add(thread['document_path'])
            if status == 'open':
                open_threads[thread['document_path']] += 1
            discussion['warnings' if thread.get('kind') == 'warning' else 'highlights'] += 1
            discussion['comments'] += len(thread['comments'])
            item = self.engagement.thread_items(thread)[-1]
            if record.get(item['key'], {}).get('version') != item['version']:
                pending.append({'id': thread['id'], 'path': thread['document_path'], 'owner': thread['owner'],
                                'quote': thread['anchor']['quote'][:220], 'comments': len(thread['comments']),
                                'at': thread['comments'][-1]['created_at'] if thread['comments'] else thread['created_at']})
        for row in rows:
            row['threads'] = open_threads[row['primary']]
        today = datetime.now(timezone.utc).date()
        read = sum(w['read'] for w in rows)
        return {'participant': participant, 'participants': [r['participant'] for r in receipts], 'works': rows,
                'as_of': as_of, 'today': today.isoformat(),
                'metrics': {'works': len(rows), 'read': read, 'unread': len(rows) - read,
                            'authors': len({a for w in rows for a in w['authors']}), 'threads': thread_count},
                'discussion': discussion | {'paths': {key: sorted(paths) for key, paths in discussion_paths.items()}},
                'pending': sorted(pending, key=lambda t: t['at'], reverse=True)[:12],
                'recent': sorted((w for w in rows if w['read_at']), key=lambda w: w['read_at'], reverse=True)[:50],
                'scope': 'Grouped catalog works; read status refers to the current primary source. Timestamps are UTC instants; the browser groups them by its local day.'}

    def document(self, path, participant='You'):
        # Inbox arrivals open as plain previews: no receipts, bookmarks or discussion.
        preview = isinstance(path, str) and path.startswith('inbox/')
        file = self.path(path, preview)
        digest = self.digest(path, preview)
        kind = file.suffix.lower()
        data = None
        if kind not in ('.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'):
            if file.stat().st_size > MAX_DOCUMENT:
                raise ValueError('This document exceeds the 4 MiB browser text limit; open the original file')
            data = file.read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('Document changed while reading; reopen it')
        metadata = parse_metadata(data).metadata if data is not None and kind in ('.md', '.markdown') else {}
        return {'path': path, 'sha256': digest, 'kind': kind, 'text': data.decode('utf-8') if data is not None else None,
                'title': metadata.get('title') or file.stem.replace('-', ' '), 'metadata': metadata,
                'file_url': '/api/file?path=' + quote(path, safe=''),
                'item': None if preview else {'key': 'document:' + path, 'version': digest},
                'preview': preview, 'bookmark': None if preview else self.bookmarks.get(participant, path)}

    def speak(self, path, source_sha256, scope='article', start=None, end=None, page=None):
        """Queue the exact viewed edition, or a code-point slice of it, with AI-TTS."""
        if scope not in ('article', 'from', 'selection'):
            raise ValueError('Expected an article, from or selection scope')
        for name, value in (('start', start), ('end', end), ('page', page)):
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError(f'Expected a non-negative integer {name}')
        file = self.path(path)
        if self.digest(path) != source_sha256:
            raise ValueError('Source changed; reopen it before sending it to AI-TTS')
        kind = file.suffix.lower()
        if kind == '.pdf':
            if scope == 'selection':
                raise ValueError('Speaking a PDF selection is not supported; use From here or the whole PDF')
            text, title = self.pdf_text(file, source_sha256, page if scope == 'from' else None), file.stem.replace('-', ' ')
            fmt = 'plain_text'
        elif kind in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'):
            raise ValueError('Images have no text to speak')
        else:
            document = self.document(path)
            if document['sha256'] != source_sha256:
                raise ValueError('Source changed; reopen it before sending it to AI-TTS')
            raw, title = document['text'], document['title']
            markdown = kind in ('.md', '.markdown')
            body = FRONTMATTER.match(raw).end() if markdown and FRONTMATTER.match(raw) else (1 if raw.startswith('\ufeff') else 0)
            if scope == 'article':
                text = raw[body:]
            elif scope == 'from':
                if start is None or start > len(raw):
                    raise ValueError('Expected a start offset inside the document')
                text = raw[max(body, start):]
            else:
                if start is None or end is None or not start < end <= len(raw):
                    raise ValueError('Expected a selection inside the document')
                text = raw[max(body, start):end]
            fmt = 'markdown' if markdown else 'plain_text'
        title = ' '.join(str(title or '').split())
        lead = text.lstrip().lstrip('#').strip()
        if title and not lead.startswith(title):
            text = title + ('' if title[-1] in '.?!:' else '.') + '\n\n' + text
        return self.speech.submit(text, fmt, scope) | {'scope': scope}

    def pdf_text(self, file, digest, page=None):
        from pypdf import PdfReader
        import io
        if file.stat().st_size > MAX_SPOKEN_PDF:
            raise ValueError('PDFs larger than 64 MiB cannot be sent to AI-TTS')
        data = file.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('Source changed; reopen it before sending it to AI-TTS')
        try:
            pdf = PdfReader(io.BytesIO(data))
            count = len(pdf.pages)
        except Exception as exc:  # pypdf raises its own error types for malformed files.
            raise ValueError('Couldn’t read this PDF’s text layer') from exc
        if count > 5000:
            raise ValueError('PDF exceeds 5000-page limit')
        first = (page or 1) - 1
        if not 0 <= first < count:
            raise ValueError('Expected a page inside the PDF')
        parts, size = [], 0
        for number in range(first, count):
            try:
                text = (pdf.pages[number].extract_text() or '').strip()
            except Exception as exc:
                raise ValueError(f'Couldn’t read the text of PDF page {number + 1}') from exc
            size += len(text.encode()) + 2
            if size > MAX_TEXT:
                raise ValueError('This PDF’s text exceeds the 512 KiB AI-TTS limit. Use From here on a later page.')
            if text:
                parts.append(text)
        if not parts:
            raise ValueError('This PDF has no text layer to speak' + (' from this page' if page else ''))
        return '\n\n'.join(parts)

    def search(self, query, mode, limit=30, path_prefix='library/'):
        if not query.strip() or len(query) > 1000 or mode not in ('fuzzy', 'keyword', 'semantic'):
            raise ValueError('Expected a query of 1–1000 characters and fuzzy, keyword or semantic mode')
        if not isinstance(path_prefix, str) or not path_prefix.startswith('library/') or '\\' in path_prefix or any(part in ('', '.', '..') or part.startswith('.') for part in path_prefix.rstrip('/').split('/')):
            raise ValueError('Expected a normalized library folder prefix')
        path_prefix = path_prefix.rstrip('/') + '/'
        if mode == 'fuzzy':
            works, as_of = self.works()
            works = [work for work in works if work['primary'].startswith(path_prefix)]
            choices = {i: ' '.join([w['title'], w['primary'], *w['authors']]).casefold() for i, w in enumerate(works)}
            matches = process.extract(query.casefold(), choices, scorer=fuzz.WRatio, limit=limit, score_cutoff=48)
            return {'results': [dict(works[i], path=works[i]['primary'], matched_by=['fuzzy'], score=score / 100) for _, score, i in matches],
                    'mode': mode, 'indexed_at': as_of, 'warnings': [], 'scope': 'Titles, paths and authors in the maintained work inventory.'}
        # One content search at a time; a second one queues briefly instead of failing at once.
        if not self.search_lock.acquire(timeout=SEARCH_WAIT):
            raise BlockingIOError('Another content search is still running; try again shortly')
        try:
            result = self.engine.search(query, mode=mode, limit=limit, path_prefix=path_prefix)
        finally:
            self.search_lock.release()
        # The engine's absolute_path is for local agents (the MCP tools); the browser opens vault-relative paths.
        return result | {'results': [{k: v for k, v in row.items() if k != 'absolute_path'} for row in result['results']]}

    def search_page(self, query, mode='best', filters=None, offset=0, limit=20, participant='You'):
        """Passages grouped by work, with facets, for the full search page (see docs/web.md)."""
        if mode not in PAGE_MODES:
            raise ValueError('Expected mode best, words or meaning')
        if not isinstance(query, str) or not query.strip() or len(query) > 1000:
            raise ValueError('Expected a query of 1–1000 characters')
        if type(offset) is not int or type(limit) is not int or not 0 <= offset <= PAGE_POOL or not 1 <= limit <= 50:
            raise ValueError('Expected offset 0–500 and limit 1–50 works')
        f = page_filters(filters or {})
        works, _ = self.works()
        work_of = WorkIndex(works)
        read_of, read_cache = self.reader(participant), {}
        def is_read(work):
            if work['primary'] not in read_cache:
                read_cache[work['primary']] = read_of(work['primary'])
            return read_cache[work['primary']]
        def in_range(w):
            at = utc_instant(w.get('arrival_time'))
            if at and (f['from_at'] or f['to_at']):
                when = datetime.fromisoformat(at)
                return ((not f['from_at'] or when >= datetime.fromisoformat(f['from_at']))
                        and (not f['to_at'] or when < datetime.fromisoformat(f['to_at'])))
            return (not f['from'] or (w['date'] or '') >= f['from']) and (not f['to'] or bool(w['date']) and w['date'] <= f['to'])
        tests = {
            'project': lambda w: not f['project'] or bool(set(f['project']) & set(w['projects'])),
            'author': lambda w: not f['author'] or bool(set(f['author']) & set(w['authors'])),
            'type': lambda w: not f['type'] or bool(set(f['type']) & set(w['types'])),
            'date': in_range,
            'read': lambda w: f['read'] == 'all' or is_read(w) == (f['read'] == 'read')}
        metadata = {}
        def work(path, doc=None):
            if path not in metadata:
                try:
                    metadata[path] = json.loads(doc['metadata'] or '{}') if doc and work_of.known(path) is None else {}
                except ValueError:
                    metadata[path] = {}
            return work_of(path, metadata[path])
        def passes(skip=None):
            return lambda path, doc: all(test(work(path, doc)) for name, test in tests.items() if name != skip)
        relaxed = [name for name in FACETS if f[name]]
        # Like search(): wait briefly for a running search instead of refusing at once (#57).
        if not self.search_lock.acquire(timeout=SEARCH_WAIT):
            raise BlockingIOError('Another content search is still running; try again shortly')
        try:
            result = self.engine.passages(query, {'best': 'hybrid', 'words': 'keyword', 'meaning': 'semantic'}[mode],
                                          path_prefix=f['folder'] or 'library/', include_machine=f['machine'],
                                          allow=[passes(), *(passes(name) for name in relaxed)])
        finally:
            self.search_lock.release()
        pools = dict(zip(['all', *relaxed], result['pools']))
        truncated = any(result['truncated'])
        grouped, warnings = {}, list(result['warnings'])
        for candidate in pools['all']:
            w = work(candidate['path'])
            entry = grouped.setdefault(w['id'], {'work': w, 'score': candidate['score'], 'passages': []})
            if len(entry['passages']) >= 3:
                continue
            text, spans, line = passage_excerpt(candidate['text'], result['words'], candidate['start_line'])
            core = text[spans[0][0]:spans[-1][1]] if spans else text.strip('…')
            # Overlapping chunks and copies of one passage (an original and its reading copy) show once.
            if any(p['path'] == candidate['path'] and p['line'] == line or core and (core in p['excerpt'] or p['core'] in text)
                   for p in entry['passages']):
                continue
            entry['passages'].append({'path': candidate['path'], 'page': candidate['page'],
                'start_line': candidate['start_line'], 'end_line': candidate['end_line'], 'line': line,
                'excerpt': text, 'spans': spans, 'matched_by': candidate['matched_by'], 'literal': candidate['literal'],
                'sha256': result['docs'][candidate['path']]['sha256'], 'core': core})
        ordered = list(grouped.values())
        rows, changed = [], False
        for entry in ordered[offset:offset + limit]:
            passages = []
            for passage in entry['passages']:
                try:
                    current = self.digest(passage['path'])
                except (ValueError, OSError):
                    current = None
                passage.pop('core')
                if current != passage.pop('sha256'):
                    changed = True  # Never show text the source no longer contains.
                    continue
                passages.append(passage)
            if not passages:
                continue
            w = entry['work']
            rows.append({k: w.get(k) for k in WORK_FIELDS} | {'read': is_read(w), 'score': entry['score'], 'passages': passages})
        if changed:
            warnings.append('Some sources changed since the index was built; their passages are hidden until it is rebuilt.')
        facets = {}
        for name in FACETS:
            counts = Counter()
            seen = set()
            for candidate in pools.get(name, pools['all']):
                w = work(candidate['path'])
                if w['id'] not in seen:
                    seen.add(w['id'])
                    counts.update(set(w[FACETS[name]]))
            top = dict(counts.most_common(40))
            # Selected values count the results they produce, so a checked box matches the result list.
            chosen = Counter(v for w in {work(c['path'])['id']: work(c['path']) for c in pools['all']}.values()
                             for v in set(w[FACETS[name]]) if v in f[name])
            facets[name] = top | {value: chosen.get(value, 0) for value in f[name]}
        # Subfolders one level below the current folder scope, counted in works.
        depth = len((f['folder'] or 'library/').rstrip('/').split('/')) + 1
        folders = {}
        for candidate in pools['all']:
            parts = candidate['path'].split('/')
            if len(parts) > depth:
                folders.setdefault('/'.join(parts[:depth]) + '/', set()).add(work(candidate['path'])['id'])
        facets['folder'] = dict(Counter({k: len(v) for k, v in folders.items()}).most_common(12))
        return {'query': query, 'mode': mode, 'terms': result['words'], 'filters': f, 'works': rows, 'total': len(ordered),
                'offset': offset, 'limit': limit, 'facets': facets,
                'facet_scope': 'top' if truncated else 'all', 'pool': PAGE_POOL,
                'indexed_at': result['indexed_at'], 'complete': result['complete'],
                'semantic': result['semantic'], 'warnings': warnings,
                'scope': 'Indexed reading material, grouped by catalog work; facets count works.'}

    def exists(self, path):
        try:
            self.path(path)
            return True
        except (ValueError, OSError):
            return False

    def resolve(self, source, target, resolver=None):
        """A click on a link; the link graph resolves stored links with the same `Resolver`."""
        self.link_source(source)
        if source.startswith('inbox/') and isinstance(target, str) and len(target) <= 2000 and not urlsplit(target).scheme and not target.startswith(('/', '//', 'library/')):
            # An inbox preview may resolve its own bundle's attachments; library documents stay in library/.
            bundle = '/'.join(source.split('/')[:2]) + '/'
            path, _, fragment = target.partition('#')
            candidate = posixpath.normpath(str(PurePosixPath(source).parent / path)) if path else ''
            if candidate.startswith(bundle):
                for option in (candidate, candidate + '.md'):
                    try:
                        self.path(option, preview=True)
                        return {'path': option, 'fragment': fragment}
                    except (ValueError, OSError):
                        pass
        # A folder source resolves like a file inside that folder.
        path, fragment, _ = (resolver or self.resolver)().resolve(source + 'draft.md' if source.endswith('/') else source, target)
        return {'path': path, 'fragment': fragment}

    def resolver(self):
        works, _ = self.works()
        return Resolver(self.exists, self.links.file_paths(), [w['primary'] for w in works])

    def backlinks(self, path):
        """Documents that link here; the first request on a vault starts a quiet background build."""
        self.path(path)
        result = self.links.inbound(path)
        if result is None:
            failed = next((j for j in self.maintenance.status()['jobs'] if j['kind'] == 'links'), None)
            if failed and failed['state'] == 'failed':
                return {'state': 'failed', 'error': failed['error'], 'inbound': [], 'inbound_count': 0, 'outbound_count': 0, 'built_at': None, 'stale': True}
            try:
                self.maintenance.start('links', quiet=True)
            except BlockingIOError:
                pass  # A refresh, or another job, is running; the client asks again.
            return {'state': 'building', 'inbound': [], 'inbound_count': 0, 'outbound_count': 0, 'built_at': None, 'stale': True}
        return result | {'state': 'ready', 'stale': self.links.stale()}

    def preview(self, path, fragment='', participant='You'):
        """A short, plain-text preview of a library document (or an inbox arrival, read-only) for a link hover."""
        arrival = isinstance(path, str) and path.startswith('inbox/')
        file = self.path(path, preview=arrival)
        if not isinstance(fragment, str) or len(fragment) > 500:
            raise ValueError('Expected a short fragment')
        works, _ = self.works()
        work = next((w for w in works if w['primary'] == path), None)
        kind = file.suffix.lower()
        metadata, heading, text = {}, None, ''
        if kind in ('.md', '.markdown') and file.stat().st_size <= MAX_DOCUMENT:
            data = file.read_bytes()[:MAX_DOCUMENT]
            metadata = parse_metadata(data).metadata
            heading, text = excerpt(data.decode('utf-8', 'replace'), fragment)
            title = title_of(data, path)
        else:
            title = file.stem.replace('-', ' ')
        author = metadata.get('author')
        authors = (work or {}).get('authors') or ([author] if isinstance(author, str) else [a for a in author if isinstance(a, str)] if isinstance(author, list) else [])
        project = next((p for p in (work or {}).get('projects') or [] if isinstance(p, str) and not p.startswith('Unspecified')), None) or (metadata.get('project') if isinstance(metadata.get('project'), str) else None)
        return {'path': path, 'title': (work or {}).get('title') or title, 'authors': authors[:6], 'project': project,
                'read': True if arrival else self.reader(participant)(path), 'kind': kind, 'heading': heading, 'excerpt': text[:600]}

    def link_counts(self):
        works, _ = self.works()
        result = self.links.counts([w['primary'] for w in works])
        return result if result is not None else {'counts': {}, 'built_at': None}

    def resolve_many(self, source, targets):
        """Resolve up to MAX_RESOLVE_BATCH links from one document, in order; one inventory read."""
        if not isinstance(targets, list) or len(targets) > MAX_RESOLVE_BATCH:
            raise ValueError(f'Expected at most {MAX_RESOLVE_BATCH} link targets')
        self.link_source(source)  # Inbox previews resolve their bundle's images too; a draft resolves from its folder.
        cache, results = [], []

        def resolver():
            if not cache:
                cache.append(self.resolver())
            return cache[0]
        for target in targets:
            try:
                results.append(self.resolve(source, target, resolver))
            except (ValueError, OSError) as exc:
                results.append({'error': str(exc)})
        return {'results': results}

    def embeds(self, source, targets, ancestors=(), depth=0):
        """The resolved embed tree of `targets` written in `source` (see embeds.tree): one request instead of a fetch per embed."""
        return embed_tree.tree(self, source, targets, ancestors, depth, self.embed_texts)

    def reader(self, participant):
        """A predicate: has this participant read the current edition of a path?"""
        participant = self.engagement.participant(participant)
        record = next((receipt['items'] for receipt in self.engagement.receipts()
                       if receipt['participant'] == participant), {})
        def read(path):
            receipt = record.get('document:' + path) if path else None
            if not receipt:
                return False
            try:
                return self.digest(path) == receipt['version']
            except (ValueError, OSError):
                return False
        return read

    def edition_paths(self, path):
        """Other library paths that hold earlier editions of this work: the members of its
        edition family (RW-05) ordered before `path`, so a newer version never counts as earlier."""
        try:
            paths = [entry['path'] for entry in self.editions.family(path)['family']]
        except (ValueError, OSError, KeyError):
            return []
        return paths[:paths.index(path)] if path in paths else []

    def readers(self, path, participant):
        """The reading log of one document: who read this exact edition, or an earlier one, and when."""
        you = self.engagement.participant(participant)
        current = self.digest(path)
        others = [p for p in self.edition_paths(path) if p != path]
        voices = self.engagement.voices()
        threads = Counter()
        for thread in self.engagement.inventory(path):
            for name in {thread['owner'], *(c['author'] for c in thread['comments'])}:
                threads[name] += 1
        readers = []
        for receipt in self.engagement.receipts():
            name, items = receipt['participant'], receipt['items']
            entry = items.get('document:' + path)
            state = None
            if entry:
                state = 'current' if entry.get('version') == current else 'earlier'
            else:
                earlier = [items['document:' + p] for p in others if 'document:' + p in items]
                if earlier:
                    entry, state = max(earlier, key=lambda e: e['at']), 'earlier'
            if not state:
                continue
            group = self.engagement.group(name, you, voices)
            documents = sum(key.startswith('document:') for key in items)
            readers.append({'participant': name, 'group': group, 'state': state, 'at': entry['at'], 'version': entry.get('version'),
                            'threads': threads[name], 'folded': group == 'agent' and documents < ONE_OFF_RECEIPTS})
        rank = {'voice': 0, 'you': 1, 'agent': 2}
        readers.sort(key=lambda r: r['at'], reverse=True)
        readers.sort(key=lambda r: (r['folded'], rank[r['group']]))
        return {'path': path, 'version': current, 'participant': you, 'readers': readers,
                'folded': sum(r['folded'] for r in readers), 'one_off_threshold': ONE_OFF_RECEIPTS}

    def family(self, path):
        """The edition family of a library file; a family of one when it has no siblings."""
        self.path(path)
        return self.editions.family(path)

    def text(self, path):
        file = self.path(path)
        if file.suffix.lower() not in TEXT_TYPES:
            raise ValueError('What changed covers Markdown and plain-text documents only')
        if file.stat().st_size > MAX_BLOB:
            raise ValueError('What changed is limited to documents of at most 4 MiB')
        data = file.read_bytes()
        return data, hashlib.sha256(data).hexdigest()

    def compare(self, old, new):
        try:
            stats, hunks = diff(old.decode('utf-8'), new.decode('utf-8'))
        except UnicodeDecodeError as exc:
            raise ValueError('Only UTF-8 text can be compared') from exc
        hunks, truncated = bounded(hunks)
        return {'stats': stats, 'hunks': hunks, 'truncated': truncated,
                'prose_changed': any(stats[k] for k in ('added', 'removed', 'reworded'))}

    def same_prose(self, path, version, current):
        """True when the edition `version` reads the same as `current`; unknown editions count as different."""
        if not isinstance(version, str) or not SHA.match(version):
            return False
        try:
            old, _ = self.history.recover(path, version)
            return prose(old.decode('utf-8')) == prose(current.decode('utf-8'))
        except (Unavailable, BlockingIOError, UnicodeDecodeError, ValueError, OSError):
            return False

    def annotation_summary(self, path):
        """Where each thread's passage is in the current edition: exact, relocated, orphaned or ambiguous."""
        try:
            threads = self.annotations.list(path)['threads']
        except (ValueError, OSError):
            return None
        counts = Counter(t['location']['status'] for t in threads)
        return {key: counts.get(key, 0) for key in ('exact', 'relocated', 'orphaned', 'ambiguous')} | {
            'threads': [{'owner': t['owner'], 'kind': t.get('kind', 'highlight'), 'status': t['location']['status'],
                         'quote': t['anchor']['quote'][:160]} for t in threads[:50]]}

    def changes(self, path, participant, against=None, successor=False):
        """What changed since `participant` (or `against`) read `path`, or against its newer version."""
        current, digest = self.text(path)
        if successor:
            newer = self.editions.family(path)['newer']
            if not newer:
                raise ValueError('This document has no newer version')
            other, other_digest = self.text(newer['path'])
            return {'path': path, 'status': 'changed' if other_digest != digest else 'unchanged', 'successor': newer['path'],
                    'successor_revision': newer['revision'], 'current_version': digest, 'read_version': digest,
                    'annotations': self.annotation_summary(path)} | self.compare(current, other)
        participant = self.engagement.participant(participant)
        key = 'document:' + path
        receipts = {r['participant']: r['items'] for r in self.engagement.receipts()}
        whose = participant
        if against is not None:
            against = self.engagement.participant(against)
            if key not in receipts.get(against, {}):
                raise ValueError('No receipt for that participant and document')
            whose = against
        # Another reader's edition is offered only when its prose differs from the current one.
        others = [{'participant': name, 'read_at': items[key]['at']} for name, items in sorted(
                      ((n, i) for n, i in receipts.items() if n not in (participant, against) and key in i and i[key].get('version') != digest),
                      key=lambda pair: pair[1][key]['at'], reverse=True)[:5]
                  if not self.same_prose(path, items[key].get('version'), current)]
        result = {'path': path, 'participant': participant, 'against': against, 'current_version': digest, 'others': others}
        record = receipts.get(whose, {}).get(key)
        if not record:
            return result | {'status': 'unread'}
        result |= {'read_at': record.get('at'), 'read_version': record.get('version')}
        if record.get('version') == digest:
            return result | {'status': 'unchanged'}
        if not isinstance(record.get('version'), str) or not SHA.match(record['version']):
            return result | {'status': 'unavailable', 'reason': 'The receipt does not name a file version'}
        try:
            old, recovery = self.history.recover(path, record['version'])
        except Unavailable as exc:
            return result | {'status': 'unavailable', 'reason': str(exc)}
        return result | {'status': 'changed', 'recovery': recovery, 'annotations': self.annotation_summary(path)} | self.compare(old, current)

    def explore(self, path, participant, hashes=False):
        """The version explorer: edition family, each member's git history, and read markers."""
        self.path(path)
        participant = self.engagement.participant(participant)
        family = self.editions.family(path)

        def current_bytes(member):
            try:
                file = self.path(member)
                return file.read_bytes() if file.stat().st_size <= MAX_BLOB else None
            except (ValueError, OSError):
                return None

        def digest(member):
            try:
                return self.digest(member)
            except (ValueError, OSError):
                return None
        receipts = {r['participant']: r['items'] for r in self.engagement.receipts()}
        return self.versions.explore(family, current_bytes, receipts, participant, digest, with_hashes=hashes)

    def version(self, path, commit):
        """A document as it was at `commit`: the same shape as `document`, read-only and without receipts."""
        file = self.path(path)
        if file.suffix.lower() not in TEXT_TYPES:
            raise ValueError('Historical versions cover Markdown and plain-text documents only')
        try:
            data, entry = self.versions.blob(path, commit)
        except Unavailable as exc:
            raise ValueError(str(exc)) from exc
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError as exc:
            raise ValueError('Only UTF-8 text versions can be shown') from exc
        kind = file.suffix.lower()
        metadata = parse_metadata(data).metadata if kind in ('.md', '.markdown') else {}
        return {'path': path, 'commit': entry['commit'], 'short': entry['short'], 'date': entry['date'], 'author': entry['author'],
                'subject': entry['subject'], 'historical': True, 'sha256': hashlib.sha256(data).hexdigest(), 'kind': kind, 'text': text,
                'title': metadata.get('title') or file.stem.replace('-', ' '), 'metadata': metadata,
                'file_url': '/api/file?path=' + quote(path, safe=''), 'item': None, 'bookmark': None}

    def ref_text(self, ref):
        path, commit = split_ref(ref)
        if commit is None:
            return self.text(path)[0], {'ref': ref, 'path': path}
        self.text(path)  # Validates the path and type.
        try:
            data, entry = self.versions.blob(path, commit)
        except Unavailable as exc:
            raise ValueError(str(exc)) from exc
        return data, {'ref': ref, 'path': path, 'commit': entry['commit'], 'short': entry['short'], 'date': entry['date']}

    def compare_refs(self, a, b):
        """Any two versions: a file's current bytes (`<path>`) or a historical one (`<path>@<commit>`)."""
        old, left = self.ref_text(a)
        new, right = self.ref_text(b)
        result = {'a': left, 'b': right, 'status': 'unchanged' if old == new else 'changed'}
        if 'commit' not in right:
            result['annotations'] = self.annotation_summary(right['path'])
        return result | self.compare(old, new)

    def next_reads(self, path, participant):
        self.path(path)
        works, _ = self.works()
        read = self.reader(participant)
        return self.related.suggest(path, works, lambda work: read(work['primary']))

    def colorize(self, request):
        """Prose roles for visible text of the open, current edition only."""
        if not isinstance(request, dict) or set(request) != {'path', 'sha256', 'segments'}:
            raise ValueError('Expected {"path", "sha256", "segments"}')
        path = request['path']
        if self.digest(path) != request['sha256']:
            raise ValueError('Source changed; reopen before coloring prose')
        return self.prose.colorize((path, request['sha256']), request['segments'])

    # Reading queue and history ----------------------------------------------
    def entry(self, path, works, read, marks):
        """One queue or history row: catalog fields plus progress on the current edition."""
        try:
            digest = self.digest(path)
        except (ValueError, OSError):
            return None
        work = works.get(path) or {}
        mark = marks.get(path)
        progress = mark['progress'] if mark and mark.get('source_sha256') == digest else None
        size = work.get('primary_bytes')
        words = round(size / 6) if isinstance(size, int) and size > 0 and PurePosixPath(path).suffix.lower() in TEXT_FORMATS else None
        return {'path': path, 'title': work.get('title') or PurePosixPath(path).stem.replace('-', ' '),
                'authors': work.get('authors') or [], 'projects': [p for p in work.get('projects') or [] if not str(p).startswith(VAGUE)],
                'date': work.get('date'), 'read': read(path), 'words': words, 'progress': progress,
                'finished': progress is not None and progress >= FINISHED, 'sha256': digest}

    def history_rows(self, participant):
        """Latest open per document, newest first: the open log joined with read receipts.

        A receipt's time counts as an open (the web app marks a document read when it
        opens), so history reaches back before the log existed. A `hidden` entry hides
        opens up to its time; opening the document again brings it back."""
        participant = self.engagement.participant(participant)
        stamp = lambda value: datetime.fromisoformat(value)
        opens, hidden = {}, {}
        record = next((r['items'] for r in self.engagement.receipts() if r['participant'] == participant), {})
        for key, receipt in record.items():
            if key.startswith('document:'):
                opens[key[9:]] = (stamp(receipt['at']), receipt['version'])
        for event in self.queue.events(participant):
            try:
                at = stamp(event['at'])
            except ValueError:
                continue
            if event.get('hidden'):
                hidden[event['path']] = max(at, hidden.get(event['path'], at))
            elif event['path'] not in opens or at >= opens[event['path']][0]:
                opens[event['path']] = (at, event.get('sha256'))
        rows = [(path, at, version) for path, (at, version) in opens.items() if not (path in hidden and hidden[path] >= at)]
        return sorted(rows, key=lambda row: row[1], reverse=True)

    def history_view(self, participant, cursor=0, finished=False, tz=0):
        participant = self.engagement.participant(participant)
        if type(cursor) is not int or cursor < 0 or type(tz) is not int or not -840 <= tz <= 840:
            raise ValueError('Expected a non-negative cursor and a UTC offset of at most 14 hours')
        works = {w['primary']: w for w in self.works()[0]}
        read = self.reader(participant)
        marks = self.bookmarks.read(participant)['items']
        offset = timedelta(minutes=tz)
        items = []
        for path, at, version in self.history_rows(participant):
            row = self.entry(path, works, read, marks)
            if row is None or finished and not row['finished']:
                continue
            items.append(row | {'opened_at': at.isoformat(), 'changed': bool(version) and version != row['sha256'],
                                'day': (at.astimezone(timezone.utc) + offset).date().isoformat()})
        page = items[cursor:cursor + HISTORY_PAGE]
        days = []
        for row in page:
            if not days or days[-1]['date'] != row['day']:
                days.append({'date': row['day'], 'items': []})
            days[-1]['items'].append(row)
        return {'participant': participant, 'days': days, 'total': len(items), 'filter': 'finished' if finished else 'all',
                'next_cursor': cursor + HISTORY_PAGE if cursor + HISTORY_PAGE < len(items) else None,
                'today': (datetime.now(timezone.utc) + offset).date().isoformat()}

    def queue_view(self, participant, current=None):
        participant = self.engagement.participant(participant)
        record = self.queue.load(participant)
        works = {w['primary']: w for w in self.works()[0]}
        read = self.reader(participant)
        marks = self.bookmarks.read(participant)['items']
        rows = self.history_rows(participant)
        now = None
        if current:
            self.path(current)
            now = self.entry(current, works, read, marks)
        else:
            for path, at, _ in rows[:20]:
                row = self.entry(path, works, read, marks)
                if row and not row['finished']:
                    now = row | {'resume': True, 'opened_at': at.isoformat()}
                    break
        queued, voices = [], []
        for item in record['items']:
            row = self.entry(item['path'], works, read, marks)
            if row is None:
                continue
            row |= {k: item[k] for k in ('added_at', 'added_by', 'reason', 'pinned_at') if k in item}
            (queued if self.queue.mine(item, participant) else voices).append(row | {'source': 'you' if self.queue.mine(item, participant) else 'voice'})
        generated = [row for row in self.suggest_queue(participant, record, rows, works, read, marks)
                     if not now or row['path'] != now['path']]
        return {'participant': participant, 'now': now, 'queued': queued, 'suggested': voices + generated,
                'updated_at': record['updated_at'],
                'scope': 'Your queue, in your order. Suggestions come from your latest opens, new unread works and one other project; voice suggestions are labelled.'}

    def suggest_queue(self, participant, record=None, rows=None, works=None, read=None, marks=None):
        """About ten documents to read next, each with the reason it was suggested.

        Seeds are the latest five opens. Each seed's related works are scored by
        relatedness, weighted toward the most recent seed, with a boost for unread
        editions; then mixed with the newest unread works and one work from a project
        none of the seeds belong to. Queued, dismissed and finished documents, other
        editions of a seed and near-duplicates of a pick are left out."""
        participant = self.engagement.participant(participant)
        record = record or self.queue.load(participant)
        rows = self.history_rows(participant) if rows is None else rows
        works = works or {w['primary']: w for w in self.works()[0]}
        read = read or self.reader(participant)
        marks = self.bookmarks.read(participant)['items'] if marks is None else marks
        seeds = [path for path, _, _ in rows if path in works][:SEEDS]
        key = (record.get('updated_at'), tuple(seeds), len(record['dismissed']))
        cached = self.suggestions.get(participant)
        if cached and cached[0] == key and time.monotonic() - cached[1] < SUGGEST_TTL:
            return cached[2]
        inventory = list(works.values())
        def finished(path):
            mark = marks.get(path)
            if not mark or mark.get('progress', 0) < FINISHED:
                return False
            try:
                return self.digest(path) == mark.get('source_sha256')
            except (ValueError, OSError):
                return False
        excluded = set(seeds) | {item['path'] for item in record['items']} | set(record['dismissed'])
        vectors = self.related.vectors(set(works))
        picked, titles = [], {base_title(works[s].get('title')) for s in seeds}
        def admit(path):
            if path in excluded or path in picked or finished(path) or base_title(works[path].get('title')) in titles:
                return False
            vector = vectors.get(path)
            if vector is not None:
                for other, limit in [*((s, SAME_EDITION) for s in seeds), *((p, DIVERSE) for p in picked)]:
                    if other in vectors and float(vector @ vectors[other]) >= limit:
                        return False
            return True
        def take(path):
            picked.append(path)
            titles.add(base_title(works[path].get('title')))
        title = lambda path: works[path].get('title') or PurePosixPath(path).stem
        related = {}
        for rank, seed in enumerate(seeds):
            for item in self.related.suggest(seed, inventory, lambda w: read(w['primary']), limit=6)['items']:
                if item.get('score') is None:
                    continue  # The "new in the library" fill is mixed in below instead.
                value = item['score'] / (1 + .5 * rank) + (.15 if not item['read'] else 0)
                if value > related.get(item['primary'], (-1, None))[0]:
                    related[item['primary']] = (value, seed)
        lists = {'related': [], 'new': [], 'other': []}
        newest = sorted((w for w in inventory if not read(w['primary'])), key=lambda w: w.get('date') or '', reverse=True)
        def project(work):
            return next((p for p in work.get('projects') or [] if isinstance(p, str) and not p.startswith(VAGUE)), None)
        # The cross-project slot is reserved first, before related picks can claim its candidate (RW-02).
        own = {p for s in seeds for p in works[s].get('projects') or [] if isinstance(p, str) and not p.startswith(VAGUE)}
        if seeds:
            outside = [w for w in inventory if project(w) and not own & set(w.get('projects') or [])]
            best = None
            seed_vectors = [(s, vectors[s]) for s in seeds if s in vectors]
            outside_vectors = [w for w in outside if w['primary'] in vectors]
            if seed_vectors and outside_vectors and len(vectors) > 10:
                keys = list(vectors)
                everything = np.stack([vectors[k] for k in keys])
                candidates = np.stack([vectors[w['primary']] for w in outside_vectors])
                for seed, vector in seed_vectors:
                    row = np.delete(everything @ vector, keys.index(seed))  # the seed's own row, without itself
                    floor = float(np.percentile(row, 90))
                    for work, similarity in sorted(zip(outside_vectors, (candidates @ vector).tolist()), key=lambda pair: -pair[1]):
                        if similarity < floor or (best and similarity <= best[2]):
                            break
                        if admit(work['primary']):
                            best = (work['primary'], 'From another project · like ' + title(seed), similarity)
                            break
            if not best:
                outside_paths = {w['primary'] for w in outside}
                fallback = next((w for w in newest if w['primary'] in outside_paths and admit(w['primary'])), None)
                if fallback:
                    best = (fallback['primary'], 'From another project · ' + project(fallback), 0)
            if best:
                take(best[0])
                lists['other'].append(best[:2])
        # Round-robin over seeds, best first, at most two each: the list reflects
        # several recent reads rather than the one with the most neighbours.
        by_seed = {}
        for path, (value, seed) in sorted(related.items(), key=lambda pair: -pair[1][0]):
            by_seed.setdefault(seed, []).append(path)
        for round_ in range(2):
            for seed in seeds:
                for path in by_seed.get(seed, []):
                    if len(lists['related']) < SUGGESTED - 3 and admit(path):
                        take(path)
                        by_seed[seed].remove(path)
                        lists['related'].append((path, 'Because you read ' + title(seed)))
                        break
        for work in newest:
            if len(lists['new']) >= max(2, SUGGESTED - len(lists['related']) - len(lists['other'])):
                break
            if admit(work['primary']):
                take(work['primary'])
                lists['new'].append((work['primary'], 'New in ' + (project(work) or 'the library')))
        pattern = ['related', 'related', 'new', 'related', 'other', 'related', 'new', 'related', 'related', 'related']
        order = []
        while len(order) < SUGGESTED and any(lists.values()):
            for kind in pattern:
                source = lists[kind] if lists[kind] else next((l for l in lists.values() if l), None)
                if source and len(order) < SUGGESTED:
                    order.append(source.pop(0))
        result = []
        for path, reason in order:
            row = self.entry(path, works, read, marks)
            if row:
                result.append(row | {'reason': reason, 'source': 'suggested'})
        self.suggestions[participant] = (key, time.monotonic(), result)
        return result

    def search_read_status(self, result, participant):
        """Dim only exact current versions acknowledged by this participant."""
        read = self.reader(participant)
        return result | {'results': [dict(row, read=read(row.get('path') or row.get('primary'))) for row in result['results']]}


# Request admission, after the requester is identified (web_access). Static assets and
# /api/health are never gated: refusing an asset breaks the page load, and a health probe
# must answer while the server is busy.
# Expensive work (every POST, search, the search page, Read next, prose, and the chat
# routes) shares a small non-blocking pool; ordinary reads share a larger pool and wait
# briefly before refusing. The chat SSE stream (/api/chat/stream) is dispatched before
# admission and limited only by its own four-stream semaphore, so it never holds a slot.
STATIC_PREFIXES = ('/assets/', '/fonts/')
UNGATED = frozenset({'/', '/api/health'})  # The page itself and the cheap liveness probe.
EXPENSIVE_GETS = frozenset({'/api/search', '/api/search/page', '/api/next', '/api/prose', '/api/service', '/api/shape'})
EXPENSIVE_GET_PREFIXES = ('/api/chat',)  # /api/chat, /api/chats, /api/chat/raw
EXPENSIVE_LIMIT, READ_LIMIT, READ_WAIT = 8, 32, 5.0


class WebServer(ThreadingHTTPServer):
    daemon_threads = True
    # A page load opens many parallel connections; the default backlog of 5 resets some on macOS.
    request_queue_size = 64

    def __init__(self, address, library, participant='You'):
        if address[0] not in ('127.0.0.1', 'localhost'):
            raise ValueError('Reader web binds to IPv4 loopback only')
        self.library = library
        self.participant = library.engagement.participant(participant)
        self.token = secrets.token_urlsafe(32)
        self.started_at = datetime.now(timezone.utc).isoformat(timespec='seconds')
        self.requests = threading.BoundedSemaphore(EXPENSIVE_LIMIT)
        self.reads = threading.BoundedSemaphore(READ_LIMIT)
        self.streams = threading.BoundedSemaphore(4)  # SSE streams: outside both pools
        self.chat_heartbeat = 15  # Seconds between `ping` events on an idle chat stream.
        super().__init__(address, WebHandler)


class WebHandler(BaseHTTPRequestHandler):
    server_version = 'Reader'

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, *_):
        pass  # No private paths, queries or passages in access logs.

    def allowed(self):
        """Identify every request, assets included, before routing (see web_access)."""
        self.identity = self.server.library.access.identify(self.headers, self.server.server_address[1])
        return self.identity

    def refuse(self, message):
        if urlsplit(self.path).path.startswith('/api/'):
            self.json({'error': message}, 403)
            return
        body = ('<!doctype html><meta charset="utf-8"><title>Not allowed</title><p>Not allowed.</p>' if message == 'Not allowed'
                else '<!doctype html><meta charset="utf-8"><title>Refused</title><p>Refused.</p>').encode()
        self.response_headers(403, 'text/html; charset=utf-8', len(body))
        self.end_headers()
        self.wfile.write(body)

    def response_headers(self, status, kind, length, *, raw=False):
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(length))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        policy = "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
        self.send_header('Content-Security-Policy', "default-src 'none'; sandbox; frame-ancestors 'self'" if raw else policy)

    def json(self, data, status=200):
        if status >= 400 and isinstance(data.get('error'), str):
            # An OSError's message names the file it failed on; show it as <vault>/… or ~/… (#105).
            data = data | {'error': shown(data['error'], self.server.library.root)}
        body = json.dumps(data, ensure_ascii=False).encode()
        self.response_headers(status, 'application/json; charset=utf-8', len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlsplit(self.path).path == '/api/chat/stream':
            self.stream_chat()
        elif urlsplit(self.path).path == '/api/jobs/stream':
            self.stream_job()
        else:
            self.handle_request(False)

    def stream_chat(self):
        """Server-Sent Events for one chat: `state`, `started`, `delta`, `posted`, `done` and `commit`.

        An idle stream sends a `ping` every `chat_heartbeat` seconds with the chat's revision and
        pending turn IDs, so a client can notice a dead server and reconcile what it shows."""
        try:
            self.allowed()
            args = {k: v[0] for k, v in parse_qs(urlsplit(self.path).query).items()}
            conversations = self.server.library.conversations
            chat = conversations.chats.read(args.get('id', ''))
        except PermissionError as exc:
            self.json({'error': str(exc)}, 403); return
        except (ValueError, TypeError, OSError) as exc:
            self.json({'error': str(exc)}, 400); return
        if not self.server.streams.acquire(blocking=False):
            self.json({'error': 'At most 4 chat streams may be open; close another chat panel'}, 429); return
        runner = conversations.runner
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.close_connection = True
            def send(kind, data, seq=None):
                self.wfile.write(((f'id: {seq}\n' if seq else '') + f'event: {kind}\ndata: ' + json.dumps(data, ensure_ascii=False) + '\n\n').encode())
            def snapshot():
                for turn in runner.pending(chat['id']):
                    send('state', turn)
            interval = self.server.chat_heartbeat
            def ping():
                try:
                    revision = conversations.chats.read(chat['id'])['revision']
                except (ValueError, OSError):
                    revision = None
                return {'revision': revision, 'pending': [t['id'] for t in runner.pending(chat['id'])], 'interval': interval}
            after = runner.seq
            send('hello', {'chat_id': chat['id'], 'seq': after} | ping())
            snapshot()
            self.wfile.flush()
            deadline = datetime.now(timezone.utc) + timedelta(hours=1)
            while not runner.closed and datetime.now(timezone.utc) < deadline:
                rows, latest, gap = runner.wait(chat['id'], after, interval)
                if gap:
                    snapshot()
                if not rows:
                    send('ping', ping())
                for seq, kind, data in rows:
                    send(kind, data, seq)
                after = max([after, *[seq for seq, _, _ in rows]]) if rows else latest
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass
        finally:
            self.server.streams.release()

    def stream_job(self):
        """Server-Sent Events for one coding job: `hello` (the run), `event` frames with `id: <seq>`, `ping`, and `end`.

        `after` is the last sequence the client has; events after it come from memory or, after a gap, from the
        run archive, so a reload or a missed frame resynchronizes. Clients ignore frames at or below their cursor."""
        try:
            self.allowed()
            args = {k: v[0] for k, v in parse_qs(urlsplit(self.path).query).items()}
            jobs = self.server.library.jobs
            run_id, after = args.get('id', ''), args.get('after', '0')
            if not after.isdigit() or len(after) > 9:
                raise ValueError('Expected a non-negative event cursor')
            jobs.detail(run_id)
        except PermissionError as exc:
            self.json({'error': str(exc)}, 403); return
        except (ValueError, TypeError, OSError) as exc:
            self.json({'error': str(exc)}, 400); return
        if not self.server.streams.acquire(blocking=False):
            self.json({'error': 'At most 4 live streams may be open; close another panel'}, 429); return
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.close_connection = True
            def send(kind, data, seq=None):
                self.wfile.write(((f'id: {seq}\n' if seq else '') + f'event: {kind}\ndata: ' + json.dumps(data, ensure_ascii=False) + '\n\n').encode())
            cursor = int(after)
            send('hello', {'run': jobs.detail(run_id), 'after': cursor})
            self.wfile.flush()
            deadline = datetime.now(timezone.utc) + timedelta(hours=1)
            while not jobs.live.closed and datetime.now(timezone.utc) < deadline:
                page = jobs.events(run_id, cursor, 500)
                for event in page['events']:
                    send('event', event, event['seq'])
                cursor = page['next']
                if page['done'] and not page['more']:
                    send('end', {'run': page['run']})
                    self.wfile.flush()
                    break
                if not page['events']:
                    send('ping', {'seq': cursor, 'status': page['run']['status'], 'phase': page['run']['phase']})
                self.wfile.flush()
                if not page['more']:
                    jobs.live.wait(run_id, cursor, self.server.chat_heartbeat)
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass
        finally:
            self.server.streams.release()

    def do_POST(self):
        self.handle_request(True)

    def admission(self, write):
        path = urlsplit(self.path).path
        if not write and (path in UNGATED or path.startswith(STATIC_PREFIXES)):
            return None, None
        if write or path in EXPENSIVE_GETS or path.startswith(EXPENSIVE_GET_PREFIXES):
            return self.server.requests, {'blocking': False}
        return self.server.reads, {'timeout': READ_WAIT}

    def handle_request(self, write):
        # Identify first (web_access): a refused requester never takes or waits for a slot.
        try:
            self.allowed()
        except PermissionError as exc:
            self.refuse(str(exc))
            return
        gate, wait = self.admission(write)
        if gate is not None and not gate.acquire(**wait):
            self.json({'error': 'Reader is busy; try again shortly'}, 429)
            return
        try:
            parsed = urlsplit(self.path)
            args = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            library = self.server.library
            if write:
                if self.headers.get('X-Reader-Token') != self.server.token or self.headers.get_content_type() != 'application/json':
                    raise PermissionError('A same-origin Reader token and JSON request are required')
                length = int(self.headers.get('Content-Length', '0'))
                # Prose batches carry up to 512 KiB of text; an art still image is a data URL of at most 2 MiB.
                limit = 1024**2 if parsed.path == '/api/prose' else 3 * 1024**2 if parsed.path == '/api/art' else 128 * 1024
                if not 0 < length <= limit:
                    raise ValueError(f'Request body exceeds {limit // 1024} KiB or is empty')
                request = json.loads(self.rfile.read(length))
                if not isinstance(request, dict):
                    raise ValueError('Expected an object')
                if parsed.path == '/api/annotations':
                    self.json(library.annotations.dispatch(request))
                elif parsed.path == '/api/seen':
                    self.json(library.engagement.seen(**request))
                elif parsed.path == '/api/bookmark':
                    if library.digest(request.get('path', '')) != request.get('source_sha256'):
                        raise ValueError('Source changed; reopen before saving a reading position')
                    self.json(library.bookmarks.save(**request))
                elif parsed.path == '/api/themes':
                    self.json(library.themes.dispatch(request))
                elif parsed.path == '/api/speak':
                    if set(request) - {'path', 'source_sha256', 'scope', 'start', 'end', 'page'}:
                        raise ValueError('Unexpected speech request field')
                    self.json(library.speak(**request))
                elif parsed.path.startswith('/api/speak/'):
                    if set(request) != {'action'}:
                        raise ValueError('Expected {"action": ...}')
                    self.json(library.speech.control(parsed.path[len('/api/speak/'):], request['action']))
                elif parsed.path == '/api/chat':
                    participant = library.engagement.participant(request.pop('participant', self.server.participant))
                    self.json(library.conversations.dispatch(request, participant))
                elif parsed.path == '/api/prose':
                    self.json(library.colorize(request))
                elif parsed.path == '/api/queue':
                    if set(request) - {'participant', 'action', 'path', 'index', 'request_id', 'added_by', 'reason', 'current'}:
                        raise ValueError('Unexpected queue request fields')
                    participant = request.pop('participant', self.server.participant)
                    current = request.pop('current', None)
                    library.queue.change(participant, **request)
                    self.json(library.queue_view(participant, current))
                elif parsed.path == '/api/history':
                    if request.get('action') not in ('open', 'hide') or set(request) - {'participant', 'action', 'path', 'sha256'}:
                        raise ValueError('Expected {"action": "open" | "hide", "path": ...}')
                    participant = request.get('participant', self.server.participant)
                    if request['action'] == 'open':
                        if library.digest(request.get('path', '')) != request.get('sha256'):
                            raise ValueError('Source changed; reopen it')
                        self.json(library.queue.opened(participant, request['path'], request['sha256']))
                    else:
                        self.json(library.queue.hide(participant, request.get('path')))
                elif parsed.path == '/api/maintenance':
                    if request.get('action') != 'start' or set(request) - {'action', 'kind'}:
                        raise ValueError('Expected {"action": "start", "kind": ...}')
                    if request.get('kind') in COMPANION_JOBS:
                        raise ValueError('Companion installs start from /api/companions')
                    self.json(library.maintenance.start(request.get('kind')))
                elif parsed.path == '/api/companions':
                    self.json(library.companions.dispatch(request, self.identity))
                elif parsed.path == '/api/inbox':
                    action = request.get('action')
                    if action == 'start' and not set(request) - {'action', 'sandbox_mode'}:
                        self.json(library.inbox.start(request.get('sandbox_mode', 'workspace-write')))
                    elif action == 'stop' and set(request) == {'action'}:
                        self.json(library.inbox.stop())
                    else:
                        raise ValueError('Expected {"action": "start", "sandbox_mode": ...} or {"action": "stop"}')
                elif parsed.path == '/api/local-model':
                    self.json(library.local_model.dispatch(request))
                elif parsed.path == '/api/art':
                    participant = library.engagement.participant(request.pop('participant', self.server.participant))
                    self.json(library.art.dispatch(request, participant))
                elif parsed.path == '/api/writing':
                    participant = library.engagement.participant(request.pop('participant', self.server.participant))
                    self.json(library.writing.dispatch(request, participant))
                elif parsed.path == '/api/jobs':
                    self.json(library.jobs.dispatch(request))
                elif parsed.path == '/api/repositories':
                    self.json(library.jobs.configure(request, self.identity))
                elif parsed.path == '/api/service':
                    if set(request) != {'action'}:
                        raise ValueError('Expected {"action": "update" | "restart" | "pause" | "resume"}')
                    self.json(library.service.act(request['action']) | {'action': request['action']})
                else:
                    self.json({'error': 'Unknown route'}, 404)
                return
            if parsed.path == '/api/library':
                self.json(library.bootstrap(args.get('participant', self.server.participant)) | {'token': self.server.token})
            elif parsed.path == '/api/document':
                self.json(library.document(args.get('path', ''), args.get('participant', self.server.participant)))
            elif parsed.path == '/api/search':
                result = library.search(args.get('q', ''), args.get('mode', 'fuzzy'), path_prefix=args.get('path_prefix', 'library/'))
                self.json(library.search_read_status(result, args.get('participant', self.server.participant)))
            elif parsed.path == '/api/search/page':
                lists = parse_qs(parsed.query)
                filters = {k: lists[k] if k in FACETS else lists[k][0] for k in lists if k not in ('q', 'mode', 'offset', 'limit', 'participant')}
                def number(name, default):
                    value = args.get(name, str(default))
                    if not value.isdigit() or len(value) > 4:
                        raise ValueError(f'Expected {name} as a small whole number')
                    return int(value)
                self.json(library.search_page(args.get('q', ''), args.get('mode', 'best'), filters, number('offset', 0),
                                              number('limit', 20), args.get('participant', self.server.participant)))
            elif parsed.path == '/api/discussion':
                path = args.get('path', '')
                self.json(library.annotations.list(path) | {'attention': library.engagement.attention(args.get('participant', self.server.participant), path)})
            elif parsed.path == '/api/resolve-batch':
                targets = parse_qs(parsed.query, keep_blank_values=True).get('target', [])
                self.json(library.resolve_many(args.get('from', ''), targets))
            elif parsed.path == '/api/embeds':
                lists = parse_qs(parsed.query, keep_blank_values=True)
                depth = args.get('depth', '0')
                if not depth.isdigit() or len(depth) > 1:
                    raise ValueError('Expected depth as a small whole number')
                self.json(library.embeds(args.get('from', ''), lists.get('target', []), lists.get('ancestor', []), int(depth)))
            elif parsed.path == '/api/resolve':
                self.json(library.resolve(args.get('from', ''), args.get('target', '')))
            elif parsed.path == '/api/themes':
                self.json(library.themes.list())
            elif parsed.path == '/api/maintenance':
                self.json(library.maintenance.status() | {'local_model': library.local_model.brief()})
            elif parsed.path == '/api/readers':
                self.json(library.readers(args.get('path', ''), args.get('participant', self.server.participant)))
            elif parsed.path.startswith('/api/speak/'):
                self.json(library.speech.get(parsed.path[len('/api/speak/'):]))
            elif parsed.path == '/api/inbox':
                self.json(library.inbox.status())
            elif parsed.path == '/api/links':
                self.json(library.backlinks(args.get('path', '')))
            elif parsed.path == '/api/preview':
                self.json(library.preview(args.get('path', ''), args.get('fragment', ''), args.get('participant', self.server.participant)))
            elif parsed.path == '/api/link-counts':
                self.json(library.link_counts())
            elif parsed.path == '/api/chats':
                self.json(library.conversations.list(args.get('path', '')))
            elif parsed.path == '/api/chat':
                self.json(library.conversations.get(args.get('id', '')))
            elif parsed.path == '/api/local-model':
                self.json(library.local_model.status())
            elif parsed.path == '/api/inbox/events':
                after = args.get('after', '0')
                if not after.isdigit() or len(after) > 9:
                    raise ValueError('Expected a non-negative event offset')
                self.json(library.inbox.events(int(after)))
            elif parsed.path == '/api/chat/raw':
                self.json(library.conversations.raw(args.get('id', ''), args.get('turn', '')))
            elif parsed.path == '/api/prose':
                self.json(library.prose.status())
            elif parsed.path == '/api/companions':
                self.json(library.companions.status(args.get('name')))
            elif parsed.path == '/api/companions/log':
                if args.get('name') not in ('colorful', 'wide-md', 'ai-tts'):
                    raise ValueError('Expected a companion with an install log')
                self.json(library.companions.log(args['name']))
            elif parsed.path == '/api/health':
                self.json(health(library, self.server.started_at))
            elif parsed.path == '/api/service':
                self.json({'service': library.service.status(), 'identity': self.identity,
                           'health': health(library, self.server.started_at)})
            elif parsed.path == '/api/next':
                self.json(library.next_reads(args.get('path', ''), args.get('participant', self.server.participant)))
            elif parsed.path == '/api/standfirst':
                self.json(library.magazine.standfirst(args.get('path', '')))
            elif parsed.path == '/api/art':
                self.json(library.art.art(args.get('path', ''), args.get('edition'), args.get('generation')))
            elif parsed.path == '/api/art/prompt':
                self.json(library.art.prompts(args.get('path', ''), args.get('edition') or None, args.get('generation') or None))
            elif parsed.path == '/api/art/jobs':
                self.json(library.art.status())
            elif parsed.path == '/api/art/still':
                self.send_file(library.art.still_file(args.get('path', ''), args.get('edition', ''), args.get('generation', '')), raw=True)
            elif parsed.path == '/api/jobs':
                self.json(library.jobs.runs(args.get('repo') or None, args.get('state') or None, args.get('path') or None,
                                            args.get('block') or None, self.number(args, 'cursor', 0), self.number(args, 'limit', 50)))
            elif parsed.path == '/api/jobs/actions':
                self.json(library.jobs.actions(args.get('path', '')))
            elif parsed.path == '/api/jobs/run':
                self.json(library.jobs.detail(args.get('id', '')))
            elif parsed.path == '/api/jobs/events':
                self.json(library.jobs.events(args.get('id', ''), self.number(args, 'after', 0), self.number(args, 'limit', 500)))
            elif parsed.path == '/api/jobs/artifact':
                self.json(library.jobs.artifact(args.get('id', ''), args.get('name', ''), self.number(args, 'limit', 256 * 1024)))
            elif parsed.path == '/api/repositories':
                self.json(library.jobs.repositories(args.get('check') == '1'))
            elif parsed.path == '/api/logs':
                self.json(llm_inventory.page(library.root, args.get('kind') or None, args.get('cursor') or None, self.number(args, 'limit', 50)))
            elif parsed.path == '/api/logs/run':
                self.json(llm_inventory.detail(library.root, args.get('path', '')))
            elif parsed.path == '/api/logs/artifact':
                self.json(llm_inventory.artifact(library.root, args.get('path', ''), args.get('name', ''), self.number(args, 'limit', 256 * 1024)))
            elif parsed.path == '/api/shape':
                self.json(library.shapes.shape(args.get('path', '')))
            elif parsed.path == '/api/issue':
                self.json(library.magazine.issue(args.get('start', ''), args.get('end', '')))
            elif parsed.path == '/api/editions':
                self.json(library.family(args.get('path', '')))
            elif parsed.path == '/api/versions':
                self.json(library.explore(args.get('path', ''), args.get('participant', self.server.participant), hashes=args.get('hashes') == '1'))
            elif parsed.path == '/api/version':
                self.json(library.version(args.get('path', ''), args.get('commit', '')))
            elif parsed.path == '/api/changes' and ('a' in args or 'b' in args):
                self.json(library.compare_refs(args.get('a', ''), args.get('b', '')))
            elif parsed.path == '/api/changes':
                self.json(library.changes(args.get('path', ''), args.get('participant', self.server.participant),
                                          against=args.get('against'), successor=args.get('successor') == '1'))
            elif parsed.path == '/api/editions/diagnostics':
                self.json(library.editions.diagnostics())
            elif parsed.path == '/api/queue':
                self.json(library.queue_view(args.get('participant', self.server.participant), args.get('current') or None))
            elif parsed.path == '/api/history':
                self.json(library.history_view(args.get('participant', self.server.participant), int(args.get('cursor', '0')),
                                               args.get('filter') == 'finished', int(args.get('tz', '0'))))
            elif parsed.path == '/api/fonts':
                self.json(library.themes.search(args.get('q', '')))
            elif parsed.path.startswith('/fonts/') and parsed.path.count('/') == 3:
                _, _, family, name = parsed.path.split('/')
                self.send_file(library.themes.font_file(family, name))
            elif parsed.path == '/api/file':
                file = library.path(args.get('path', ''), preview=True)
                self.send_file(file, raw=True)
            elif parsed.path == '/' or parsed.path.startswith('/assets/'):
                name = 'index.html' if parsed.path == '/' else parsed.path[len('/assets/'):]
                file = (STATIC / name).resolve()
                if not file.is_relative_to(STATIC.resolve()) or not file.is_file():
                    self.json({'error': 'Not found'}, 404)
                else:
                    self.send_file(file)
            else:
                self.json({'error': 'Not found'}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except MissingDocument as exc:
            self.json({'error': str(exc)}, 404)
        except PermissionError as exc:
            self.json({'error': str(exc)}, 403)
        except ProseUnavailable as exc:
            self.json({'error': str(exc), 'unavailable': True}, 409)
        except (RunConflict, ChatOwned, ArtOwned, JobsOwned) as exc:
            self.json({'error': str(exc)}, 409)
        except JobConflict as exc:
            self.json({'error': str(exc), 'code': exc.code}, 409)
        except WritingConflict as exc:
            self.json({'error': str(exc)} | exc.extra, 409)
        except BlockingIOError as exc:
            self.json({'error': str(exc)}, 429)
        except SpeechUnavailable as exc:
            self.json({'error': str(exc), 'unavailable': True}, 503)
        except TimeoutError as exc:
            self.json({'error': str(exc)}, 504)
        except ArtMissing as exc:
            self.json({'error': str(exc)}, 404)
        except (ValueError, TypeError, KeyError, OSError, sqlite3.Error) as exc:
            self.json({'error': str(exc)}, 400)
        finally:
            if gate is not None:
                gate.release()

    @staticmethod
    def number(args, name, default):
        value = args.get(name, str(default))
        if not value.isdigit() or len(value) > 9:
            raise ValueError(f'Expected {name} as a non-negative whole number')
        return int(value)

    def send_file(self, file, raw=False):
        size = file.stat().st_size
        start, end, status = 0, size - 1, 200
        range_header = self.headers.get('Range')
        if range_header and raw:
            import re
            match = re.fullmatch(r'bytes=(\d+)-(\d*)', range_header)
            if not match:
                raise ValueError('Expected a single byte range')
            start, stop = match.groups()
            start, end = int(start), min(int(stop) if stop else end, end)
            if not 0 <= start <= end < size:
                self.json({'error': 'Range outside file'}, 416)
                return
            status = 206
        kind = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        if raw and file.suffix.lower() not in ('.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'):
            kind = 'text/plain; charset=utf-8'
        self.response_headers(status, kind, max(0, end - start + 1), raw=raw)
        self.send_header('Accept-Ranges', 'bytes')
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        with file.open('rb') as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                data = stream.read(min(65536, remaining))
                if not data:
                    break
                self.wfile.write(data)
                remaining -= len(data)


def serve_web(root, port=8766, participant='You'):
    server = WebServer(('127.0.0.1', port), WebLibrary(root), participant)
    print(f'Reader web: http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.library.close()
        server.server_close()
