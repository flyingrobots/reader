"""Article shapes (experiment): the path an article's argument takes through meaning-space.

Read-only and computed from data Reader already keeps. A text source's search-index
passages, in reading order, are projected to three dimensions by PCA (sign-fixed, so the
same text always yields the same shape); key terms are scored by TF-IDF against the
library's full-text index; the nearest works by `related.py` are projected through the
same basis. Without passage vectors the response is the simpler term-only form: the
passages along a helix seeded by the source digest, marked `form: "terms"`.

No model calls, no network, nothing written. Responses are bounded (at most MAX_POINTS
passages, MAX_TERMS terms, MAX_NEIGHBOURS neighbours, under MAX_RESPONSE bytes) and
cached in memory by source digest, index publication and annotation folder state."""
from contextlib import closing
import json
import math
import re
import sqlite3
import threading

import numpy as np

from .search import STOPWORDS, active, chunks, fold, readable, tokens, unpack

MAX_POINTS = 400          # passages drawn; longer documents are evenly subsampled in order
MAX_TERMS, MIN_TERMS = 7, 4
MAX_NEIGHBOURS = 12
MAX_RINGS = 40            # heading rings drawn at most
MIN_DIRECTION = 0.05      # neighbours projected closer than this to the centre have no meaningful direction
SMOOTHING = 80            # long ribbons average over ±(passages ÷ 80) neighbours (none below 40)
MIN_CHUNKS = 6            # shorter pieces make a dot, not a shape (the browser does not draw them)
MAX_SOURCE = 4 * 1024**2
MAX_RESPONSE = 64 * 1024
EXCERPT = 90              # characters of a passage's first line, for hover and the text list
CACHE = 256
TEXT_KINDS = ('.md', '.markdown', '.txt')
VECTOR_SHARE = 0.9        # the full form needs vectors for at least this share of the passages
TERMS_NOTE = 'Rebuild the search index for the full shape'
# Words that carry no subject on their own, beyond the search stop words; numbers are dropped separately.
EXTRA_STOPWORDS = frozenset('''
about above after again against all also always among another any anything around because been before being below
between both can cannot could did does doing done down during each either else enough even ever every few first
further get gets getting given goes going got had having here how however just keep kept know known last less let like
made make makes making many may maybe might more most much must need needs never new next nor not nothing now off
often once one only other others otherwise ought out over own per perhaps quite rather really said same say says see
seem seems several shall should since some something still such take than thing things think those though through
thus too two under until upon use used uses using very via want way ways well went whether while whose why within
without would yet yes you're it's don't does not www http https com org html md png jpg svg pdf etc
'''.split())
OVERLAP = 150           # characters each search passage repeats from the one before (search.chunks)
SENTENCE = re.compile(r'(?<=[.!?:])\s+(?=\S)|\n\s*')
HEADING = re.compile(r'^\s{0,3}(#{1,6})\s+\S')
FENCE = re.compile(r'^\s{0,3}(`{3,}|~{3,})')
WORD = re.compile(r'\w+', re.UNICODE)


def sample(count, limit=MAX_POINTS):
    """Evenly spaced indices, in order, keeping the first and last."""
    if count <= limit:
        return list(range(count))
    return sorted({int(round(i * (count - 1) / (limit - 1))) for i in range(limit)})


def project(vectors):
    """Centre, take three principal components by SVD and fix their signs.

    Returns (points on the unit sphere, basis, mean, scale, variance explained). Each
    component's sign makes the first passage with a nonzero coordinate positive."""
    matrix = np.asarray(vectors, dtype=np.float64)
    mean = matrix.mean(axis=0)
    centred = matrix - mean
    _, singular, vt = np.linalg.svd(centred, full_matrices=False)
    basis = np.zeros((3, matrix.shape[1]))
    rank = min(3, vt.shape[0])
    basis[:rank] = vt[:rank]
    coords = centred @ basis.T
    for k in range(3):
        nonzero = np.nonzero(np.abs(coords[:, k]) > 1e-9)[0]
        if len(nonzero) and coords[nonzero[0], k] < 0:
            coords[:, k] *= -1
            basis[k] *= -1
    norms = np.linalg.norm(coords, axis=1)
    scale = float(norms.max()) if len(norms) and norms.max() > 1e-12 else 1.0
    total = float((singular ** 2).sum())
    variance = [(float(singular[k] ** 2) / total if total > 0 and k < len(singular) else 0.0) for k in range(3)]
    return coords / scale, basis, mean, scale, variance


