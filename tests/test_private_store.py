"""Encrypted machine-only storage. The first group fakes the bridge; the end-to-end group runs the real pinned git-cas."""
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
from uuid import uuid4

import pytest

from reader_mcp import private_store, uploads
from reader_mcp.private_store import PrivateStore
from reader_mcp.web import WebLibrary, WebServer

SHARED_TOOL = os.environ.get('READER_TEST_GIT_CAS_TOOL')
PASSPHRASE = 'a long enough test passphrase'
MARKER, TITLE = b'ZQXMARKER7731', 'SECRETTITLE9931'


class FakeClock:
    now = 1000.0

    def __call__(self):
        return self.now


def fake_store(tmp_path, clock=None, wrong='wrong'):
    store = PrivateStore(environ={'READER_HOME': str(tmp_path / 'home'), 'PATH': os.environ['PATH']}, clock=clock or FakeClock())
    store.repo.mkdir(parents=True)
    subprocess.run(['git', 'init', '-q', '--bare', str(store.repo)], check=True)
    calls = []

    def call(request, payload=b''):
        calls.append(request)
        if request.get('passphrase') == wrong:
            raise ValueError('That passphrase doesn’t match.')
        return {'ok': True, 'key': 'ab' * 32, 'items': []}, b''
    store.call = call
    store.calls = calls
    return store


def test_a_session_belongs_to_one_cookie_and_expires_when_idle(tmp_path):
    clock = FakeClock()
    store = fake_store(tmp_path, clock)
    session = store.unlock('right passphrase')
    assert store.unlocked(session) and not store.unlocked('someone-elses-cookie-value') and not store.unlocked(None)
    with pytest.raises(private_store.Locked):
        store.key('someone-elses-cookie-value')
    clock.now += private_store.IDLE_LIMIT - 1
    assert store.unlocked(session), 'use renews the idle limit'
    clock.now += private_store.IDLE_LIMIT + 1
    assert not store.unlocked(session) and store.session is None, 'an expired key is dropped from memory'


def test_lock_forgets_the_key(tmp_path):
    store = fake_store(tmp_path)
    session = store.unlock('right passphrase')
    store.close()
    assert not store.unlocked(session) and store.session is None


def test_repeated_wrong_passphrases_back_off(tmp_path):
    clock = FakeClock()
    store = fake_store(tmp_path, clock)
    for _ in range(private_store.ATTEMPTS):
        with pytest.raises(ValueError, match='doesn’t match'):
            store.unlock('wrong')
    attempts = len(store.calls)
    with pytest.raises(ValueError, match='Wait a minute'):
        store.unlock('right passphrase')
    assert len(store.calls) == attempts, 'a blocked attempt never reaches the bridge'
    clock.now += private_store.BACKOFF + 1
    assert store.unlock('right passphrase')


@pytest.mark.parametrize('passphrase', ['', 'too short', 7, None, 'x' * 2000])
def test_setup_refuses_a_weak_or_malformed_passphrase(tmp_path, passphrase):
    store = PrivateStore(environ={'READER_HOME': str(tmp_path / 'home'), 'PATH': os.environ['PATH']})
    with pytest.raises(ValueError, match='at least'):
        store.setup(passphrase)
    assert not store.repo.exists()


def test_a_repository_with_a_remote_refuses_to_store(tmp_path):
    store = fake_store(tmp_path)
    session = store.unlock('right passphrase')
    subprocess.run(['git', '--git-dir', str(store.repo), 'remote', 'add', 'origin', 'https://example.com/x.git'], check=True)
    with pytest.raises(ValueError, match='remote'):
        store.store(session, uuid4(), {'title': 't'}, [('a.md', b'x')])
    assert not [c for c in store.calls if c['op'] == 'store']


def test_guards_are_restored_before_every_write(tmp_path):
    store = fake_store(tmp_path)
    session = store.unlock('right passphrase')
    os.chmod(store.repo, 0o755)
    store.store(session, uuid4(), {'title': 't'}, [('a.md', b'x')])
    assert (store.repo.stat().st_mode & 0o777) == 0o700
    assert (store.repo / 'hooks/pre-push').read_text() == private_store.NEVER_PUSH


@pytest.mark.parametrize('header,expected', [('reader_private=' + 'a' * 30, 'a' * 30), ('x=1; reader_private=' + 'b' * 30 + '; y=2', 'b' * 30),
                                             ('reader_private=short', None), ('reader_private=' + 'a' * 30 + '$', None), (None, None), ('other=' + 'a' * 30, None)])
def test_cookie_parsing_is_strict(header, expected):
    assert private_store.cookie_value(header) == expected


