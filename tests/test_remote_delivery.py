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


def test_library_scope_pings_and_refuses_file_requests(vault, capfd):
    assert run_gate(vault, 'reader-remote ping', scope='library') == 0
    assert json.loads(capfd.readouterr().out) == {'ok': True, 'scope': 'library'}
    assert run_gate(vault, 'reader-remote search notes', scope='deliver') == 2
    assert run_gate(vault, 'reader-remote annotate /tmp/request.json', scope='library') == 2


ECHO_ARGV = [sys.executable, '-c', 'import json, sys; print(json.dumps([sys.argv[1:], sys.stdin.read()]))']


@pytest.mark.parametrize('command, expected', [
    ('reader-remote search notes --limit 3', ['search', 'notes', '--limit', '3']),
    ('reader-remote annotate -', ['annotate', '-']),
    ('reader-remote serve', ['serve', '--inline-only']),
])
def test_library_scope_dispatches_to_the_cli(vault, tmp_path, capfd, command, expected):
    stdin = tmp_path / 'stdin'
    stdin.write_text('{"op": "list"}')
    with stdin.open('rb') as stream:
        assert remote.gate('library', ECHO_ARGV, vault / '.reader', {'SSH_ORIGINAL_COMMAND': command}, stream) == 0
    assert json.loads(capfd.readouterr().out) == [expected, '{"op": "list"}']


@pytest.mark.parametrize('command', ['reader-remote serve --root /tmp', 'reader-remote serve x',
                                     'reader-remote status', 'reader-remote status a b',
                                     'reader-remote annotate list', 'reader-remote curation list'])
def test_gate_refuses_malformed_arguments(vault, command):
    assert run_gate(vault, command, scope='library') == 2


@pytest.mark.parametrize('header', [
    b'[]', b'"x"',
    (b'{"remote_delivery": 1, "files": [], '
     b'"submission": {"markdown": "x", "attachments": "abc"}}'),
    (b'{"remote_delivery": 1, "files": [{"role": "attachment", "bytes": 0}], '
     b'"submission": {"markdown": "x", "attachments": [1]}}'),
    b'[' * 100_000,
])
def test_malformed_header_is_a_controlled_refusal(vault, capfd, header):
    assert run_gate(vault, 'reader-remote ingest', header + b'\n') == 1
    assert 'Traceback' not in capfd.readouterr().err


def test_inline_only_mcp_session_refuses_server_files(vault, tmp_path):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    import asyncio
    secret = tmp_path / 'secret.txt'
    secret.write_text('private')

    async def exercise():
        parameters = StdioServerParameters(command=sys.executable, env=dict(os.environ),
                                           args=['-m', 'reader_mcp.cli', '--root', str(vault), 'serve', '--inline-only'])
        async with stdio_client(parameters) as (read, write):
            async with ClientSession(read, write) as client:
                await client.initialize()
                base = {'title': 'x', 'provenance': {}}
                for named in ({'document_path': str(secret)},
                              {'markdown': '# x', 'attachments': [{'source_path': str(secret), 'path': 'a.txt'}]}):
                    result = await client.call_tool('reader_ingest', {'submission': {
                        **base, **named, 'request_id': str(uuid4())}})
                    assert result.isError and 'inline markdown only' in result.content[0].text
                inline = await client.call_tool('reader_ingest', {'submission': {
                    **base, 'markdown': '# x', 'request_id': str(uuid4())}})
                assert not inline.isError, inline
    asyncio.run(exercise())
    assert len(list((vault / 'inbox').iterdir())) == 1


@pytest.mark.parametrize('request_', [[1], {'markdown': 'x', 'attachments': 5}, {'markdown': 'x', 'attachments': [1]},
                                      {'markdown': 'x', 'attachments': [{'path': 'a'}]}, {'document_path': 5}])
def test_encode_delivery_refuses_malformed_requests(request_):
    with pytest.raises(ValueError):
        remote.encode_delivery(request_)


def test_restricted_requests_never_share_a_connection():
    command = remote.ssh_command({'host': 'h', 'identity': '/k'}, ['reader-remote', 'ping'])
    assert command[1:3] == ['-S', 'none']


