"""HTTP integration checks against isolated synthetic vaults, never the real library."""
import hashlib
from http.client import HTTPConnection
import json
import re
from pathlib import Path
import threading
from uuid import uuid4

import pytest

from reader_mcp.web import WebLibrary, WebServer


@pytest.fixture
def web(tmp_path):
    (tmp_path / 'library').mkdir()
    (tmp_path / 'inbox').mkdir()
    (tmp_path / 'indexes').mkdir()
    source = '---\ntitle: A quiet thought\nauthor: Ada\n---\n\n# A quiet thought\n\nAn emoji 🐈 and **a precise passage**.\n\nA second paragraph waits.\n'
    (tmp_path / 'library/thought.md').write_text(source)
    (tmp_path / 'library/other.md').write_text('# Another thought\n\nA different thought.\n')
    works = [dict(id=name, title=title, primary='library/' + name, authors=['Ada'], topics=['Ideas'], projects=['Test'], date='2026-10-23', primary_format='.md', primary_bytes=100) for name, title in [('thought.md','A quiet thought'), ('other.md','Another thought')]]
    (tmp_path / 'indexes/coverage.json').write_text(json.dumps({'as_of':'2026-10-23', 'works':works}))
    library = WebLibrary(tmp_path, service_runner=lambda argv: {'installed': False})
    server = WebServer(('127.0.0.1', 0), library, 'Test reader')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(path, payload=None, headers=None, raw=False):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
        h = {'Content-Type':'application/json', 'X-Reader-Token':server.token}
        h.update(headers or {})
        connection.request('POST' if payload is not None else 'GET', path, json.dumps(payload) if payload is not None else None, h)
        response = connection.getresponse()
        body = response.read()
        result = (response.status, body if raw else json.loads(body), dict(response.getheaders()))
        connection.close()
        return result

    yield tmp_path, library, server, request
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def test_open_get_is_read_only_and_read_marks_reject_new_editions(web):
    root, library, server, request = web
    _, doc, _ = request('/api/document?path=library/thought.md')
    assert not (root / 'engagement').exists()
    assert request('/api/library')[1]['metrics']['read'] == 0
    assert request('/api/seen', {'participant':'Test reader', 'items':[doc['item']]})[0] == 200
    assert request('/api/library')[1]['metrics']['read'] == 1
    assert request('/api/library?participant=Another%20reader')[1]['metrics']['read'] == 0
    (root / 'library/thought.md').write_text(doc['text'] + '\nA new edition.\n')
    assert request('/api/library')[1]['metrics']['read'] == 0
    assert request('/api/seen', {'participant':'Test reader', 'items':[doc['item']]})[0] == 400


def test_host_origin_token_and_path_boundaries(web, tmp_path):
    root, library, server, request = web
    assert request('/api/library', headers={'Host':'untrusted.example'})[0] == 403
    assert request('/api/library', headers={'Origin':'https://untrusted.example'})[0] == 403
    _, doc, _ = request('/api/document?path=library/thought.md')
    assert request('/api/seen', {'participant':'Test reader','items':[doc['item']]}, {'X-Reader-Token':'wrong'})[0] == 403
    for path in ['../outside', 'library/../outside', '/etc/passwd', 'library/.hidden', 'library//thought.md', 'library/%2e%2e/outside']:
        assert request('/api/document?path=' + path)[0] == 400
    (root / 'library/link.md').symlink_to(root / 'library/thought.md')
    assert request('/api/file?path=library/link.md')[0] == 400
    status, body, headers = request('/', raw=True)
    assert status == 200 and b'file-query' in body
    assert "script-src 'self'" in headers['Content-Security-Policy']
    # Split view (RW-32) runs panes as same-origin frames of the app: frames from Reader only, framed only by Reader.
    assert "frame-src 'self'" in headers['Content-Security-Policy'] and "frame-ancestors 'self'" in headers['Content-Security-Policy']
    assert request('/assets/../../pyproject.toml')[0] == 404


def test_unicode_annotation_reply_seen_and_source_preservation(web):
    root, library, server, request = web
    _, doc, _ = request('/api/document?path=library/thought.md')
    source = doc['text']
    start = source.index('a precise passage')
    payload = dict(operation='create', path=doc['path'], start=start, end=start+len('a precise passage'), owner='Test reader', kind='warning', comment='Check this interpretation.', expected_sha256=doc['sha256'], request_id=str(uuid4()))
    status, thread, _ = request('/api/annotations', payload)
    assert status == 200 and thread['anchor']['quote'] == 'a precise passage'
    assert request('/api/annotations', payload)[1]['id'] == thread['id']
    parent = thread['comments'][0]['id']
    reply = dict(operation='reply', thread_id=thread['id'], author='Another reader', body='Here is the missing context.', reply_to=parent, request_id=str(uuid4()))
    assert request('/api/annotations', reply)[1]['revision'] == 2
    assert len(request('/api/annotations', reply)[1]['comments']) == 2
    discussion = request('/api/discussion?path=library/thought.md')[1]
    assert discussion['threads'][0]['location']['status'] == 'exact'
    items = [{k: i[k] for k in ('key','version')} for i in discussion['attention']['items'] if i.get('thread_id') == thread['id']]
    assert request('/api/seen', dict(participant='Test reader',items=items))[0] == 200
    current = request('/api/discussion?path=library/thought.md')[1]
    assert all(i['read'] for i in current['attention']['items'] if i.get('thread_id') == thread['id'])
    assert request('/api/library')[1]['pending'] == []
    assert (root / doc['path']).read_text() == source


def test_fuzzy_inventory_search_survives_missing_full_text_index(web):
    _, library, server, request = web
    result = request('/api/search?q=quie%20thoght&mode=fuzzy')[1]
    assert result['results'][0]['path'] == 'library/thought.md'
    assert request('/api/search?q=thought&mode=semantic')[0] == 400
    status, result, _ = request('/api/search?q=thought&mode=keyword')
    assert status == 400 and 'error' in result


def test_search_read_status_is_participant_and_current_version_specific(web, monkeypatch):
    root, library, _, request = web
    doc = request('/api/document?path=library/thought.md')[1]
    request('/api/seen', {'participant': 'Test reader', 'items': [doc['item']]})
    # The search index is a projection: read state must be checked against the
    # current source, for all modes, including a nonprimary attachment result.
    (root / 'library/attachment.md').write_text('A separate attachment.\n')
    attachment = request('/api/document?path=library/attachment.md')[1]
    request('/api/seen', {'participant': 'Test reader', 'items': [attachment['item']]})
    monkeypatch.setattr(library.engine, 'search', lambda *args, **kwargs: {
        'results': [{'path': doc['path']}, {'path': attachment['path']}], 'warnings': []})
    for mode in ('fuzzy', 'keyword', 'semantic'):
        path = '/api/search?q=quiet&mode=' + mode
        rows = request(path)[1]['results']
        assert next(row for row in rows if row['path'] == doc['path'])['read'] is True
        assert all(row['read'] is False for row in request(path + '&participant=Other')[1]['results'])
        if mode != 'fuzzy':
            assert rows[1]['read'] is True
    (root / doc['path']).write_text(doc['text'] + '\nA changed edition.\n')
    for mode in ('fuzzy', 'keyword', 'semantic'):
        rows = request('/api/search?q=quiet&mode=' + mode)[1]['results']
        assert next(row for row in rows if row['path'] == doc['path'])['read'] is False