def frame(request_id=None, privacy='machine-only', data=MARKER * 100, path='secret-name.md', title=TITLE):
    header = {'upload': 1, 'request_id': request_id or str(uuid4()), 'title': title, 'privacy': privacy,
              'files': [{'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}
    return json.dumps(header).encode() + b'\n' + data, header['request_id']


@pytest.fixture
def vault(tmp_path):
    for name in ('library', 'inbox', '.reader'):
        (tmp_path / name).mkdir()
    return tmp_path


LOCAL = {'via': 'local', 'login': None, 'name': None}


def test_machine_only_needs_a_local_browser_and_an_unlocked_session(vault, tmp_path):
    store = fake_store(tmp_path)
    body, _ = frame()
    with pytest.raises(ValueError, match='browser on this machine'):
        uploads.receive(vault, io.BytesIO(body), len(body), {'via': 'tailscale', 'login': 'a@example.com'}, private=store, session='x')
    with pytest.raises(ValueError, match='Unlock'):
        uploads.receive(vault, io.BytesIO(body), len(body), LOCAL, private=store, session=None)
    assert not list((vault / 'inbox').iterdir()) and not (vault / '.reader/upload-staging').exists()


@pytest.fixture(scope='module')
def real_tool(tmp_path_factory):
    """The real pinned bridge, installed once. Set READER_TEST_GIT_CAS_TOOL to reuse an installed copy."""
    if not shutil.which('node') or not shutil.which('npm'):
        pytest.skip('needs Node.js and npm')
    if SHARED_TOOL:
        return Path(SHARED_TOOL)
    tool = tmp_path_factory.mktemp('tool') / 'git-cas-bridge'
    tool.mkdir()
    for name in ('package.json', 'package-lock.json'):
        shutil.copyfile(private_store.BRIDGE / name, tool / name)
    done = subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=tool, capture_output=True, timeout=240)
    if done.returncode:
        pytest.skip('could not install the pinned bridge')
    return tool


@pytest.fixture
def real(tmp_path, real_tool):
    store = PrivateStore(environ={'READER_HOME': str(tmp_path / 'home'), 'PATH': os.environ['PATH']})
    store.tool = real_tool
    return store


def repository_bytes(repo):
    """Everything on disk under the repository, plus every Git object decompressed."""
    raw = b''.join(p.read_bytes() for p in repo.rglob('*') if p.is_file())
    objects = subprocess.run(['git', '--git-dir', str(repo), 'cat-file', '--batch-all-objects', '--batch'], capture_output=True)
    return raw + objects.stdout


def test_end_to_end_nothing_readable_reaches_disk_and_only_the_passphrase_opens_it(real, vault, tmp_path):
    session = real.setup(PASSPHRASE)
    body, identity = frame()
    tracked = lambda: {p for name in ('library', 'inbox', '.reader') for p in (vault / name).rglob('*')}
    before = tracked()
    result = uploads.receive(vault, io.BytesIO(body), len(body), LOCAL, private=real, session=session)
    assert result['status'] == 'encrypted' and result['id'] == identity
    assert tracked() == before, 'the vault gained nothing, not even a staging folder'
    stored = repository_bytes(real.repo)
    for secret in (MARKER, TITLE.encode(), b'secret-name'):
        assert secret not in stored
    # The listing and the document come back only through the session.
    items = real.items(session)
    assert [item['title'] for item in items] == [TITLE] and items[0]['files'][0]['path'] == 'secret-name.md'
    assert real.view(session, identity)['text'] == (MARKER * 100).decode()
    with pytest.raises(private_store.Locked):
        real.read('not-the-session-cookie-value', identity)
    # A new server process knows nothing, and a wrong passphrase gets nothing.
    fresh = PrivateStore(environ=real.environ)
    fresh.tool = real.tool
    assert fresh.initialized() and not fresh.unlocked(session)
    with pytest.raises(ValueError, match='doesn’t match'):
        fresh.unlock('not the right passphrase')
    assert fresh.items(fresh.unlock(PASSPHRASE))[0]['id'] == identity


def test_end_to_end_retry_is_idempotent_and_delete_removes_it(real):
    session = real.setup(PASSPHRASE)
    identity = str(uuid4())
    for _ in range(2):
        real.store(session, identity, {'title': 'once', 'received_at': 'now'}, [('a.md', b'first'), ('b/c.png', b'second')])
    assert len(real.items(session)) == 1
    meta, files = real.read(session, identity)
    assert files == {'a.md': b'first', 'b/c.png': b'second'} and meta['title'] == 'once'
    real.delete(session, identity)
    assert real.items(session) == []
    with pytest.raises(ValueError, match='doesn’t exist'):
        real.read(session, identity)


def test_end_to_end_a_document_opens_by_id_and_position_never_by_name(real):
    session = real.setup(PASSPHRASE)
    identity = str(uuid4())
    real.store(session, identity, {'title': 'A debrief', 'received_at': 'now'}, [('secret-name.md', b'# Text'), ('notes/raw.txt', b'raw'), ('receipt.json', b'{}')])
    first = real.document(session, f'private/{identity}')
    assert first['text'] == '# Text' and first['title'] == 'A debrief' and first['kind'] == '.md' and first['preview'] and first['item'] is None and first['bookmark'] is None
    assert [row['path'] for row in first['private_files']] == [f'private/{identity}', f'private/{identity}/1']
    assert 'secret-name' not in first['path'] and all('secret-name' not in row['path'] for row in first['private_files'])
    assert real.document(session, f'private/{identity}/1')['text'] == 'raw'
    for bad in (f'private/{identity}/9', f'private/{identity}/secret-name.md', f'private/{identity}/1/2', 'private/not-an-id', 'library/x.md'):
        with pytest.raises(ValueError):
            real.document(session, bad)
    with pytest.raises(private_store.Locked):
        real.document('wrong session', f'private/{identity}')


def test_the_reader_route_to_encrypted_storage_is_only_for_a_browser_here():
    source = (Path(private_store.__file__).parent / 'web.py').read_text()
    route = source[source.index("elif parsed.path == '/api/document' and args.get('path', '').startswith('private/')"):]
    assert route.split('\n')[2].strip() == 'self.private_read(library, parsed.path, args)'
    guard = source[source.index('def private_read'):]
    assert "self.identity.get('via') != 'local'" in guard.split('\n')[1]


def waiting_delivery(vault, title='A waiting debrief', text=b'WAITINGMARKER6620 text\n'):
    body, identity = frame(privacy='no-cloud', data=text, path='debrief.md', title=title)
    uploads.receive(vault, io.BytesIO(body), len(body), LOCAL)
    return identity


def test_end_to_end_a_waiting_delivery_moves_into_encrypted_storage(real, vault):
    session = real.setup(PASSPHRASE)
    identity = waiting_delivery(vault)
    folder = vault / 'inbox' / identity
    receipt = (folder / 'receipt.json').read_bytes()
    assert real.encrypt_arrival(session, vault, identity, None)['status'] == 'encrypted'
    assert not folder.exists()
    meta, files = real.read(session, identity)
    assert files['debrief.md'] == b'WAITINGMARKER6620 text\n' and files['receipt.json'] == receipt and meta['title'] == 'A waiting debrief'
    assert meta['files'][0]['path'] == 'debrief.md' and real.view(session, identity)['text'].startswith('WAITINGMARKER6620')
    assert b'WAITINGMARKER6620' not in repository_bytes(real.repo)


def test_end_to_end_the_inbox_copy_stays_if_anything_goes_wrong(real, vault, monkeypatch):
    session = real.setup(PASSPHRASE)
    identity = waiting_delivery(vault)
    folder = vault / 'inbox' / identity
    with pytest.raises(ValueError, match='filing run'):
        real.encrypt_arrival(session, vault, identity, 'A filing run is using the inbox.')
    assert folder.is_dir()
    with pytest.raises(private_store.Locked):
        real.encrypt_arrival('not-the-session-cookie-value', vault, identity, None)
    assert folder.is_dir()
    monkeypatch.setattr(real, 'read', lambda *_: ({}, {'debrief.md': b'different'}))
    with pytest.raises(ValueError, match='didn’t match'):
        real.encrypt_arrival(session, vault, identity, None)
    assert (folder / 'debrief.md').is_file()
    monkeypatch.undo()
    (folder / 'debrief.md').write_bytes(b'changed since delivery')
    with pytest.raises(ValueError, match='changed since'):
        real.encrypt_arrival(session, vault, identity, None)
    assert folder.is_dir()


def test_end_to_end_only_a_waiting_delivery_can_be_moved(real, vault):
    session = real.setup(PASSPHRASE)
    for bad, message in ((str(uuid4()), 'isn’t a delivery'), ('../etc', 'badly formed|invalid')):
        with pytest.raises(ValueError, match=message):
            real.encrypt_arrival(session, vault, bad, None)


def test_end_to_end_a_killed_write_leaves_nothing_readable_and_earlier_documents_intact(real):
    import signal
    import time
    session = real.setup(PASSPHRASE)
    keep = str(uuid4())
    real.store(session, keep, {'title': 'kept', 'received_at': 'now'}, [('a.md', b'kept bytes')])
    assert subprocess.run(['git', '--git-dir', str(real.repo), 'config', 'core.fsync'], capture_output=True, text=True).stdout.strip() == 'loose-object,pack,reference'
    key, data = real.key(session), (MARKER + b' ') * (3 * 1024 * 1024)
    meta = json.dumps({'title': TITLE, 'files': [{'path': 'b.md', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}).encode()
    request = json.dumps({'op': 'store', 'key': key, 'id': str(uuid4()), 'meta_bytes': len(meta)}).encode() + b'\n'
    process = subprocess.Popen(['node', str(private_store.BRIDGE / 'bridge.mjs'), str(real.repo), str(real.tool)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    process.stdin.write(request + meta + data)
    process.stdin.close()
    time.sleep(0.7)
    process.send_signal(signal.SIGKILL)
    process.wait()
    stored = repository_bytes(real.repo)
    assert MARKER not in stored and TITLE.encode() not in stored
    assert real.read(session, keep)[1] == {'a.md': b'kept bytes'}
    assert subprocess.run(['git', '--git-dir', str(real.repo), 'fsck', '--connectivity-only'], capture_output=True).returncode == 0


def test_end_to_end_a_push_is_refused(real, tmp_path):
    real.setup(PASSPHRASE)
    remote = tmp_path / 'remote.git'
    subprocess.run(['git', 'init', '-q', '--bare', str(remote)], check=True)
    done = subprocess.run(['git', '--git-dir', str(real.repo), 'push', str(remote), 'refs/cas/vault:refs/cas/vault'], capture_output=True, text=True)
    assert done.returncode and 'never leaves' in done.stderr
    assert not subprocess.run(['git', '--git-dir', str(remote), 'for-each-ref'], capture_output=True, text=True).stdout


@pytest.fixture
def server(vault, tmp_path):
    library = WebLibrary(vault)
    library.private = fake_store(tmp_path)
    instance = WebServer(('127.0.0.1', 0), library)
    threading.Thread(target=instance.serve_forever, daemon=True).start()
    yield instance
    instance.shutdown()
    instance.server_close()
    library.close()


def call(server, method, path, payload=None, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=10)
    all_headers = {'Content-Type': 'application/json', 'X-Reader-Token': server.token, **(headers or {})}
    connection.request(method, path, json.dumps(payload) if payload is not None else None, all_headers)
    response = connection.getresponse()
    body = response.read()
    connection.close()
    return response.status, json.loads(body or b'{}'), response.getheader('Set-Cookie')


def test_the_routes_set_a_strict_cookie_and_clear_it_on_lock(server):
    status, body, cookie = call(server, 'POST', '/api/private', {'action': 'unlock', 'passphrase': 'right passphrase'})
    assert status == 200 and 'key' not in body and body['unlocked'] is True
    assert 'HttpOnly' in cookie and 'SameSite=Strict' in cookie and 'Path=/api' in cookie
    value = cookie.split(';')[0]
    assert call(server, 'GET', '/api/private', headers={'Cookie': value})[1]['unlocked'] is True
    assert call(server, 'GET', '/api/private')[1]['unlocked'] is False, 'the write token alone is not the session'
    assert call(server, 'GET', '/api/private/item?id=' + str(uuid4()))[0] == 403
    status, body, cookie = call(server, 'POST', '/api/private', {'action': 'lock'}, {'Cookie': value})
    assert status == 200 and 'Max-Age=0' in cookie
    assert call(server, 'GET', '/api/private', headers={'Cookie': value})[1]['unlocked'] is False


def test_the_routes_refuse_requests_without_the_write_token(server):
    assert call(server, 'POST', '/api/private', {'action': 'unlock', 'passphrase': 'x'}, {'X-Reader-Token': 'wrong'})[0] == 403


def test_a_tailnet_browser_cannot_tell_it_exists(server, vault, tmp_path):
    (vault / '.reader/web-config.json').write_text(json.dumps({
        'allowed_hosts': ['reader.example.ts.net'], 'allowed_origins': ['https://reader.example.ts.net'],
        'trusted_proxy': 'tailscale', 'allowed_logins': ['a@example.com']}))
    tailnet = {'Host': 'reader.example.ts.net', 'X-Forwarded-Host': 'reader.example.ts.net', 'X-Forwarded-For': '100.64.0.1',
               'Tailscale-User-Login': 'a@example.com'}
    for method, path, payload in (('GET', '/api/private', None), ('GET', '/api/private/item?id=' + str(uuid4()), None),
                                  ('POST', '/api/private', {'action': 'unlock', 'passphrase': 'right passphrase'})):
        status, body, cookie = call(server, method, path, payload, tailnet)
        assert status == 404 and body == {'error': 'Not found'} and cookie is None, path
