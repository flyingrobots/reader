"""Index freshness checks and on-demand rebuilds for the web Behind the scenes page.

One job runs at a time in a background thread of the web server. Rebuilds reuse
the existing guarded entry points: the search index runs in the bounded worker
of `search_guard.run_index`, and browse and catalog keep their own locks. Job
history lives in memory only; freshness is always measured again."""
from collections import deque
from contextlib import closing
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import threading
import time
import traceback
import uuid
from .junk import os_junk

MIB = 1024 ** 2

JOBS = {
    'check': 'Freshness check',
    'search': 'Search index (with embeddings)',
    'search-keyword': 'Search index (keywords only)',
    'browse': 'Browse indexes',
    'catalog': 'Catalog SQL mirror',
    'links': 'Link graph',
    'remove-legacy-search': 'Remove legacy search index',
    # Companion setup (companions.py); started through /api/companions only.
    'install-colorful': 'Install Colorful Language',
    'update-colorful': 'Update Colorful Language',
    'install-wide-md': 'Install wide-md',
    'update-wide-md': 'Reinstall wide-md',
    'start-ai-tts': 'Start AI-TTS',
}
COMPANION_JOBS = frozenset({'install-colorful', 'update-colorful', 'install-wide-md', 'update-wide-md', 'start-ai-tts'})
INDEX_OF = {'search': 'search', 'search-keyword': 'search', 'browse': 'browse', 'catalog': 'catalog', 'links': 'links',
            'remove-legacy-search': 'search'}
LEGACY_FILES = ('search.sqlite3', 'search.sqlite3-wal', 'search.sqlite3-shm', 'search.sqlite3-journal')


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def short(error):
    text = str(error) or type(error).__name__
    return text if len(text) <= 600 else text[:600] + '…'