def test_asset_ranges_and_link_resolution(web):
    root, library, server, request = web
    (root / 'library/paper.pdf').write_bytes(b'%PDF-synthetic-range-test')
    status, body, headers = request('/api/file?path=library/paper.pdf', headers={'Range':'bytes=5-13'}, raw=True)
    assert status == 206 and body == b'synthetic'
    assert headers['Content-Range'].startswith('bytes 5-13/')
    assert request('/api/resolve?from=library/thought.md&target=other.md')[1]['path'] == 'library/other.md'
    assert request('/api/resolve?from=library/thought.md&target=https://example.com')[0] == 400
    assert request('/api/resolve?from=library/thought.md&target=../../outside')[0] == 400


def test_diagram_chunks_are_packaged_and_served_locally(web):
    _, _, _, request = web
    controls = Path(__file__).parents[1] / 'src/reader_mcp/web_ui/controls'
    meta = json.loads((controls / 'build-meta.json').read_text())
    assert meta['dependencies']['pele']['license'] == 'MIT'
    assert (controls / 'licenses/pele-LICENSE').is_file()
    chunks = sorted((controls / 'diagrams').glob('*.js'))
    assert chunks and all('diagrams/' + chunk.name in meta['outputs'] for chunk in chunks)
    entry = (controls / 'diagrams.js').read_text()
    assert 'https://' not in entry
    status, body, headers = request('/assets/controls/diagrams.js', raw=True)
    assert status == 200 and headers['Content-Type'] == 'text/javascript' and body == (controls / 'diagrams.js').read_bytes()
    status, _, headers = request('/assets/controls/diagrams/' + chunks[0].name, raw=True)
    assert status == 200 and headers['Content-Type'] == 'text/javascript'
    assert "script-src 'self'" in headers['Content-Security-Policy']
    assert request('/assets/controls/diagrams/../../../web.py', raw=True)[0] == 404


def test_control_licenses_match_shipped_packages():
    controls = Path(__file__).parents[1] / 'src/reader_mcp/web_ui/controls'
    meta = json.loads((controls / 'build-meta.json').read_text())
    deps = meta['dependencies']
    files = {path.name for path in (controls / 'licenses').iterdir()}
    owner = lambda name: next(dep for dep in sorted(deps, key=len, reverse=True) if name.startswith(dep.replace('/', '-') + '-'))
    # Every license file belongs to a listed package (no stale copies) and every package has one.
    assert {owner(name) for name in files - {'shadcn-ui-LICENSE'}} == set(deps)
    assert {'licenses/' + name for name in files} <= set(meta['outputs'])
    # Tree-shaken packages (Shiki's HTML renderer, CodeMirror's unused languages) are not listed.
    for shaken in ['hast-util-to-html', 'property-information', '@codemirror/lang-html', '@lezer/javascript']:
        assert shaken not in deps
    for kept in ['@shikijs/core', '@shikijs/langs', 'oniguruma-to-es', '@codemirror/view', 'react', 'three', 'katex', 'tailwindcss', 'tw-animate-css']:
        assert kept in deps


def test_katex_chunk_styles_and_woff2_fonts_are_local(web):
    _, _, _, request = web
    controls = Path(__file__).parents[1] / 'src/reader_mcp/web_ui/controls'
    meta = json.loads((controls / 'build-meta.json').read_text())
    assert meta['dependencies']['katex'] == {'version': '0.19.1', 'license': 'MIT'}
    assert (controls / 'licenses/katex-LICENSE').is_file()
    css = (controls / 'katex/katex.css').read_text()
    urls = re.findall(r'url\(([^)]+)\)', css)
    assert urls and all(url.startswith('fonts/KaTeX_') and url.endswith('.woff2') for url in urls)
    assert all((controls / 'katex' / url).is_file() for url in urls)
    assert sorted(path.suffix for path in (controls / 'katex/fonts').iterdir()) == ['.woff2'] * len(list((controls / 'katex/fonts').iterdir()))
    status, _, headers = request('/assets/controls/katex/katex.css', raw=True)
    assert status == 200 and headers['Content-Type'] == 'text/css'
    status, _, headers = request('/assets/controls/katex/' + urls[0], raw=True)
    assert status == 200 and headers['Content-Type'] == 'font/woff2'
    assert "font-src 'self'" in headers['Content-Security-Policy']
    status, body, headers = request('/assets/controls/math.js', raw=True)
    assert status == 200 and headers['Content-Type'] == 'text/javascript' and b'https://' not in body


def test_resolve_batch_keeps_order_reports_per_target_errors_and_reads_inventory_once(web, monkeypatch):
    root, library, server, request = web
    (root / 'library/figures').mkdir()
    (root / 'library/figures/plot.png').write_bytes(b'\x89PNG synthetic')
    reads = []
    original = library.works
    monkeypatch.setattr(library, 'works', lambda: reads.append(1) or original())
    status, data, _ = request('/api/resolve-batch?from=library/thought.md&target=figures/plot.png&target=https://example.com/x.png'
                              '&target=&target=../../outside&target=other&target=missing.png&target=other.md%23part')
    assert status == 200
    results = data['results']
    assert [r.get('path') for r in results] == ['library/figures/plot.png', None, None, None, 'library/other.md', None, 'library/other.md']
    assert results[6]['fragment'] == 'part' and all('error' in results[i] for i in (1, 2, 3, 5))
    assert len(reads) == 1, 'unresolved targets share one inventory read'
    assert request('/api/resolve-batch?from=library/thought.md')[1] == {'results': []}
    assert request('/api/resolve-batch?from=library/missing.md&target=other.md')[0] == 404  # a missing source document
    too_many = ''.join('&target=other.md' for _ in range(65))
    assert request('/api/resolve-batch?from=library/thought.md' + too_many)[0] == 400
    assert len(request('/api/resolve-batch?from=library/thought.md' + too_many[:-16 * 1])[1]['results']) == 64


def test_resolve_routes_accept_a_draft_folder_source(web, tmp_path):
    # A scratch draft has no file yet: it resolves from the folder it will be saved in (#114).
    root, library, server, request = web
    (root / 'library/figures').mkdir()
    (root / 'library/figures/plot.png').write_bytes(b'\x89PNG synthetic')
    status, data, _ = request('/api/resolve-batch?from=library/notebook/&target=library/figures/plot.png&target=../thought.md&target=other&target=missing.png')
    assert status == 200, data
    assert [r.get('path') for r in data['results']] == ['library/figures/plot.png', 'library/thought.md', 'library/other.md', None]
    assert request('/api/resolve?from=library/figures/&target=plot.png')[1]['path'] == 'library/figures/plot.png'
    status, data, _ = request('/api/embeds?from=library/notebook/&target=Another%20thought&target=other&target=%23Heading')
    assert status == 200, data
    assert [n['status'] for n in data['nodes']] == ['missing', 'ok', 'missing'] and 'library/other.md' in data['documents']
    assert not (root / 'library/notebook').exists(), 'a GET never creates the notebook folder'
    # Bounds: only an existing real folder in library/ (or the not-yet-created notebook); never a file, inbox, symlink or escape.
    (root / 'outside').mkdir()
    (root / 'library/linked').symlink_to(root / 'outside', target_is_directory=True)
    for bad in ('library/linked/', 'library/missing/', 'inbox/', 'library/thought.md/', 'library/../', 'library//', '/library/', 'library/.hidden/', 'library/notebook/x/'):
        status, data, _ = request('/api/resolve-batch?from=' + bad + '&target=other.md')
        assert status in (400, 404), (bad, status, data)
        assert request('/api/embeds?from=' + bad + '&target=other')[0] in (400, 404), bad
    assert request('/api/resolve-batch?from=library/missing.md&target=other.md')[0] == 404  # a missing source document stays missing