def test_encode_delivery_checks_count_before_reading(tmp_path):
    request = {'markdown': 'x', 'attachments': [{'source_path': '/nonexistent', 'path': f'{i}'} for i in range(65)]}
    with pytest.raises(ValueError, match='64-file'):
        remote.encode_delivery(request)


def test_client_forwards_stdin_for_dash(tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(remote.subprocess, 'run', lambda command, input: seen.update(command=command, input=input)
                        or subprocess.CompletedProcess(command, 0))
    monkeypatch.setattr(remote.sys, 'stdin', io.TextIOWrapper(io.BytesIO(b'{"op": "highlight"}')))
    assert remote.client(['annotate', '-'], {'host': 'h', 'identity': '/k'}) == 0
    assert seen['input'] == b'{"op": "highlight"}' and seen['command'][-1] == 'reader-remote annotate -'


def test_ping_timeout_is_a_failed_ping(monkeypatch):
    def stalled(*args, **kwargs):
        assert kwargs['timeout'] == remote.PING_TIMEOUT
        raise subprocess.TimeoutExpired(args[0], kwargs['timeout'])
    monkeypatch.setattr(remote.subprocess, 'run', stalled)
    assert remote.ping({'host': 'h', 'identity': '/k'}) is False


def test_damaged_config_is_reported_not_a_traceback(tmp_path, monkeypatch):
    config = tmp_path / 'remote.json'
    config.write_text('{"host": ')
    env = dict(os.environ, READER_REMOTE_CONFIG=str(config))
    result = subprocess.run([sys.executable, str(SCRIPTS / 'reader.py'), 'status', str(uuid4())],
                            env=env, capture_output=True, text=True)
    assert result.returncode == 1 and 'not a valid remote configuration' in result.stderr
    assert 'Traceback' not in result.stderr


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


def test_concurrent_authorizations_keep_both_keys(tmp_path, monkeypatch):
    """Each authorization stalls after reading; without the lock the second replace drops the first key."""
    import threading
    keys = [PUBLIC.replace('testkeyblob', f'testkey{n}lob') for n in (1, 2)]
    original, barrier = remote.Path.read_bytes, threading.Barrier(2, timeout=2)

    def slow_read(self):
        data = original(self)
        if self.name == 'authorized_keys':
            try:
                barrier.wait()
            except threading.BrokenBarrierError:
                pass  # the lock serialized the readers, as intended
        return data
    monkeypatch.setattr(remote.Path, 'read_bytes', slow_read)
    (tmp_path / 'ssh').mkdir()
    (tmp_path / 'ssh/authorized_keys').write_text('')
    results = []
    threads = [threading.Thread(target=lambda k=k: results.append(authorize(tmp_path, monkeypatch, key=k))) for k in keys]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    text = (tmp_path / 'ssh/authorized_keys').read_text()
    assert results == [0, 0] and all(k.split()[1] in text for k in keys)


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


def test_setup_saves_absolute_key_and_retries_without_agent_keys(tmp_path, monkeypatch):
    """The first login is answered by the gate, as when ssh-agent offers the Reader key itself."""
    fake = tmp_path / 'fake-ssh'
    fake.write_text(f'''#!{sys.executable}
import sys
if '-i' in sys.argv:
    print('{{"ok": true, "scope": "deliver"}}')
elif 'IdentitiesOnly=yes' in sys.argv:
    sys.stdin.read()
else:
    sys.exit('Reader: {remote.GATE_REFUSAL}')
''')
    fake.chmod(0o755)
    config = tmp_path / 'config/remote.json'
    monkeypatch.setenv('READER_SSH', str(fake))
    monkeypatch.setenv('READER_REMOTE_CONFIG', str(config))
    monkeypatch.chdir(tmp_path)
    assert remote.setup(['user@vault-host', '--key', 'keys/reader']) == 0
    identity = Path(json.loads(config.read_text())['identity'])
    assert identity.is_absolute() and identity.samefile(tmp_path / 'keys/reader')
