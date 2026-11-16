"""Delivery tokens and quotas: what a token can reach, as real requests, and the helper's HTTPS mode."""
from datetime import datetime, timedelta, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import threading
from uuid import uuid4

import pytest

from reader_mcp import delivery_tokens, uploads
from reader_mcp.delivery_tokens import DeliveryTokens, QuotaExceeded
from reader_mcp.web import WebLibrary, WebServer

HELPER = Path(__file__).resolve().parents[1] / 'skills/reader/scripts/reader.py'


def frame(privacy='no-cloud', data=b'# Note\n', path='note.md'):
    identity = str(uuid4())
    header = {'upload': 1, 'request_id': identity, 'title': 'A note', 'privacy': privacy,
              'files': [{'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}
    return json.dumps(header).encode() + b'\n' + data, identity


@pytest.fixture
def vault(tmp_path):
    root = tmp_path / 'vault'
    for name in ('library', 'inbox', '.reader'):
        (root / name).mkdir(parents=True)
    return root


@pytest.fixture
def server(vault):
    library = WebLibrary(vault)
    instance = WebServer(('127.0.0.1', 0), library)
    threading.Thread(target=instance.serve_forever, daemon=True).start()
    yield instance
    instance.shutdown()
    instance.server_close()
    library.close()


def request(server, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=10)
    connection.request(method, path, body, headers or {})
    response = connection.getresponse()
    data = response.read()
    connection.close()
    try:
        return response.status, json.loads(data)
    except ValueError:
        return response.status, data


def upload(server, token, body):
    return request(server, 'POST', '/api/inbox/deliveries', body, {'Content-Type': uploads.CONTENT_TYPE, 'Authorization': 'Bearer ' + token})


def browser(server, path, payload):
    return request(server, 'POST', path, json.dumps(payload), {'Content-Type': 'application/json', 'X-Reader-Token': server.token})


def test_only_a_hash_is_stored_and_the_file_is_private(vault):
    tokens = DeliveryTokens(vault)
    created = tokens.create('Laptop')
    text = tokens.file.read_text()
    assert created['token'] not in text and created['token'].split('_')[2] not in text
    assert stat.S_IMODE(tokens.file.stat().st_mode) == 0o600
    assert 'token' not in tokens.list()['tokens'][0] and 'hash' not in tokens.list()['tokens'][0]
    assert tokens.verify('Bearer ' + created['token'])['name'] == 'Laptop'


@pytest.mark.parametrize('value', [None, '', 'Bearer', 'Basic x', 'Bearer rdt_short', 'Bearer rdt_' + 'a' * 32 + '_' + 'b' * 40])
def test_malformed_and_unknown_tokens_are_refused(vault, value):
    DeliveryTokens(vault).create('Laptop')
    assert DeliveryTokens(vault).verify(value) is None


def test_a_right_id_with_a_wrong_secret_and_a_revoked_token_are_refused(vault):
    tokens = DeliveryTokens(vault)
    created = tokens.create('Laptop')
    forged = created['token'].rsplit('_', 1)[0] + '_' + 'x' * 43
    assert tokens.verify('Bearer ' + forged) is None
    tokens.revoke(created['id'])
    assert tokens.verify('Bearer ' + created['token']) is None


@pytest.mark.parametrize('name', ['', '   ', 'x' * 81, 'bad\nname', None, 7])
def test_bad_names_are_refused(vault, name):
    with pytest.raises(ValueError):
        DeliveryTokens(vault).create(name)


def test_quota_resets_daily_and_never_applies_to_this_machine(vault, monkeypatch):
    clock = {'now': datetime(2026, 11, 4, 23, tzinfo=timezone.utc)}
    tokens = DeliveryTokens(vault, now=lambda: clock['now'])
    sender = tokens.verify('Bearer ' + tokens.create('Laptop')['token'])
    monkeypatch.setattr(delivery_tokens, 'DAILY_UPLOADS', 2)
    tokens.admit(sender, 10)
    tokens.admit(sender, 10)
    with pytest.raises(QuotaExceeded):
        tokens.admit(sender, 10)
    tokens.admit({'via': 'local'}, 10 ** 12)
    clock['now'] += timedelta(hours=2)
    tokens.admit(sender, 10)
    assert tokens.list()['tokens'][0]['uploads_today'] == 1 and tokens.list()['tokens'][0]['last_used_at']


def test_bytes_quota_is_per_sender(vault):
    tokens = DeliveryTokens(vault)
    laptop = tokens.verify('Bearer ' + tokens.create('Laptop')['token'])
    tokens.admit(laptop, delivery_tokens.DAILY_BYTES)
    with pytest.raises(QuotaExceeded):
        tokens.admit(laptop, 1)
    tokens.admit({'via': 'tailscale', 'login': 'a@example.com'}, 1)


def test_a_token_delivers_with_its_name_on_the_receipt_and_starts_no_filing(server, vault):
    created = DeliveryTokens(vault).create('Laptop')
    body, identity = frame()
    status, result = upload(server, created['token'], body)
    assert status == 200 and result['status'] == 'awaiting_filing'
    receipt = json.loads((vault / 'inbox' / identity / 'receipt.json').read_text())
    assert receipt['provenance']['uploaded_by'] == 'token: Laptop' and receipt['provenance']['privacy'] == 'no-cloud'
    assert not (vault / '.reader/inbox-runner/state.json').exists()


def test_a_token_reaches_nothing_else(server, vault):
    created = DeliveryTokens(vault).create('Laptop')
    auth = {'Authorization': 'Bearer ' + created['token'], 'Content-Type': 'application/json'}
    for path, payload in (('/api/inbox', {'action': 'start'}), ('/api/delivery-tokens', {'action': 'create', 'name': 'more'}),
                          ('/api/private', {'action': 'unlock', 'passphrase': 'x'}), ('/api/model-chain', {'order': ['claude']})):
        assert request(server, 'POST', path, json.dumps(payload), auth)[0] == 403, path
    assert not (vault / '.reader/model-chain.json').exists()


def test_a_token_cannot_use_machine_only_storage(server, vault):
    created = DeliveryTokens(vault).create('Laptop')
    status, result = upload(server, created['token'], frame(privacy='machine-only')[0])
    assert status == 400 and 'browser on this machine' in result['error']
    assert not [p for p in (vault / 'inbox').iterdir()]


def test_an_invalid_or_revoked_token_is_refused_before_the_body_is_read(server, vault):
    tokens = DeliveryTokens(vault)
    created = tokens.create('Laptop')
    assert upload(server, 'rdt_nope', frame()[0])[0] == 401
    tokens.revoke(created['id'])
    assert upload(server, created['token'], frame()[0])[0] == 401
    assert not list((vault / 'inbox').iterdir())


def test_a_token_only_sees_its_own_receipts(server, vault):
    tokens = DeliveryTokens(vault)
    first, second = tokens.create('First'), tokens.create('Second')
    body, identity = frame()
    assert upload(server, first['token'], body)[0] == 200
    see = lambda token: request(server, 'GET', '/api/inbox/deliveries?id=' + identity, headers={'Authorization': 'Bearer ' + token})
    assert see(first['token'])[1]['status'] == 'awaiting_filing'
    assert see(second['token'])[1] == {'id': identity, 'status': 'not_found', 'integrity': None, 'title': None, 'bundle_path': None}
    assert see('rdt_nope')[0] == 401


def test_quota_refusal_stores_nothing(server, vault, monkeypatch):
    created = DeliveryTokens(vault).create('Laptop')
    monkeypatch.setattr(delivery_tokens, 'DAILY_UPLOADS', 1)
    assert upload(server, created['token'], frame()[0])[0] == 200
    status, result = upload(server, created['token'], frame()[0])
    assert status == 400 and 'limit' in result['error']
    assert len(list((vault / 'inbox').iterdir())) == 1


def test_creating_and_listing_tokens_needs_the_browser_on_this_machine(server, vault):
    status, created = browser(server, '/api/delivery-tokens', {'action': 'create', 'name': 'Laptop'})
    assert status == 200 and created['token'].startswith('rdt_')
    assert request(server, 'GET', '/api/delivery-tokens')[1]['tokens'][0]['name'] == 'Laptop'
    (vault / '.reader/web-config.json').write_text(json.dumps({
        'allowed_hosts': ['reader.example.ts.net'], 'allowed_origins': ['https://reader.example.ts.net'],
        'trusted_proxy': 'tailscale', 'allowed_logins': ['a@example.com']}))
    tailnet = {'Host': 'reader.example.ts.net', 'X-Forwarded-Host': 'reader.example.ts.net', 'X-Forwarded-For': '100.64.0.1', 'Tailscale-User-Login': 'a@example.com'}
    assert request(server, 'GET', '/api/delivery-tokens', headers=tailnet) == (404, {'error': 'Not found'})
    assert request(server, 'POST', '/api/delivery-tokens', json.dumps({'action': 'create', 'name': 'x'}),
                   {**tailnet, 'Content-Type': 'application/json', 'X-Reader-Token': server.token})[0] == 404
    # A token still needs the tailnet's own admission.
    denied = {**tailnet, 'Tailscale-User-Login': 'stranger@example.com', 'Authorization': 'Bearer ' + created['token'], 'Content-Type': uploads.CONTENT_TYPE}
    assert request(server, 'POST', '/api/inbox/deliveries', frame()[0], denied)[0] == 403
    funnel = {**tailnet, 'Tailscale-Funnel-Request': '?1', 'Authorization': 'Bearer ' + created['token'], 'Content-Type': uploads.CONTENT_TYPE}
    assert request(server, 'POST', '/api/inbox/deliveries', frame()[0], funnel)[0] == 403


def helper_env(tmp_path, url, token):
    token_file = tmp_path / 'token'
    token_file.write_text(token + '\n')
    config = tmp_path / 'remote.json'
    config.write_text(json.dumps({'url': url, 'token_file': str(token_file)}))
    return dict(os.environ, READER_REMOTE_CONFIG=str(config))


def test_the_helper_delivers_and_checks_status_with_a_token(server, vault, tmp_path):
    created = DeliveryTokens(vault).create('Laptop')
    env = helper_env(tmp_path, f'http://127.0.0.1:{server.server_address[1]}', created['token'])
    document = tmp_path / 'report.md'
    document.write_text('# Report\n')
    identity = str(uuid4())
    request_file = tmp_path / 'request.json'
    request_file.write_text(json.dumps({'request_id': identity, 'title': 'Report', 'filename': 'report.md', 'document_path': str(document), 'provenance': {'project': 'p'}}))
    run = lambda *args: subprocess.run([sys.executable, str(HELPER), *args], env=env, capture_output=True, text=True, timeout=30)
    done = run('ingest', str(request_file))
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout)['status'] == 'awaiting_filing'
    assert (vault / 'inbox' / identity / 'report.md').read_text() == '# Report\n'
    assert json.loads(run('status', identity).stdout)['status'] == 'awaiting_filing'
    refused = run('search', 'x')
    assert refused.returncode and 'ingest' in refused.stderr


def test_the_helper_will_not_send_a_token_over_plain_http_to_another_machine(tmp_path):
    env = helper_env(tmp_path, 'http://reader.example.com', 'rdt_secret')
    done = subprocess.run([sys.executable, str(HELPER), 'status', str(uuid4())], env=env, capture_output=True, text=True, timeout=30)
    assert done.returncode and 'https' in done.stderr