def smooth(points, window):
    """A centred moving average over reading order (shrinking at the ends), rescaled to the unit sphere,
    with the factor applied.

    Long articles drift between neighbouring passages; averaging over `window` passages on either
    side draws the path the argument takes rather than every step of it."""
    if window < 1 or len(points) < 3:
        return points, 1.0
    sums = np.vstack([np.zeros((1, points.shape[1])), np.cumsum(points, axis=0)])
    index = np.arange(len(points))
    low, high = np.maximum(0, index - window), np.minimum(len(points), index + window + 1)
    averaged = (sums[high] - sums[low]) / (high - low)[:, None]
    norm = float(np.linalg.norm(averaged, axis=1).max())
    return (averaged / norm, 1 / norm) if norm > 1e-12 else (averaged, 1.0)


def helix(count, seed):
    """The term-only form: passages along a helix whose turns and radius come from the seed."""
    rng = np.random.default_rng(seed)
    turns, radius, height = rng.uniform(1.5, 3.5), rng.uniform(.55, .85), rng.uniform(1.1, 1.5)
    t = np.linspace(0, 1, count) if count > 1 else np.zeros(1)
    angle = 2 * math.pi * turns * t + rng.uniform(0, 2 * math.pi)
    coords = np.stack([radius * np.cos(angle), (t - .5) * height, radius * np.sin(angle)], axis=1)
    norms = np.linalg.norm(coords, axis=1)
    return coords / max(float(norms.max()), 1e-12)


def first_line(text, limit=EXCERPT):
    line = next((part.strip() for part in text.splitlines() if part.strip()), '')
    if len(line) <= limit:
        return line
    cut = line[:limit].rsplit(' ', 1)[0] or line[:limit]
    return cut.rstrip(',;:—–-') + '…'


def fresh(text, first):
    """A passage's text from where it stops repeating its predecessor: the indexer's windows overlap by
    OVERLAP characters, so a later passage starts mid-sentence. Starts at the next sentence (or word)."""
    if first or len(text) <= 2 * OVERLAP:
        return text
    rest = text[OVERLAP:]
    found = SENTENCE.search(rest[:160]) or re.search(r'\s+', rest)
    return rest[found.end():] if found else rest


def headings(text):
    """Source line numbers of headings below the title (level 2 and deeper), outside code fences; at most MAX_RINGS."""
    found, fence = [], None
    for number, line in enumerate(text.splitlines(), 1):
        marker = FENCE.match(line)
        if fence:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence):
                fence = None
            continue
        if marker:
            fence = marker.group(1)
            continue
        match = HEADING.match(line)
        if match and len(match.group(1)) > 1:
            found.append((number, len(match.group(1))))
    # Many headings would ring every bead: keep the shallowest levels that fit, else an even sample.
    for level in range(6, 1, -1):
        if len(found) <= MAX_RINGS:
            break
        found = [item for item in found if item[1] < level] or found
    return [number for number, _ in (found if len(found) <= MAX_RINGS else [found[i] for i in sample(len(found), MAX_RINGS)])]


def chunk_at(starts, line):
    """Index of the last passage starting at or before `line` (passages are in reading order)."""
    index = int(np.searchsorted(np.asarray(starts), line, side='right')) - 1
    return max(0, index)


def word_ok(word):
    return len(word) >= 3 and not any(c.isdigit() for c in word) and word not in STOPWORDS and word not in EXTRA_STOPWORDS


