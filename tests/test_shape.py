"""Article shapes: projection, terms, neighbours, bounds and refusals (RW-20)."""
from http.client import HTTPConnection
import json
from pathlib import Path
import sys
import threading

import numpy as np
import pytest

from reader_mcp.annotations import Annotations
from reader_mcp.search import Search
from reader_mcp.shape import MAX_POINTS, MAX_RESPONSE, MIN_DIRECTION, Shapes, project, sample, smooth
from reader_mcp.web import WebLibrary, WebServer

sys.path.insert(0, str(Path(__file__).parent))
from shape_fixture import TOPICS, TopicModel, neighbours, section, tight, wandering  # noqa: E402


def vault(root, extra=None, embed=True):
    for name in ('library', 'inbox', 'indexes', 'library/near'):
        (root / name).mkdir(exist_ok=True)
    files = {'library/walk.md': wandering(), 'library/ledger.md': tight(), **neighbours(), **(extra or {})}
    works = []
    for path, text in files.items():
        (root / path).write_text(text)
        works.append(dict(id=path, title=text.split('title: ')[1].split('\n')[0] if 'title: ' in text else text.split('\n')[0][2:],
                          primary=path, authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-20',
                          primary_format='.md', primary_bytes=len(text)))
    (root / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': works}))
    engine = Search(root)
    engine._model = TopicModel()
    engine._signature = 'topic-model'
    engine.index(embed)
    return WebLibrary(root, service_runner=lambda argv: {'installed': False})


@pytest.fixture
def library(tmp_path):
    lib = vault(tmp_path)
    yield lib
    lib.close()


def test_full_shape_is_deterministic_bounded_and_ordered(library):
    first = library.shapes.shape('library/walk.md')
    again = Shapes(library).shape('library/walk.md')  # a fresh cache computes the same bytes
    assert json.dumps(first, sort_keys=True) == json.dumps(again, sort_keys=True)
    assert first['form'] == 'full' and first['count'] >= 6 and len(first['points']) == first['count']
    assert first['seed'] == int(first['sha256'][:8], 16)
    assert first['lines'] == sorted(first['lines']), 'passages stay in reading order'
    norms = [np.linalg.norm(p) for p in first['points']]
    assert max(norms) == pytest.approx(1, abs=1e-3), 'normalised to the unit sphere'
    assert all(all(abs(v) <= 1 for v in p) for p in first['points'])
    assert len(first['variance']) == 3 and first['variance'][0] >= first['variance'][1] >= first['variance'][2] > 0
    assert 4 <= len(first['terms']) <= 7 and all(0 <= t['i'] < len(first['points']) for t in first['terms'])
    words = {t['text'].casefold() for t in first['terms']}
    assert words <= {w for group in TOPICS for w in group}, 'filler shared by every passage scores low against the library'
    assert len(first['headings']) == 7 and first['headings'] == sorted(set(first['headings']))
    assert len(first['excerpts']) == len(first['points']) and all(len(e) <= 91 for e in first['excerpts'])
    assert first['current'] is True and first['note'] is None
    assert len(json.dumps(first, ensure_ascii=False).encode()) < MAX_RESPONSE


def test_two_articles_make_different_shapes(library):
    walk, ledger = library.shapes.shape('library/walk.md'), library.shapes.shape('library/ledger.md')
    assert walk['seed'] != ledger['seed'] and walk['points'] != ledger['points']
    # The wandering essay spreads over more dimensions than the note that circles one idea.
    assert walk['variance'][1] > ledger['variance'][1]


def test_projection_signs_are_fixed_and_equal_vectors_reorder_stably():
    rng = np.random.default_rng(4)
    vectors = rng.normal(size=(12, 16))
    points, basis, mean, scale, variance = project(vectors)
    for k in range(3):
        first = next(p[k] for p in points if abs(p[k]) > 1e-9)
        assert first > 0, 'each component is positive at the first passage'
    flipped, *_ = project(-vectors)  # the same passages pointing the other way give the same render
    assert np.allclose(np.abs(flipped), np.abs(points))
    for k in range(3):
        assert next(p[k] for p in flipped if abs(p[k]) > 1e-9) > 0
    # Swapping two passages with equal vectors changes nothing.
    vectors[5] = vectors[2]
    swapped = vectors.copy()
    swapped[[2, 5]] = swapped[[5, 2]]
    assert np.array_equal(project(vectors)[0], project(swapped)[0])


def test_long_documents_are_subsampled_in_order(tmp_path):
    long = '# Very long\n\n' + '\n\n'.join(f'## Part {i}\n\n' + section(i % len(TOPICS), 1150) for i in range(520))
    lib = vault(tmp_path, {'library/long.md': long})
    try:
        result = lib.shapes.shape('library/long.md')
        assert result['count'] > MAX_POINTS and result['sampled'] is True
        assert len(result['points']) == MAX_POINTS and result['lines'] == sorted(result['lines'])
        assert result['lines'][0] == 1 or result['lines'][0] < result['lines'][1]
        assert len(json.dumps(result, ensure_ascii=False).encode()) < MAX_RESPONSE, 'under 64 KiB even at the cap'
        points = np.asarray(result['points'])
        assert max(np.linalg.norm(points, axis=1)) == pytest.approx(1, abs=1e-3), 'smoothed and rescaled'
        assert 0 < len(result['headings']) <= 40, 'at most 40 heading rings'
    finally:
        lib.close()
    # Long ribbons are smoothed over reading order: a zig-zag becomes a much shorter path.
    zigzag = np.array([[i / 100, (-1) ** i * .5, 0] for i in range(100)])
    smoothed, factor = smooth(zigzag, 2)
    length = lambda p: float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum())  # noqa: E731
    assert length(smoothed) < length(zigzag / np.linalg.norm(zigzag, axis=1).max()) / 3 and factor > 0
    assert smooth(zigzag, 0)[0] is zigzag
    picks = sample(1000)
    assert len(picks) == MAX_POINTS and picks[0] == 0 and picks[-1] == 999 and picks == sorted(picks)
    assert sample(10) == list(range(10))


