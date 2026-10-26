"""One Reader server owns chat per vault (#20, #72): the supervisor lock, read-only secondaries and quiet recovery."""
from http.client import HTTPConnection
import json
from pathlib import Path
import random
import sys
import threading
import time
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from chat_vault import make_vault  # noqa: E402

from reader_mcp import voice_runner
from reader_mcp.voice_runner import Conversations
from reader_mcp.web import WebLibrary, WebServer

OWNED = 'Another Reader server owns chat for this vault'


def documents(root):
    def lookup(path, inline=False):
        import hashlib
        data = (Path(root) / path).read_bytes()
        return {'path': path, 'title': Path(path).stem, 'sha256': hashlib.sha256(data).hexdigest(), 'text': data.decode() if inline else None}
    return lookup


def service(root):
    return Conversations(root, documents(root), rng=random.Random(7), git_locks=False)


@pytest.fixture
def vault(tmp_path):
    return make_vault(tmp_path / 'vault')


def unfinished_state(vault, chat_id):
    """A state.json that names one queued turn: a recovering server would mark it failed and rewrite the file."""
    runtime = vault / '.reader/voice-runner'
    runtime.mkdir(parents=True, exist_ok=True)
    turn_id = str(uuid4())
    state = runtime / 'state.json'
    state.write_text(json.dumps({'updated_at': '2026-01-01T00:00:00+00:00', 'supervisor_pid': 1, 'active': None, 'queue': [turn_id],
                                 'turns': {turn_id: {'id': turn_id, 'chat_id': chat_id, 'voice': 'Claude', 'state': 'queued', 'reply_to': None, 'text': ''}}},
                                indent=2) + '\n')
    return state


def test_second_server_leaves_state_json_bytes_unchanged_and_refuses_chat(vault):
    primary = service(vault)
    try:
        chat = primary.create('library/thought.md', 'You', request_id=str(uuid4()))['chat']
        state = unfinished_state(vault, chat['id'])
        before = state.read_bytes()
        secondary = service(vault)
        try:
            assert state.read_bytes() == before, 'a secondary server never rewrites the owner state'
            assert primary.chats.read(chat['id'])['messages'] == [], 'nor marks the owner turns interrupted'
            with pytest.raises(Exception, match=OWNED):
                secondary.dispatch({'action': 'send', 'id': chat['id'], 'body': '@claude hello'}, 'You')
            view = secondary.get(chat['id'])
            assert view['chat']['id'] == chat['id'] and view['owner'] == {'owner': False, 'writable': False, 'message': OWNED + '; chat is read-only here.'}
            assert state.read_bytes() == before
        finally:
            secondary.close()
    finally:
        primary.close()


def test_recover_writes_only_when_it_changed_a_turn(vault):
    runtime = vault / '.reader/voice-runner'
    runtime.mkdir(parents=True)
    state = runtime / 'state.json'
    state.write_text(json.dumps({'updated_at': '2026-01-01T00:00:00+00:00', 'supervisor_pid': 1, 'active': None, 'queue': [],
                                 'turns': {'t': {'id': 't', 'chat_id': 'c', 'voice': 'Claude', 'state': 'done'}}}) + '\n')
    before = state.read_bytes()
    conversations = service(vault)
    try:
        assert state.read_bytes() == before, 'nothing to recover: state.json is left as it was'
        assert conversations.voices()['owner'] == {'owner': True, 'writable': True, 'message': None}
    finally:
        conversations.close()


def test_owner_recovers_unfinished_turns(vault):
    first = service(vault)
    chat = first.create('library/thought.md', 'You', request_id=str(uuid4()))['chat']
    first.close()
    state = unfinished_state(vault, chat['id'])
    before = state.read_bytes()
    again = service(vault)
    try:
        assert state.read_bytes() != before
        assert json.loads(state.read_text())['turns'] == {}
        assert again.chats.read(chat['id'])['messages'][-1]['turn']['failure'] == 'interrupted'
    finally:
        again.close()


def test_secondary_becomes_owner_once_the_owner_stops(vault):
    primary = service(vault)
    chat = primary.create('library/thought.md', 'You', request_id=str(uuid4()))['chat']
    secondary = service(vault)
    try:
        with pytest.raises(voice_runner.ChatOwned):
            secondary.dispatch({'action': 'create', 'path': 'library/thought.md', 'reuse': True}, 'You')
        state = unfinished_state(vault, chat['id'])
        primary.close()
        secondary.dispatch({'action': 'create', 'path': 'library/thought.md', 'reuse': True}, 'You')
        assert secondary.voices()['owner']['owner'] is True
        assert secondary.chats.read(chat['id'])['messages'][-1]['turn']['failure'] == 'interrupted', 'promotion recovers the old turns'
        assert json.loads(state.read_text())['supervisor_pid'] != 1
    finally:
        secondary.close()