def key_terms(texts, frequency, documents):
    """Top terms by TF-IDF against the library, each with the passage where it peaks."""
    per_chunk = []
    for text in texts:
        words = [w for w in tokens(text) if word_ok(w)]
        counts = {}
        for word in words:
            counts[word] = counts.get(word, 0) + 1
        per_chunk.append((counts, max(1, len(words))))
    vocabulary = sorted({w for counts, _ in per_chunk for w in counts})
    df = frequency(vocabulary)
    if documents <= 0:  # No library index: passages of this document stand in for the library.
        documents = len(texts)
        df = {w: sum(1 for counts, _ in per_chunk if w in counts) for w in vocabulary}
    totals, scores = {}, {}
    for index, (counts, length) in enumerate(per_chunk):
        for word, count in counts.items():
            idf = math.log((documents + 1) / (df.get(word, 0) + 1))  # a word in every passage scores nothing
            score = count / length * idf
            totals[word] = totals.get(word, 0.0) + score
            scores.setdefault(word, []).append((score, index))
    ranked = sorted((w for w in totals if totals[w] > 0), key=lambda w: (-totals[w], w))
    chosen, stems = [], set()
    for word in ranked:
        stem = word[:-1] if word.endswith('s') and len(word) > 4 else word
        if stem in stems:
            continue
        if len(chosen) >= MIN_TERMS and totals[word] < .4 * totals[ranked[0]]:
            break
        chosen.append(word)
        stems.add(stem)
        if len(chosen) == MAX_TERMS:
            break
    # Each term sits where it peaks; when that passage (or its neighbour) already holds a label, at its
    # strongest free passage, so labels do not pile up on one bead.
    placed, used = [], []
    spacing = 1 if len(texts) >= 3 * len(chosen) else 0
    for word in chosen:
        ranked_chunks = sorted(scores[word], key=lambda item: (-item[0], item[1]))
        free = next((i for _, i in ranked_chunks if all(abs(i - u) > spacing for u in used)), ranked_chunks[0][1])
        placed.append((word, free))
        used.append(free)
    return placed


def surface(word, text):
    """The form a casefolded term takes in the source: capitalised only when it is capitalised mid-sentence
    in most of its uses (a name), not merely at the start of sentences and list items."""
    total = named = 0
    form = word
    for match in WORD.finditer(text):
        if match.group().casefold() != word:
            continue
        total += 1
        before = text[max(0, match.start() - 3):match.start()].rstrip(' *_`[(')
        if match.group()[:1].isupper() and before and before[-1] not in '.!?:#>-\n':
            named += 1
            form = match.group()
    return form if total and named * 2 > total else word


