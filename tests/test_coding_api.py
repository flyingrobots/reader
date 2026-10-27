"""The coding-job HTTP surface (RW-44): admission rules, read-only views, the event stream with its cursor,
bounded archive reads, the LLM log inventory and the repository registry. Uses the real Git fixture and
the fake GitHub; nothing reaches the network."""
from http.client import HTTPConnection
import json
import socket
import threading
import time

import pytest

from coding_fixture import World
from reader_mcp.web import WebLibrary, WebServer


@pytest.fixture
def site(tmp_path):
    world = World(tmp_path)
    world.jobs.close()
    library = WebLibrary(world.vault, service_runner=lambda argv: {'installed': False},
                         coding_options={'github': world.github, 'environ': world.environ, 'git_locks': False, 'limits': False,
                                         'capacity': lambda path: True})
    world.jobs = library.jobs
    server = WebServer(('127.0.0.1', 0), library, 'Test reader')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(path, payload=None, headers=None):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=30)
        h = {'Content-Type': 'application/json', 'X-Reader-Token': server.token}
        h.update(headers or {})
        connection.request('POST' if payload is not None else 'GET', path, json.dumps(payload) if payload is not None else None, h)
        response = connection.getresponse()
        body = json.loads(response.read())
        connection.close()
        return response.status, body
    yield world, server, request
    server.shutdown()
    server.server_close()
    library.close()
    thread.join(timeout=5)


