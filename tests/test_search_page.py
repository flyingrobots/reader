"""The search page API: passages grouped by work, excerpts with spans, facets, read state and bounds."""
import hashlib
from http.client import HTTPConnection
import json
import threading
from urllib.parse import quote

import numpy as np
import pytest

from reader_mcp.engagement import Engagement
from reader_mcp.search import Search, excerpt, fold, readable
from reader_mcp.web import WebLibrary, WebServer, WorkIndex, page_filters


class ConceptModel:
    """Deterministic vectors: 'crash' passages and the 'recover' query share a direction."""
    def vector(self, text):
        words = text.casefold().split()
        return np.array([sum(w.startswith(('crash', 'recover', 'durab')) for w in words) + .01,
                         sum(w.startswith(('rose', 'garden')) for w in words) + .01], dtype=np.float32)

    def passage_embed(self, texts, **kwargs):
        for text in texts:
            yield self.vector(text)

    def query_embed(self, text):
        yield np.array([1, 0], dtype=np.float32) if 'lost work' in text else self.vector(text)


def write(root, path, text):
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text)


@pytest.fixture
def vault(tmp_path):
    for name in ('library', 'inbox', 'indexes'):
        (tmp_path / name).mkdir()
    journal = ('---\ntitle: Durable journal\nauthor: Ada\n---\n\n# Journal\n\n'
               + ''.join(f'Paragraph {i}: a journal preserves transactions after a crash and keeps them.\n\n' for i in range(60)))
    write(tmp_path, 'library/journal.md', journal)
    write(tmp_path, 'library/journal.reading.md', journal.split('---\n', 2)[2])
    write(tmp_path, 'library/bundle/index.md', '# Bundle\n\nCatalog wrapper.\n')
    write(tmp_path, 'library/bundle/report.md', '# Report\n\nA crash report from the field, with transactions listed.\n')
    write(tmp_path, 'library/bundle/receipt.json', '{"crash": "machine record"}')
    write(tmp_path, 'library/garden.md', '---\ntitle: Roses\nauthor: Bo\ndate: 2025-05-01\n---\nRoses need water. A crash of thunder.\n')
    write(tmp_path, 'library/emoji.md', '# Cats\n\n🐈 🐈 the café crash 🐈 and more.\n')
    works = [dict(id='library/journal.md', title='Durable journal', primary='library/journal.md', path='library/journal.md',
                  authors=['Ada'], topics=['Systems'], projects=['Storage'], types=['Essay'], date='2026-10-01', primary_format='.md'),
             dict(id='library/bundle/index.md', title='Field report', primary='library/bundle/report.md', path='library/bundle/index.md',
                  authors=['Cy'], topics=['Systems'], projects=['Field'], types=['Report'], date='2026-09-02', primary_format='.md'),
             dict(id='library/emoji.md', title='Cats', primary='library/emoji.md', path='library/emoji.md',
                  authors=['Ada'], topics=['Pets'], projects=['Storage'], types=['Note'], date='2024-01-01', primary_format='.md')]
    (tmp_path / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-23', 'works': works}))
    engine = Search(tmp_path)
    engine._model = ConceptModel()
    engine.index(True)
    return tmp_path


@pytest.fixture
def library(vault):
    library = WebLibrary(vault)
    library.engine._model = ConceptModel()
    return library


def titles(result):
    return [w['title'] for w in result['works']]


def test_groups_passages_by_work_with_at_most_three(library):
    result = library.search_page('journal transactions crash', 'words')
    journal = next(w for w in result['works'] if w['title'] == 'Durable journal')
    assert 1 <= len(journal['passages']) <= 3
    # The reading copy and its original are one work; identical passages show once.
    assert len({p['excerpt'] for p in journal['passages']}) == len(journal['passages'])
    assert all(p['path'] in ('library/journal.md', 'library/journal.reading.md') for p in journal['passages'])
    bundle = next(w for w in result['works'] if w['title'] == 'Field report')
    assert bundle['passages'][0]['path'] == 'library/bundle/report.md' and bundle['projects'] == ['Field']
    loose = next(w for w in library.search_page('roses', 'words')['works'] if w['primary'] == 'library/garden.md')
    assert loose['title'] == 'Roses' and loose['authors'] == ['Bo'] and loose['date'] == '2025-05-01'
    assert len(result['works']) == len({w['id'] for w in result['works']})


def test_excerpt_spans_match_query_terms(library):
    result = library.search_page('Transactions CRASH', 'words')
    for work in result['works']:
        for passage in work['passages']:
            assert len(passage['excerpt']) <= 322 and '---' not in passage['excerpt'] and '#' not in passage['excerpt']
            assert passage['spans'], passage
            assert all(fold(passage['excerpt'][s:e]) in {'transactions', 'crash'} for s, e in passage['spans'])
    deep = library.search_page('Paragraph 57', 'words')['works'][0]['passages'][0]
    assert deep['line'] > 100 and 'Paragraph 57' in deep['excerpt']
    # Spans are code points: emoji before a match do not shift them, and diacritics fold like FTS5.
    cats = library.search_page('cafe crash', 'words')['works'][0]['passages'][0]
    assert [cats['excerpt'][s:e] for s, e in cats['spans']] == ['café', 'crash']


def test_excerpt_helper_cuts_around_the_densest_cluster():
    text = 'Filler words here. ' * 40 + 'The rare term and the other rare term meet. ' + 'More filler. ' * 40
    cut, spans, line = excerpt(text, ['rare', 'term'], 7)
    assert cut.startswith('…') and cut.endswith('…') and len(cut) <= 320 and line == 7
    assert [cut[s:e] for s, e in spans] == ['rare', 'term', 'rare', 'term']
    clean, sources = readable('---\na: 1\n---\n# Head **bold** [link](x) `code`\n')
    assert clean == 'Head bold link code' and len(sources) == len(clean)


def test_facets_count_works_and_respect_filters(library):
    result = library.search_page('crash', 'words')
    assert result['facets']['project'] == {'Storage': 2, 'Field': 1, 'Unspecified project': 1}
    assert result['facets']['author']['Ada'] == 2 and result['facet_scope'] == 'all'
    narrowed = library.search_page('crash', 'words', {'project': ['Storage']})
    assert set(titles(narrowed)) == {'Durable journal', 'Cats'}
    # A facet's own counts relax its own filter, so other values stay choosable; other facets narrow.
    assert narrowed['facets']['project']['Field'] == 1
    assert narrowed['facets']['author'] == {'Ada': 2}
    assert titles(library.search_page('crash', 'words', {'project': ['Storage'], 'type': ['Note']})) == ['Cats']
    dated = library.search_page('crash', 'words', {'from': '2026-01-01', 'to': '2026-12-31'})
    assert set(titles(dated)) == {'Durable journal', 'Field report'}
    folder = library.search_page('crash', 'words', {'folder': 'library/bundle'})
    assert titles(folder) == ['Field report'] and folder['filters']['folder'] == 'library/bundle/'
    assert 'library/bundle/' in result['facets']['folder']
    # Machine files stay out unless asked for.
    paths = lambda r: {p['path'] for w in r['works'] for p in w['passages']}
    assert 'library/bundle/receipt.json' not in paths(result)
    assert 'library/bundle/receipt.json' in paths(library.search_page('receipt', 'words', {'machine': '1'}))


def test_date_range_matches_arrival_instants_by_the_browsers_local_day(library, vault):
    coverage = json.loads((vault / 'indexes/coverage.json').read_text())
    coverage['works'][0]['arrival_time'] = '2026-10-01T03:00:00+00:00'   # Sep 30, 20:00 in Los Angeles
    (vault / 'indexes/coverage.json').write_text(json.dumps(coverage))
    la = {'from': '2026-09-30', 'to': '2026-09-30', 'from_at': '2026-09-30T07:00:00.000Z', 'to_at': '2026-10-01T07:00:00.000Z'}
    result = library.search_page('crash', 'words', la)
    assert titles(result) == ['Durable journal']
    assert result['works'][0]['arrival_time'] == '2026-10-01T03:00:00+00:00' and result['works'][0]['date'] == '2026-10-01'
    # Without the local bounds, the UTC catalog day applies; plain dates are compared as written.
    assert titles(library.search_page('crash', 'words', {'from': '2026-09-30', 'to': '2026-09-30'})) == []
    assert titles(library.search_page('crash', 'words', {'from': '2026-09-02', 'to': '2026-09-02', 'from_at': '2026-09-02T07:00:00Z',
                                                         'to_at': '2026-09-03T07:00:00Z'})) == ['Field report']
    for bad in ('2026-09-30', 'yesterday', '2026-09-30T07:00:00', 'x' * 41):
        with pytest.raises(ValueError):
            page_filters({'from_at': bad})


def test_read_state_filtering(library, vault):
    digest = hashlib.sha256((vault / 'library/emoji.md').read_bytes()).hexdigest()
    Engagement(vault).seen('You', [{'key': 'document:library/emoji.md', 'version': digest}])
    result = library.search_page('crash', 'words', participant='You')
    assert next(w for w in result['works'] if w['title'] == 'Cats')['read'] is True
    assert 'Cats' not in titles(library.search_page('crash', 'words', {'read': 'unread'}, participant='You'))
    assert titles(library.search_page('crash', 'words', {'read': 'read'}, participant='You')) == ['Cats']
    assert 'Cats' in titles(library.search_page('crash', 'words', {'read': 'unread'}, participant='Someone else'))


def test_meaning_marks_non_literal_passages_and_falls_back(library):
    result = library.search_page('recover lost work', 'meaning')
    assert result['semantic'] == 'used' and result['works']
    passages = [p for w in result['works'] for p in w['passages']]
    assert passages and all(not p['literal'] and p['spans'] == [] for p in passages)
    best = library.search_page('crash', 'best')
    assert any('semantic' in p['matched_by'] and 'words' in p['matched_by'] for w in best['works'] for p in w['passages'])
    def broken(**_):
        raise ValueError('Embedding model unavailable')
    library.engine._model = None
    library.engine.model = broken
    fallback = library.search_page('crash', 'meaning')
    assert fallback['semantic'] == 'unavailable' and fallback['works']
    assert any('Meaning search is unavailable' in w for w in fallback['warnings'])


def test_changed_sources_are_hidden_and_reported(library, vault):
    (vault / 'library/garden.md').write_text('Completely different now.\n')
    result = library.search_page('roses', 'words')
    assert result['works'] == [] and any('changed since' in w for w in result['warnings'])


def test_limits_enforced(library):
    for args in [('', 'best'), ('x' * 1001, 'best'), ('crash', 'fuzzy')]:
        with pytest.raises(ValueError):
            library.search_page(*args)
    for kwargs in [{'limit': 51}, {'limit': 0}, {'offset': 501}]:
        with pytest.raises(ValueError):
            library.search_page('crash', 'words', **kwargs)
    for filters in [{'project': ['x'] * 21}, {'from': '2026-13-01'}, {'read': 'maybe'}, {'folder': '../etc'},
                    {'folder': 'library/../x'}, {'unknown': 1}, {'machine': 'perhaps'}]:
        with pytest.raises(ValueError):
            page_filters(filters)
    many = library.search_page('crash', 'words', limit=1)
    assert len(many['works']) == 1 and many['total'] >= 3
    second = library.search_page('crash', 'words', offset=1, limit=1)
    assert second['works'][0]['id'] != many['works'][0]['id']


def test_work_index_maps_copies_and_bundles():
    index = WorkIndex([dict(id='w', title='W', primary='library/b/doc.md', path='library/b/index.md', authors=['A'], projects=['P'], types=['T'], date=None)])
    for path in ('library/b/doc.md', 'library/b/index.md', 'library/b/doc.reading.md', 'library/b/attachments/x.pdf'):
        assert index(path)['id'] == 'w'
    assert index('library/other.md', {'title': 'Other'})['title'] == 'Other'


@pytest.fixture
def http(library):
    server = WebServer(('127.0.0.1', 0), library, 'You')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def get(path):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
        connection.request('GET', path)
        response = connection.getresponse()
        body = json.loads(response.read())
        connection.close()
        return response.status, body
    yield library, get
    server.shutdown()
    server.server_close()


def test_route_parses_repeated_facets_and_bounds(http):
    library, get = http
    status, body = get('/api/search/page?q=crash&mode=words&project=Storage&project=Field&limit=5')
    assert status == 200 and body['filters']['project'] == ['Field', 'Storage'] and len(body['works']) <= 5
    assert get('/api/search/page?q=crash&mode=words&limit=abc')[0] == 400
    assert get('/api/search/page?q=' + quote('x' * 1001))[0] == 400


def test_passage_search_waits_for_a_running_search_then_answers_429(http, monkeypatch):
    """Issue #57: the page's passage search queues behind a running search like the picker's does."""
    import time
    from reader_mcp import web as web_module
    library, get = http
    library.search_lock.acquire()
    releaser = threading.Timer(1, library.search_lock.release); releaser.start()
    started = time.monotonic()
    status, body = get('/api/search/page?q=crash&mode=words')
    releaser.join()
    assert status == 200 and body['works'], body
    assert .8 < time.monotonic() - started < 6, 'a contended passage search waits for the running one'
    monkeypatch.setattr(web_module, 'SEARCH_WAIT', .2)
    with library.search_lock:
        status, body = get('/api/search/page?q=crash')
    assert status == 429 and 'try again' in body['error']


def test_a_format_1_index_alone_asks_for_a_rebuild(vault):
    """Format 1 is retired (#9): with only the old index, the page says to rebuild and never reads or writes it."""
    import sqlite3
    (vault / '.reader/search.v2.sqlite3').unlink()
    with sqlite3.connect(vault / '.reader/search.sqlite3') as con:
        con.executescript("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('version', '1');")
    before = (vault / '.reader/search.sqlite3').read_bytes()
    library = WebLibrary(vault)
    for mode in ('words', 'meaning', 'best'):
        with pytest.raises(ValueError, match='no longer reads the format 1 index.*run reader index'):
            library.search_page('journal transactions crash', mode)
    assert (vault / '.reader/search.sqlite3').read_bytes() == before, 'format 1 is never written'
    assert not (vault / '.reader/search.v2.sqlite3').exists()