def test_server_refuses_external_bind(web):
    _, library, _, _ = web
    with pytest.raises(ValueError, match='loopback'):
        WebServer(('0.0.0.0', 8766), library)


def test_server_accepts_a_module_import_burst(web):
    # Browsers open many connections at once for the page's ES modules.
    import socket
    _, _, server, _ = web
    assert server.request_queue_size >= 64
    sockets = [socket.create_connection(('127.0.0.1', server.server_port), timeout=5) for _ in range(40)]
    try:
        for connection in sockets:
            connection.sendall(f'GET /assets/style.css HTTP/1.1\r\nHost: 127.0.0.1:{server.server_port}\r\nConnection: close\r\n\r\n'.encode())
        # Every connection is answered (200, or 429 past the handler limit), none is reset.
        assert {connection.recv(12) for connection in sockets} <= {b'HTTP/1.0 200', b'HTTP/1.0 429'}
    finally:
        for connection in sockets:
            connection.close()


def test_bookmarks_are_persistent_version_bound_and_participant_specific(web):
    from reader_mcp.bookmarks import Bookmarks
    root, library, server, request = web
    doc = request('/api/document?path=library/thought.md')[1]
    payload = dict(participant='Test reader', path=doc['path'], source_sha256=doc['sha256'], progress=.6, source_offset=50, block_fraction=.3, layout='spread', spread_count=7)
    assert request('/api/bookmark', payload)[0] == 200
    stored = Bookmarks(root).get('Test reader', doc['path'])
    assert stored['progress'] == .6 and stored['spread_count'] == 7
    assert request('/api/document?path=library/thought.md')[1]['bookmark'] == stored
    assert request('/api/document?path=library/thought.md&participant=Someone%20else')[1]['bookmark'] is None
    assert not (root / 'engagement').exists(), 'A bookmark is not a reading receipt'
    (root / doc['path']).write_text(doc['text'] + '\nA changed edition.\n')
    assert request('/api/bookmark', payload)[0] == 400
    assert request('/api/document?path=library/thought.md')[1]['bookmark']['source_sha256'] == doc['sha256'], 'Preserve the old version instead of guessing its location'


@pytest.mark.parametrize('change', [{'progress':float('nan')}, {'progress':float('inf')}, {'progress':True}, {'progress':1.1}, {'source_offset':-1}, {'pdf_page':5001}, {'spread_count':0}, {'layout':'unknown'}])
def test_invalid_bookmark_does_not_overwrite_position(web, change):
    _, library, _, request = web
    doc = request('/api/document?path=library/thought.md')[1]
    payload = dict(participant='Test reader', path=doc['path'], source_sha256=doc['sha256'], progress=.4)
    assert request('/api/bookmark', payload)[0] == 200
    assert request('/api/bookmark', payload | change)[0] == 400
    assert library.bookmarks.get('Test reader', doc['path'])['progress'] == .4


def test_bom_source_coordinates_are_preserved_for_annotations(web):
    root, _, _, request = web
    source = '\ufeff# An edition\n\nAn emoji 🐈 then a passage.\n'
    (root / 'library/thought.md').write_text(source)
    doc = request('/api/document?path=library/thought.md')[1]
    assert doc['text'] == source
    start = source.index('a passage')
    status, thread, _ = request('/api/annotations', dict(operation='create', path=doc['path'], start=start, end=start+len('a passage'), owner='Test reader', expected_sha256=doc['sha256']))
    assert status == 200 and thread['anchor']['quote'] == 'a passage'


def test_folder_search_filters_before_ranking_and_respects_path_boundary(web, monkeypatch):
    _, library, _, request = web
    def work(path):
        return dict(title='A quiet thought', primary=path, authors=['Ada'])
    # More outside matches than the result limit; filter before ranking, not after.
    works = [work(f'library/notes-other/{index}.md') for index in range(35)] + [work('library/notes/inside.md')]
    monkeypatch.setattr(library, 'works', lambda: (works, '2026-10-23'))
    status, result, _ = request('/api/search?q=quiet&mode=fuzzy&path_prefix=library/notes/')
    assert status == 200 and [row['path'] for row in result['results']] == ['library/notes/inside.md']
    assert request('/api/search?q=quiet&mode=fuzzy&path_prefix=library/missing/')[1]['results'] == []
    for prefix in ['../', 'library/../', 'library/.private/', 'library//notes/']:
        assert request('/api/search?q=quiet&mode=fuzzy&path_prefix='+prefix)[0] == 400


def test_folder_context_reaches_content_and_semantic_search(web, monkeypatch):
    _, library, _, request = web
    calls = []
    def search(query, **options):
        calls.append((query, options))
        return {'results': []}
    monkeypatch.setattr(library.engine, 'search', search)
    for mode in ('keyword', 'semantic'):
        assert request('/api/search?q=quiet&mode='+mode+'&path_prefix=library/notes/')[0] == 200
    assert calls == [('quiet', dict(mode=mode, limit=30, path_prefix='library/notes/')) for mode in ('keyword','semantic')]


def test_content_search_waits_briefly_for_a_running_search_then_answers_429(web, monkeypatch):
    import time
    from reader_mcp import web as web_module
    _, library, _, request = web
    monkeypatch.setattr(library.engine, 'search', lambda query, **options: {'results': [], 'mode': options['mode']})
    library.search_lock.acquire()
    releaser = threading.Timer(.4, library.search_lock.release); releaser.start()
    started = time.monotonic()
    status, body, _ = request('/api/search?q=quiet&mode=semantic')
    assert status == 200 and .3 < time.monotonic() - started < 5, 'a contended search waits for the running one'
    monkeypatch.setattr(web_module, 'SEARCH_WAIT', .2)
    with library.search_lock:
        status, body, _ = request('/api/search?q=quiet&mode=keyword')
    assert status == 429 and 'search is still running' in body['error']


def test_dashboard_discussion_counts_actual_threads_comments_and_resolution(web):
    _, library, _, request = web
    doc=request('/api/document?path=library/thought.md')[1]
    first=doc['text'].index('a precise passage');second=doc['text'].index('A second paragraph')
    a=library.annotations.create(doc['path'],first,first+len('a precise passage'),'Ada')
    library.annotations.create(doc['path'],second,second+len('A second paragraph'),'Bo',kind='warning',comment='Check this claim.')
    library.annotations.resolve(a['id'],True)
    data=request('/api/library')[1]
    assert data['metrics']['threads']==2
    assert data['discussion']==dict(open=1,resolved=1,highlights=1,warnings=1,comments=1,paths={'open':[doc['path']],'resolved':[doc['path']]})


