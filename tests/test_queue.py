"""Reading queue and history: actions, idempotency, voices, suggestions, history joins and caps."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from http.client import HTTPConnection
import threading
from uuid import uuid4

import pytest

from reader_mcp import reading_queue
from reader_mcp.web import WebLibrary, WebServer
from test_related import index


def rid():
    return str(uuid4())


def make_vault(root, works):
    for name in ('library', 'inbox', 'indexes'):
        (root / name).mkdir(exist_ok=True)
    rows = []
    for name, title, project, date, *topics in works:
        path = f'library/{name}.md'
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(f'# {title}\n\nSynthetic text for {name}.\n')
        rows.append(dict(id=path, title=title, primary=path, authors=['Ada'], topics=topics or ['T'], projects=[project], date=date,
                         primary_format='.md', primary_bytes=600))
    (root / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': rows}))
    return WebLibrary(root)


WORKS = [('a', 'Alpha', 'P', '2026-10-01'), ('b', 'Beta', 'P', '2026-10-02'), ('c', 'Gamma', 'P', '2026-10-03'),
         ('d', 'Delta', 'P', '2026-10-04'), ('e', 'Epsilon', 'Q', '2026-10-05'), ('f', 'Zeta', 'P', '2026-10-06')]


@pytest.fixture
def lib(tmp_path):
    return make_vault(tmp_path, WORKS)


def paths(view, key='queued'):
    return [row['path'] for row in view[key]]


def test_add_move_remove_pin_clear_and_request_idempotency(lib):
    q = lib.queue
    first = rid()
    q.change('You', 'add', 'library/a.md', request_id=first)
    q.change('You', 'add', 'library/a.md', request_id=first)  # a retry
    q.change('You', 'add', 'library/b.md', request_id=rid())
    q.change('You', 'add', 'library/c.md', request_id=rid())
    record = q.load('You')
    assert [i['path'] for i in record['items']] == ['library/a.md', 'library/b.md', 'library/c.md']
    assert record['requests'].count(first) == 1
    move = rid()
    q.change('You', 'move', 'library/c.md', index=0, request_id=move)
    q.change('You', 'move', 'library/c.md', index=2, request_id=move)  # repeated id: not applied again
    assert [i['path'] for i in q.load('You')['items']] == ['library/c.md', 'library/a.md', 'library/b.md']
    q.change('You', 'remove', 'library/a.md', request_id=rid())
    assert [i['path'] for i in q.load('You')['items']] == ['library/c.md', 'library/b.md']
    q.change('You', 'pin', 'library/d.md', reason='Because you read Alpha', request_id=rid())
    record = q.load('You')
    assert record['items'][-1]['path'] == 'library/d.md' and record['items'][-1]['pinned_at']
    q.change('You', 'clear', request_id=rid())
    assert q.load('You')['items'] == []
    other = q.load('Someone else')
    assert other['items'] == [] and other['participant'] == 'Someone else'
    with pytest.raises(ValueError):
        q.change('You', 'add', 'library/a.md', request_id='not-a-uuid')
    with pytest.raises(ValueError):
        q.change('You', 'move', 'library/e.md', index=0, request_id=rid())
    file = lib.root / 'queues' / (hashlib.sha256(b'You').hexdigest() + '.json')
    assert json.loads(file.read_text())['schema_version'] == 1 and not list((lib.root / 'queues').glob('.queue-*'))


def test_writes_hold_the_shared_vault_lock(lib, monkeypatch):
    held = []
    original = lib.queue.annotations.locked

    def spy():
        held.append(True)
        return original()
    monkeypatch.setattr(lib.queue.annotations, 'locked', spy)
    lib.queue.change('You', 'add', 'library/a.md', request_id=rid())
    lib.queue.opened('You', 'library/b.md', lib.digest('library/b.md'))
    lib.queue.hide('You', 'library/b.md')
    assert len(held) == 3


def test_voice_items_stay_suggested_until_pinned(lib):
    q = lib.queue
    with pytest.raises(ValueError, match='reason'):
        q.change('You', 'add', 'library/e.md', added_by='Agy', request_id=rid())
    q.change('You', 'add', 'library/a.md', request_id=rid())
    q.change('You', 'add', 'library/e.md', added_by='Agy', reason='The effector boundary, again', request_id=rid())
    view = lib.queue_view('You')
    assert paths(view) == ['library/a.md']
    voice = view['suggested'][0]
    assert voice['path'] == 'library/e.md' and voice['added_by'] == 'Agy' and voice['source'] == 'voice'
    assert voice['reason'] == 'The effector boundary, again'
    q.change('You', 'add', 'library/a.md', added_by='Agy', reason='Also good', request_id=rid())
    assert lib.queue.load('You')['items'][0]['added_by'] == 'You', 'a voice never takes over your item'
    q.change('You', 'pin', 'library/e.md', request_id=rid())
    view = lib.queue_view('You')
    assert paths(view) == ['library/a.md', 'library/e.md']
    assert view['queued'][1]['added_by'] == 'Agy', 'provenance is kept after pinning'
    assert 'library/e.md' not in paths(view, 'suggested')


def test_suggestions_exclude_queued_finished_and_editions_and_include_another_project(tmp_path):
    works = WORKS + [('a2', 'Alpha (corrected)', 'P', '2026-10-07'), ('copy', 'Copy of Alpha', 'P', '2026-10-08'),
                     ('far', 'Far away', 'R', '2026-09-01', 'U'), ('near', 'Near neighbour', 'R', '2026-09-02', 'U')]
    works += [(f'x{i}', f'Filler {i}', 'P', '2026-01-01') for i in range(30)]
    lib = make_vault(tmp_path, works)
    vectors = {f'library/{n}.md': v for n, v in {
        'a': [1, 0, 0, 0], 'b': [.9, .1, 0, 0], 'c': [.8, .6, 0, 0], 'd': [.7, .3, 0, 0], 'e': [0, 0, 1, 0],
        'f': [.6, .4, 0, 0], 'a2': [.95, .05, 0, 0], 'copy': [1, .001, 0, 0], 'far': [0, 0, 0, 1], 'near': [.97, 0, 0, .243]}.items()}
    vectors |= {f'library/x{i}.md': [0, 1, 0, 0] for i in range(30)}
    index(tmp_path, vectors)
    lib.queue.opened('You', 'library/a.md', lib.digest('library/a.md'))
    lib.queue.change('You', 'add', 'library/b.md', request_id=rid())
    lib.bookmarks.save('You', 'library/c.md', lib.digest('library/c.md'), 1.0)
    view = lib.queue_view('You')
    suggested = paths(view, 'suggested')
    assert 'library/b.md' not in suggested, 'already queued'
    assert 'library/c.md' not in suggested, 'already finished'
    assert 'library/a.md' not in suggested and 'library/a2.md' not in suggested, 'the seed and its other edition'
    assert 'library/copy.md' not in suggested, 'near-identical text is another edition of the seed'
    reasons = {row['path']: row['reason'] for row in view['suggested']}
    others = [p for p, r in reasons.items() if r.startswith('From another project')]
    assert others == ['library/near.md'] and reasons['library/near.md'] == 'From another project · like Alpha', reasons
    assert any(r == 'Because you read Alpha' for r in reasons.values())
    assert len(suggested) == len(set(suggested)) <= 10
    lib.queue.change('You', 'remove', 'library/d.md', request_id=rid())
    assert 'library/d.md' not in paths(lib.queue_view('You'), 'suggested'), 'dismissed suggestions stay away'


def test_without_history_suggestions_are_new_unread_works_and_receipts_seed_them(lib):
    view = lib.queue_view('You')
    assert view['now'] is None
    assert paths(view, 'suggested')[:2] == ['library/f.md', 'library/e.md']
    assert all(row['reason'] in ('New in P', 'New in Q') for row in view['suggested'])
    lib.engagement.seen('You', [lib.engagement.document('library/f.md')])
    view = lib.queue_view('You')
    assert view['now']['path'] == 'library/f.md' and view['now']['resume'] is True, 'pick up where you left off'
    suggested = paths(view, 'suggested')
    assert 'library/f.md' not in suggested and suggested[0] == 'library/d.md'
    assert view['suggested'][0]['reason'] == 'Because you read Zeta'


def test_history_joins_opens_bookmarks_and_receipts_groups_by_day_and_hides(lib):
    q = lib.queue
    lib.engagement.seen('You', [lib.engagement.document('library/a.md')])
    q.change('You', 'add', 'library/b.md', request_id=rid())
    q.opened('You', 'library/b.md', lib.digest('library/b.md'))
    assert lib.queue.load('You')['items'] == [], 'opening takes it out of Up next'
    lib.bookmarks.save('You', 'library/b.md', lib.digest('library/b.md'), .62)
    q.opened('You', 'library/c.md', lib.digest('library/c.md'))
    lib.bookmarks.save('You', 'library/c.md', lib.digest('library/c.md'), 1.0)
    # An open from two days ago, written as the log would hold it.
    log = lib.root / 'history' / (hashlib.sha256(b'You').hexdigest() + '.jsonl')
    old = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    with log.open('a') as stream:
        stream.write(json.dumps({'path': 'library/d.md', 'sha256': '0' * 64, 'at': old}) + '\n{"torn":\n')
    view = lib.history_view('You')
    rows = [row for day in view['days'] for row in day['items']]
    assert [r['path'] for r in rows] == ['library/c.md', 'library/b.md', 'library/a.md', 'library/d.md']
    assert view['days'][0]['date'] == view['today'] and len(view['days']) == 2
    by = {r['path']: r for r in rows}
    assert by['library/b.md']['progress'] == .62 and not by['library/b.md']['finished']
    assert by['library/c.md']['finished'] and by['library/c.md']['words'] == 100
    assert by['library/d.md']['changed'] is True and by['library/a.md']['changed'] is False
    assert [r['path'] for d in lib.history_view('You', finished=True)['days'] for r in d['items']] == ['library/c.md']
    receipts = lib.engagement.receipts()[0]['items']
    q.hide('You', 'library/a.md')
    assert 'library/a.md' not in [r['path'] for d in lib.history_view('You')['days'] for r in d['items']]
    assert lib.engagement.receipts()[0]['items'] == receipts, 'hiding never deletes a receipt'
    q.opened('You', 'library/a.md', lib.digest('library/a.md'))
    assert lib.history_view('You')['days'][0]['items'][0]['path'] == 'library/a.md', 'opening again brings it back'
    assert '"text"' not in log.read_text() and 'Synthetic text' not in log.read_text()


def test_history_pages_and_local_days(lib):
    for name in 'abcdef':
        lib.queue.opened('You', f'library/{name}.md', lib.digest(f'library/{name}.md'))
    page = lib.history_view('You', tz=840)
    assert page['total'] == 6 and page['next_cursor'] is None and page['days'][0]['date'] == page['today']
    with pytest.raises(ValueError):
        lib.history_view('You', tz=9999)


def test_caps_are_enforced(lib, monkeypatch):
    monkeypatch.setattr(reading_queue, 'QUEUE_ITEMS', 2)
    lib.queue.change('You', 'add', 'library/a.md', request_id=rid())
    lib.queue.change('You', 'add', 'library/b.md', request_id=rid())
    with pytest.raises(ValueError, match='at most'):
        lib.queue.change('You', 'add', 'library/c.md', request_id=rid())
    monkeypatch.setattr(reading_queue, 'QUEUE_BYTES', 400)
    with pytest.raises(ValueError, match='64 KiB'):
        lib.queue.change('You', 'remove', 'library/a.md', request_id=rid())
    monkeypatch.setattr(reading_queue, 'QUEUE_BYTES', 64 * 1024)
    with pytest.raises(ValueError):
        lib.queue.change('You', 'add', 'library/a.md', added_by='Agy', reason='x' * 301, request_id=rid())
    monkeypatch.setattr(reading_queue, 'HISTORY_LINES', 6)
    monkeypatch.setattr(reading_queue, 'HISTORY_KEEP', 4)
    digest = {n: lib.digest(f'library/{n}.md') for n in 'abcdef'}
    for _ in range(3):
        for name in 'abc':
            lib.queue.opened('You', f'library/{name}.md', digest[name])
    events = lib.queue.events('You')
    assert len(events) <= 6
    assert sorted(e['path'] for e in events[-3:]) == ['library/a.md', 'library/b.md', 'library/c.md']
    for name in 'abcdef':
        lib.queue.opened('You', f'library/{name}.md', digest[name])
    assert len(lib.queue.events('You')) <= 6
    assert [r[0] for r in lib.history_rows('You')[:2]] == ['library/f.md', 'library/e.md']


def test_inbox_historical_and_unsafe_paths_are_refused(lib):
    (lib.root / 'inbox/preview.md').write_text('# Preview\n')
    for path in ('inbox/preview.md', 'library/../inbox/preview.md', 'library/a.md?version=1', 'library/missing.md', '/etc/passwd'):
        with pytest.raises(ValueError):
            lib.queue.change('You', 'add', path, request_id=rid())
        with pytest.raises(ValueError):
            lib.queue.opened('You', path, '0' * 64)
    (lib.root / 'library/link.md').symlink_to(lib.root / 'library/a.md')
    with pytest.raises(ValueError):
        lib.queue.change('You', 'add', 'library/link.md', request_id=rid())
    assert not (lib.root / 'queues').exists() or lib.queue.load('You')['items'] == []


def test_routes(lib):
    server = WebServer(('127.0.0.1', 0), lib, 'You')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(path, payload=None, token=None):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
        connection.request('POST' if payload is not None else 'GET', path, json.dumps(payload) if payload is not None else None,
                           {'Content-Type': 'application/json', 'X-Reader-Token': token or server.token})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result
    try:
        status, body = request('/api/queue', {'action': 'add', 'path': 'library/a.md', 'request_id': rid()})
        assert status == 200 and paths(body) == ['library/a.md'] and body['updated_at']
        assert request('/api/queue', {'action': 'add', 'path': 'library/b.md', 'request_id': rid()}, token='wrong')[0] == 403
        assert request('/api/queue', {'action': 'add', 'path': 'inbox/x.md', 'request_id': rid()})[0] == 400
        assert request('/api/queue', {'action': 'add', 'path': 'library/b.md', 'request_id': rid(), 'surprise': 1})[0] == 400
        status, body = request('/api/queue?participant=You&current=library/c.md')
        assert status == 200 and body['now']['path'] == 'library/c.md' and paths(body) == ['library/a.md']
        assert request('/api/history', {'action': 'open', 'path': 'library/a.md', 'sha256': '0' * 64})[0] == 400
        status, body = request('/api/history', {'action': 'open', 'path': 'library/a.md', 'sha256': lib.digest('library/a.md')})
        assert status == 200
        status, body = request('/api/history?participant=You&tz=-420')
        assert status == 200 and body['days'][0]['items'][0]['path'] == 'library/a.md'
        assert request('/api/queue?participant=You')[1]['queued'] == []
        assert request('/api/history', {'action': 'hide', 'path': 'library/a.md'})[0] == 200
        assert request('/api/history?participant=You')[1]['total'] == 0
        assert request('/api/history?cursor=-1')[0] == 400
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_cli_queue_add_for_voices(lib, capsys, monkeypatch):
    from reader_mcp import cli
    monkeypatch.setattr('sys.argv', ['reader', '--root', str(lib.root), 'queue', 'add', 'library/e.md', '--participant', 'You', '--by', 'Agy', '--reason', 'Read this beside Alpha'])
    cli.main()
    out = json.loads(capsys.readouterr().out)
    assert out['suggested'][0]['path'] == 'library/e.md' and out['suggested'][0]['added_by'] == 'Agy'
    monkeypatch.setattr('sys.argv', ['reader', '--root', str(lib.root), 'queue', 'add', 'library/e.md', '--participant', 'You', '--by', 'Agy'])
    with pytest.raises(SystemExit):
        cli.main()
    monkeypatch.setattr('sys.argv', ['reader', '--root', str(lib.root), 'queue', 'list', '--participant', 'You'])
    cli.main()
    assert json.loads(capsys.readouterr().out)['queued'] == []
