"""Rebuildable local search. Source files are never modified."""
from contextlib import contextmanager, closing
from datetime import datetime, timezone
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
from typing import Literal

import numpy as np
from pypdf import PdfReader
from rapidfuzz import fuzz, process
from .metadata import inspect_metadata, parse_metadata

Mode = Literal['hybrid', 'keyword', 'fuzzy', 'semantic']
MODEL = 'BAAI/bge-small-en-v1.5'
VERSION = '1'
METADATA_INDEX_VERSION = '1'
METADATA_COLUMNS = {'frontmatter_schema_version', 'document_revision', 'metadata_status',
                    'metadata_profile', 'metadata_diagnostics'}
MAX_FILE = 32 * 1024 * 1024
MAX_CHUNKS = 100_000
TEXT_TYPES = {'.md', '.txt', '.rst', '.tex', '.html', '.csv', '.json', '.yaml', '.yml',
              '.toml', '.py', '.rs', '.js', '.ts', '.css', '.sh', '.bib', '.edict',
              '.cff', '.cls', '.log', '.v', '.mjs', '.lock', '.svg', ''}


def tokens(text):
    return re.findall(r'\w+', text.casefold(), re.UNICODE)


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


def extract(path, data):
    """Return (page number or None, text) sections and untrusted source metadata."""
    suffix = Path(path).suffix.lower()
    if suffix == '.pdf':
        pdf = PdfReader(io.BytesIO(data))
        if len(pdf.pages) > 5000:
            raise ValueError('PDF exceeds 5000-page limit')
        sections = [(i + 1, page.extract_text() or '') for i, page in enumerate(pdf.pages)]
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