def test_library_sends_instants_for_the_browser_to_show_in_local_time(web, tmp_path):
    _, library, _, request = web
    coverage = json.loads((tmp_path / 'indexes/coverage.json').read_text())
    coverage['works'][0].update(date='2026-10-25', arrival_time='2026-10-25T00:16:00+00:00', date_basis='arrival')
    (tmp_path / 'indexes/coverage.json').write_text(json.dumps(coverage))
    request('/api/document?path=library/thought.md')
    data = request('/api/library')[1]
    rows = {w['primary']: w for w in data['works']}
    # The calendar day stays as catalogued; the instant goes with it, and day grouping is the browser's.
    assert rows['library/thought.md']['date'] == '2026-10-25' and rows['library/thought.md']['arrival_time'] == '2026-10-25T00:16:00+00:00'
    assert rows['library/other.md']['arrival_time'] is None and rows['library/other.md']['date'] == '2026-10-23'
    assert 'activity' not in data and 'local day' in data['scope']


def test_timestamps_and_plain_dates_are_kept_apart():
    from reader_mcp.editions import day_or_instant
    from reader_mcp.web import WorkIndex, utc_instant
    assert utc_instant('2026-10-24T17:16:00-07:00') == '2026-10-25T00:16:00+00:00'
    assert utc_instant('2026-10-25T00:16:00Z') == '2026-10-25T00:16:00+00:00'
    assert utc_instant('2026-10-25') is None and utc_instant('2026-10-25T00:16:00') is None and utc_instant('later') is None
    assert day_or_instant('2026-10-25') == '2026-10-25'
    assert day_or_instant('2026-10-24 17:16:00-07:00') == '2026-10-25T00:16:00+00:00'
    assert day_or_instant('2026-10-24T17:16:00') == '2026-10-24'   # no zone: the written calendar day
    unknown = WorkIndex([])
    assert unknown('library/a.md', {'added': '2026-10-24T17:16:00-07:00'})['arrival_time'] == '2026-10-25T00:16:00+00:00'
    plain = unknown('library/b.md', {'date': '2026-10-24'})
    assert plain['date'] == '2026-10-24' and plain['arrival_time'] is None


def test_theme_routes_store_in_vault_and_serve_cached_fonts(web):
    root, library, server, request = web
    from reader_mcp.themes import COLOR_TOKENS
    tokens = {token: '#202020' for token in COLOR_TOKENS}
    theme = {'id': 'dusk', 'name': 'Dusk', 'fonts': {}, 'light': tokens, 'dark': tokens}
    assert request('/api/themes')[1] == {'themes': [], 'fonts': []}
    assert request('/api/themes', {'action': 'save', 'theme': theme}, {'X-Reader-Token': 'wrong'})[0] == 403
    status, saved, _ = request('/api/themes', {'action': 'save', 'theme': theme})
    assert status == 200 and saved['id'] == 'dusk' and (root / 'themes/dusk.json').is_file()
    assert [t['id'] for t in request('/api/themes')[1]['themes']] == ['dusk']
    assert request('/api/themes', {'action': 'save', 'theme': theme | {'id': 'paper'}})[0] == 400
    assert request('/api/themes', {'action': 'delete', 'id': 'dusk'})[1] == {'deleted': 'dusk'}
    folder = root / 'themes/fonts/lora'
    folder.mkdir(parents=True)
    (folder / 'font.css').write_text('@font-face{}')
    status, body, headers = request('/fonts/lora/font.css', raw=True)
    assert status == 200 and body == b'@font-face{}' and headers['Content-Type'].startswith('text/css')
    assert request('/fonts/lora/..%2Fmanifest.json')[0] == 400
    assert request('/fonts/../themes/dusk.json')[0] == 404


def test_maintenance_and_next_routes(web):
    root, library, server, request = web
    status, body, _ = request('/api/maintenance')
    assert status == 200 and body['running'] is None and 'search' in body['kinds']
    status, body, _ = request('/api/maintenance', {'action': 'start', 'kind': 'check'}, headers={'X-Reader-Token': 'wrong'})
    assert status == 403
    status, body, _ = request('/api/maintenance', {'action': 'start', 'kind': 'nonsense'})
    assert status == 400
    status, body, _ = request('/api/maintenance', {'action': 'start', 'kind': 'check'})
    assert status == 200 and body['kind'] == 'check'
    for _ in range(200):
        if not library.maintenance.status()['running']:
            break
        threading.Event().wait(.05)
    assert library.maintenance.status()['checks']['search']['state'] == 'missing'
    status, body, _ = request('/api/next?path=' + 'library/thought.md')
    assert status == 200 and [i['primary'] for i in body['items']] == ['library/other.md']
    status, body, _ = request('/api/next?path=' + 'library/../etc')
    assert status == 400


def test_reading_log_without_a_voice_registry_names_no_voices(web):
    """#93: with no voices.json, nobody is a voice, including any name the code once defaulted to."""
    root, library, server, request = web
    assert not (root / 'voices.json').exists()
    defaults = library.engagement.voices()  # whatever the engagement layer would name without a registry
    for name in (*defaults, 'Synthetic voice', 'Archivist'):
        library.engagement.seen(name, [library.engagement.document('library/thought.md')])
    status, body, _ = request('/api/readers?path=library/thought.md')
    groups = {r['participant']: r['group'] for r in body['readers']}
    assert status == 200 and 'voice' not in groups.values(), groups
    assert defaults == () and set(groups) == {'Synthetic voice', 'Archivist'}
    assert library.engagement.group('Archivist', 'Test reader', ()) == 'agent'
    assert library.engagement.group('Test reader', 'Test reader', ('Test reader',)) == 'you'