class Shapes:
    def __init__(self, library):
        self.library = library
        self.state = library.root / '.reader'
        self.lock = threading.Lock()
        self.cache = {}
        self.frequencies = (None, {}, 0)

    # Index access -------------------------------------------------------------------------
    def connect(self):
        """The published search index, read-only, with its version and publication key; None without one."""
        version = active(self.state)
        db = self.state / ('search.v2.sqlite3' if version == 2 else 'search.sqlite3')
        if not db.is_file() or db.is_symlink():
            return None
        con = sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True, timeout=5)
        try:
            found = dict(con.execute("SELECT key, value FROM settings WHERE key IN ('version', 'indexed_at', 'updated_at')"))
        except sqlite3.Error:
            con.close()
            return None
        if found.get('version') != str(version):
            con.close()
            return None
        return con, version, (str(db), found.get('updated_at') or found.get('indexed_at'))

    @staticmethod
    def passages(con, version, path):
        """(start_line, end_line, text, vector or None) for a path's passages, in reading order."""
        if version == 2:
            rows = con.execute('SELECT c.start_line, c.end_line, p.text, p.vector FROM chunks c JOIN passages p ON p.id = c.passage_id '
                               'WHERE c.path = ? ORDER BY coalesce(c.page, 0), c.start_line, c.id', (path,)).fetchall()
            decode = unpack
        else:
            rows = con.execute('SELECT start_line, end_line, text, vector FROM chunks WHERE path = ? '
                               'ORDER BY coalesce(page, 0), start_line, id', (path,)).fetchall()
            decode = lambda blob: np.frombuffer(blob, dtype=np.float32).copy()  # noqa: E731
        return [(start or 1, end or start or 1, text or '', decode(blob) if blob else None) for start, end, text, blob in rows]

    @staticmethod
    def indexed_digest(con, path):
        row = con.execute('SELECT sha256 FROM docs WHERE path = ?', (path,)).fetchone()
        return row[0] if row else None

    def frequency(self, con, build):
        """A lookup of library document frequency for folded terms, cached per index publication."""
        with self.lock:
            if self.frequencies[0] != build:
                self.frequencies = (build, {}, 0)
            known, documents = self.frequencies[1], self.frequencies[2]
        try:
            con.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.shape_vocabulary USING fts5vocab(main, 'terms', 'col')")
            if not documents:
                documents = con.execute('SELECT count(*) FROM terms').fetchone()[0]
        except sqlite3.Error:
            return (lambda words: {}), 0

        def lookup(words):
            folded = {w: fold(w) for w in words}
            missing = sorted({f for f in folded.values() if f not in known})
            found = {}
            for offset in range(0, len(missing), 500):
                batch = missing[offset:offset + 500]
                found.update(con.execute(f"SELECT term, doc FROM temp.shape_vocabulary WHERE col = 'text' AND term IN ({','.join('?' * len(batch))})", batch))
            with self.lock:
                if self.frequencies[0] == build:
                    if len(self.frequencies[1]) > 200_000:
                        self.frequencies[1].clear()
                    self.frequencies[1].update({term: found.get(term, 0) for term in missing})
                    self.frequencies = (build, self.frequencies[1], documents)
                table = self.frequencies[1]
            return {w: table.get(f, found.get(f, 0)) for w, f in folded.items()}
        return lookup, documents

    # The shape ------------------------------------------------------------------------------
    def shape(self, path):
        file = self.library.path(path)
        if file.suffix.lower() not in TEXT_KINDS:
            raise ValueError('Shapes are drawn for Markdown and plain-text articles')
        if file.stat().st_size > MAX_SOURCE:
            raise ValueError('Shapes are drawn for text sources of at most 4 MiB')
        digest = self.library.digest(path)
        folder = self.library.root / 'annotations'
        try:
            annotated = folder.stat().st_mtime_ns if folder.is_dir() and not folder.is_symlink() else None
        except OSError:
            annotated = None
        opened = self.connect()
        con, version, build = opened if opened else (None, None, None)
        try:
            key = (path, digest, build, annotated)
            with self.lock:
                cached = self.cache.get(key)
            if cached is not None:
                return cached
            result = self.compute(path, file, digest, con, version, build)
        finally:
            if con is not None:
                con.close()
        with self.lock:
            if len(self.cache) >= CACHE:
                self.cache.clear()
            self.cache[key] = result
        return result

    def compute(self, path, file, digest, con, version, build):
        data = file.read_bytes()
        text = data.decode('utf-8', errors='replace')
        rows = self.passages(con, version, path) if con is not None else []
        current = bool(rows) and self.indexed_digest(con, path) == digest
        if not rows:  # Not in the index yet: the same passage windows the indexer uses, without vectors.
            rows = [(start, end, excerpt, None) for _, start, end, excerpt in chunks([(None, text.lstrip('﻿'))])]
        total = len(rows)
        picked = [rows[i] for i in sample(total)]
        seed = int(digest[:8], 16)
        with_vectors = [row for row in picked if row[3] is not None]
        dimension = {len(row[3]) for row in with_vectors}
        full = len(with_vectors) >= max(2, VECTOR_SHARE * len(picked)) and len(dimension) == 1
        if full:
            picked = with_vectors
            points, basis, mean, scale, variance = project([row[3] for row in picked])
            points, factor = smooth(points, round(len(picked) / SMOOTHING))
            scale /= factor  # neighbours stay in the same coordinates as the drawn ribbon
        else:
            points, variance = helix(len(picked), seed), None
        clean = [readable(row[2], row[0])[0] for row in picked]
        lines = [readable(fresh(row[2], row is rows[0]), row[0] if row is rows[0] else 2)[0] for row in picked]
        starts = [row[0] for row in picked]
        lookup, documents = self.frequency(con, build) if con is not None else ((lambda words: {}), 0)
        terms = [{'text': surface(word, text), 'i': index} for word, index in key_terms(clean, lookup, documents)]
        rings = sorted({chunk_at(starts, line) for line in headings(text)}) if file.suffix.lower() != '.txt' else []
        threads = self.threads(path, file, text, starts)
        lengths = np.asarray([len(c) for c in clean], dtype=np.float64)
        longest = float(lengths.max()) if len(lengths) and lengths.max() > 0 else 1.0
        weights = [round(float(.6 * length / longest + .4 * min(1.0, count / 3)), 3) for length, count in zip(lengths, threads)]
        neighbours = self.neighbours(path, basis, mean, scale) if full else []
        result = {
            'path': path, 'sha256': digest, 'seed': seed, 'form': 'full' if full else 'terms',
            'points': [[round(float(v), 4) for v in point] for point in points],
            'lines': starts, 'weights': weights, 'threads': threads, 'headings': rings, 'terms': terms,
            'neighbours': neighbours, 'variance': None if variance is None else [round(v, 4) for v in variance],
            'excerpts': [first_line(c) for c in lines], 'count': total, 'sampled': len(picked) < total,
            'current': current, 'min_chunks': MIN_CHUNKS, 'note': None if full else TERMS_NOTE,
            'scope': 'Passages in reading order projected by PCA from search-index embeddings; '
                     'terms by TF-IDF against the library; neighbours by Read next relatedness.' if full else
                     'Passages in reading order along a helix seeded by the source digest; terms by TF-IDF. '
                     + TERMS_NOTE + '.'}
        # Bounded: shorten passage lines, then drop them, before ever exceeding the response limit.
        for limit in (EXCERPT, 48, 0):
            if limit != EXCERPT:
                result['excerpts'] = [first_line(c, limit) for c in lines] if limit else []
            if len(json.dumps(result, ensure_ascii=False).encode()) <= MAX_RESPONSE:
                break
        return result

    def threads(self, path, file, text, starts):
        """Margin threads (placed exact or relocated) per passage, by source line."""
        counts = [0] * len(starts)
        if file.suffix.lower() not in ('.md', '.markdown'):
            return counts
        try:
            listed = self.library.annotations.list(path)
        except (ValueError, OSError, KeyError, TypeError):
            return counts
        for thread in listed.get('threads', []):
            location = thread.get('location') or {}
            if location.get('status') in ('exact', 'relocated') and isinstance(location.get('start'), int):
                line = text.count('\n', 0, location['start']) + 1
                counts[chunk_at(starts, line)] += 1
        return counts

    def neighbours(self, path, basis, mean, scale):
        """The nearest works by Read next relatedness, projected through this article's basis."""
        try:
            works, _ = self.library.works()
        except (ValueError, OSError, KeyError):
            return []
        nearest = self.library.related.nearest(path, works, MAX_NEIGHBOURS)
        found = []
        for score, work, vector in nearest:
            if len(vector) != basis.shape[1]:
                continue
            xyz = (np.asarray(vector, dtype=np.float64) - mean) @ basis.T / scale
            # The browser draws a star at a fixed radius along this direction, never at xyz, so a star cannot
            # meet the ribbon on screen. Distance to passages says nothing (a long ribbon fills the sphere, #81).
            if float(np.linalg.norm(xyz)) < MIN_DIRECTION:
                continue
            found.append({'path': work['primary'], 'title': str(work.get('title') or work['primary'])[:200],
                          'xyz': [round(float(v), 4) for v in xyz], 'score': round(float(score), 4)})
        return found
