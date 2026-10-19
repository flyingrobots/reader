"""Remote delivery over SSH, exercised without a network: a fake ssh runs the forced command locally."""
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from uuid import uuid4

import pytest

SCRIPTS = Path(__file__).parents[1] / 'skills/reader/scripts'
SRC = str(Path(__file__).parents[1] / 'src')
spec = importlib.util.spec_from_file_location('reader_remote', SCRIPTS / 'remote.py')
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


@pytest.fixture
def vault(tmp_path):
    root = tmp_path / 'vault'
    for name in ('inbox', 'library', '.reader'):
        (root / name).mkdir(parents=True)
    return root


@pytest.fixture(autouse=True)
def importable_package(monkeypatch):
    monkeypatch.setenv('PYTHONPATH', SRC + os.pathsep + os.environ.get('PYTHONPATH', ''))


def cli(vault):
    return [sys.executable, '-m', 'reader_mcp.cli', '--root', str(vault)]


def run_gate(vault, command, stream=b'', scope='deliver'):
    return remote.gate(scope, cli(vault), vault / '.reader', {'SSH_ORIGINAL_COMMAND': command}, io.BytesIO(stream))


def submission(tmp_path):
    document = tmp_path / 'report.md'
    document.write_bytes(b'# Remote\r\n![chart](assets/chart.bin)\r\n')
    chart = tmp_path / 'chart.bin'
    chart.write_bytes(bytes(range(256)) * 3)
    return {'request_id': str(uuid4()), 'title': 'Remote report', 'filename': 'report.md',
            'document_path': str(document),
            'attachments': [{'source_path': str(chart), 'path': 'assets/chart.bin'}],
            'provenance': {'project': 'other-machine'}}, document, chart


def test_delivery_roundtrip_preserves_bytes_and_retries(vault, tmp_path, capfd):
    request, document, chart = submission(tmp_path)
    stream = remote.encode_delivery(request)
    assert run_gate(vault, 'reader-remote ingest', stream) == 0
    receipt = json.loads(capfd.readouterr().out)
    assert receipt['status'] == 'awaiting_filing' and receipt['integrity'] == 'intact'
    bundle = vault / receipt['bundle_path']
    assert (bundle / 'report.md').read_bytes() == document.read_bytes()
    assert (bundle / 'assets/chart.bin').read_bytes() == chart.read_bytes()
    assert run_gate(vault, 'reader-remote ingest', stream) == 0
    assert json.loads(capfd.readouterr().out)['received_at'] == receipt['received_at']
    assert list((vault / '.reader/remote-staging').iterdir()) == []


def test_inline_markdown_needs_no_payloads(vault, capfd):
    request = {'request_id': str(uuid4()), 'title': 'Inline', 'markdown': '# Inline\n'}
    assert run_gate(vault, 'reader-remote ingest', remote.encode_delivery(request)) == 0
    assert json.loads(capfd.readouterr().out)['integrity'] == 'intact'


@pytest.mark.parametrize('damage', ['flip', 'truncate', 'extra'])
def test_damaged_stream_leaves_no_arrival(vault, tmp_path, damage):
    stream = bytearray(remote.encode_delivery(submission(tmp_path)[0]))
    if damage == 'flip':
        stream[-1] ^= 1
    elif damage == 'truncate':
        del stream[-10:]
    else:
        stream += b'x'
    assert run_gate(vault, 'reader-remote ingest', bytes(stream)) == 1
    assert list((vault / 'inbox').iterdir()) == []
    assert list((vault / '.reader/remote-staging').iterdir()) == []


def test_header_cannot_name_server_paths(vault, tmp_path):
    secret = tmp_path / 'secret.txt'
    secret.write_text('private')
    header = {'remote_delivery': 1, 'files': [],
              'submission': {'request_id': str(uuid4()), 'title': 'x', 'document_path': str(secret), 'attachments': []}}
    assert run_gate(vault, 'reader-remote ingest', json.dumps(header).encode() + b'\n') == 1
    header['submission'] = {'request_id': str(uuid4()), 'title': 'x', 'markdown': '# x',
                            'attachments': [{'source_path': str(secret), 'path': 'a.txt'}]}
    assert run_gate(vault, 'reader-remote ingest', json.dumps(header).encode() + b'\n') == 1
    assert list((vault / 'inbox').iterdir()) == []


@pytest.mark.parametrize('command', ['', 'ls', 'sh -c id', 'reader-remote search notes',
                                     'reader-remote serve', 'reader-remote status --root /tmp x',
                                     'reader-remote status not-a-uuid', 'reader-remote ingest /etc/passwd'])