def test_reading_log_reports_editions_groups_folding_and_threads_without_writing(web):
    root, library, server, request = web
    engagement = library.engagement
    for index in range(6):
        (root / f'library/extra-{index}.md').write_text(f'# Extra {index}\n')
    mark = lambda who, *paths: engagement.seen(who, [engagement.document(p) for p in paths])
    (root / 'voices.json').write_text(json.dumps({'schema_version': 1, 'voices': [{'name': 'Builder'}, {'name': 'Archivist'}]}))
    _, body, _ = request('/api/readers?path=library/thought.md')
    assert body['readers'] == [] and body['folded'] == 0
    mark('Builder', 'library/thought.md')
    mark('Archivist', 'library/thought.md')
    mark('Test reader', 'library/other.md')  # no receipt for thought.md: absent
    extras = [f'library/extra-{i}.md' for i in range(6)]
    mark('Steady agent', 'library/thought.md', *extras[:4])  # five documents: shown
    mark('One-off agent', 'library/thought.md', *extras[:3])  # four documents: folded
    start = (root / 'library/thought.md').read_text().index('a precise passage')
    thread = library.annotations.create(path='library/thought.md', start=start, end=start + 17, owner='Builder', request_id=str(uuid4()))
    library.annotations.reply(thread['id'], 'Archivist', 'Noted.')
    library.annotations.reply(thread['id'], 'Archivist', 'Twice.')
    library.annotations.create(path='library/thought.md', start=start, end=start + 1, owner='Builder', request_id=str(uuid4()))
    # The librarian's receipt is for the edition before this change.
    with (root / 'library/thought.md').open('a') as stream:
        stream.write('\nA new edition.\n')
    mark('Builder', 'library/thought.md')
    status, body, _ = request('/api/readers?path=library/thought.md')
    assert status == 200 and body['version'] == library.digest('library/thought.md') and body['participant'] == 'Test reader'
    rows = {r['participant']: r for r in body['readers']}
    assert set(rows) == {'Builder', 'Archivist', 'Steady agent', 'One-off agent'}
    assert rows['Builder']['state'] == 'current' and rows['Builder']['group'] == 'voice' and rows['Builder']['threads'] == 2
    assert rows['Archivist']['state'] == 'earlier' and rows['Archivist']['threads'] == 1
    assert rows['Steady agent']['group'] == 'agent' and not rows['Steady agent']['folded']
    assert rows['One-off agent']['folded'] and body['folded'] == 1 and body['one_off_threshold'] == 5
    assert [r['participant'] for r in body['readers']] == ['Builder', 'Archivist', 'Steady agent', 'One-off agent']
    # The requester is "you"; the voices are exactly the ones voices.json names now.
    mark('Test reader', 'library/thought.md')
    (root / 'voices.json').write_text(json.dumps({'schema_version': 1, 'voices': [{'name': 'Steady agent'}]}))
    receipts = {f.name: f.read_bytes() for f in (root / 'engagement').iterdir()}
    _, body, _ = request('/api/readers?path=library/thought.md')
    rows = {r['participant']: r for r in body['readers']}
    assert rows['Test reader']['group'] == 'you' and rows['Steady agent']['group'] == 'voice' and rows['Builder']['group'] == 'agent'
    assert rows['Builder']['folded'] and not rows['Steady agent']['folded'], 'only agents are folded'
    _, body, _ = request('/api/readers?path=library/thought.md&participant=One-off%20agent')
    row = next(r for r in body['readers'] if r['participant'] == 'One-off agent')
    assert row['group'] == 'you' and not row['folded'], 'you are never folded'
    assert {f.name: f.read_bytes() for f in (root / 'engagement').iterdir()} == receipts, 'the route never writes receipts'
    assert request('/api/readers?path=library/../etc')[0] == 400
    (root / 'engagement' / ('0' * 64 + '.json')).write_text('{"schema_version": 1, "participant": "Forged", "items": {}}')
    status, body, _ = request('/api/readers?path=library/thought.md')
    assert status == 400 and 'receipt' in body['error']


def test_reading_log_counts_other_edition_paths_as_earlier(web, monkeypatch):
    root, library, server, request = web
    library.engagement.seen('Builder', [library.engagement.document('library/other.md')])
    assert request('/api/readers?path=library/thought.md')[1]['readers'] == []
    monkeypatch.setattr(library, 'edition_paths', lambda path: ['library/other.md'])  # the RW-05 hook
    rows = request('/api/readers?path=library/thought.md')[1]['readers']
    assert [(r['participant'], r['state']) for r in rows] == [('Builder', 'earlier')]


def test_reading_log_counts_earlier_members_of_the_edition_family(web):
    root, library, server, request = web
    (root / 'library/thought.v2.md').write_text('---\ntitle: A quiet thought (v2)\nprevious_version: thought.md\n---\n\n# v2\n')
    library.editions.checked = None
    library.engagement.seen('Builder', [library.engagement.document('library/thought.md')])
    library.engagement.seen('Reviewer', [library.engagement.document('library/thought.v2.md')])
    assert library.edition_paths('library/thought.v2.md') == ['library/thought.md']
    rows = request('/api/readers?path=library/thought.v2.md')[1]['readers']
    assert sorted((r['participant'], r['state']) for r in rows) == [('Builder', 'earlier'), ('Reviewer', 'current')]
    rows = request('/api/readers?path=library/thought.md')[1]['readers']  # a newer version is not an earlier edition
    assert [(r['participant'], r['state']) for r in rows] == [('Builder', 'current')]


def test_standfirst_skips_frontmatter_heading_code_and_mermaid_and_is_bounded(web):
    root, library, server, request = web
    prose = ' '.join(f'word{i}' for i in range(80)) + '.'
    (root / 'library/cover.md').write_text('---\ntitle: Cover\n---\n\n# Cover\n\n> A quotation.\n\n```mermaid\ngraph TD; A-->B\n```\n\n```python\nprint("not prose")\n```\n\n| a | b |\n| - | - |\n\nProject: x · Date: y · By: z\n\n' + prose + '\n\nLater paragraph.\n')
    status, body, _ = request('/api/standfirst?path=library/cover.md')
    assert status == 200 and body['source'] == 'opening'
    assert body['standfirst'].startswith('word0 word1') and body['standfirst'].endswith('…')
    assert len(body['standfirst'].split()) == 60 and 'mermaid' not in body['standfirst'] and 'Project' not in body['standfirst']
    (root / 'library/written.md').write_text('---\nstandfirst: "A *written* standfirst wins."\n---\n\n# W\n\nThe opening paragraph is long enough to be prose for this test.\n')
    assert request('/api/standfirst?path=library/written.md')[1] == {'path': 'library/written.md', 'standfirst': 'A written standfirst wins.', 'source': 'frontmatter'}
    (root / 'library/list.md').write_text('# L\n\nThis note separates three kinds of statement and then lists them:\n\n- one\n')
    assert request('/api/standfirst?path=library/list.md')[1]['standfirst'] is None
    for path in ('../secret.md', 'inbox/x.md', 'library/../indexes/coverage.json', '/etc/passwd'):
        assert request('/api/standfirst?path=' + path)[0] == 400
    (root / 'outside.md').write_text('# Outside\n\nOutside prose that must never be read by the route.\n')
    (root / 'library/link.md').symlink_to(root / 'outside.md')
    assert request('/api/standfirst?path=library/link.md')[0] == 400


def test_issue_signals_newsletter_picks_and_window_limits(web):
    root, library, server, request = web
    (root / 'library/newsletters').mkdir()
    (root / 'library/newsletters/2026-10-19-weekly.md').write_text("---\ntitle: Weekly\nnewsletter_week_start: '2026-10-19'\nnewsletter_week_end: '2026-10-25'\n---\n\n# Weekly\n\nRead [this](../thought.md#part) and [elsewhere](https://example.invalid/x) and [missing](../nope.md).\n")
    (root / 'library/newsletters/2026-10-12-weekly.md').write_text("---\nnewsletter_week_start: '2026-10-12'\nnewsletter_week_end: '2026-10-18'\n---\n\n[other](../other.md)\n")
    status, body, _ = request('/api/issue?start=2026-10-19&end=2026-10-25')
    assert status == 200 and body['picks'] == ['library/thought.md'] and body['near'] == []
    assert [letter['path'] for letter in body['newsletters']] == ['library/newsletters/2026-10-19-weekly.md']
    assert body['candidates'] == 2
    assert request('/api/issue?start=2026-10-12&end=2026-10-25')[1]['picks'] == ['library/other.md', 'library/thought.md']
    for query in ('start=2026-10-25&end=2026-10-19', 'start=2026-01-01&end=2026-10-25', 'start=x&end=y', 'start=2026-02-30&end=2026-03-01'):
        assert request('/api/issue?' + query)[0] == 400
    rows = request('/api/library')[1]['works']
    assert {row['primary']: (row['voices'], row['threads']) for row in rows} == {'library/thought.md': (0, 0), 'library/other.md': (0, 0)}
    _, doc, _ = request('/api/document?path=library/thought.md')
    request('/api/seen', {'participant': 'Another voice', 'items': [doc['item']]})
    rows = {row['primary']: row for row in request('/api/library')[1]['works']}
    assert rows['library/thought.md']['voices'] == 1 and rows['library/other.md']['voices'] == 0
    assert {row['primary']: row['voices'] for row in request('/api/library?participant=Another%20voice')[1]['works']}['library/thought.md'] == 0