class Search:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve(strict=True)
        self.state = self.root / '.reader'
        self.state.mkdir(exist_ok=True)
        self.db = self.state / 'search.sqlite3'
        self._model = None
        self._signature = None

    def model(self, download=False):
        if self._model is None:
            from fastembed import TextEmbedding
            try:
                self._model = TextEmbedding(MODEL, cache_dir=str(self.state / 'models'),
                    threads=2, providers=['CPUExecutionProvider'], local_files_only=not download)
            except Exception as exc:
                raise ValueError('Embedding model unavailable; run reader index first. ' + str(exc)) from exc
        return self._model

    def model_signature(self):
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

    def embed_batch(self, model, texts, cache, signature):
        keys = [hashlib.sha256((signature + '\0' + text).encode()).hexdigest() for text in texts]
        saved = {key: cache.execute('SELECT vector FROM vectors WHERE key=?', (key,)).fetchone()
                 for key in keys}
        missing = {key: text for key, text in zip(keys, texts, strict=True) if saved[key] is None}
        if missing:
            vectors = model.passage_embed(list(missing.values()), batch_size=32)
            with cache:
                for key, vector in zip(missing, vectors, strict=True):
                    blob = np.asarray(vector, dtype=np.float32).tobytes()
                    cache.execute('INSERT OR REPLACE INTO vectors VALUES (?,?)', (key, blob))
                    saved[key] = (blob,)
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
                con.executescript('''
                    PRAGMA journal_mode=WAL;
                    PRAGMA max_page_count=131072;
                    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
                    CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, sha256 TEXT,
                        metadata TEXT, status TEXT, size INTEGER, mtime INTEGER);
                    CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, path TEXT,
                        page INTEGER, start_line INTEGER, end_line INTEGER, text TEXT, vector BLOB);
                    CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
                    CREATE VIRTUAL TABLE IF NOT EXISTS terms USING fts5(path, text, tokenize='unicode61');
                ''')
            version = con.execute("SELECT value FROM settings WHERE key='version'").fetchone()
            if version and version[0] != VERSION:
                raise ValueError('Index version unsupported; rebuild the search index')
            metadata_version = con.execute(
                "SELECT value FROM settings WHERE key='metadata_index_version'").fetchone()
            if metadata_version and metadata_version[0] != METADATA_INDEX_VERSION:
                raise ValueError('Metadata index version unsupported; rebuild the search index')
            if create:
                columns = {row[1] for row in con.execute('PRAGMA table_info(docs)')}
                additions = {'frontmatter_schema_version': 'INTEGER', 'document_revision': 'INTEGER',
                             'metadata_status': 'TEXT', 'metadata_profile': 'TEXT',
                             'metadata_diagnostics': 'TEXT'}
                for name, sql_type in additions.items():
                    if name not in columns:
                        con.execute(f'ALTER TABLE docs ADD COLUMN {name} {sql_type}')
            if not create and not version:
                raise ValueError('Search index incomplete; run reader index')
            if not create:
                columns = {row[1] for row in con.execute('PRAGMA table_info(docs)')}
                if not metadata_version or not METADATA_COLUMNS <= columns:
                    raise ValueError('Metadata index incomplete; run reader index')
            yield con
        except sqlite3.DatabaseError as exc:
            raise ValueError(f'Search database error: {exc}; rebuild .reader/search.sqlite3; '
                             'if the embedding cache is damaged/full, remove .reader/embedding-cache.sqlite3') from exc
        finally:
            con.close()

    def index(self, semantic=True):
        with (self.state / 'search.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            return self._index(semantic)

    def _index(self, semantic):
        issues, seen, changed = [], set(), 0
        metadata_issues = []
        model = self.model(download=True) if semantic else None
        signature = self.model_signature() if model else None
        with closing(sqlite3.connect(self.state / 'embedding-cache.sqlite3')) as cache, self.connect(create=True) as con, con:
            cache.execute('PRAGMA max_page_count=131072')
            cache.execute('CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, vector BLOB)')
            old_signature = con.execute("SELECT value FROM settings WHERE key='embedding_signature'").fetchone()
            reembed = bool(semantic and old_signature and old_signature[0] != signature)
            old_model = con.execute("SELECT value FROM settings WHERE key='model'").fetchone()
            if old_model and old_model[0] != MODEL:
                raise ValueError('Embedding model changed; rebuild the search index')
            for folder, dirs, files in os.walk(self.root / 'library', followlinks=False):
                dirs[:] = sorted(d for d in dirs if not d.startswith('.') and
                                 not (Path(folder) / d).is_symlink())
                for name in sorted(files):
                    if name.startswith('.'):
                        continue
                    path = (Path(folder) / name).relative_to(self.root).as_posix()
                    seen.add(path)
                    from .metadata import MetadataResult
                    meta = MetadataResult()
                    try:
                        data = source_bytes(self.root, path)
                        digest = hashlib.sha256(data).hexdigest()
                        meta = inspect_metadata(self.root, path, data)
                        if meta.diagnostics:
                            metadata_issues.append({'path': path, 'status': meta.status,
                                                    'diagnostics': meta.diagnostics})
                        previous = con.execute('SELECT * FROM docs WHERE path=?', (path,)).fetchone()
                        missing = con.execute('SELECT 1 FROM chunks WHERE path=? AND vector IS NULL LIMIT 1', (path,)).fetchone()
                        if previous and previous['sha256'] == digest and not (semantic and missing) and not reembed and not (
                                previous['status'] != 'text' and Path(path).suffix.lower() in TEXT_TYPES):
                            self._write_metadata(con, path, meta)
                            if previous['status'] != 'text':
                                issues.append({'path': path, 'reason': previous['status']})
                            continue
                        sections, metadata = extract(path, data)
                        parts = list(chunks(sections))
                        status = 'text' if parts else 'path_only: unsupported format or no extractable text'
                    except Exception as exc:
                        # Failed extraction stays discoverable by path, but old text is never retained.
                        parts, metadata, digest = [], {}, ''
                        status = f'path_only: {type(exc).__name__}: {exc}'
                    changed += 1
                    if status != 'text':
                        issues.append({'path': path, 'reason': status})
                    con.execute('DELETE FROM terms WHERE rowid IN (SELECT id FROM chunks WHERE path=?)', (path,))
                    con.execute('DELETE FROM chunks WHERE path=?', (path,))
                    info = (self.root / path).lstat()
                    con.execute('INSERT OR REPLACE INTO docs(path,sha256,metadata,status,size,mtime) VALUES (?,?,?,?,?,?)',
                        (path, digest, '{}', status, info.st_size, info.st_mtime_ns))
                    self._write_metadata(con, path, meta)
                    if con.execute('SELECT count(*) FROM chunks').fetchone()[0] + max(1, len(parts)) > MAX_CHUNKS:
                        raise ValueError('Index exceeds 100,000 chunks; narrow the library before retrying')
                    for offset in range(0, max(1, len(parts)), 32):
                        batch = parts[offset:offset + 32] or [(None, 1, 1, '')]
                        vectors = self.embed_batch(model, [path + '\n' + p[3] for p in batch], cache, signature) if model else [None] * len(batch)
                        for (page, start, end, text), vector in zip(batch, vectors, strict=True):
                            blob = vector
                            row = con.execute('INSERT INTO chunks(path,page,start_line,end_line,text,vector) VALUES (?,?,?,?,?,?)',
                                (path, page, start, end, text, blob)).lastrowid
                            con.execute('INSERT INTO terms(rowid,path,text) VALUES (?,?,?)', (row, path, text))
            removed = [r[0] for r in con.execute('SELECT path FROM docs') if r[0] not in seen]
            for path in removed:
                con.execute('DELETE FROM terms WHERE rowid IN (SELECT id FROM chunks WHERE path=?)', (path,))
                con.execute('DELETE FROM chunks WHERE path=?', (path,))
                con.execute('DELETE FROM docs WHERE path=?', (path,))
            if signature:
                con.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('embedding_signature', signature))
            for key, value in {'version': VERSION, 'metadata_index_version': METADATA_INDEX_VERSION, 'model': MODEL,
                               'indexed_at': datetime.now(timezone.utc).isoformat()}.items():
                con.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, value))
            return {'documents': con.execute('SELECT count(*) FROM docs').fetchone()[0],
                    'chunks': con.execute('SELECT count(*) FROM chunks').fetchone()[0],
                    'changed': changed, 'removed': len(removed), 'semantic': semantic, 'issues': issues,
                    'metadata_issues': metadata_issues}

    @staticmethod
    def _write_metadata(con, path, meta):
        # A failed schema validation never publishes a trusted version or revision.
        con.execute("UPDATE docs SET metadata=?, frontmatter_schema_version=?, document_revision=?, "
                    "metadata_status=?, metadata_profile=?, metadata_diagnostics=? WHERE path=?",
                    (json.dumps(meta.metadata, ensure_ascii=False, allow_nan=False),
                     meta.metadata.get('frontmatter_schema_version') if meta.status in {'valid', 'legacy'} else None,
                     meta.metadata.get('document_revision') if meta.status in {'valid', 'legacy'} else None,
                     meta.status, meta.profile, json.dumps(meta.diagnostics), path))

    def search(self, query, mode: Mode = 'hybrid', limit=10, path_prefix='library/'):
        if not query.strip() or len(query) > 1000:
            raise ValueError('Query must contain 1–1000 characters')
        if mode not in {'hybrid', 'keyword', 'fuzzy', 'semantic'} or not 1 <= limit <= 50:
            raise ValueError('Invalid search mode or limit (1–50)')
        if not path_prefix.startswith('library/') or '..' in Path(path_prefix).parts:
            raise ValueError('path_prefix must start with library/')
        with self.connect() as con:
            settings = dict(con.execute('SELECT key,value FROM settings'))
            docs = {r['path']: dict(r) for r in con.execute('SELECT * FROM docs')
                    if r['path'].startswith(path_prefix)}
            rows = {r['id']: dict(r) for r in con.execute('SELECT * FROM chunks') if r['path'] in docs}
            rankings, warnings, scores = {}, [], {}
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
                    ranked = con.execute('SELECT rowid, bm25(terms, 4.0, 1.0) AS rank FROM terms WHERE terms MATCH ? ORDER BY rank', (expression,))
                    rankings['keyword'] = [r[0] for r in ranked if r[0] in rows]
            if mode in {'fuzzy', 'hybrid'}:
                choices = {i: (r['path'] + '\n' + r['text']).casefold() for i, r in rows.items()}
                matches = process.extract(query.casefold(), choices, scorer=fuzz.partial_ratio,
                                          limit=None, score_cutoff=70)
                rankings['fuzzy'] = document_candidates(i for _, _, i in matches)
                scores['fuzzy'] = {i: round(score / 100, 4) for _, score, i in matches}
            if mode in {'semantic', 'hybrid'}:
                embedded = [(i, r['vector']) for i, r in rows.items() if r['vector'] is not None]
                if len(embedded) != len(rows):
                    warnings.append('Some passages lack embeddings; run reader index for complete semantic coverage.')
                if embedded:
                    model = self.model()
                    if settings.get('embedding_signature') != self.model_signature():
                        raise ValueError('Embedding model files changed; run reader index to refresh vectors')
                    vector = np.asarray(next(iter(model.query_embed(query))), dtype=np.float32)
                    matrix = np.stack([np.frombuffer(blob, dtype=np.float32) for _, blob in embedded])
                    similarity = matrix @ vector / np.maximum(np.linalg.norm(matrix, axis=1) * np.linalg.norm(vector), 1e-12)
                    order = np.argsort(-similarity)
                    rankings['semantic'] = document_candidates(embedded[i][0] for i in order)
                    scores['semantic'] = {embedded[i][0]: round(float(similarity[i]), 4) for i in order}
                elif mode == 'semantic' and rows:
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
                results.append({'path': path, 'absolute_path': str(self.root / path),
                    'sha256': doc['sha256'], 'metadata': json.loads(doc['metadata']),
                    'metadata_status': doc['metadata_status'], 'metadata_profile': doc['metadata_profile'],
                    'metadata_diagnostics': json.loads(doc['metadata_diagnostics'] or '[]'),
                    'score': round(fused[path], 6), 'matched_by': signals[path],
                    'similarity': {k: v[row['id']] for k, v in scores.items() if row['id'] in v},
                    'page': row['page'], 'start_line': row['start_line'], 'end_line': row['end_line'],
                    'excerpt': row['text'], 'content_status': doc['status']})
                if len(results) == limit:
                    break
            return {'query': query, 'mode': mode, 'indexed_at': settings['indexed_at'],
                    'model': MODEL if 'semantic' in rankings else None, 'results': results,
                    'warnings': warnings, 'scope': 'Indexed library files; run reader index after additions, edits, or filing.'}

    def read(self, path, start_line=1, limit=100, page=None, expected_sha256=None):
        if not 1 <= limit <= 500 or start_line < 1 or (page is not None and page < 1):
            raise ValueError('Invalid reading range; limit is 1–500')
        data = source_bytes(self.root, path)
        digest = hashlib.sha256(data).hexdigest()
        if expected_sha256 and digest != expected_sha256:
            raise ValueError('Source changed since search; search again after indexing')
        sections, metadata = extract(path, data)
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