def test_term_only_form_without_vectors(tmp_path):
    lib = vault(tmp_path, embed=False)
    try:
        result = lib.shapes.shape('library/walk.md')
        assert result['form'] == 'terms' and result['variance'] is None and result['neighbours'] == []
        assert result['note'] == 'Rebuild the search index for the full shape'
        assert 4 <= len(result['terms']) <= 7 and len(result['points']) == result['count']
        again = Shapes(lib).shape('library/walk.md')
        assert again['points'] == result['points'], 'the helix is seeded by the source digest'
        other = lib.shapes.shape('library/ledger.md')
        assert other['points'] != result['points']
    finally:
        lib.close()


def test_unindexed_source_uses_indexer_windows(tmp_path):
    lib = vault(tmp_path)
    try:
        (tmp_path / 'library/fresh.md').write_text('# Fresh\n\n' + section(1, 9000))
        result = lib.shapes.shape('library/fresh.md')
        assert result['form'] == 'terms' and result['current'] is False and result['count'] >= 6
    finally:
        lib.close()


def test_neighbours_project_through_the_same_basis(library):
    result = library.shapes.shape('library/walk.md')
    assert result['neighbours'], 'related works appear as stars'
    assert len(result['neighbours']) <= 12
    paths = [n['path'] for n in result['neighbours']]
    assert 'library/walk.md' not in paths and len(set(paths)) == len(paths)
    # Recompute one neighbour's position from the same PCA basis.
    rows = library.shapes.passages(*library.shapes.connect()[:2], 'library/walk.md')
    vectors = [r[3] for r in rows]
    _, basis, mean, scale, _ = project(vectors)
    target = result['neighbours'][0]
    mine = library.related.vectors({target['path']})[target['path']]
    expected = (np.asarray(mine, dtype=np.float64) - mean) @ basis.T / scale
    assert np.allclose(target['xyz'], expected, atol=1e-3)
    for neighbour in result['neighbours']:
        assert np.linalg.norm(neighbour['xyz']) >= MIN_DIRECTION, 'every star has a direction to be drawn along'


