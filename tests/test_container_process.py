"""Real process cleanup is tested inside Docker; no Docker daemon is invoked by these cases."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

import pytest

from reader_mcp.container_process import ProcessError, execute


@pytest.mark.parametrize('failure', ['combined-output', 'closed-pipes', 'archive'])
def test_failure_reaps_the_control_plane_process_group(monkeypatch, failure):
    children = []
    popen = subprocess.Popen
    def record(*args, **kwargs):
        child = popen(*args, **kwargs)
        children.append(child)
        return child
    monkeypatch.setattr(subprocess, 'Popen', record)
    script = ('import os,time;os.write(1,b"a"*700);os.write(2,b"b"*700);time.sleep(30)'
              if failure != 'closed-pipes' else 'import os,time;os.close(1);os.close(2);time.sleep(30)')
    def archive(*args):raise ProcessError('archive full')
    expected = {'combined-output': 'output limit', 'closed-pipes': 'deadline', 'archive': 'archive full'}[failure]
    with pytest.raises(ProcessError, match=expected):
        execute([sys.executable, '-c', script], timeout=.5, limit=1024,
                output=archive if failure == 'archive' else None)
    assert len(children) == 1 and children[0].poll() is not None


def test_success_keeps_stdout_and_stderr_separate():
    result = execute([sys.executable, '-c', 'import sys;print("ok");print("warning",file=sys.stderr)'])
    assert result.returncode == 0 and result.stdout == 'ok\n' and result.stderr == 'warning\n'


def test_early_leader_exit_does_not_abandon_a_surviving_writer(tmp_path):
    pidfile = tmp_path / 'pid'
    script = ('import subprocess,sys,time;from pathlib import Path;'
              'p=subprocess.Popen([sys.executable,"-c","import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)"]);'
              f'Path({str(pidfile)!r}).write_text(str(p.pid))')
    try:
        with pytest.raises(ProcessError, match='deadline'):
            execute([sys.executable, '-c', script], timeout=.5)
        pid = int(pidfile.read_text())
        stat = Path(f'/proc/{pid}/stat')
        until = time.monotonic() + 2
        while stat.exists() and stat.read_text().rsplit(')', 1)[1].split()[0] != 'Z' and time.monotonic() < until:
            time.sleep(.01)
        assert not stat.exists() or stat.read_text().rsplit(')', 1)[1].split()[0] == 'Z'
    finally:
        if pidfile.exists():
            try:os.kill(int(pidfile.read_text()), signal.SIGKILL)
            except ProcessLookupError:pass


def test_failed_reap_does_not_announce_client_cleanup(monkeypatch):
    from reader_mcp import container_process
    finished=[]
    def denied(process):
        process.wait(timeout=5)
        raise PermissionError('cleanup unconfirmed')
    monkeypatch.setattr(container_process,'reap',denied)
    with pytest.raises(PermissionError,match='unconfirmed'):
        execute([sys.executable,'-c','print("done")'],finished=finished.append)
    assert finished == []