def record(vault, host, heartbeat):
    file = vault / '.reader/voice-runner/supervisor.lock'
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps({'pid': 4242, 'host': host, 'started_at': '2026-01-01T00:00:00+00:00', 'heartbeat': heartbeat}))
    return file


def test_a_fresh_record_from_another_host_counts_as_held(vault):
    # A host and a container may not share flock over a bind mount; the heartbeat record covers that case.
    record(vault, 'some-container', time.time())
    secondary = service(vault)
    try:
        assert secondary.voices()['owner']['writable'] is False
    finally:
        secondary.close()
    record(vault, 'some-container', time.time() - voice_runner.SUPERVISOR_STALE - 5)
    owner = service(vault)
    try:
        assert owner.voices()['owner']['writable'] is True
        owner.dispatch({'action': 'create', 'path': 'library/thought.md'}, 'You')
        assert owner.voices()['owner']['owner'] is True
        held = json.loads((vault / '.reader/voice-runner/supervisor.lock').read_text())
        assert held['host'] != 'some-container' and held['pid'] > 0
    finally:
        owner.close()
    assert json.loads((vault / '.reader/voice-runner/supervisor.lock').read_text())['heartbeat'] == 0, 'a clean stop releases at once'


def test_second_web_server_answers_409_for_chat_posts(vault):
    primary = service(vault)
    primary.create('library/thought.md', 'You', request_id=str(uuid4()))  # The first chat action takes ownership.
    library = WebLibrary(vault, chat_options={'rng': random.Random(3), 'git_locks': False})
    server = WebServer(('127.0.0.1', 0), library, 'Test reader')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(path, payload=None):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
        connection.request('POST' if payload is not None else 'GET', path, json.dumps(payload) if payload is not None else None,
                           {'Content-Type': 'application/json', 'X-Reader-Token': server.token})
        response = connection.getresponse()
        body = json.loads(response.read())
        connection.close()
        return response.status, body
    try:
        status, body = request('/api/chat', {'action': 'create', 'path': 'library/thought.md', 'request_id': str(uuid4())})
        assert status == 409 and body['error'].startswith(OWNED)
        status, body = request('/api/chats?path=library/thought.md')
        assert status == 200 and body['owner']['writable'] is False
    finally:
        library.close()
        server.shutdown(); server.server_close(); thread.join(timeout=5)
        primary.close()


def test_a_server_that_only_reads_writes_nothing(vault):
    library = WebLibrary(vault, chat_options={'git_locks': False})
    try:
        assert library.conversations.list('library/thought.md')['owner'] == {'owner': False, 'writable': True, 'message': None}
        assert not (vault / '.reader/voice-runner').exists()
    finally:
        library.close()


def test_an_unusable_lock_file_fails_closed(vault, tmp_path):
    runtime = vault / '.reader/voice-runner'
    runtime.mkdir(parents=True)
    (tmp_path / 'elsewhere').write_text('')
    (runtime / 'supervisor.lock').symlink_to(tmp_path / 'elsewhere')
    conversations = service(vault)
    try:
        assert conversations.voices()['owner']['writable'] is False
        with pytest.raises(voice_runner.ChatOwned):
            conversations.create('library/thought.md', 'You')
        assert (tmp_path / 'elsewhere').read_text() == ''
    finally:
        conversations.close()


def test_the_heartbeat_keeps_the_record_fresh(vault, monkeypatch):
    monkeypatch.setattr(voice_runner, 'SUPERVISOR_BEAT', 0.05)
    ticks = iter(range(1000, 2000))
    supervisor = voice_runner.Supervisor(vault / '.reader/voice-runner', clock=lambda: next(ticks), host='here')
    assert supervisor.acquire()
    try:
        first = json.loads((vault / '.reader/voice-runner/supervisor.lock').read_text())['heartbeat']
        deadline = time.monotonic() + 5
        while json.loads((vault / '.reader/voice-runner/supervisor.lock').read_text())['heartbeat'] == first and time.monotonic() < deadline:
            time.sleep(.02)
        assert json.loads((vault / '.reader/voice-runner/supervisor.lock').read_text())['heartbeat'] > first
    finally:
        supervisor.release()