class Maintenance:
    def __init__(self, root, runners=None, links=None):
        self.root = Path(root)
        self._links = links
        self.lock = threading.Lock()
        self.jobs = deque(maxlen=20)
        self.running = None
        self.checks = {}
        self.checking = False
        self.runners = {
            'search': lambda: self.summarize_search(self.index(True)),
            'search-keyword': lambda: self.summarize_search(self.index(False)),
            'browse': self.browse,
            'catalog': self.catalog,
            'links': lambda: self.links.refresh(),
            'remove-legacy-search': self.remove_legacy_search,
            'check': self.check,
        } | (runners or {})

    # Status ---------------------------------------------------------------

    def status(self):
        with self.lock:
            return {'running': dict(self.running) if self.running else None, 'jobs': [dict(j) for j in self.jobs],
                    'checks': json.loads(json.dumps(self.checks)), 'checking': self.checking, 'kinds': JOBS}

    @property
    def links(self):
        if self._links is None:
            from .links import LinkGraph
            self._links = LinkGraph(self.root)
        return self._links

    def start(self, kind, quiet=False):
        """Start a job; a quiet job (the link graph's first build) is not announced with toasts."""
        if kind not in JOBS:
            raise ValueError('Unknown maintenance job')
        with self.lock:
            if self.running:
                raise BlockingIOError(f'{JOBS[self.running["kind"]]} is already running')
            job = {'id': uuid.uuid4().hex, 'kind': kind, 'label': JOBS[kind], 'state': 'running',
                   'started_at': stamp(), 'finished_at': None, 'elapsed_seconds': None, 'result': None, 'error': None,
                   'quiet': bool(quiet), 'progress': None}
            self.running = job
        threading.Thread(target=self._run, args=(job,), name='reader-maintenance', daemon=True).start()
        return dict(job)

    def progress(self, text):
        """A running job's latest step, shown beside it (companion installs report one per step)."""
        with self.lock:
            if self.running:
                self.running['progress'] = text

    def _run(self, job):
        started = time.monotonic()
        try:
            result = self.runners[job['kind']]()
            job.update(state='succeeded', result=result)
        except Exception as exc:  # A failed job is reported, never raised into the server.
            job.update(state='failed', error=short(exc))
            if os.environ.get('READER_DEBUG'):
                traceback.print_exc()
        job.update(finished_at=stamp(), elapsed_seconds=round(time.monotonic() - started, 2))
        with self.lock:
            self.jobs.appendleft(dict(job))
            self.running = None
            self.checking = job['kind'] != 'check' and job['kind'] not in COMPANION_JOBS
        # A rebuild changes what is fresh; measure again so the page never shows stale status.
        # A quiet link-graph build re-measures only its own card.
        if job['quiet']:
            try:
                links = self.links.check() | {'checked_at': stamp()}
                with self.lock:
                    if self.checks:
                        self.checks = self.checks | {'links': links}
            except Exception:
                pass
            finally:
                with self.lock:
                    self.checking = False
        elif job['kind'] != 'check' and job['kind'] not in COMPANION_JOBS and self.runners.get('check'):
            try:
                self.check()
            except Exception:
                pass
            finally:
                with self.lock:
                    self.checking = False

    # Checks ---------------------------------------------------------------

    def check(self):
        results = {}
        for name, probe in (('search', self.search_check), ('browse', self.browse_check), ('catalog', self.catalog_check),
                            ('links', self.links.check), ('limits', self.limits_check)):
            try:
                results[name] = probe() | {'checked_at': stamp()}
            except Exception as exc:
                results[name] = {'state': 'error', 'message': short(exc), 'checked_at': stamp()}
        with self.lock:
            self.checks = results
        return {name: value['state'] for name, value in results.items()}

    def library_files(self):
        """Paths the search indexer would visit, with (size, mtime_ns)."""
        files = {}
        for folder, dirs, names in os.walk(self.root / 'library', followlinks=False):
            dirs[:] = [d for d in dirs if not d.startswith('.') and not (Path(folder) / d).is_symlink()]
            for name in names:
                if name.startswith('.') or os_junk(name):
                    continue
                file = Path(folder) / name
                info = file.lstat()
                files[file.relative_to(self.root).as_posix()] = (info.st_size, info.st_mtime_ns)
        return files

    def search_check(self):
        from .search import MACHINE, VERSION, active, settings as search_settings
        state_dir = self.root / '.reader'
        db = state_dir / 'search.v2.sqlite3'
        cache = state_dir / 'embedding-cache.sqlite3'
        files = self.library_files()
        limits = search_settings(self.root)
        usage = {'database': [db.stat().st_size if db.is_file() else 0, limits['max_database_mib'] * MIB],
                 'cache': [cache.stat().st_size if cache.is_file() else 0, limits['max_cache_mib'] * MIB]}
        legacy = None
        if (state_dir / 'search.sqlite3').is_file():
            serving = active(state_dir) == 1
            legacy = {'format': 1, 'bytes': sum((state_dir / n).stat().st_size for n in LEGACY_FILES if (state_dir / n).is_file()),
                      'serving': serving, 'removable': not serving}
        extra = {'legacy': legacy} if legacy else {}
        if not db.is_file():
            if legacy:
                return {'state': 'stale', 'files': len(files), 'usage': usage, **extra,
                        'message': 'Search serves the format 1 index read-only. Rebuild to upgrade; cached embeddings '
                                   'and format 1 vectors are reused, and the format 1 index is left for older Reader processes.'}
            return {'state': 'missing', 'message': 'No search index yet.', 'files': len(files), 'usage': usage}
        with closing(sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True, timeout=10)) as con:
            settings = dict(con.execute("SELECT key, value FROM settings"))
            if settings.get('version') != VERSION:
                return {'state': 'error', 'files': len(files), 'usage': usage, **extra,
                        'message': f'{db.name} has unexpected format {settings.get("version") or "unknown"}; remove it and rebuild.'}
            docs = {path: (size, mtime) for path, size, mtime in con.execute('SELECT path, size, mtime FROM docs')}
            text = con.execute("SELECT count(*) FROM docs WHERE status='text'").fetchone()[0]
            machine = con.execute('SELECT count(*) FROM docs WHERE status=?', (MACHINE,)).fetchone()[0]
            unembedded = con.execute('SELECT count(DISTINCT c.path) FROM chunks c JOIN passages p ON p.id=c.passage_id '
                                     'WHERE p.vector IS NULL').fetchone()[0]
            passages = con.execute('SELECT count(*) FROM passages').fetchone()[0]
            chunks = con.execute('SELECT count(*) FROM chunks').fetchone()[0]
            usage['database'][0] = con.execute('PRAGMA page_count').fetchone()[0] * con.execute('PRAGMA page_size').fetchone()[0]
        usage['passages'] = [passages, limits['max_passages']]
        complete = settings.get('complete') == '1'
        new = [p for p in files if p not in docs]
        changed = [p for p in files if p in docs and docs[p] != files[p]]
        removed = [p for p in docs if p not in files]
        stale = bool(new or changed or removed)
        state = 'partial' if not complete else 'stale' if stale else 'partial' if unembedded else 'current'
        message = (f'The last rebuild stopped before finishing; {passages:,} passages saved. Run again to continue.'
                   + (' Search serves the format 1 index until then.' if legacy and legacy['serving'] else '') if not complete
                   else f'{len(new)} new, {len(changed)} changed and {len(removed)} removed files since the last build.' if stale
                   else f'{unembedded} of {text} text documents have no embeddings; semantic search and Read next are incomplete.' if unembedded
                   else 'Every library file is indexed with embeddings.')
        return {'state': state, 'message': message, 'built_at': settings.get('indexed_at') or settings.get('updated_at'),
                'model': settings.get('model'), 'complete': complete,
                'files': len(files), 'documents': len(docs), 'text_documents': text, 'chunks': chunks, 'passages': passages,
                'path_only_machine': machine, 'unembedded': unembedded, 'new': len(new), 'changed': len(changed),
                'removed': len(removed), 'examples': (new + changed + removed)[:5], 'usage': usage, **extra}

    def limits_check(self):
        """Other bounded inventories, with their current size, so a ceiling is visible before it is hit."""
        from .annotations import MAX_THREADS
        from .browse import MAX_WORKS
        from .engagement import MAX_PARTICIPANTS
        from .inbox_runner import MAX_INBOX_FILES
        def count(folder, pattern, limit):
            if not folder.is_dir() or folder.is_symlink():
                return 0
            total = 0
            for _ in folder.glob(pattern):
                total += 1
                if total > limit:
                    break
            return total
        coverage = self.root / 'indexes' / 'coverage.json'
        works = None
        if coverage.is_file() and not coverage.is_symlink() and coverage.stat().st_size <= 16 * MIB:
            works = len(json.loads(coverage.read_text()).get('works') or [])
        inbox = 0
        for folder, dirs, names in os.walk(self.root / 'inbox', followlinks=False):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            inbox += sum(1 for n in names if not n.startswith('.') and Path(folder, n) != self.root / 'inbox/README.md')
            if inbox > MAX_INBOX_FILES:
                break
        items = [{'key': 'works', 'label': 'Works', 'used': works, 'limit': MAX_WORKS},
                 {'key': 'inbox', 'label': 'Inbox files', 'used': inbox, 'limit': MAX_INBOX_FILES},
                 {'key': 'participants', 'label': 'Reading participants', 'used': count(self.root / 'engagement', '*.json', MAX_PARTICIPANTS), 'limit': MAX_PARTICIPANTS},
                 {'key': 'threads', 'label': 'Annotation threads', 'used': count(self.root / 'annotations', '*.json', MAX_THREADS), 'limit': MAX_THREADS}]
        known = [i for i in items if i['used'] is not None]
        over = [i['label'] for i in known if i['used'] > i['limit']]
        near = [i['label'] for i in known if i['used'] >= 0.8 * i['limit']]
        state = 'over' if over else 'near' if near else 'ok'
        message = (f'Over its limit: {", ".join(over)}.' if over else f'Within 20 % of its limit: {", ".join(near)}.' if near
                   else 'Every inventory is well inside its limit.')
        return {'state': state, 'message': message, 'items': items}

    def browse_check(self):
        from .browse import Browse
        coverage = self.root / 'indexes' / 'coverage.json'
        if not (self.root / 'indexes' / 'settings.json').is_file():
            return {'state': 'unconfigured', 'message': 'This vault has no indexes/settings.json, so browse indexes are not maintained.'}
        result = Browse(self.root).run(check=True)
        built = None
        if coverage.is_file() and not coverage.is_symlink() and coverage.stat().st_size <= 16 * 1024 ** 2:
            built = json.loads(coverage.read_text()).get('as_of')
        stale = result['status'] == 'stale'
        return {'state': 'stale' if stale else 'current', 'built_at': built, 'works': result['work_entries'],
                'changed': len(result['changed']), 'examples': result['changed'][:5],
                'message': f'{len(result["changed"])} navigation files would change.' if stale else 'Browse indexes match the current metadata.'}

    def catalog_check(self):
        from .catalog import Catalog
        db = self.root / '.reader' / 'catalog.sqlite3'
        if not db.is_file():
            return {'state': 'missing', 'message': 'No catalog SQL mirror yet.'}
        try:
            report = Catalog(self.root).run('check')
        except ValueError as exc:
            message = short(exc)
            # Drift is the expected "needs rebuild" answer; anything else is an error.
            state = 'stale' if 'run catalog sync' in message else 'error'
            return {'state': state, 'message': message, 'built_at': datetime.fromtimestamp(db.stat().st_mtime, timezone.utc).isoformat(timespec='seconds')}
        return {'state': 'current', 'message': 'The SQL mirror matches every catalog record.', 'documents': report['documents'],
                'usage': {'files': [report['files'], report['limits']['files']],
                          'sources': [report['source_bytes'], report['limits']['source_bytes']]},
                'built_at': datetime.fromtimestamp(db.stat().st_mtime, timezone.utc).isoformat(timespec='seconds')}

    # Rebuilds -------------------------------------------------------------

    def index(self, semantic):
        from .search_guard import run_index
        return run_index(self.root, semantic=semantic)

    @staticmethod
    def summarize_search(result):
        return {k: result.get(k) for k in ('documents', 'chunks', 'passages', 'path_only_machine', 'changed', 'removed',
                                           'semantic', 'complete', 'message', 'migrated')} | {
            'issues': len(result.get('issues') or []),
            'pdf_warnings': (result.get('pdf_warnings') or {}).get('messages', 0)}

    def remove_legacy_search(self):
        """Delete the format 1 index on explicit request, once format 2 serves search and nothing holds it.

        Best effort: an index run (any Reader version) holds .reader/search.lock, and a process
        mid-write holds the database's write lock. A reader between queries is not detectable without
        lsof; it reports "Search index missing" afterwards, and older code can rebuild format 1."""
        from .search import active
        state = self.root / '.reader'
        legacy = state / 'search.sqlite3'
        if not legacy.is_file() or legacy.is_symlink():
            raise ValueError('There is no legacy search index to remove')
        if active(state) != 2:
            raise ValueError('The legacy index still serves search; build the format 2 search index first')
        with (state / 'search.lock').open('a') as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('A search index run holds .reader/search.lock; remove the legacy index after it finishes') from None
            try:
                with closing(sqlite3.connect(legacy, timeout=0)) as con:
                    con.execute('BEGIN EXCLUSIVE')
                    con.rollback()
            except sqlite3.OperationalError:
                raise ValueError('Another Reader process is using the legacy search index; try again later') from None
            freed = 0
            for name in LEGACY_FILES:
                path = state / name
                if path.is_file() and not path.is_symlink():
                    freed += path.stat().st_size
                    path.unlink()
        return {'removed': 'search.sqlite3', 'freed_bytes': freed}

    def browse(self):
        from .browse import Browse
        result = Browse(self.root).run()
        return {'works': result['work_entries'], 'changed': len(result['changed']), 'files': result['changed'][:20]}

    def catalog(self):
        from .catalog import Catalog
        result = Catalog(self.root).run('sync')
        return {k: result.get(k) for k in ('documents', 'status')}