def test_margin_threads_weight_their_passages(library, tmp_path):
    text = (tmp_path / 'library/walk.md').read_text()
    start = text.index('## Part 4')
    Annotations(tmp_path).create('library/walk.md', start, start + 9, 'Ada', comment='A note.')
    result = library.shapes.shape('library/walk.md')
    assert sum(result['threads']) == 1
    index = result['threads'].index(1)
    line = text.count('\n', 0, start) + 1
    assert result['lines'][index] <= line and (index + 1 == len(result['lines']) or result['lines'][index + 1] > line)


def test_refusals(library, tmp_path):
    (tmp_path / 'notes.md').write_text('# Outside\n')
    for path in ('notes.md', '../notes.md', 'library/../notes.md', '/etc/passwd', 'library/missing.md'):
        with pytest.raises(ValueError):
            library.shapes.shape(path)
    (tmp_path / 'library/picture.png').write_bytes(b'\x89PNG')
    with pytest.raises(ValueError, match='Markdown and plain-text'):
        library.shapes.shape('library/picture.png')


def test_route_is_read_only_and_refuses_outside_library(library, tmp_path):
    server = WebServer(('127.0.0.1', 0), library, 'Test reader')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    before = sorted((p.relative_to(tmp_path), p.stat().st_mtime_ns) for p in (tmp_path / 'library').rglob('*'))
    try:
        def get(path):
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            connection.request('GET', path)
            response = connection.getresponse()
            body = json.loads(response.read())
            connection.close()
            return response.status, body
        status, body = get('/api/shape?path=library%2Fwalk.md')
        assert status == 200 and body['form'] == 'full'
        assert get('/api/shape?path=..%2Fnotes.md')[0] == 400
        assert get('/api/shape?path=library%2Fnope.md')[0] == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    assert sorted((p.relative_to(tmp_path), p.stat().st_mtime_ns) for p in (tmp_path / 'library').rglob('*')) == before



def test_a_dense_ribbon_keeps_its_stars(tmp_path):
    """#81: a long document's 400 passages wind over the whole sphere, so every neighbour lies within the old 0.15
    drop distance of some point, yet stars are drawn at a fixed radius along each neighbour's direction. Only a neighbour
    with no direction is dropped."""
    k = np.arange(400) + 0.5
    z, turn = 1 - 2 * k / 400, np.pi * (1 + 5 ** 0.5) * k  # a spiral path in reading order over the sphere
    ribbon = 0.8 * np.stack([np.sqrt(1 - z * z) * np.cos(turn), np.sqrt(1 - z * z) * np.sin(turn), z], axis=1)
    directions = np.random.default_rng(81).normal(size=(11, 3))
    vectors = [[0.0, 0.0, MIN_DIRECTION / 2]] + [list(d / np.linalg.norm(d) * 0.8) for d in directions]
    works = [{'primary': f'library/w{n}.md', 'title': f'Work {n}'} for n in range(len(vectors))]

    class Related:
        def nearest(self, path, listed, limit):
            return [(0.9 - n / 100, work, vector) for n, (work, vector) in enumerate(zip(listed, vectors))][:limit]

    class Library:
        root = tmp_path
        related = Related()

        def works(self):
            return works, None

    shapes = Shapes(Library())
    assert all(np.min(np.linalg.norm(ribbon - np.asarray(v), axis=1)) < 0.15 for v in vectors[1:]), 'every star is within the old 0.15 rule of some passage'
    found = shapes.neighbours('library/dense.md', np.eye(3), np.zeros(3), 1.0)
    assert [n['path'] for n in found] == [w['primary'] for w in works[1:]], 'all eleven directed neighbours stay; the directionless one goes'
