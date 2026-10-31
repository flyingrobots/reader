"""Suggest what to read next from the existing search index and work inventory.

Relatedness is computed when asked, from data Reader already keeps: each work's
primary source has passage embeddings in the rebuildable search index, and the
work inventory carries projects and topics. Nothing new is written. Works whose
source has no embeddings yet still match on shared projects and topics."""
from contextlib import closing
import re
import sqlite3
import threading
from pathlib import Path

import numpy as np

from .search import unpack

POOL = 12             # most related works considered before read status and date
SAME_EDITION = 0.985  # near-identical text: another edition or copy, not a new idea
DIVERSE = 0.97        # two picks this similar would repeat one another
SHARED_BONUS = 0.03   # per shared project or topic
VAGUE = ('Unspecified', 'Unclassified')


def labels(work):
    return {x for x in [*(work.get('projects') or []), *(work.get('topics') or [])]
            if isinstance(x, str) and not x.startswith(VAGUE)}


def base_title(title):
    return re.sub(r'\s*\([^)]*\)?\s*$', '', (title or '').casefold()).strip()


class Related:
    def __init__(self, root):
        self.state = Path(root) / '.reader'
        self.lock = threading.Lock()
        self.cache = (None, {})

    def vectors(self, paths):
        """Unit mean passage vector per path, cached per published index build.

        Reads the format 2 index; there are none without one (format 1 is retired)."""
        version = 2
        db = self.state / 'search.v2.sqlite3'
        if not db.is_file():
            return {}
        with closing(sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True, timeout=5)) as con:
            try:
                found = dict(con.execute("SELECT key, value FROM settings WHERE key IN ('version', 'indexed_at', 'updated_at')"))
            except sqlite3.Error:
                return {}
            if found.get('version') != str(version):
                return {}
            # Rebuilds publish per batch, so the last publication time keys the cache.
            key = (version, found.get('updated_at') or found.get('indexed_at'), frozenset(paths))
            with self.lock:
                if self.cache[0] == key:
                    return self.cache[1]
            sums, counts = {}, {}
            paths = sorted(paths)
            query = ('SELECT c.path, p.vector FROM chunks c JOIN passages p ON p.id = c.passage_id '
                     'WHERE p.vector IS NOT NULL AND c.path IN ({})')
            for offset in range(0, len(paths), 900):
                batch = paths[offset:offset + 900]
                for path, blob in con.execute(query.format(','.join('?' * len(batch))), batch):
                    vector = unpack(blob)
                    sums[path] = sums[path] + vector if path in sums else vector
                    counts[path] = counts.get(path, 0) + 1
        result = {}
        for path, total in sums.items():
            norm = float(np.linalg.norm(total))
            if norm > 0:
                result[path] = total / norm
        with self.lock:
            self.cache = (key, result)
        return result

    def nearest(self, path, works, limit=12):
        """The `limit` most related works with passage embeddings, as (score, work, unit mean vector).

        Scored as Read next scores them (similarity plus shared projects and topics), without
        read status, recency or diversity; other editions and copies of the same text are left out."""
        current = next((w for w in works if path in (w.get('primary'), w.get('path'))), None)
        vectors = self.vectors({w['primary'] for w in works} | {path})
        mine = vectors.get(path)
        if mine is None:
            return []
        own_labels = labels(current) if current else set()
        own_title = base_title(current.get('title')) if current else None
        scored = []
        for work in works:
            other = vectors.get(work['primary'])
            if work is current or work['primary'] == path or other is None or (own_title and base_title(work.get('title')) == own_title):
                continue
            similarity = float(mine @ other)
            if similarity >= SAME_EDITION:
                continue
            scored.append((similarity + SHARED_BONUS * len(own_labels & labels(work)), work['primary'], work, other))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [(score, work, vector) for score, _, work, vector in scored[:limit]]

    def suggest(self, path, works, read, limit=3):
        """Up to `limit` works: the most related, unread first, then latest; diverse.

        `read(work)` reports whether the participant has read the work's current
        edition. Each suggestion carries the reasons it was chosen."""
        current = next((w for w in works if path in (w.get('primary'), w.get('path'))), None)
        vectors = self.vectors({w['primary'] for w in works} | {path})
        mine = vectors.get(path)
        own_labels = labels(current) if current else set()
        own_title = base_title(current.get('title')) if current else None
        scored, excluded = [], {path}
        for work in works:
            if work is current or work['primary'] == path or (own_title and base_title(work.get('title')) == own_title):
                excluded.add(work['primary'])
                continue
            shared = sorted(own_labels & labels(work), key=str.casefold)
            other = vectors.get(work['primary'])
            similarity = float(mine @ other) if mine is not None and other is not None else None
            if similarity is not None and similarity >= SAME_EDITION:
                excluded.add(work['primary'])
                continue
            if similarity is None and not shared:
                continue
            score = (similarity if similarity is not None else 0.0) + SHARED_BONUS * len(shared)
            scored.append((score, similarity, shared, work))
        scored.sort(key=lambda item: -item[0])
        pool = [dict(work=work, similarity=similarity, shared=shared, read=read(work), score=score)
                for score, similarity, shared, work in scored[:POOL]]
        pool.sort(key=lambda item: item['work'].get('date') or '', reverse=True)
        pool.sort(key=lambda item: item['read'])
        picks = []

        def repeats_pick(work):
            # Revisions remain separate holdings, but occupy one recommendation slot.
            title = base_title(work.get('title'))
            authors = {a.strip().casefold() for a in work.get('authors') or []}
            vector = vectors.get(work['primary'])
            for pick in picks:
                chosen = pick['work']
                if work['primary'] == chosen['primary']:
                    return True
                if title and title == base_title(chosen.get('title')) and authors == {
                        a.strip().casefold() for a in chosen.get('authors') or []}:
                    return True
                other = vectors.get(chosen['primary'])
                if vector is not None and other is not None and float(vector @ other) >= DIVERSE:
                    return True
            return False

        for item in pool:
            if len(picks) == limit:
                break
            if repeats_pick(item['work']):
                continue
            reasons = (['Similar ideas'] if item['similarity'] is not None else []) + item['shared'][:2]
            picks.append(item | {'reasons': reasons})
        if len(picks) < limit:
            chosen = {p['work']['primary'] for p in picks} | excluded
            newest = sorted((w for w in works if w['primary'] not in chosen), key=lambda w: w.get('date') or '', reverse=True)
            for work in newest:
                if len(picks) == limit:
                    break
                if not read(work) and not repeats_pick(work):
                    picks.append(dict(work=work, similarity=None, shared=[], read=False, score=None, reasons=['New in the library']))
        return {'items': [dict({k: p['work'].get(k) for k in ('title', 'primary', 'authors', 'projects', 'date')},
                               read=p['read'], reasons=p['reasons'],
                               score=None if p['score'] is None else round(p['score'], 4)) for p in picks],
                'embedded': mine is not None,
                'scope': 'Related by search-index embeddings and shared projects/topics; unread first, then latest.'}