def test_editions_route_validates_paths_and_lists_families(web):
    root, library, server, request = web
    (root / 'library/thought.v2.md').write_text('---\ntitle: A quiet thought (v2)\nprevious_version: thought.md\n---\n\n# v2\n')
    library.editions.checked = None
    status, body, _ = request('/api/editions?path=library/thought.md')
    assert status == 200 and [e['path'] for e in body['family']] == ['library/thought.md', 'library/thought.v2.md']
    assert body['newer']['path'] == 'library/thought.v2.md' and body['family'][0]['current'] is True
    status, body, _ = request('/api/editions?path=library/other.md')
    assert status == 200 and len(body['family']) == 1 and body['newer'] is None
    for bad in ('library/../etc/passwd', 'catalog/metadata/x.md'):
        assert request('/api/editions?path=' + bad)[0] == 400
    assert request('/api/editions?path=library/missing.md')[0] == 404
    status, body, _ = request('/api/editions/diagnostics')
    assert status == 200 and body['stats']['families'] == 1 and body['unresolved'] == []


def test_changes_route_statuses_and_refusals(web):
    root, library, server, request = web
    status, body, _ = request('/api/changes?path=library/thought.md')
    assert status == 200 and body['status'] == 'unread' and body['others'] == []
    request('/api/seen', {'participant': 'Test reader', 'items': [library.engagement.document('library/thought.md')]})
    assert request('/api/changes?path=library/thought.md')[1]['status'] == 'unchanged'
    (root / 'library/thought.md').write_text('# Changed outside any git history\n')
    status, body, _ = request('/api/changes?path=library/thought.md')
    assert status == 200 and body['status'] == 'unavailable' and body['read_at']
    assert request('/api/changes?path=library/thought.md&against=Stranger')[0] == 400
    assert request('/api/changes?path=library/thought.md&successor=1')[0] == 400
    assert request('/api/changes?path=library/../x.md')[0] == 400


def test_discussion_loads_for_versioned_header_without_type(web):
    root, library, server, request = web
    (root / 'library/versioned.md').write_text('---\nfrontmatter_schema_version: 1\ndocument_revision: 2\ntitle: X\n---\n# X\n\nBody.\n')
    status, body, _ = request('/api/discussion?path=library/versioned.md')
    assert status == 200 and body['threads'] == []


def test_admission_classes_cover_every_expensive_route_and_leave_streams_out(web):
    from types import SimpleNamespace
    from reader_mcp.web import WebHandler
    _, _, server, request = web
    def gate(path, write=False):
        handler = SimpleNamespace(path=path, server=server)
        found, _ = WebHandler.admission(handler, write)
        return 'none' if found is None else 'expensive' if found is server.requests else 'read'
    for path in ('/', '/assets/app.mjs', '/assets/controls/diagrams.js', '/fonts/serif/font.css', '/api/health'):
        assert gate(path) == 'none', path
    for path in ('/api/search?q=x', '/api/search/page?q=x', '/api/next?path=a', '/api/prose', '/api/chat?id=x', '/api/chats?path=a', '/api/chat/raw?id=x&turn=y', '/api/service', '/api/quiz?path=a', '/api/prompt?path=a', '/api/writing?participant=x', '/api/readers?path=a'):
        assert gate(path) == 'expensive', path
    for path in ('/api/maintenance', '/api/local-model', '/api/inbox', '/api/prose', '/api/chat', '/api/seen', '/api/bookmark', '/api/service'):
        assert gate(path, write=True) == 'expensive', path
    for path in ('/api/library', '/api/document?path=a', '/api/discussion', '/api/resolve-batch?from=a', '/api/versions', '/api/links', '/api/file?path=a', '/api/maintenance', '/api/inbox/events?after=0'):
        assert gate(path) == 'read', path
    # The chat SSE stream never reaches admission, so a full expensive pool cannot starve it.
    held = 0
    while server.requests.acquire(blocking=False):
        held += 1
    try:
        assert request('/api/chats?path=library/thought.md')[0] == 429
        assert request('/api/quiz?path=library/thought.md')[0] == 429
        assert request('/api/prompt?path=library/thought.md')[0] == 429
        assert request('/api/writing?participant=Reader')[0] == 429
        assert request('/api/readers?path=library/thought.md')[0] == 429
        assert request('/api/chat/stream?id=not-a-uuid')[0] == 400  # answered by the stream route, not refused as busy
        assert request('/api/health')[0] == 200, 'health answers while the server is busy'
        reads = 0
        while server.reads.acquire(blocking=False):
            reads += 1
        try:
            # Identification comes first: an unknown proxied requester is refused (403), never queued or 429.
            assert request('/api/library', headers={'Host': 'elsewhere.example', 'X-Forwarded-For': '100.64.0.9'})[0] == 403
            assert request('/api/health')[0] == 200
        finally:
            for _ in range(reads):
                server.reads.release()
    finally:
        for _ in range(held):
            server.requests.release()


