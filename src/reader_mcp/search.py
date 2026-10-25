"""Rebuildable local search. Source files are never modified.

Format 2 stores each distinct passage once (`passages`, keyed by the SHA-256 of
its text) and maps files to passages through `chunks`. Vectors are float16 on
disk and float32 in arithmetic. Only reading material is split into passages by
default; machine files stay findable by path. A run publishes per batch of
paths, so a stopped rebuild keeps its work and the next run continues.

Format 2 lives in `.reader/search.v2.sqlite3`, beside the format 1 index
`.reader/search.sqlite3` that older Reader processes still read and write. New
code never writes or deletes the format 1 file: it seeds vectors from it read-only
and serves search from it (see search_legacy) until a format 2 build completes."""
from contextlib import contextmanager, closing
from datetime import datetime, timezone
import fcntl
import hashlib
import io
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import sys
import time
import unicodedata
from typing import Literal
import warnings

import numpy as np
from pypdf import PdfReader
from rapidfuzz import fuzz, process
from .metadata import MetadataResult, inspect_metadata, parse_metadata
from .junk import os_junk

Mode = Literal['hybrid', 'keyword', 'fuzzy', 'semantic']
Editions = Literal['preferred', 'all']
MODEL = 'BAAI/bge-small-en-v1.5'
VERSION = '2'
LEGACY_VERSION = '1'
METADATA_INDEX_VERSION = '1'
METADATA_COLUMNS = {'frontmatter_schema_version', 'document_revision', 'metadata_status',
                    'metadata_profile', 'metadata_diagnostics'}
MAX_FILE = 32 * 1024 * 1024
MIB = 1024 ** 2
PAGE_SIZE = 4096
BATCH_PATHS = 64  # files per published transaction
# Text-decodable formats. Which of them are split into passages is a setting.
TEXT_TYPES = {'.md', '.txt', '.rst', '.tex', '.html', '.csv', '.json', '.jsonl', '.yaml', '.yml',
              '.toml', '.py', '.rs', '.js', '.ts', '.css', '.sh', '.bib', '.edict', '.err', '.load',
              '.cff', '.cls', '.log', '.v', '.mjs', '.lock', '.svg', ''}
CONTENT_TYPES = ('.md', '.txt', '.pdf', '.html', '.tex', '.rst', '.edict', '.bib')
SETTINGS_FILE = 'indexes/settings.json'
DEFAULTS = {'content_types': list(CONTENT_TYPES), 'max_passages': 400_000, 'max_database_mib': 2048,
            'max_cache_mib': 1024, 'worker_timeout_minutes': 60, 'worker_threads': 4}
RANGES = {'max_passages': (1, 5_000_000), 'max_database_mib': (16, 3072), 'max_cache_mib': (16, 2048),
          'worker_timeout_minutes': (1, 240), 'worker_threads': (1, 8)}
DATA_ROOM_MIB = 3584  # database + cache budgets leave room inside the 4 GiB .reader data budget
PAGE_POOL = 500  # Search page: chunks considered per query, before grouping by work.
PAGE_CHANNEL = 2000  # Ranked passages taken from each channel before fusion.
# Meaning keeps passages within MEANING_BAND of the best match and above MEANING_FLOOR, at most
# MEANING_TOP of them (fewer in Best, so exact words lead). Calibrated for bge-small-en-v1.5 on the
# real library: cosine medians sit near 0.53 and a nonsense query still reaches 0.67.
MEANING_FLOOR = 0.62
MEANING_BAND = 0.08
MEANING_TOP = {'semantic': 300, 'hybrid': 100}
EXCERPT = 320
# Words too common to rank or highlight on their own; kept when a query has nothing else.
STOPWORDS = frozenset('a an and are as at be but by for from has have he her his i if in into is it its of on or our she so '
                      'than that the their them then there these they this to was we were what when which who will with you your'.split())
MACHINE = 'path_only: machine file; indexed by path only (search.content_types)'
UNSUPPORTED = 'path_only: unsupported format or no extractable text'
SCHEMA = '''
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, sha256 TEXT,
        metadata TEXT, status TEXT, size INTEGER, mtime INTEGER, frontmatter_schema_version INTEGER,
        document_revision INTEGER, metadata_status TEXT, metadata_profile TEXT, metadata_diagnostics TEXT);
    CREATE TABLE IF NOT EXISTS passages (id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE,
        text TEXT NOT NULL, vector BLOB, vector_path TEXT);
    CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, path TEXT NOT NULL, page INTEGER,
        start_line INTEGER, end_line INTEGER, passage_id INTEGER REFERENCES passages(id));
    CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
    CREATE INDEX IF NOT EXISTS chunks_passage ON chunks(passage_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS terms USING fts5(text, content='passages', content_rowid='id',
        tokenize='unicode61');
    CREATE VIRTUAL TABLE IF NOT EXISTS names USING fts5(path, tokenize='unicode61');
'''


def tokens(text):
    return re.findall(r'\w+', text.casefold(), re.UNICODE)


def fold(word):
    """Casefold and drop diacritics, as the FTS5 unicode61 tokenizer does."""
    return ''.join(c for c in unicodedata.normalize('NFKD', word.casefold()) if not unicodedata.combining(c))


FRONTMATTER = re.compile(r'\A\ufeff?---\r?\n.*?\r?\n---[ \t]*(?:\r?\n|\Z)', re.S)
MARKUP = re.compile(r'^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-+*][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)|\*\*|__|`+|~~|!?\[\[|\]\]|\]\([^)\n]*\)|!?\[(?=[^\]\n]*\]\()|<[^>\n]+>|^[ \t]*\|?[ \t]*:?-{3,}.*$|\||(?:[ \t]*\.){4,}|[\u2500-\u257f]+', re.M)


def readable(text, start_line=1):
    """Passage text as prose: frontmatter and common Markdown markup removed, whitespace collapsed.

    Returns (clean, sources) where sources[i] is the offset in `text` of clean[i]."""
    skip = FRONTMATTER.match(text) if start_line == 1 else None
    cuts = [(0, skip.end())] if skip else []
    cuts += [m.span() for m in MARKUP.finditer(text, skip.end() if skip else 0)]
    out, sources, cursor, space = [], [], 0, True
    for begin, end in [*cuts, (len(text), len(text))]:
        for i in range(cursor, max(cursor, begin)):
            c = text[i]
            if c.isspace() or c in '*_' and (i + 1 >= len(text) or text[i + 1].isspace() or i == 0 or text[i - 1].isspace()):
                if not space:
                    out.append(' ')
                    sources.append(i)
                    space = True
            else:
                out.append(c)
                sources.append(i)
                space = False
        if end > begin and not space and begin > cursor:
            out.append(' ')
            sources.append(begin)
            space = True
        cursor = max(cursor, end)
    while out and out[-1] == ' ':
        out.pop()
        sources.pop()
    return ''.join(out), sources


