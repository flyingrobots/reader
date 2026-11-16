"""Web uploads: framing, limits, identity, privacy levels and scoped filing. Attacks are tested as requests."""
import hashlib
import http.client
import io
import json
from pathlib import Path
import threading
from uuid import uuid4

import pytest

from reader_mcp import uploads
from reader_mcp.web import WebHandler, WebLibrary, WebServer

LOCAL = {'via': 'local', 'login': None, 'name': None}
TAILNET = {'via': 'tailscale', 'login': 'reader@example.com', 'name': 'R'}


def frame(files=(('note.md', b'# Note\n'),), damage=None, **fields):
    header = {'upload': 1, 'request_id': str(uuid4()), 'title': 'A note', 'privacy': 'no-cloud',
              'files': [{'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for path, data in files], **fields}
    if damage:
        damage(header)
    return json.dumps(header).encode() + b'\n' + b''.join(data for _, data in files), header


def send(root, body, identity=LOCAL):
    return uploads.receive(root, io.BytesIO(body), len(body), identity)


@pytest.fixture
def vault(tmp_path):
    for name in ('library', 'inbox', '.reader'):
        (tmp_path / name).mkdir()
    return tmp_path


def arrivals(root):
    return [p for p in (root / 'inbox').iterdir()]


def test_an_upload_arrives_with_a_receipt_and_the_servers_name_for_the_uploader(vault):
    body, header = frame(files=(('note.md', b'# Note\n'), ('assets/a.png', b'\x89PNG')), provenance={'author': 'A. Writer'})
    result = send(vault, body, TAILNET)
    assert result['status'] == 'awaiting_filing' and result['integrity'] == 'intact'
    folder = vault / 'inbox' / header['request_id']
    assert (folder / 'note.md').read_bytes() == b'# Note\n' and (folder / 'assets/a.png').read_bytes() == b'\x89PNG'
    receipt = json.loads((folder / 'receipt.json').read_text())
    assert receipt['provenance'] == {'author': 'A. Writer', 'privacy': 'no-cloud', 'uploaded_by': 'reader@example.com'}
    assert not list((vault / '.reader/upload-staging').iterdir())


def test_a_retry_with_the_same_id_does_not_duplicate(vault):
    body, _ = frame()
    assert send(vault, body)['id'] == send(vault, body)['id']
    assert len(arrivals(vault)) == 1


@pytest.mark.parametrize('claim', [{'uploaded_by': 'Claude'}, {'privacy': 'normal'}, {'anything': 'x'}])
def test_a_client_cannot_set_the_servers_fields_in_provenance(vault, claim):
    with pytest.raises(ValueError, match='provenance'):
        send(vault, frame(provenance=claim)[0])
    assert not arrivals(vault)


def test_the_default_level_is_normal(vault):
    def drop(header):
        del header['privacy']
    body, header = frame(damage=drop)
    send(vault, body)
    assert json.loads((vault / 'inbox' / header['request_id'] / 'receipt.json').read_text())['provenance']['privacy'] == 'normal'


@pytest.mark.parametrize('level,message', [('machine-only', 'browser on this machine'), ('secret', 'Unknown privacy')])
def test_an_unavailable_level_stores_nothing_rather_than_a_weaker_one(vault, level, message):
    with pytest.raises(ValueError, match=message):
        send(vault, frame(privacy=level)[0], TAILNET)
    assert not arrivals(vault) and not (vault / '.reader/upload-staging').exists()


@pytest.mark.parametrize('path', ['../escape.md', '/etc/passwd', '.hidden', 'a/../../b.md', 'receipt.json', 'index.md', 'a\\b.md'])
def test_unsafe_paths_never_land(vault, path):
    with pytest.raises(ValueError):
        send(vault, frame(files=((path, b'x'),))[0])
    assert not arrivals(vault) and not (vault.parent / 'escape.md').exists()


def test_a_wrong_hash_short_body_or_extra_bytes_leave_nothing(vault):
    def wrong(header):
        header['files'][0]['sha256'] = '0' * 64
    with pytest.raises(ValueError, match='SHA-256'):
        send(vault, frame(damage=wrong)[0])
    body, _ = frame()
    with pytest.raises(ValueError, match='length'):
        uploads.receive(vault, io.BytesIO(body), len(body) + 5, LOCAL)
    with pytest.raises(ValueError, match='length'):
        send(vault, body + b'extra')
    assert not arrivals(vault) and not list((vault / '.reader/upload-staging').iterdir())


@pytest.mark.parametrize('length', [0, -1, uploads.MAX_BODY + 1])
def test_a_bad_length_is_refused_before_reading(vault, length):
    class Unread(io.BytesIO):
        def read(self, *_):
            raise AssertionError('read the body')
        readline = read
    with pytest.raises(ValueError, match='64 MiB'):
        uploads.receive(vault, Unread(), length, LOCAL)


def test_sizes_are_refused_from_the_header_alone(vault):
    def huge(header):
        header['files'][0]['bytes'] = uploads.MAX_FILE + 1
    with pytest.raises(ValueError, match='32 MiB'):
        send(vault, frame(damage=huge)[0])
    def many(header):
        header['files'] = header['files'] * 65
    with pytest.raises(ValueError, match='1 to 64'):
        send(vault, frame(damage=many)[0])


def test_a_stalled_upload_hits_its_deadline(vault):
    times = iter([0, uploads.DEADLINE + 1])
    with pytest.raises(ValueError, match='too long'):
        uploads.receive(vault, io.BytesIO(frame()[0]), len(frame()[0]), LOCAL, clock=lambda: next(times))
    assert not arrivals(vault)


def test_a_full_disk_stores_nothing(vault, monkeypatch):
    monkeypatch.setattr(uploads, 'has_capacity', lambda root: False)
    with pytest.raises(ValueError, match='free-space'):
        send(vault, frame()[0])


@pytest.fixture
def server(vault):
    library = WebLibrary(vault)
    instance = WebServer(('127.0.0.1', 0), library)
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield instance
    instance.shutdown()
    instance.server_close()
    library.close()


def post(server, body, headers):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=10)
    host = f'127.0.0.1:{server.server_address[1]}'
    try:
        connection.putrequest('POST', '/api/inbox/deliveries', skip_host=True)
        connection.putheader('Host', headers.pop('Host', host))
        for name, value in headers.items():
            connection.putheader(name, value)
        connection.putheader('Content-Length', str(len(body)))
        connection.endheaders()
        connection.send(body)
        response = connection.getresponse()
        return response.status, json.loads(response.read() or b'{}')
    finally:
        connection.close()


def good(server, **extra):
    return {'Content-Type': uploads.CONTENT_TYPE, 'X-Reader-Token': server.token, **extra}


def test_the_route_accepts_a_browser_with_its_token_and_reveals_no_local_path(server, vault):
    body, header = frame()
    status, result = post(server, body, good(server))
    assert status == 200 and result['status'] == 'awaiting_filing' and result['id'] == header['request_id']
    assert str(vault) not in json.dumps(result) and 'document_path' not in result


@pytest.mark.parametrize('change', [
    {'X-Reader-Token': 'wrong'}, {'Content-Type': 'application/json'}, {'Content-Type': 'multipart/form-data'},
    {'Origin': 'https://evil.example'}, {'Host': 'evil.example'}, {'X-Forwarded-For': '1.2.3.4'},
    {'Tailscale-User-Login': 'a@example.com'}, {'Tailscale-Funnel-Request': '?1'}])
def test_the_route_refuses_requests_without_the_browsers_authority(server, vault, change):
    status, _ = post(server, frame()[0], good(server, **change))
    assert status in (400, 403) and not arrivals(vault)


def test_status_route_validates_its_id(server):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=10)
    connection.request('GET', '/api/inbox/deliveries?id=../../etc')
    assert connection.getresponse().status == 400
    connection.close()


@pytest.mark.parametrize('default', ['normal', 'no-cloud'])
def test_saved_default_applies_only_when_upload_omits_privacy(vault, default):
    assert uploads.settings(vault, {'default_privacy': default}) == {'default_privacy': default}
    body, header = frame(damage=lambda header: header.pop('privacy'))
    send(vault, body)
    receipt = json.loads((vault / 'inbox' / header['request_id'] / 'receipt.json').read_text())
    assert receipt['provenance']['privacy'] == default
    body, header = frame(privacy='no-cloud' if default == 'normal' else 'normal')
    send(vault, body)
    receipt = json.loads((vault / 'inbox' / header['request_id'] / 'receipt.json').read_text())
    assert receipt['provenance']['privacy'] == header['privacy']


def test_machine_only_cannot_be_a_saved_default(vault):
    with pytest.raises(ValueError, match='Default upload privacy'):
        uploads.settings(vault, {'default_privacy': 'machine-only'})
    assert uploads.settings(vault) == {'default_privacy': 'normal'}


@pytest.mark.parametrize('default', ['normal', 'no-cloud'])
def test_unmarked_arrivals_use_saved_default_but_explicit_levels_win(vault, default, monkeypatch):
    from reader_mcp.arrival_choices import local_only
    monkeypatch.delenv('READER_UNMARKED_PRIVACY', raising=False)
    uploads.settings(vault, {'default_privacy': default})
    assert local_only(vault, 'drop.md', None) == (default == 'no-cloud')
    assert local_only(vault, 'drop.md', {}) == (default == 'no-cloud')
    assert local_only(vault, 'drop.md', {'privacy': 'no-cloud'})
    assert local_only(vault, 'drop.md', {'privacy': 'unknown'})
    assert not local_only(vault, 'drop.md', {'privacy': 'normal'})
