"""Canaries for the enforced test sandbox (scripts/test_jail.py, #247).

Each canary attempts something no test may do and requires the sandbox to refuse it with a permission error, not
some other failure: a refused connection or a missing file would also "fail", and would pass these tests even if the
sandbox were gone. The positive controls show the same operations still work where they are allowed.

Oracle: the runner's own record of what it protects (READER_TEST_JAIL_PROTECTED, _PORTS, _PROGRAMS, _SOCKET).
"""
import errno
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

import pytest

MODE = os.environ.get('READER_TEST_JAIL')
pytestmark = pytest.mark.skipif(MODE != 'sandbox-exec', reason='only meaningful inside the macOS test sandbox')
REFUSED = (errno.EPERM, errno.EACCES)


def listed(name):
    return json.loads(os.environ.get('READER_TEST_JAIL_' + name) or '[]')


def refused(call):
    with pytest.raises(OSError) as caught:
        call()
    assert caught.value.errno in REFUSED, f'expected a sandbox refusal, got {caught.value!r}'


def test_the_runner_declares_what_it_protects():
    # Witness counts: an empty list would make the canaries below pass vacuously.
    assert len(listed('PROTECTED')) >= 5
    assert 8766 in listed('PORTS')
    assert os.environ['HOME'] != os.environ['READER_TEST_JAIL_REAL_HOME']


def test_protected_paths_cannot_be_read():
    # The runner records which protected paths exist; inside the sandbox even that check is refused.
    existing = [Path(p) for p in listed('PROTECTED_EXISTING')]
    assert existing, 'no protected path exists on this machine; nothing was checked'
    for path in existing:
        refused(lambda: os.close(os.open(path, os.O_RDONLY)))  # works for files and directories alike


def test_the_real_home_cannot_be_written():
    target = Path(os.environ['READER_TEST_JAIL_REAL_HOME']) / f'.reader-test-jail-canary-{os.getpid()}'
    refused(lambda: target.write_text('escaped'))
    assert not target.exists()


def test_the_guard_probe_cannot_be_written():
    refused(lambda: (Path(os.environ['READER_TEST_JAIL_PROBE']) / 'escape').write_text('escaped'))


def test_live_service_ports_cannot_be_reached():
    for port in listed('PORTS'):
        with socket.socket() as client:
            refused(lambda: client.connect(('127.0.0.1', port)))


def test_external_hosts_cannot_be_reached():
    with socket.socket() as client:
        client.settimeout(5)
        refused(lambda: client.connect(('1.1.1.1', 443)))


def test_the_speech_socket_cannot_be_reached():
    with socket.socket(socket.AF_UNIX) as client:
        refused(lambda: client.connect(os.environ['READER_TEST_JAIL_SOCKET']))


def test_real_agent_clis_cannot_start():
    programs = listed('PROGRAMS')
    if not programs:
        pytest.skip('no agent CLI is installed on this machine')
    for program in programs:
        refused(lambda: subprocess.run([program, '--version'], capture_output=True, timeout=10))


def test_a_child_process_inherits_the_sandbox():
    probe = Path(os.environ['READER_TEST_JAIL_PROBE']) / 'child'
    code = f'open({str(probe)!r}, "w")'
    result = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=30)
    assert result.returncode != 0 and 'Operation not permitted' in result.stderr
    assert not probe.exists()


def test_loopback_and_the_run_directory_still_work():
    with socket.socket() as server:
        server.bind(('127.0.0.1', 0))
        server.listen(1)
        with socket.create_connection(server.getsockname(), timeout=5):
            pass
    scratch = Path(os.environ['TMPDIR']) / 'canary'
    scratch.write_text('allowed')
    assert scratch.read_text() == 'allowed'