def excerpt(text, words, start_line=1, width=EXCERPT):
    """Cut readable passage text around its densest cluster of query words.

    Returns (excerpt, spans, line): at most `width` characters including ellipses, `spans` as
    [start, end) code-point offsets of each matched word within the excerpt, and the source
    line of the cluster's first word (or of the excerpt's start)."""
    clean, sources = readable(text, start_line)
    wanted = {fold(w) for w in words}
    hits = [(m.start(), m.end(), fold(m.group())) for m in re.finditer(r'\w+', clean) if fold(m.group()) in wanted]
    room = width - 2
    if hits:
        best, last = (0, 0, 0, 0), 0
        for first in range(len(hits)):
            last = max(last, first)
            while last + 1 < len(hits) and hits[last + 1][1] - hits[first][0] <= room * 2 // 3:
                last += 1
            score = (len({h[2] for h in hits[first:last + 1]}), last - first + 1)
            if score > best[:2]:
                best = (*score, first, last)
        a, b = hits[best[2]][0], hits[best[3]][1]
        start = max(0, a - (room - (b - a)) // 3)
        if start:  # Begin at a word, ideally a sentence.
            sentence = max(clean.rfind('. ', start, a), clean.rfind('? ', start, a), clean.rfind('! ', start, a))
            space = clean.find(' ', start, a)
            start = sentence + 2 if sentence >= 0 and a - sentence < room // 2 else space + 1 if space >= 0 else start
    else:
        a = start = 0
    end = min(len(clean), start + room)
    if end < len(clean):
        cut = clean.rfind(' ', start, end)
        end = cut if cut > start + room // 2 else end
    body = clean[start:end].rstrip()
    lead = '…' if start > 0 else ''
    tail = '…' if end < len(clean) else ''
    spans = [[s - start + len(lead), e - start + len(lead)] for s, e, _ in hits if s >= start and e <= start + len(body)]
    anchor = sources[a] if hits else sources[start] if sources else 0
    return lead + body + tail, spans, start_line + text.count('\n', 0, anchor)


def passage_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()


def pack(vector):
    """float32 arithmetic, float16 storage."""
    half = np.asarray(vector, dtype=np.float32).astype(np.float16)
    if not np.all(np.isfinite(half)):
        raise ValueError('Embedding vector does not fit float16 storage')
    return half.tobytes()


def unpack(blob):
    return np.frombuffer(blob, dtype=np.float16).astype(np.float32)


def edition_rank(path):
    """Prefer a reading copy over its original, and either over an original/ archive copy."""
    p = PurePosixPath(path)
    return ('.reading.' not in p.name, bool({'original', 'originals'} & set(p.parts[:-1])), len(p.parts), path)


def settings(root):
    """Search budgets and content types from indexes/settings.json → search, with defaults."""
    path = Path(root) / SETTINGS_FILE
    result = dict(DEFAULTS)
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError('indexes/settings.json must not be a symlink')
    if not path.is_file():
        return result
    if path.stat().st_size > 128 * 1024:
        raise ValueError('indexes/settings.json exceeds 128 KiB')
    data = json.loads(path.read_bytes())
    section = data.get('search', {}) if isinstance(data, dict) else None
    if not isinstance(section, dict):
        raise ValueError('indexes/settings.json search must be an object')
    unknown = sorted(set(section) - set(DEFAULTS))
    if unknown:
        raise ValueError(f'Unknown search settings {unknown}; supported: {sorted(DEFAULTS)}')
    for key, (low, high) in RANGES.items():
        if key in section:
            value = section[key]
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f'indexes/settings.json search.{key} must be an integer from {low:,} to {high:,}')
            result[key] = value
    if 'content_types' in section:
        types = section['content_types']
        if not isinstance(types, list) or len(types) > 64 or any(not isinstance(t, str) for t in types):
            raise ValueError('indexes/settings.json search.content_types must be a list of up to 64 extensions')
        normalized = sorted({t.casefold() for t in types})
        unsupported = [t for t in normalized if t not in TEXT_TYPES | {'.pdf'}]
        if unsupported:
            raise ValueError(f'search.content_types {unsupported} cannot be read as text; '
                             f'supported: {sorted(TEXT_TYPES | {".pdf"})}')
        result['content_types'] = normalized
    if result['max_database_mib'] + result['max_cache_mib'] > DATA_ROOM_MIB:
        raise ValueError(f'search.max_database_mib + search.max_cache_mib must not exceed {DATA_ROOM_MIB:,} MiB '
                         '(the 4 GiB .reader data budget)')
    return result


def kind_of(path, content_types):
    suffix = Path(path).suffix.lower()
    if suffix in content_types:
        return 'content'
    return 'machine' if suffix in TEXT_TYPES | {'.pdf'} else 'unsupported'


def source_bytes(root, relative):
    path = Path(relative)
    if path.is_absolute() or not path.parts or path.parts[0] != 'library' or any(
            part in {'.', '..'} or part.startswith('.') for part in path.parts):
        raise ValueError('Use a relative path under library/')
    target = root / path
    if any(p.is_symlink() for p in [target, *target.parents] if p != root.parent):
        raise ValueError('Search does not follow symlinks')
    if not target.resolve().is_relative_to(root / 'library'):
        raise ValueError('Path escapes library/')
    info = target.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE:
        raise ValueError('Source must be a regular file no larger than 32 MiB')
    with target.open('rb') as stream:
        data = stream.read(MAX_FILE + 1)
    if len(data) > MAX_FILE or target.stat().st_mtime_ns != info.st_mtime_ns:
        raise ValueError('Source is too large or changed during reading')
    return data