def test_static_assets_and_reads_are_not_refused_by_the_expensive_request_limit(web, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    import reader_mcp.web as webmod
    root, library, server, request = web
    held = 0
    while server.requests.acquire(blocking=False):
        held += 1  # simulate eight in-flight expensive requests
    assert held == webmod.EXPENSIVE_LIMIT
    try:
        with ThreadPoolExecutor(24) as pool:
            statuses = list(pool.map(lambda p: request(p, raw=True)[0], ['/', '/assets/app.mjs', '/assets/style.css', '/api/library', '/api/document?path=library/thought.md', '/api/discussion?path=library/thought.md'] * 4))
        assert statuses == [200] * 24
        status, body, _ = request('/api/search?q=thought')
        assert status == 429 and 'busy' in body['error']
    finally:
        for _ in range(held):
            server.requests.release()
    assert request('/api/search?q=thought')[0] == 200
    monkeypatch.setattr(webmod, 'READ_WAIT', 0.05)
    reads = 0
    while server.reads.acquire(blocking=False):
        reads += 1
    try:
        assert request('/api/library')[0] == 429
        assert request('/assets/app.mjs', raw=True)[0] == 200
    finally:
        for _ in range(reads):
            server.reads.release()
    assert request('/api/library')[0] == 200


TAILNET = 'reader-host.example-tailnet.ts.net'


def tailnet(login='user@example.com', **extra):
    """Headers as `tailscale serve` forwards them: the client's Host, X-Forwarded-*, identity."""
    headers = {'Host': TAILNET, 'X-Forwarded-Host': TAILNET, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '100.64.0.7'}
    if login is not None:
        headers['Tailscale-User-Login'] = login
    return headers | extra


def configure(root, **config):
    (root / '.reader').mkdir(exist_ok=True)
    (root / '.reader/web-config.json').write_text(json.dumps({'allowed_hosts': [TAILNET], 'allowed_origins': ['https://' + TAILNET],
                                                              'trusted_proxy': 'tailscale', 'allowed_logins': ['user@example.com']} | config))


def test_tailscale_identity_allows_only_listed_logins_on_every_route(web):
    root, library, server, request = web
    # Without a trusted proxy, forwarded requests are refused even with a valid-looking identity.
    assert request('/api/library', headers=tailnet())[0] == 403
    configure(root)
    status, body, _ = request('/api/library', headers=tailnet())
    assert status == 200 and body['token'] == server.token
    assert request('/api/library', headers=tailnet('User@Example.com'))[0] == 200
    status, body, headers = request('/', headers=tailnet(), raw=True)
    assert status == 200 and b'file-query' in body
    for login in (None, '', 'someone@example.net'):
        for path in ('/', '/assets/style.css', '/api/library', '/api/health', '/api/document?path=library/thought.md'):
            status, body, headers = request(path, headers=tailnet(login), raw=True)
            assert status == 403, (login, path)
            assert b'quiet thought' not in body and b'file-query' not in body
        status, body, headers = request('/', headers=tailnet(login), raw=True)
        assert headers['Content-Type'].startswith('text/html') and b'Not allowed' in body
        assert json.loads(request('/api/library', headers=tailnet(login), raw=True)[1])['error'] == 'Not allowed'
    # Funnel traffic is never accepted, even for an allowed login.
    assert request('/api/library', headers=tailnet(**{'Tailscale-Funnel-Request': '?1'}))[0] == 403
    # The identity is reported to the Server card; RFC 2047 names are decoded.
    status, body, _ = request('/api/service', headers=tailnet(**{'Tailscale-User-Name': '=?utf-8?q?Ad=C3=A9le?='}))
    assert status == 200 and body['identity'] == {'via': 'tailscale', 'login': 'user@example.com', 'name': 'Adéle'}
    assert request('/api/service')[1]['identity']['via'] == 'local'


def test_spoofed_identity_and_unknown_hosts_never_grant_access(web):
    root, library, server, request = web
    configure(root)
    port = server.server_port
    # A Tailscale identity header on a loopback Host does not make a tailnet identity: it is refused.
    status, body, _ = request('/api/service', headers={'Tailscale-User-Login': 'user@example.com'})
    assert status == 403
    # Tailscale passes the client's Host through, so a peer naming 127.0.0.1 is still proxied, and refused.
    assert request('/api/library', headers=tailnet() | {'Host': f'127.0.0.1:{port}'})[0] == 403
    assert request('/api/library', headers=tailnet() | {'Host': f'127.0.0.1:{port}', 'Tailscale-User-Login': ''})[0] == 403
    # Unknown names and a Host that disagrees with X-Forwarded-Host are refused.
    assert request('/api/library', headers=tailnet() | {'Host': 'other.example-tailnet.ts.net', 'X-Forwarded-Host': 'other.example-tailnet.ts.net'})[0] == 403
    assert request('/api/library', headers=tailnet() | {'X-Forwarded-Host': 'other.example-tailnet.ts.net'})[0] == 403
    assert request('/api/library', headers={'Host': TAILNET})[0] == 403
    # Local requests keep today's rules.
    assert request('/api/library')[0] == 200
    assert request('/api/library', headers={'Host': f'localhost:{port}'})[0] == 200
    assert request('/api/library', headers={'Host': 'untrusted.example'})[0] == 403


def test_tailnet_origin_is_accepted_for_writes_and_others_refused(web):
    root, library, server, request = web
    configure(root)
    _, doc, _ = request('/api/document?path=library/thought.md', headers=tailnet())
    seen = {'participant': 'Test reader', 'items': [doc['item']]}
    assert request('/api/seen', seen, tailnet(Origin='https://' + TAILNET))[0] == 200
    for origin in ('https://evil.example', 'http://' + TAILNET, f'http://127.0.0.1:{server.server_port}'):
        assert request('/api/seen', seen, tailnet(Origin=origin))[0] == 403
    assert request('/api/seen', seen, tailnet(Origin='https://' + TAILNET) | {'X-Reader-Token': 'wrong'})[0] == 403
    # The tailnet origin is not a local origin.
    assert request('/api/seen', seen, {'Origin': 'https://' + TAILNET})[0] == 403


def test_web_config_environment_overrides_and_unsafe_files(web):
    root, library, server, request = web
    library.access.environ = {'READER_WEB_TRUSTED_PROXY': 'tailscale', 'READER_WEB_ALLOWED_HOSTS': TAILNET,
                              'READER_WEB_ALLOWED_LOGINS': 'someone@example.net, user@example.com', 'READER_WEB_ALLOWED_ORIGINS': ''}
    assert request('/api/library', headers=tailnet())[0] == 200
    assert request('/api/library', headers=tailnet('someone@example.net'))[0] == 200
    library.access.environ = {}
    (root / '.reader').mkdir(exist_ok=True)
    (root / '.reader/web-config.json').write_text('{not json')
    assert request('/api/library', headers=tailnet())[0] == 403
    assert request('/api/library')[0] == 200, 'a broken config never locks out the local user'
    (root / '.reader/web-config.json').unlink()
    (root / 'elsewhere.json').write_text(json.dumps({'trusted_proxy': 'tailscale', 'allowed_hosts': [TAILNET], 'allowed_logins': ['user@example.com']}))
    (root / '.reader/web-config.json').symlink_to(root / 'elsewhere.json')
    assert request('/api/library', headers=tailnet())[0] == 403
    (root / '.reader/web-config.json').unlink()
    configure(root, trusted_proxy='nginx')
    assert request('/api/library', headers=tailnet())[0] == 403


FRONT_SECRET = 'front-secret-' + 'x' * 40


def front(identity=None, secret=FRONT_SECRET, **extra):
    """Headers as the trusted front forwards them: the client's Host and Origin, the secret and identity."""
    headers = {} if secret is None else {'X-Reader-Front-Secret': secret}
    if identity is not None:
        headers['X-Reader-Identity'] = identity if isinstance(identity, str) else json.dumps(identity)
    return headers | extra


LOCAL = {'via': 'local', 'login': None, 'name': None}
PEER = {'via': 'tailscale', 'login': 'user@example.com', 'name': 'A Tester'}


def test_front_headers_are_ignored_without_a_configured_secret(web):
    root, library, server, request = web
    # Off by default: a client-sent identity or secret neither elevates nor refuses a local request.
    for headers in (front(PEER), front(PEER, secret='guess'), front('not json'), front(PEER, secret=None)):
        status, body, _ = request('/api/service', headers=headers)
        assert status == 200 and body['identity'] == LOCAL, headers
    item = request('/api/document?path=library/thought.md', headers=front(PEER))[1]['item']
    assert request('/api/seen', {'participant': 'Test reader', 'items': [item]}, front(PEER))[0] == 200
    # And a forwarded request with front headers keeps today's proxy rules.
    assert request('/api/library', headers=tailnet() | front(PEER))[0] == 403


def test_a_configured_front_secret_admits_only_the_front(web):
    root, library, server, request = web
    library.access.environ = {'READER_WEB_FRONT_SECRET': FRONT_SECRET}
    status, body, _ = request('/api/service', headers=front(LOCAL))
    assert status == 200 and body['identity'] == LOCAL
    # No secret, a wrong one, or a right one without identity is a 403, assets and pages included.
    for headers in ({}, front(LOCAL, secret=None), front(LOCAL, secret='wrong'), front(LOCAL, secret=FRONT_SECRET[:-1]),
                    front(LOCAL, secret=FRONT_SECRET + 'x'), front(None), front('not json'), front('[]'),
                    front({'via': 'root', 'login': None, 'name': None}), front(LOCAL | {'extra': 1}),
                    front({'via': 'local', 'login': 'user@example.com', 'name': None}),
                    front({'via': 'tailscale', 'login': '', 'name': None})):
        for path in ('/api/service', '/', '/assets/style.css'):
            status, body, _ = request(path, headers=headers, raw=True)
            assert status == 403, (headers, path)
            assert FRONT_SECRET.encode() not in body
    # A tailscale identity sent without the secret never elevates; it is refused like any other direct request.
    configure(root)
    assert request('/api/service', headers=tailnet() | front(PEER, secret=None))[0] == 403


def test_front_identity_survives_the_hop_and_keeps_host_origin_and_token_checks(web):
    root, library, server, request = web
    library.access.environ = {'READER_WEB_FRONT_SECRET': FRONT_SECRET}
    port = 8766  # The front's public port, not the child's: Host and Origin are the client's.
    local = front(LOCAL, Host=f'127.0.0.1:{port}')
    assert request('/api/service', headers=local)[1]['identity'] == LOCAL
    assert request('/api/service', headers=front(LOCAL, Host=f'localhost:{port}', Origin=f'http://localhost:{port}'))[0] == 200
    for bad in ({'Host': 'untrusted.example'}, {'Host': TAILNET}, {'Origin': 'http://evil.example'},
                {'Origin': f'http://localhost:{port}'}):
        assert request('/api/service', headers=local | bad)[0] == 403, bad
    # A tailnet identity needs the same configuration as a direct tailscale request.
    peer = front(PEER, Host=TAILNET)
    assert request('/api/service', headers=peer)[0] == 403
    configure(root)
    status, body, _ = request('/api/service', headers=peer)
    assert status == 200 and body['identity'] == PEER
    for bad in ({'Host': 'other.example-tailnet.ts.net'}, {'Origin': 'https://evil.example'},
                {'X-Reader-Identity': json.dumps(PEER | {'login': 'someone@example.net'})}, {'Tailscale-Funnel-Request': '?1'}):
        assert request('/api/service', headers=peer | bad)[0] == 403, bad
    # The identity reaches handlers: a tailnet peer still may not choose companion executables.
    assert request('/api/companions', {'action': 'set-path', 'name': 'colorful', 'path': '/bin/true'}, peer)[0] == 403
    # Writes still need the token and JSON.
    seen = {'participant': 'Test reader', 'items': [request('/api/document?path=library/thought.md', headers=peer)[1]['item']]}
    assert request('/api/seen', seen, peer | {'Origin': 'https://' + TAILNET})[0] == 200
    assert request('/api/seen', seen, peer | {'X-Reader-Token': 'wrong'})[0] == 403
    assert request('/api/seen', seen, local | {'Content-Type': 'text/plain'})[0] == 403


def test_the_front_supplies_the_write_token_and_bad_settings_fail_closed(tmp_path):
    library = WebLibrary(tmp_path, service_runner=lambda argv: {'installed': False})
    token = 'front-token-' + 'y' * 40
    library.access.environ = {'READER_WEB_FRONT_TOKEN': token}
    assert WebServer(('127.0.0.1', 0), library).token != token, 'the front token needs the front secret'
    library.access.environ = {'READER_WEB_FRONT_SECRET': FRONT_SECRET, 'READER_WEB_FRONT_TOKEN': token}
    server = WebServer(('127.0.0.1', 0), library)
    assert server.token == token
    server.server_close()
    for environ in ({'READER_WEB_FRONT_SECRET': 'tiny-value'}, {'READER_WEB_FRONT_SECRET': FRONT_SECRET, 'READER_WEB_FRONT_TOKEN': 'tiny-value'}):
        library.access.environ = environ
        with pytest.raises(ValueError) as error:
            WebServer(('127.0.0.1', 0), library)
        assert 'tiny-value' not in str(error.value) and FRONT_SECRET not in str(error.value)


def test_health_and_service_routes(web):
    root, library, server, request = web
    status, body, _ = request('/api/health')
    assert status == 200 and body['status'] == 'ok' and body['busy'] == [] and body['started_at'] == server.started_at
    assert body['commit'] is None or len(body['commit']) in (40, 64)
    calls = []
    def runner(argv):
        calls.append(argv)
        if argv[0] == 'status':
            return {'installed': True, 'commit': 'a' * 40, 'source': 'preview/integration'}
        return {'requested': True}
    library.service.runner = runner
    status, body, _ = request('/api/service')
    assert status == 200 and body['service']['source'] == 'preview/integration' and body['health']['status'] == 'ok'
    assert request('/api/service', {'action': 'update'})[1] == {'requested': True, 'action': 'update'}
    assert request('/api/service', {'action': 'restart'})[0] == 200
    assert request('/api/service', {'action': 'pause'})[0] == 200
    assert calls[1:] == [['request-update'], ['restart', '--detach'], ['pause']]
    assert request('/api/service', {'action': 'rm -rf'})[0] == 400
    assert request('/api/service', {'action': 'update', 'extra': 1})[0] == 400
    assert request('/api/service', {'action': 'update'}, {'X-Reader-Token': 'wrong'})[0] == 403
    def failing(argv):
        raise ValueError('Reader service is not installed')
    library.service.runner = failing
    assert request('/api/service')[1]['service'] == {'installed': False, 'error': 'Reader service is not installed'}
    assert request('/api/service', {'action': 'update'})[0] == 400


def test_health_reports_active_inbox_runs_and_jobs(web):
    import fcntl
    root, library, server, request = web
    (root / '.reader/inbox-runner').mkdir(parents=True)
    lock = root / '.reader/inbox-runner/run.lock'
    lock.write_text('')
    assert request('/api/health')[1]['busy'] == []
    with lock.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        assert request('/api/health')[1]['busy'] == [{'kind': 'inbox', 'label': 'Inbox run'}]
    assert request('/api/health')[1]['busy'] == []


def test_manifest_and_icons_are_served(web):
    root, library, server, request = web
    status, body, headers = request('/assets/manifest.webmanifest', raw=True)
    assert status == 200 and headers['Content-Type'] == 'application/manifest+json'
    manifest = json.loads(body)
    assert manifest['display'] == 'standalone' and manifest['start_url'] == '/'
    for icon in manifest['icons']:
        status, body, headers = request(icon['src'], raw=True)
        assert status == 200 and headers['Content-Type'] == icon['type'] and body[:8] == b'\x89PNG\r\n\x1a\n'
    _, page, _ = request('/', raw=True)
    assert b'rel="manifest"' in page and b'apple-touch-icon' in page and b'name="theme-color"' in page


def test_missing_document_is_a_clear_404_and_other_refusals_stay_400(web):
    root, library, server, request = web
    for route in ['/api/document?path=library/no-such-folder/missing.md', '/api/file?path=library/missing.md']:
        status, body, _ = request(route)
        assert status == 404 and 'No document at this path' in body['error'] and '256 MiB' not in body['error']
    (root / 'library/folder.md').mkdir()
    assert request('/api/document?path=library/folder.md')[0] == 400
    assert request('/api/document?path=library/../outside')[0] == 400
    # Link resolution still treats a missing candidate as "try the next one".
    assert request('/api/resolve?from=library/thought.md&target=other.md')[1]['path'] == 'library/other.md'