def finished(request, run_id, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status, run = request('/api/jobs/run?id=' + run_id)
        if run.get('status') == 'finished':
            return run
        time.sleep(0.1)
    raise AssertionError('run did not finish')


def sse(server, path, limit=4 * 1024**2):
    with socket.create_connection(('127.0.0.1', server.server_port), timeout=30) as connection:
        connection.sendall(f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{server.server_port}\r\n\r\n'.encode())
        data = b''
        while b'event: end' not in data and len(data) < limit:
            chunk = connection.recv(65536)
            if not chunk:
                break
            data += chunk
    frames = []
    for block in data.split(b'\r\n\r\n', 1)[-1].decode().split('\n\n'):
        fields = dict(line.split(': ', 1) for line in block.splitlines() if ': ' in line)
        if 'event' in fields:
            frames.append((fields['event'], fields.get('id'), json.loads(fields['data'])))
    return frames


def test_the_api_admits_by_request_and_streams_one_run_to_every_view(site):
    world, server, request = site
    status, actions = request('/api/jobs/actions?path=' + world.doc)
    assert status == 200 and actions['enabled'] and [b['id'] for b in actions['blocks']] == ['bound-parser-depth']
    body = world.request()
    status, admitted = request('/api/jobs', body)
    assert status == 200 and admitted['status'] == 'queued'
    assert request('/api/jobs', body)[1]['id'] == admitted['id']
    run = finished(request, admitted['id'])
    assert run['outcome'] == 'pr_opened' and run['pr']['url'].startswith('https://github.com/acme/widget/pull/')
    # The article and admin read the same run: by block, by repository and by ID.
    assert [r['id'] for r in request('/api/jobs/actions?path=' + world.doc)[1]['blocks'][0]['runs']] == [admitted['id']]
    assert [r['id'] for r in request('/api/jobs?repo=acme/widget')[1]['runs']] == [admitted['id']]
    assert request('/api/jobs?state=failed')[1]['runs'] == []
    # Events page from a cursor, from the archive after the run is sealed.
    status, page = request(f'/api/jobs/events?id={admitted["id"]}&after=3&limit=2')
    assert status == 200 and [e['seq'] for e in page['events']] == [4, 5] and page['more'] and page['source'] == 'archive'
    # A reload resumes the stream after its cursor: hello, the remaining frames with ids, then end.
    frames = sse(server, f'/api/jobs/stream?id={admitted["id"]}&after={run["seq"] - 2}')
    assert frames[0][0] == 'hello' and frames[-1][0] == 'end'
    assert [int(i) for kind, i, _ in frames if kind == 'event'] == [run['seq'] - 1, run['seq']]
    assert frames[-2][2]['type'] == 'outcome'


def test_writes_need_the_token_json_and_a_local_requester(site):
    world, server, request = site
    assert request('/api/jobs', world.request(), {'X-Reader-Token': 'wrong'})[0] == 403
    assert world.jobs.store.runs() == []
    proxied = {'X-Forwarded-For': '100.64.0.1', 'Host': 'reader.example.ts.net'}
    assert request('/api/repositories', {'action': 'check'}, proxied)[0] == 403
    with pytest.raises(PermissionError):
        world.jobs.configure({'action': 'check'}, {'via': 'tailscale', 'login': 'someone@example.com'})
    assert request('/api/jobs', {'action': 'submit', 'request_id': 'not-a-uuid'})[0] == 400
    status, refused = request('/api/jobs', world.request(sha256='0' * 64))
    assert status == 409 and refused['code'] == 'stale'
    status, refused = request('/api/jobs', world.request(block_id='example'))
    assert status == 409 and refused['code'] == 'missing-block'


def test_bounded_artifact_reads_and_the_llm_log_inventory(site):
    world, server, request = site
    _, admitted = request('/api/jobs', world.request())
    run = finished(request, admitted['id'])
    status, artifact = request(f'/api/jobs/artifact?id={run["id"]}&name=system.txt&limit=1024')
    assert status == 200 and artifact['truncated'] and len(artifact['text'].encode()) <= 1024 and artifact['bytes'] is None
    assert request(f'/api/jobs/artifact?id={run["id"]}&name=../meta.json')[0] == 400
    whole = request(f'/api/jobs/artifact?id={run["id"]}&name=prompt.txt')[1]
    assert whole['text'] == world.request()['prompt'] and not whole['truncated']
    status, logs = request('/api/logs?kind=coding-job')
    assert status == 200 and [r['run_id'] for r in logs['runs']] == [run['id']] and logs['runs'][0]['sealed']
    assert logs['retention'] == 'forever' and 'coding-job' in logs['kinds']
    status, detail = request('/api/logs/run?path=' + run['log'])
    assert status == 200 and 'events.jsonl' in detail['artifacts'] and detail['meta']['status'] == 'pr_opened'
    assert request('/api/logs/artifact?path=' + run['log'] + '&name=prompt.txt')[1]['text'] == whole['text']
    assert request('/api/logs/run?path=logs/llm/coding-job/../../x')[0] == 400
    for body in (json.dumps(detail), json.dumps(logs), json.dumps(run)):
        assert str(world.vault) not in body


def test_the_registry_is_shown_without_host_folders_and_validated_on_registration(site, monkeypatch):
    world, server, request = site
    monkeypatch.setenv('HOME', str(world.tmp))
    status, registry = request('/api/repositories?check=1')
    [row] = registry['repositories']
    assert status == 200 and row['repo'] == 'acme/widget' and row['problems'] == []
    assert row['checkout'] == '~/checkout' and row['worktree_root'] == '~/worktrees'
    entry = dict(world.entry, checkout=str(world.checkout))
    status, refused = request('/api/repositories', {'action': 'register', 'repo': 'acme/other', 'entry': entry})
    assert status == 400 and 'is not github.com/acme/other' in refused['error']
    status, refused = request('/api/repositories', {'action': 'register', 'repo': 'acme/widget', 'entry': dict(entry, worktree_root=str(world.vault))})
    assert status == 400 and 'outside the Reader vault' in refused['error']
    status, refused = request('/api/repositories', {'action': 'register', 'repo': 'acme/widget', 'entry': dict(entry, command='rm -rf /')})
    assert status == 400 and 'unknown registry fields' in refused['error']
    status, ok = request('/api/repositories', {'action': 'register', 'repo': 'acme/widget', 'entry': entry})
    assert status == 200 and ok['registered'] == 'acme/widget'
    assert request('/api/repositories', {'action': 'remove', 'repo': 'acme/widget'})[1]['repositories'] == []
    assert request('/api/jobs/actions?path=' + world.doc)[1]['blocks'][0]['registered'] is False


def test_a_second_server_serves_jobs_read_only(site):
    world, server, request = site
    _, admitted = request('/api/jobs', world.request())
    finished(request, admitted['id'])
    other = world.make()
    assert not other.own(), 'one server per vault owns coding jobs'
    view = other.detail(admitted['id'])
    assert view['read_only'] and not view['can_stop'] and view['outcome'] == 'pr_opened'
    from reader_mcp.coding_jobs import JobsOwned
    with pytest.raises(JobsOwned):
        other.dispatch(world.request())
    assert other.actions(world.doc)['read_only']


@pytest.mark.parametrize('after', ['%C2%B2', '%D9%A3', '-1', '1e3'])
def test_the_job_stream_refuses_a_cursor_that_is_not_ascii_digits(site, after):
    from http.client import HTTPConnection
    w, server, request = site
    run, _ = w.run()
    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
    try:
        connection.request('GET', '/api/jobs/stream?id=' + run['id'] + '&after=' + after)
        response = connection.getresponse()
        response.read()
        assert response.status == 400
    finally:
        connection.close()