class _Count(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.count = 0

    def emit(self, record):
        self.count += 1


@contextmanager
def pdf_warnings():
    """Count pypdf's per-glyph warnings (broken ToUnicode maps and the like) instead of printing them.

    A damaged PDF can emit thousands of lines, which once filled the index worker's log budget
    and buried the real error. Callers report the count per file."""
    logger = logging.getLogger('pypdf')
    counter, propagate = _Count(), logger.propagate
    logger.addHandler(counter)
    logger.propagate = False
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always')
            yield counter
        counter.count += len(caught)
    finally:
        logger.removeHandler(counter)
        logger.propagate = propagate


def extract(path, data, warning_counts=None):
    """Return (page number or None, text) sections and untrusted source metadata.

    `warning_counts`, when given, receives {path: number of suppressed PDF warnings}."""
    suffix = Path(path).suffix.lower()
    if suffix == '.pdf':
        with pdf_warnings() as counter:
            pdf = PdfReader(io.BytesIO(data))
            if len(pdf.pages) > 5000:
                raise ValueError('PDF exceeds 5000-page limit')
            sections = [(i + 1, page.extract_text() or '') for i, page in enumerate(pdf.pages)]
        if counter.count and warning_counts is not None:
            warning_counts[path] = warning_counts.get(path, 0) + counter.count
        if sum(len(text) for _, text in sections) > MAX_FILE:
            raise ValueError('Extracted PDF text exceeds 32 MiB')
        return sections, {}
    if suffix not in TEXT_TYPES:
        return [], {}
    text = data.decode('utf-8-sig')
    if '\x00' in text:
        raise ValueError('Binary content in text file')
    metadata = parse_metadata(data).metadata if suffix == '.md' else {}
    return [(None, text)], metadata


def chunks(sections):
    # Character windows bound model input even for very long single-line sources.
    for page, text in sections:
        start, start_line = 0, 1
        while start < len(text):
            end = min(start + 1200, len(text))
            if end < len(text):
                split = text.rfind('\n', start + 600, end)
                if split > start:
                    end = split + 1
            excerpt = text[start:end]
            if excerpt.strip():
                yield page, start_line, start_line + text.count('\n', start, max(start, end - 1)), excerpt
            if end == len(text):
                break
            next_start = max(start + 1, end - 150)
            start_line += text.count('\n', start, next_start)
            start = next_start


def active(state):
    """Which index serves queries: 2 once a format 2 build has completed, else 1 if a format 1
    index exists, else 2 (whatever partial format 2 index there is, or none)."""
    state = Path(state)
    for name, version in (('search.v2.sqlite3', 2), ('search.sqlite3', 1)):
        path = state / name
        if not path.is_file():
            continue
        try:
            with closing(sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True, timeout=10)) as con:
                found = dict(con.execute("SELECT key, value FROM settings WHERE key IN ('version', 'indexed_at')"))
        except sqlite3.Error:
            continue
        if found.get('version') == str(version) and (version == 1 or found.get('indexed_at')):
            return version
    return 2


def setting(con, key):
    row = con.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return row[0] if row else None


