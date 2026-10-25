"""Read-only search over a format 1 index (`.reader/search.sqlite3`).

Format 1 is kept for older Reader processes. New code never writes it; it serves
search from it only until a format 2 build completes. This is the format 1 query
path at aafca6a, unchanged except that it opens the legacy file read-only."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3

import numpy as np
from rapidfuzz import fuzz, process

LEGACY_VERSION = '1'
WARNING = 'Serving the format 1 search index read-only; rebuild the search index to upgrade.'


@contextmanager
def connect(path):
    if not path.is_file():
        raise ValueError('Search index missing; run reader index')
    con = sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True, timeout=60)
    con.row_factory = sqlite3.Row
    try:
        con.execute('BEGIN')
        version = con.execute("SELECT value FROM settings WHERE key='version'").fetchone()
        if not version:
            raise ValueError('Search index incomplete; run reader index')
        if version[0] != LEGACY_VERSION:
            raise ValueError('Index version unsupported; rebuild the search index')
        metadata_version = con.execute("SELECT value FROM settings WHERE key='metadata_index_version'").fetchone()
        columns = {row[1] for row in con.execute('PRAGMA table_info(docs)')}
        if not metadata_version or not {'metadata_status', 'metadata_profile', 'metadata_diagnostics'} <= columns:
            raise ValueError('Metadata index incomplete; run reader index')
        yield con
    except sqlite3.DatabaseError as exc:
        raise ValueError(f'Search database error: {exc}; rebuild the search index') from exc
    finally:
        con.close()


def search(engine, query, mode='hybrid', limit=10, path_prefix='library/'):
    from .search import MODEL, source_bytes, tokens
    if not query.strip() or len(query) > 1000:
        raise ValueError('Query must contain 1–1000 characters')
    if mode not in {'hybrid', 'keyword', 'fuzzy', 'semantic'} or not 1 <= limit <= 50:
        raise ValueError('Invalid search mode or limit (1–50)')
    if not path_prefix.startswith('library/') or '..' in Path(path_prefix).parts:
        raise ValueError('path_prefix must start with library/')
    self = engine
    with connect(engine.legacy) as con:
        settings = dict(con.execute('SELECT key,value FROM settings'))
        docs = {r['path']: dict(r) for r in con.execute('SELECT * FROM docs')
                if r['path'].startswith(path_prefix)}
        rows = {r['id']: dict(r) for r in con.execute('SELECT * FROM chunks') if r['path'] in docs}
        rankings, warnings, scores = {}, [WARNING], {}
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
        return {'query': query, 'mode': mode, 'format': 1, 'complete': True, 'indexed_at': settings['indexed_at'],
                'model': MODEL if 'semantic' in rankings else None, 'results': results,
                'warnings': warnings, 'scope': 'Indexed library files; run reader index after additions, edits, or filing.'}



def passages(engine, query, mode, limit, path_prefix, allow, words):
    """Search-page candidates from a format 1 index, in the same shape as `Search.passages`.

    Format 1 has no passage table, file-name index or machine-file status: each chunk is its
    own passage, ranked by reciprocal-rank fusion of FTS5 bm25 and cosine over its float32
    vector. Used only while no format 2 build has completed."""
    from .search import MEANING_BAND, MEANING_FLOOR, MEANING_TOP, PAGE_CHANNEL, fold, tokens
    with connect(engine.legacy) as con:
        settings = dict(con.execute('SELECT key,value FROM settings'))
        docs = {r['path']: {'status': r['status'], 'sha256': r['sha256'], 'metadata': r['metadata']}
                for r in con.execute('SELECT path, status, sha256, metadata FROM docs WHERE substr(path, 1, ?)=?',
                                     (len(path_prefix), path_prefix))}
        rows = {r['id']: (r['path'], r['page'], r['start_line'], r['end_line'], r['text'])
                for r in con.execute('SELECT id, path, page, start_line, end_line, text FROM chunks ORDER BY id') if r['path'] in docs}
        warnings, rankings, semantic = [WARNING], {}, None
        if mode in {'hybrid', 'semantic'}:
            try:
                embedded = [(r[0], r[1]) for r in con.execute('SELECT id, vector FROM chunks WHERE vector IS NOT NULL') if r[0] in rows]
                if not embedded:
                    raise ValueError('no passage has an embedding yet; run reader index')
                if len(embedded) < len(rows):
                    warnings.append('Some passages lack embeddings; run reader index for complete meaning search.')
                model = engine.model()
                if settings.get('embedding_signature') != engine.model_signature():
                    raise ValueError('embedding model files changed; run reader index to refresh vectors')
                vector = np.asarray(next(iter(model.query_embed(query))), dtype=np.float32)
                vector /= max(float(np.linalg.norm(vector)), 1e-12)
                matrix = np.stack([np.frombuffer(blob, dtype=np.float32) for _, blob in embedded])
                matrix = matrix / np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
                similarity = matrix @ vector
                order = np.argsort(-similarity, kind='stable')[:MEANING_TOP[mode]]
                cut = max(MEANING_FLOOR, float(similarity[order[0]]) - MEANING_BAND) if len(order) else 1.0
                rankings['semantic'] = [embedded[k][0] for k in order if similarity[k] >= cut]
                semantic = 'used'
            except ValueError as exc:
                semantic = 'unavailable'
                warnings.append('Meaning search is unavailable (' + str(exc).rstrip('.') + '); showing exact-word matches.')
        if (mode in {'hybrid', 'keyword'} or semantic == 'unavailable') and words:
            expression = ' OR '.join('"' + w + '"' for w in words)
            rankings['words'] = [r[0] for r in con.execute(
                'SELECT rowid FROM terms WHERE terms MATCH ? ORDER BY bm25(terms, 4.0, 1.0) LIMIT ?',
                (expression, PAGE_CHANNEL)) if r[0] in rows]
    fused, signals = {}, {}
    for channel, ids in rankings.items():
        for rank, chunk in enumerate(ids, 1):
            fused[chunk] = fused.get(chunk, 0) + 1 / (60 + rank)
            signals.setdefault(chunk, []).append(channel)
    order = sorted(fused, key=lambda k: (-fused[k], k))
    word_set = {fold(w) for w in words}
    pools, truncated = [], []
    for predicate in allow:
        passes, pool = {}, []
        for chunk in order:
            path = rows[chunk][0]
            if path not in passes:
                passes[path] = predicate is None or bool(predicate(path, docs[path]))
            if not passes[path]:
                continue
            path, page, start, end, text = rows[chunk]
            pool.append({'path': path, 'page': page, 'start_line': start, 'end_line': end, 'text': text,
                         'score': round(fused[chunk], 6), 'matched_by': signals[chunk],
                         'literal': bool(word_set & {fold(t) for t in tokens(text)})})
            if len(pool) == limit:
                break
        pools.append(pool)
        truncated.append(len(pool) == limit)
    return {'query': query, 'mode': mode, 'words': words, 'pools': pools, 'truncated': truncated, 'docs': docs,
            'semantic': semantic, 'warnings': warnings, 'format': 1,
            'indexed_at': settings.get('indexed_at'), 'complete': True}