def test_deliver_scope_refuses_other_commands(vault, command):
    assert run_gate(vault, command) == 2


def test_library_scope_allows_search_and_ping(vault, capfd):
    assert run_gate(vault, 'reader-remote ping', scope='library') == 0
    assert json.loads(capfd.readouterr().out) == {'ok': True, 'scope': 'library'}
    assert run_gate(vault, 'reader-remote search notes', scope='deliver') == 2
    assert run_gate(vault, 'reader-remote annotate /tmp/request.json', scope='library') == 2


PUBLIC = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtestkeyblobAAAAAAAAAAAAAAAAAAAAAAAAAAAA reader-remote@laptop'


def authorize(tmp_path, monkeypatch, key=PUBLIC, scope='deliver'):
    monkeypatch.setenv('READER_AUTHORIZED_KEYS', str(tmp_path / 'ssh/authorized_keys'))
    return remote.authorize(['--scope', scope], Path('/opt/reader skills/reader.py'), '/usr/bin/python3', io.StringIO(key + '\n'))


def test_authorize_writes_one_restricted_entry(tmp_path, monkeypatch, capfd):
    keys = tmp_path / 'ssh/authorized_keys'
    keys.parent.mkdir()
    keys.write_text('ssh-ed25519 AAAAotherkey other@host')
    assert authorize(tmp_path, monkeypatch) == 0
    assert json.loads(capfd.readouterr().out)['changed'] is True
    lines = keys.read_text().splitlines()
    assert lines[0] == 'ssh-ed25519 AAAAotherkey other@host'
    assert lines[1] == ("restrict,command=\"/usr/bin/python3 '/opt/reader skills/reader.py' remote-gate --scope deliver\" "
                        + PUBLIC)
    assert stat.S_IMODE(keys.stat().st_mode) == 0o600
    assert authorize(tmp_path, monkeypatch) == 0
    assert json.loads(capfd.readouterr().out)['changed'] is False
    assert authorize(tmp_path, monkeypatch, scope='library') == 0
    assert len(keys.read_text().splitlines()) == 2 and '--scope library' in keys.read_text()


def test_authorize_refuses_unrestricted_key_and_bad_input(tmp_path, monkeypatch):
    keys = tmp_path / 'ssh/authorized_keys'
    keys.parent.mkdir()
    keys.write_text(PUBLIC + '\n')
    assert authorize(tmp_path, monkeypatch) == 2
    assert keys.read_text() == PUBLIC + '\n'
    for bad in ['', 'not a key', PUBLIC + '\n' + PUBLIC, 'command="sh" ' + PUBLIC]:
        assert authorize(tmp_path, monkeypatch, key=bad) == 2


def test_client_delivers_through_ssh(vault, tmp_path, monkeypatch):
    """The installed helper in remote mode, with ssh replaced by a local forced-command runner."""
    fake = tmp_path / 'fake-ssh'
    fake.write_text(f'''#!{sys.executable}
import io, os, sys
sys.path.insert(0, {str(SCRIPTS)!r})
import remote
assert '-i' in sys.argv and 'BatchMode=yes' in sys.argv
raise SystemExit(remote.gate('deliver', {cli(vault)!r}, __import__('pathlib').Path({str(vault / '.reader')!r}),
                             {{'SSH_ORIGINAL_COMMAND': sys.argv[-1]}}, sys.stdin.buffer))
''')
    fake.chmod(0o755)
    config = tmp_path / 'remote.json'
    config.write_text(json.dumps({'host': 'user@vault-host', 'identity': str(tmp_path / 'key')}))
    request, document, _ = submission(tmp_path)
    (tmp_path / 'request.json').write_text(json.dumps(request))
    env = dict(os.environ, READER_SSH=str(fake), READER_REMOTE_CONFIG=str(config))
    helper = [sys.executable, str(SCRIPTS / 'reader.py')]
    result = subprocess.run([*helper, 'ingest', str(tmp_path / 'request.json')], env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout)
    assert Path(receipt['document_path']).read_bytes() == document.read_bytes()
    status = subprocess.run([*helper, 'status', request['request_id']], env=env, capture_output=True, text=True)
    assert json.loads(status.stdout)['status'] == 'awaiting_filing'
    refused = subprocess.run([*helper, 'search', 'x'], env=env, capture_output=True, text=True)
    assert refused.returncode == 2 and 'not allowed' in refused.stderr