class Search:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve(strict=True)
        self.state = self.root / '.reader'
        self.state.mkdir(exist_ok=True)
        self.db = self.state / 'search.v2.sqlite3'
        self.legacy = self.state / 'search.sqlite3'  # format 1, kept for older Reader processes
        self._model = None
        self._signature = None
        self._backend = 'fastembed'  # switching away from the default drops the loaded model
        self._limits = None
        self._vectors = None

    @property
    def model_name(self):
        """fastembed's bge-small (default) or `openai:<model>` (older `lmstudio:<model>`), served by the
        local-model provider, from the local-model settings."""
        from .local_model import embedding_backend
        backend = embedding_backend(self.root)
        key = backend
        if backend.startswith('openai:'):  # a new provider URL is a new embedder and signature
            from .local_model import effective_provider
            key += '\0' + effective_provider(self.root)['base_url']
        if key != self._backend:
            self._backend, self._model, self._signature = key, None, None
        return MODEL if backend == 'fastembed' else backend

    @property
    def limits(self):
        if self._limits is None:
            self._limits = settings(self.root)
        return self._limits

    def model(self, download=False):
        name = self.model_name
        if self._model is None and name != MODEL:
            from .local_model import embedder
            self._model = embedder(self.root, name)
        if self._model is None:
            from fastembed import TextEmbedding
            try:
                self._model = TextEmbedding(MODEL, cache_dir=str(self.state / 'models'),
                    threads=self.limits['worker_threads'], providers=['CPUExecutionProvider'],
                    local_files_only=not download)
            except Exception as exc:
                raise ValueError('Embedding model unavailable; run reader index first. ' + str(exc)) from exc
        return self._model

    def model_signature(self):
        if self._signature is None and self.model_name != MODEL:
            from .local_model import embedding_signature
            self._signature = embedding_signature(self.root, self.model_name)
        if self._signature is None:
            import fastembed
            digest = hashlib.sha256((MODEL + fastembed.__version__ + type(self._model).__name__).encode())
            seen = set()
            for path in sorted((self.state / 'models').rglob('*')):
                if path.suffix not in {'.onnx', '.json', '.txt'} or not path.is_file():
                    continue
                resolved = path.resolve()
                if resolved in seen:
                    continue
                seen.add(resolved)
                digest.update(path.name.encode())
                with path.open('rb') as source:
                    for block in iter(lambda: source.read(1024 * 1024), b''):
                        digest.update(block)
            self._signature = digest.hexdigest()
        return self._signature

    @staticmethod
    def cache_key(signature, text):
        return hashlib.sha256((signature + '\0' + text).encode()).hexdigest()

    def cached(self, cache, signature, texts):
        """float32 cache blobs for texts already embedded under `signature`; never calls the model."""
        found = {}
        for text in texts:
            row = cache.execute('SELECT vector FROM vectors WHERE key=?', (self.cache_key(signature, text),)).fetchone()
            if row:
                found[text] = row[0]
        return found

    def embed_batch(self, model, texts, cache, signature):
        keys = [self.cache_key(signature, text) for text in texts]
        saved = {key: cache.execute('SELECT vector FROM vectors WHERE key=?', (key,)).fetchone()
                 for key in keys}
        missing = {key: text for key, text in zip(keys, texts, strict=True) if saved[key] is None}
        if missing:
            vectors = model.passage_embed(list(missing.values()), batch_size=32)
            try:
                with cache:
                    for key, vector in zip(missing, vectors, strict=True):
                        blob = np.asarray(vector, dtype=np.float32).tobytes()
                        cache.execute('INSERT OR REPLACE INTO vectors VALUES (?,?)', (key, blob))
                        saved[key] = (blob,)
            except sqlite3.OperationalError as exc:
                if 'full' not in str(exc):
                    raise
                raise ValueError(f'Embedding cache reached its {self.limits["max_cache_mib"]:,} MiB budget '
                                 '(indexes/settings.json search.max_cache_mib) or the disk is full; '
                                 'completed batches are saved. Raise the setting, then run again.') from exc
        return [saved[key][0] for key in keys]

    @contextmanager
    def connect(self, create=False):
        if not create and not self.db.exists():
            raise ValueError('Search index missing; run reader index')
        con = sqlite3.connect(self.db if create else f'{self.db.as_uri()}?mode=ro',
                              uri=not create, timeout=60)
        con.row_factory = sqlite3.Row
        try:
            if not create:
                con.execute("BEGIN")  # One published snapshot across all ranking/metadata reads.
            if create:
                con.execute(f'PRAGMA page_size={PAGE_SIZE}')
                con.execute('PRAGMA journal_mode=WAL')
                con.execute(f'PRAGMA max_page_count={self.limits["max_database_mib"] * MIB // PAGE_SIZE}')
                con.executescript(SCHEMA)
            version = con.execute("SELECT value FROM settings WHERE key='version'").fetchone()
            if version and version[0] != VERSION:
                raise ValueError('Index version unsupported; rebuild the search index')
            metadata_version = con.execute(
                "SELECT value FROM settings WHERE key='metadata_index_version'").fetchone()
            if metadata_version and metadata_version[0] != METADATA_INDEX_VERSION:
                raise ValueError('Metadata index version unsupported; rebuild the search index')
            if not create and not version:
                raise ValueError('Search index incomplete; run reader index')
            if not create:
                columns = {row[1] for row in con.execute('PRAGMA table_info(docs)')}
                if not metadata_version or not METADATA_COLUMNS <= columns:
                    raise ValueError('Metadata index incomplete; run reader index')
            yield con
        except sqlite3.DatabaseError as exc:
            raise ValueError(f'Search database error: {exc}; rebuild .reader/search.v2.sqlite3; '
                             'if the embedding cache is damaged/full, remove .reader/embedding-cache.sqlite3') from exc
        finally:
            con.close()

    def index(self, semantic=True, deadline=None):
        """Refresh the index. `deadline` (epoch seconds) stops cleanly between files, keeping work."""
        if deadline is None and os.environ.get('READER_INDEX_DEADLINE'):
            deadline = float(os.environ['READER_INDEX_DEADLINE'])
        with (self.state / 'search.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self._limits = settings(self.root)
            return self._index(semantic, deadline)

    # Migration -------------------------------------------------------------

    def legacy_source(self):
        """The format 1 index, opened read-only, when it can seed vectors; never written."""
        if not self.legacy.is_file():
            return None
        try:
            with closing(sqlite3.connect(f'{self.legacy.as_uri()}?mode=ro', uri=True, timeout=10)) as con:
                return self.legacy if setting(con, 'version') == LEGACY_VERSION else None
        except sqlite3.Error:
            return None

    @staticmethod
    def validate(con):
        """Structural checks a migrated index must pass before the format 1 copy is removed."""
        problems = []
        if con.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            problems.append('quick_check failed')
        try:
            con.execute("INSERT INTO terms(terms, rank) VALUES('integrity-check', 1)")
        except sqlite3.DatabaseError as exc:
            problems.append(f'full-text index: {exc}')
        for label, sql in {
                'chunks without passages': 'SELECT count(*) FROM chunks c LEFT JOIN passages p ON p.id=c.passage_id '
                                           'WHERE c.passage_id IS NOT NULL AND p.id IS NULL',
                'unreferenced passages': 'SELECT count(*) FROM passages p WHERE NOT EXISTS '
                                         '(SELECT 1 FROM chunks c WHERE c.passage_id=p.id)',
                'documents without chunks': 'SELECT count(*) FROM docs d WHERE NOT EXISTS '
                                            '(SELECT 1 FROM chunks c WHERE c.path=d.path)'}.items():
            count = con.execute(sql).fetchone()[0]
            if count:
                problems.append(f'{count} {label}')
        return problems

    # Indexing --------------------------------------------------------------

    def walk(self):
        for folder, dirs, files in os.walk(self.root / 'library', followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and not (Path(folder) / d).is_symlink())
            for name in sorted(files):
                if not name.startswith('.') and not os_junk(name):
                    yield (Path(folder) / name).relative_to(self.root).as_posix()

    def _index(self, semantic, deadline):
        limits = self.limits
        content_types = set(limits['content_types'])
        model = self.model(download=True) if semantic else None
        signature = self.model_signature() if model else None
        legacy_path = self.legacy_source()
        run = {'issues': [], 'metadata_issues': [], 'changed': 0, 'removed': 0, 'embedded': 0, 'reused': 0,
               'pdf_warnings': {}}
        with closing(sqlite3.connect(self.state / 'embedding-cache.sqlite3')) as cache, \
                self.connect(create=True) as con, \
                closing(sqlite3.connect(f'{legacy_path.as_uri()}?mode=ro', uri=True)) if legacy_path else _null() as legacy:
            con.isolation_level = None
            cache.execute(f'PRAGMA max_page_count={limits["max_cache_mib"] * MIB // PAGE_SIZE}')
            cache.execute('CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, vector BLOB)')
            old_model = setting(con, 'model')
            switched = bool(old_model and old_model != self.model_name)
            if switched and not semantic:
                raise ValueError('Embedding model changed; rebuild the search index with embeddings')
            stored = setting(con, 'embedding_signature')
            if not stored and not semantic and legacy is not None:
                # A keyword-only first build adopts the format 1 vectors' fingerprint, so it can keep them.
                stored = setting(legacy, 'embedding_signature')
            reembed = bool(semantic and (switched or (stored and stored != signature)))  # a backend switch re-embeds every passage
            vectors_signature = signature if semantic else stored
            if legacy is not None and (not vectors_signature or setting(legacy, 'embedding_signature') != vectors_signature):
                legacy = None  # Format 1 vectors without a matching model fingerprint are not reused.
            con.execute('BEGIN IMMEDIATE')
            if reembed:
                con.execute('UPDATE passages SET vector=NULL, vector_path=NULL')
            published = {'version': VERSION, 'metadata_index_version': METADATA_INDEX_VERSION, 'model': self.model_name,
                         'complete': '0', 'updated_at': stamp()}
            if signature or stored:
                published['embedding_signature'] = signature or stored
            for key, value in published.items():
                con.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, value))
            con.execute('COMMIT')
            context = dict(con=con, cache=cache, legacy=legacy, model=model, semantic=semantic,
                           signature=vectors_signature, content_types=content_types, run=run)
            passages = con.execute('SELECT count(*) FROM passages').fetchone()[0]
            seen, pending, stopped = set(), 0, None
            con.execute('BEGIN IMMEDIATE')
            try:
                for path in self.walk():
                    if deadline is not None and time.time() >= deadline:
                        stopped = 'time limit'
                        break
                    seen.add(path)
                    con.execute('SAVEPOINT document')
                    try:
                        delta = self._refresh(path, context)
                        if passages + delta > limits['max_passages']:
                            raise ValueError(
                                f'Search index would hold more than {limits["max_passages"]:,} passages '
                                f'(indexes/settings.json search.max_passages); {passages:,} passages saved. '
                                'Raise the setting or narrow search.content_types, then run again.')
                    except BaseException:
                        con.execute('ROLLBACK TO document')
                        con.execute('RELEASE document')
                        raise
                    con.execute('RELEASE document')
                    passages += delta
                    pending += 1
                    if pending >= BATCH_PATHS:
                        con.execute("INSERT OR REPLACE INTO settings VALUES ('updated_at', ?)", (stamp(),))
                        con.execute('COMMIT')
                        con.execute('BEGIN IMMEDIATE')
                        pending = 0
                if stopped is None:
                    gone = [r[0] for r in con.execute('SELECT path FROM docs') if r[0] not in seen]
                    for path in gone:
                        passages -= self._forget(con, path)
                    run['removed'] = len(gone)
                    for key, value in {'complete': '1', 'indexed_at': stamp()}.items():
                        con.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, value))
                con.execute("INSERT OR REPLACE INTO settings VALUES ('updated_at', ?)", (stamp(),))
                con.execute('COMMIT')
            except BaseException as exc:
                # Completed files stay published; the failing file was rolled back above.
                if con.in_transaction:
                    try:
                        con.execute('COMMIT')
                    except sqlite3.Error:
                        con.execute('ROLLBACK')
                if isinstance(exc, sqlite3.OperationalError) and 'full' in str(exc):
                    raise ValueError(f'Search database reached its {limits["max_database_mib"]:,} MiB budget '
                                     f'(indexes/settings.json search.max_database_mib) or the disk is full; '
                                     f'{passages:,} passages saved. Raise the setting or narrow '
                                     'search.content_types, then run again.') from exc
                raise
            seeded = legacy is not None
            if stopped is None and setting(con, 'validated') != '1':
                # The first completed build is checked before search switches to it from format 1.
                problems = self.validate(con)
                if problems:
                    con.execute("INSERT OR REPLACE INTO settings VALUES ('complete', '0')")
                    con.execute("DELETE FROM settings WHERE key='indexed_at'")  # keeps queries on the previous index
                    raise ValueError('The new search index failed validation (' + '; '.join(problems)
                                     + '); search keeps serving the previous index. Rebuild to retry.')
                con.execute("INSERT OR REPLACE INTO settings VALUES ('validated', '1')")
        return self.report(run, semantic, stopped, seeded=seeded)

    def report(self, run, semantic, stopped, seeded=False):
        limits = self.limits
        with closing(sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True)) as con:
            documents = con.execute('SELECT count(*) FROM docs').fetchone()[0]
            machine = con.execute('SELECT count(*) FROM docs WHERE status=?', (MACHINE,)).fetchone()[0]
            passages = con.execute('SELECT count(*) FROM passages').fetchone()[0]
            chunk_count = con.execute('SELECT count(*) FROM chunks').fetchone()[0]
            pages = con.execute('PRAGMA page_count').fetchone()[0] * con.execute('PRAGMA page_size').fetchone()[0]
        result = {'documents': documents, 'chunks': chunk_count, 'passages': passages, 'path_only_machine': machine,
                  'changed': run['changed'], 'removed': run['removed'], 'semantic': semantic,
                  'embedded': run['embedded'], 'reused_vectors': run['reused'],
                  'complete': stopped is None, 'stopped': stopped, 'seeded_from_legacy': seeded,
                  'database_bytes': pages, 'budgets': {k: limits[k] for k in RANGES},
                  'issues': run['issues'], 'metadata_issues': run['metadata_issues']}
        warned = run['pdf_warnings']
        result['pdf_warnings'] = {'messages': sum(warned.values()), 'files': len(warned),
                                  'examples': sorted(warned, key=lambda p: -warned[p])[:5]}
        if warned:
            # One summary line instead of thousands of per-glyph lines.
            print(f'Reader indexing: {sum(warned.values()):,} PDF text-map warnings in {len(warned):,} files '
                  '(text still extracted; see pdf_warnings in the result)', file=sys.stderr, flush=True)
        if stopped:
            result['message'] = f'Stopped at the {stopped}; {passages:,} passages saved. Run again to continue.'
        return result

    def _refresh(self, path, ctx):
        """Bring one file's rows up to date inside the caller's savepoint; return the passage delta."""
        con, run = ctx['con'], ctx['run']
        kind = kind_of(path, ctx['content_types'])
        suffix = Path(path).suffix.lower()
        meta = MetadataResult()
        try:
            data = source_bytes(self.root, path)
            digest = hashlib.sha256(data).hexdigest()
            meta = inspect_metadata(self.root, path, data)
            if meta.diagnostics:
                run['metadata_issues'].append({'path': path, 'status': meta.status, 'diagnostics': meta.diagnostics})
            previous = con.execute('SELECT * FROM docs WHERE path=?', (path,)).fetchone()
            same = previous is not None and previous['sha256'] == digest
            if kind == 'content':
                missing = ctx['semantic'] and con.execute(
                    'SELECT 1 FROM chunks c JOIN passages p ON p.id=c.passage_id '
                    'WHERE c.path=? AND p.vector IS NULL LIMIT 1', (path,)).fetchone()
                retry = previous is not None and previous['status'] != 'text' and suffix in TEXT_TYPES
                if same and not missing and not retry and previous['status'] != MACHINE:
                    self._write_metadata(con, path, meta)
                    if previous['status'] != 'text':
                        run['issues'].append({'path': path, 'reason': previous['status']})
                    return 0
                sections, _ = extract(path, data, run['pdf_warnings'])
                parts = list(chunks(sections))
                status = 'text' if parts else UNSUPPORTED
            else:
                status = MACHINE if kind == 'machine' else UNSUPPORTED
                if same and previous['status'] == status:
                    self._write_metadata(con, path, meta)
                    if status != MACHINE:
                        run['issues'].append({'path': path, 'reason': status})
                    return 0
                parts = []
        except Exception as exc:
            # Failed extraction stays discoverable by path, but old text is never retained.
            parts, digest = [], ''
            status = f'path_only: {type(exc).__name__}: {exc}'
        run['changed'] += 1
        if status not in ('text', MACHINE):
            run['issues'].append({'path': path, 'reason': status})
        removed = self._unlink_chunks(con, path)
        info = (self.root / path).lstat()
        doc = con.execute('SELECT id FROM docs WHERE path=?', (path,)).fetchone()
        if doc:
            con.execute('UPDATE docs SET sha256=?, metadata=?, status=?, size=?, mtime=? WHERE id=?',
                        (digest, '{}', status, info.st_size, info.st_mtime_ns, doc[0]))
        else:
            doc_id = con.execute('INSERT INTO docs(path,sha256,metadata,status,size,mtime) VALUES (?,?,?,?,?,?)',
                                 (path, digest, '{}', status, info.st_size, info.st_mtime_ns)).lastrowid
            con.execute('INSERT INTO names(rowid, path) VALUES (?,?)', (doc_id, path))
        self._write_metadata(con, path, meta)
        if not parts:
            con.execute('INSERT INTO chunks(path,page,start_line,end_line,passage_id) VALUES (?,?,?,?,NULL)',
                        (path, None, 1, 1))
            return -self._collect(con, removed)
        added, unembedded = 0, {}
        for page, start, end, text in parts:
            row = con.execute('SELECT id, vector IS NOT NULL FROM passages WHERE hash=?', (passage_hash(text),)).fetchone()
            if row:
                passage, has_vector = row[0], bool(row[1])
            else:
                passage = con.execute('INSERT INTO passages(hash, text) VALUES (?,?)', (passage_hash(text), text)).lastrowid
                con.execute('INSERT INTO terms(rowid, text) VALUES (?,?)', (passage, text))
                added, has_vector = added + 1, False
            con.execute('INSERT INTO chunks(path,page,start_line,end_line,passage_id) VALUES (?,?,?,?,?)',
                        (path, page, start, end, passage))
            if not has_vector:
                unembedded[passage] = text
        if unembedded:
            self._attach_vectors(path, unembedded, ctx)
        return added - self._collect(con, removed)

    def _attach_vectors(self, path, unembedded, ctx):
        """Vectors for new passages: format 1 copy, then the cache, then (semantic runs only) the model."""
        con, signature = ctx['con'], ctx['signature']
        found = {}
        if ctx['legacy'] is not None:
            wanted = set(unembedded.values())
            for text, blob in ctx['legacy'].execute(
                    'SELECT text, vector FROM chunks WHERE path=? AND vector IS NOT NULL', (path,)):
                if text in wanted and isinstance(blob, bytes) and blob and len(blob) % 4 == 0:
                    found[text] = blob
        if signature:
            remaining = {path + '\n' + t: t for t in unembedded.values() if t not in found}
            for key, blob in self.cached(ctx['cache'], signature, remaining).items():
                found[remaining[key]] = blob
        ctx['run']['reused'] += len(found)
        missing = [(p, t) for p, t in unembedded.items() if t not in found]
        if ctx['model'] is not None:
            for offset in range(0, len(missing), 32):
                batch = missing[offset:offset + 32]
                blobs = self.embed_batch(ctx['model'], [path + '\n' + t for _, t in batch], ctx['cache'], signature)
                ctx['run']['embedded'] += len(batch)
                for (_, text), blob in zip(batch, blobs, strict=True):
                    found[text] = blob
        for passage, text in unembedded.items():
            if text in found:
                con.execute('UPDATE passages SET vector=?, vector_path=? WHERE id=?',
                            (pack(np.frombuffer(found[text], dtype=np.float32)), path, passage))

    @staticmethod
    def _unlink_chunks(con, path):
        ids = {r[0] for r in con.execute('SELECT passage_id FROM chunks WHERE path=? AND passage_id IS NOT NULL', (path,))}
        con.execute('DELETE FROM chunks WHERE path=?', (path,))
        return ids

    @staticmethod
    def _collect(con, candidates):
        """Delete passages no file references any more; return how many."""
        count = 0
        for passage in candidates:
            if con.execute('SELECT 1 FROM chunks WHERE passage_id=? LIMIT 1', (passage,)).fetchone():
                continue
            text = con.execute('SELECT text FROM passages WHERE id=?', (passage,)).fetchone()[0]
            con.execute("INSERT INTO terms(terms, rowid, text) VALUES ('delete', ?, ?)", (passage, text))
            con.execute('DELETE FROM passages WHERE id=?', (passage,))
            count += 1
        return count

    def _forget(self, con, path):
        removed = self._unlink_chunks(con, path)
        doc = con.execute('SELECT id FROM docs WHERE path=?', (path,)).fetchone()
        if doc:
            con.execute('DELETE FROM names WHERE rowid=?', (doc[0],))
        con.execute('DELETE FROM docs WHERE path=?', (path,))
        return self._collect(con, removed)

    @staticmethod
    def _write_metadata(con, path, meta):
        # A failed schema validation never publishes a trusted version or revision.
        con.execute("UPDATE docs SET metadata=?, frontmatter_schema_version=?, document_revision=?, "
                    "metadata_status=?, metadata_profile=?, metadata_diagnostics=? WHERE path=?",
                    (json.dumps(meta.metadata, ensure_ascii=False, allow_nan=False),
                     meta.metadata.get('frontmatter_schema_version') if meta.status in {'valid', 'legacy'} else None,
                     meta.metadata.get('document_revision') if meta.status in {'valid', 'legacy'} else None,
                     meta.status, meta.profile, json.dumps(meta.diagnostics), path))

    # Queries ---------------------------------------------------------------

    def search(self, query, mode: Mode = 'hybrid', limit=10, path_prefix='library/', editions: Editions = 'preferred'):
        if not query.strip() or len(query) > 1000:
            raise ValueError('Query must contain 1–1000 characters')
        if mode not in {'hybrid', 'keyword', 'fuzzy', 'semantic'} or not 1 <= limit <= 50:
            raise ValueError('Invalid search mode or limit (1–50)')
        if editions not in {'preferred', 'all'}:
            raise ValueError('editions must be preferred or all')
        if not path_prefix.startswith('library/') or '..' in Path(path_prefix).parts:
            raise ValueError('path_prefix must start with library/')
        if active(self.state) == 1:
            from . import search_legacy
            return search_legacy.search(self, query, mode, limit, path_prefix)
        with self.connect() as con:
            settings_ = dict(con.execute('SELECT key,value FROM settings'))
            docs = {r['path']: dict(r) for r in con.execute('SELECT * FROM docs')
                    if r['path'].startswith(path_prefix)}
            rows = {r['id']: dict(r) for r in con.execute(
                'SELECT id, path, page, start_line, end_line, passage_id FROM chunks ORDER BY id') if r['path'] in docs}
            texts = {}
            rankings, warnings, scores = {}, [], {}
            if settings_.get('complete') != '1':
                warnings.append('The last index run stopped before finishing; results cover the files indexed '
                                'so far. Run reader index to continue.')
            def document_candidates(ids):
                seen, selected = set(), []
                for i in ids:
                    if rows[i]['path'] in seen:
                        continue
                    seen.add(rows[i]['path'])
                    selected.append(i)
                    if len(selected) == 200:
                        break
                return selected
            if mode in {'keyword', 'hybrid'}:
                words = tokens(query)
                if words:
                    expression = ' OR '.join('"' + w + '"' for w in words)
                    passage_scores = dict(con.execute(
                        'SELECT rowid, bm25(terms) FROM terms WHERE terms MATCH ?', (expression,)).fetchall())
                    ids = {d['id']: p for p, d in docs.items()}
                    # Path matches weigh four times passage text, as in the single combined table of format 1.
                    path_scores = {ids[r[0]]: 4.0 * r[1] for r in con.execute(
                        'SELECT rowid, bm25(names) FROM names WHERE names MATCH ?', (expression,)) if r[0] in ids}
                    ranked, first = {}, {}
                    for i, row in rows.items():
                        first.setdefault(row['path'], i)
                        if row['passage_id'] in passage_scores:
                            ranked[i] = passage_scores[row['passage_id']] + path_scores.get(row['path'], 0.0)
                    matched = {rows[i]['path'] for i in ranked}
                    for path, score in path_scores.items():
                        if path not in matched and path in first:
                            ranked[first[path]] = score
                    rankings['keyword'] = sorted(ranked, key=lambda i: (ranked[i], i))
            if mode in {'fuzzy', 'hybrid'}:
                texts = dict(con.execute('SELECT id, text FROM passages').fetchall())
                choices = {i: (r['path'] + '\n' + texts.get(r['passage_id'], '')).casefold() for i, r in rows.items()}
                matches = process.extract(query.casefold(), choices, scorer=fuzz.partial_ratio,
                                          limit=None, score_cutoff=70)
                rankings['fuzzy'] = document_candidates(i for _, _, i in matches)
                scores['fuzzy'] = {i: round(score / 100, 4) for _, score, i in matches}
            if mode in {'semantic', 'hybrid'}:
                holders = {}
                for i, row in rows.items():
                    if row['passage_id'] is not None:
                        holders.setdefault(row['passage_id'], []).append(i)
                embedded = [(p, blob) for p, blob in con.execute('SELECT id, vector FROM passages WHERE vector IS NOT NULL')
                            if p in holders]
                if len(embedded) != len(holders):
                    warnings.append('Some passages lack embeddings; run reader index for complete semantic coverage.')
                if embedded:
                    model = self.model()
                    if settings_.get('embedding_signature') != self.model_signature():
                        raise ValueError('Embedding model files changed; run reader index to refresh vectors')
                    vector = np.asarray(next(iter(model.query_embed(query))), dtype=np.float32)
                    matrix = np.stack([unpack(blob) for _, blob in embedded])
                    similarity = matrix @ vector / np.maximum(np.linalg.norm(matrix, axis=1) * np.linalg.norm(vector), 1e-12)
                    order = np.argsort(-similarity, kind='stable')
                    def editions_of(passage):
                        ids = holders[passage]
                        # Identical passages collapse to the preferred edition unless all are asked for.
                        return ids if editions == 'all' else [min(ids, key=lambda i: (edition_rank(rows[i]['path']), i))]
                    rankings['semantic'] = document_candidates(i for k in order for i in editions_of(embedded[k][0]))
                    scores['semantic'] = {i: round(float(similarity[k]), 4) for k in order for i in holders[embedded[k][0]]}
                elif mode == 'semantic' and holders:
                    raise ValueError('Semantic index missing; run reader index')
            # Fuse document ranks, so long books do not dominate through repeated chunks.
            fused, best, signals = {}, {}, {}
            for channel, ids in rankings.items():
                seen = set()
                for i in ids:
                    path = rows[i]['path']
                    if path in seen:
                        continue
                    seen.add(path)
                    score = 1 / (60 + len(seen))
                    fused[path] = fused.get(path, 0) + score
                    signals.setdefault(path, []).append(channel)
                    if path not in best or score > best[path][0]:
                        best[path] = (score, i)
            # Administrative delivery records stay searchable without displacing reading material.
            for path in fused:
                name = Path(path).name.casefold()
                if name in {'receipt.json', 'sha256sums'} and name not in query.casefold():
                    fused[path] *= 0.2
            results = []
            for path in sorted(fused, key=lambda p: (-fused[p], p)):
                doc = docs[path]
                try:
                    data = source_bytes(self.root, path)
                except (ValueError, OSError):
                    warnings.append(f'Source unavailable or excluded: {path}; run reader index.')
                    continue
                if doc['sha256'] and hashlib.sha256(data).hexdigest() != doc['sha256']:
                    warnings.append(f'Source changed: {path}; run reader index. Stale excerpt omitted.')
                    continue
                row = rows[best[path][1]]
                passage = row['passage_id']
                if passage is not None and passage not in texts:
                    texts[passage] = con.execute('SELECT text FROM passages WHERE id=?', (passage,)).fetchone()[0]
                results.append({'path': path, 'absolute_path': str(self.root / path),
                    'sha256': doc['sha256'], 'metadata': json.loads(doc['metadata']),
                    'metadata_status': doc['metadata_status'], 'metadata_profile': doc['metadata_profile'],
                    'metadata_diagnostics': json.loads(doc['metadata_diagnostics'] or '[]'),
                    'score': round(fused[path], 6), 'matched_by': signals[path],
                    'similarity': {k: v[row['id']] for k, v in scores.items() if row['id'] in v},
                    'page': row['page'], 'start_line': row['start_line'], 'end_line': row['end_line'],
                    'excerpt': texts.get(passage, ''), 'content_status': doc['status']})
                if len(results) == limit:
                    break
            return {'query': query, 'mode': mode, 'editions': editions,
                    'indexed_at': settings_.get('indexed_at') or settings_.get('updated_at'),
                    'complete': settings_.get('complete') == '1',
                    'model': self.model_name if 'semantic' in rankings else None, 'results': results,
                    'warnings': warnings, 'scope': 'Indexed library files; run reader index after additions, edits, or filing.'}

    def passages(self, query, mode: Literal['hybrid', 'keyword', 'semantic'] = 'hybrid', limit=PAGE_POOL,
                 path_prefix='library/', allow=(None,), include_machine=False):
        """Passage-level candidates for the search page, from one scoring pass.

        Ranks chunks (not documents) by reciprocal-rank fusion of exact words (FTS5 bm25 over
        passages, plus file-name matches) and meaning (cosine over passage vectors). Identical
        passages collapse to the preferred edition. For each predicate in `allow` (a callable
        taking a path and its index row, or None for all), returns that predicate's top `limit` chunks, so one
        query serves both filtered results and facet counts. When the embedding model or
        vectors are unavailable, Meaning falls back to exact words and says so. While only a
        format 1 index exists (no completed format 2 build), candidates come from it read-only."""
        if not query.strip() or len(query) > 1000:
            raise ValueError('Query must contain 1–1000 characters')
        if mode not in {'hybrid', 'keyword', 'semantic'} or not 1 <= limit <= PAGE_POOL:
            raise ValueError(f'Invalid search mode or pool size (1–{PAGE_POOL})')
        if not path_prefix.startswith('library/') or '..' in Path(path_prefix).parts:
            raise ValueError('path_prefix must start with library/')
        words = list(dict.fromkeys(w for w in tokens(query) if w not in STOPWORDS)) or list(dict.fromkeys(tokens(query)))
        if active(self.state) == 1:
            # Until a format 2 build completes, the page reads the format 1 index read-only, as search() does.
            from . import search_legacy
            return search_legacy.passages(self, query, mode, limit, path_prefix, allow, words)
        with self.connect() as con:
            settings_ = dict(con.execute('SELECT key,value FROM settings'))
            docs = {r['path']: {'status': r['status'], 'sha256': r['sha256'], 'metadata': r['metadata']}
                    for r in con.execute('SELECT path, status, sha256, metadata FROM docs WHERE substr(path, 1, ?)=?',
                                         (len(path_prefix), path_prefix))
                    if include_machine or r['status'] != MACHINE}
            rows, holders, first = {}, {}, {}
            for r in con.execute('SELECT id, path, page, start_line, end_line, passage_id FROM chunks ORDER BY id'):
                if r[1] not in docs:
                    continue
                rows[r[0]] = r
                first.setdefault(r[1], r[0])
                if r[5] is not None:
                    holders.setdefault(r[5], []).append(r[0])
            warnings, rankings, semantic = [], {}, None
            if settings_.get('complete') != '1':
                warnings.append('The last index run stopped before finishing; results cover the files indexed so far.')
            if mode in {'hybrid', 'semantic'}:
                try:
                    rankings['semantic'] = self._meaning(con, query, holders, settings_, warnings, MEANING_TOP[mode])
                    semantic = 'used'
                except ValueError as exc:
                    semantic = 'unavailable'
                    warnings.append('Meaning search is unavailable (' + str(exc).rstrip('.') + '); showing exact-word matches.')
            if (mode in {'hybrid', 'keyword'} or semantic == 'unavailable') and words:
                expression = ' OR '.join('"' + w + '"' for w in words)
                rankings['words'] = [r[0] for r in con.execute(
                    'SELECT rowid FROM terms WHERE terms MATCH ? ORDER BY bm25(terms) LIMIT ?',
                    (expression, PAGE_CHANNEL)) if r[0] in holders]
                names = [r[0] for r in con.execute(
                    'SELECT d.path FROM names JOIN docs d ON d.id=names.rowid WHERE names MATCH ? '
                    'ORDER BY bm25(names) LIMIT ?', (expression, PAGE_CHANNEL)) if r[0] in first]
            else:
                names = []
            # Fuse passage ranks; file-name matches attach to a file's first chunk.
            fused, signals = {}, {}
            for channel, ids in rankings.items():
                for rank, passage in enumerate(ids, 1):
                    fused[('p', passage)] = fused.get(('p', passage), 0) + 1 / (60 + rank)
                    signals.setdefault(('p', passage), []).append(channel)
            for rank, path in enumerate(names, 1):
                key = ('c', first[path])
                fused[key] = fused.get(key, 0) + 1 / (60 + rank)
                signals.setdefault(key, []).append('path')
            order = sorted(fused, key=lambda k: (-fused[k], k))
            pools, truncated = [], []
            for predicate in allow:
                passes, pool, used = {}, [], set()
                def ok(path):
                    if path not in passes:
                        passes[path] = predicate is None or bool(predicate(path, docs[path]))
                    return passes[path]
                full = False
                for key in order:
                    kind, ident = key
                    if kind == 'p':
                        candidates = [i for i in holders[ident] if ok(rows[i][1])]
                        if not candidates:
                            continue
                        chosen = min(candidates, key=lambda i: (edition_rank(rows[i][1]), i))
                    else:
                        chosen = ident
                        if not ok(rows[chosen][1]):
                            continue
                    if chosen in used:
                        continue
                    used.add(chosen)
                    pool.append((chosen, fused[key], signals[key]))
                    if len(pool) == limit:
                        full = True
                        break
                pools.append(pool)
                truncated.append(full)
            wanted = {rows[i][5] for pool in pools for i, _, _ in pool if rows[i][5] is not None}
            texts = {}
            wanted = sorted(wanted)
            for offset in range(0, len(wanted), 900):
                batch = wanted[offset:offset + 900]
                texts.update(con.execute(f'SELECT id, text FROM passages WHERE id IN ({",".join("?" * len(batch))})',
                                         batch).fetchall())
            word_set = {fold(w) for w in words}
            def candidate(i, score, matched_by):
                _, path, page, start, end, passage = rows[i]
                text = texts.get(passage, '')
                return {'path': path, 'page': page, 'start_line': start, 'end_line': end, 'text': text,
                        'score': round(score, 6), 'matched_by': matched_by,
                        'literal': bool(word_set & {fold(t) for t in tokens(text)}) or 'path' in matched_by}
            return {'query': query, 'mode': mode, 'words': words,
                    'pools': [[candidate(*entry) for entry in pool] for pool in pools], 'truncated': truncated,
                    'docs': docs, 'semantic': semantic, 'warnings': warnings,
                    'indexed_at': settings_.get('indexed_at') or settings_.get('updated_at'),
                    'complete': settings_.get('complete') == '1'}

    def _meaning(self, con, query, holders, settings_, warnings, top_n):
        """Passage ids ranked by cosine similarity to the query, best first, within the floor and band."""
        key = (str(self.db), settings_.get('updated_at'), settings_.get('embedding_signature'),
               *con.execute('SELECT count(*), max(id) FROM passages WHERE vector IS NOT NULL').fetchone())
        if self._vectors is None or self._vectors[0] != key:
            ids, blobs = [], []
            for passage, blob in con.execute('SELECT id, vector FROM passages WHERE vector IS NOT NULL'):
                ids.append(passage)
                blobs.append(blob)
            matrix = (np.frombuffer(b''.join(blobs), dtype=np.float16).reshape(len(blobs), -1).astype(np.float32)
                      if blobs else np.zeros((0, 0), dtype=np.float32))
            if len(matrix):
                matrix /= np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
            self._vectors = (key, np.asarray(ids), matrix)  # Reused while the published snapshot is unchanged.
        _, ids, matrix = self._vectors
        if not len(ids):
            raise ValueError('no passage has an embedding yet; run reader index')
        present = np.fromiter((p in holders for p in ids.tolist()), dtype=bool, count=len(ids))
        if not present.all() and len(holders) > int(present.sum()):
            warnings.append('Some passages lack embeddings; run reader index for complete meaning search.')
        model = self.model()
        if settings_.get('embedding_signature') != self.model_signature():
            raise ValueError('embedding model files changed; run reader index to refresh vectors')
        vector = np.asarray(next(iter(model.query_embed(query))), dtype=np.float32)
        vector /= max(float(np.linalg.norm(vector)), 1e-12)
        similarity = np.where(present, matrix @ vector, -np.inf)
        count = min(top_n, int(present.sum()))
        top = np.argpartition(-similarity, count - 1)[:count] if count else np.array([], dtype=int)
        top = top[np.argsort(-similarity[top], kind='stable')]
        cut = max(MEANING_FLOOR, float(similarity[top[0]]) - MEANING_BAND) if len(top) else 1.0
        return [int(ids[k]) for k in top if similarity[k] >= cut]

    def read(self, path, start_line=1, limit=100, page=None, expected_sha256=None):
        if not 1 <= limit <= 500 or start_line < 1 or (page is not None and page < 1):
            raise ValueError('Invalid reading range; limit is 1–500')
        data = source_bytes(self.root, path)
        digest = hashlib.sha256(data).hexdigest()
        if expected_sha256 and digest != expected_sha256:
            raise ValueError('Source changed since search; search again after indexing')
        sections, metadata = extract(path, data, {})
        if not sections:
            raise ValueError('No supported text; open the original file')
        if Path(path).suffix.lower() == '.pdf':
            page = page or 1
            sections = [s for s in sections if s[0] == page]
            if not sections:
                raise ValueError('PDF page out of range')
        elif page is not None:
            raise ValueError('page applies only to PDF files')
        lines = sections[0][1].splitlines(keepends=True)
        text = ''.join(lines[start_line - 1:start_line - 1 + limit])
        meta = inspect_metadata(self.root, path, data)
        return {'path': path, 'sha256': digest, **meta.public(), 'page': page,
                'start_line': start_line, 'total_lines': len(lines), 'text': text[:64000],
                'truncated': len(text) > 64000, 'next_line': start_line + limit if start_line + limit <= len(lines) else None}


def stamp():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def _null():
    yield None
