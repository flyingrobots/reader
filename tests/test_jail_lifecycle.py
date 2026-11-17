"""A jail owns its separate test group until interruption cleanup is complete."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
from collections.abc import Iterator

import pytest

FIXTURE = Path(__file__).with_name('fake_jail_lifecycle.py')
JAIL = Path(__file__).resolve().parents[1] / 'scripts/test_jail.py'
pytestmark = pytest.mark.skipif(sys.platform == 'darwin', reason='Process-table lifecycle oracle runs in the bounded container worker')


def ready(process: subprocess.Popen[str]) -> dict[str, int]:
    assert process.stdout is not None
    readable, _, _ = select.select([process.stdout], [], [], 5)
    assert readable, 'Synthetic process did not reach its explicit readiness barrier'
    line = process.stdout.readline(1024)
    assert line.endswith('\n'), line
    return json.loads(line)


def running(pid: int) -> bool:
    result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'stat='],
                            capture_output=True, text=True, timeout=3, check=False)
    assert result.returncode in (0, 1) and not result.stderr, result
    return any(not state.startswith('Z') for state in result.stdout.split())


@contextmanager
def scenario(tmp_path: Path, *, timeout: float = 0, exit_code: int = 0, mode: str = 'runner') -> Iterator[tuple[subprocess.Popen[str], dict[str, int], subprocess.Popen[str], Path]]:
    run = tmp_path / 'jail-run'
    run.mkdir()
    outsider = subprocess.Popen([sys.executable, str(FIXTURE), 'sleeper'],
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, text=True, start_new_session=True)
    jail = None
    owned: dict[str, int] = {}
    try:
        ready(outsider)
        jail = subprocess.Popen([sys.executable, str(FIXTURE), mode, str(JAIL), str(run), str(timeout), str(exit_code)],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, start_new_session=True)
        owned = ready(jail)
        assert owned['group'] == owned['pid'] and owned['group'] != jail.pid
        yield jail, owned, outsider, run
    finally:
        # The harness must retire the deliberately orphaned group even on RED.
        if owned:
            try:
                os.killpg(owned['group'], signal.SIGKILL)
            except ProcessLookupError:
                pass
        for process in (jail, outsider):
            if process is None:
                continue
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()


@pytest.mark.parametrize('interruption', [signal.SIGTERM, signal.SIGINT])
def test_interrupting_only_the_jail_retires_its_test_group(tmp_path: Path, interruption: int) -> None:
    with scenario(tmp_path) as (jail, owned, outsider, run):
        os.kill(jail.pid, interruption)
        try:
            jail.wait(timeout=8)
        except subprocess.TimeoutExpired:
            pytest.fail('Jail interruption did not complete within its cleanup budget')
        assert not running(owned['pid']) and not running(owned['descendant']), 'Interrupted jail left its owned group running'
        assert jail.returncode == 128 + interruption
        assert outsider.poll() is None and running(outsider.pid), 'An unrelated group must remain untouched'
        assert not run.exists(), 'Confirmed termination permits removal of the owned run directory'


@pytest.mark.parametrize('exit_code', [0, 7])
def test_normal_jail_completion_preserves_the_command_exit_code(tmp_path: Path, exit_code: int) -> None:
    with scenario(tmp_path, exit_code=exit_code) as (jail, owned, outsider, run):
        assert jail.stdin is not None
        jail.stdin.write('finish\n')
        jail.stdin.flush()
        assert jail.wait(timeout=8) == exit_code
        assert not running(owned['pid']) and not running(owned['descendant'])
        assert outsider.poll() is None
        assert not run.exists()


def test_normal_completion_retires_a_descendant_the_command_left_running(tmp_path: Path) -> None:
    with scenario(tmp_path, mode='orphan', exit_code=7) as (jail, owned, outsider, run):
        assert jail.stdin is not None
        jail.stdin.write('finish\n')
        jail.stdin.flush()
        assert jail.wait(timeout=8) == 7
        assert not running(owned['descendant']), 'Normal exit left a live descendant in the test group'
        assert outsider.poll() is None
        assert not run.exists()


def test_the_jail_deadline_retires_its_group_and_returns_125(tmp_path: Path) -> None:
    with scenario(tmp_path, timeout=0.5) as (jail, owned, outsider, run):
        assert jail.wait(timeout=8) == 125
        assert not running(owned['pid']) and not running(owned['descendant'])
        assert outsider.poll() is None
        assert not run.exists()


def test_normal_completion_can_retain_leader_custody_without_waitid(tmp_path: Path) -> None:
    with scenario(tmp_path, mode='fallback', exit_code=7) as (jail, owned, outsider, run):
        assert jail.stdin is not None
        jail.stdin.write('finish\n')
        jail.stdin.flush()
        assert jail.wait(timeout=8) == 7
        assert not running(owned['pid']) and not running(owned['descendant'])
        assert outsider.poll() is None
        assert not run.exists()


def test_unconfirmed_group_cleanup_reports_failure_and_retains_its_directory(tmp_path: Path) -> None:
    with scenario(tmp_path, mode='unreadable') as (jail, owned, outsider, run):
        os.kill(jail.pid, signal.SIGTERM)
        assert jail.wait(timeout=8) != 0
        assert jail.stderr is not None
        diagnostic = jail.stderr.read(8192)
        assert 'cleanup unconfirmed; retained' in diagnostic
        assert 'Synthetic process-table visibility failure' in diagnostic
        assert run.is_dir(), 'Unknown termination must not be reported as clean removal'
        assert outsider.poll() is None


def test_lost_child_custody_refuses_signals_to_an_unverified_group(tmp_path: Path) -> None:
    with scenario(tmp_path, mode='lost-waitid') as (jail, owned, outsider, run):
        assert jail.wait(timeout=8) != 0
        assert not (run / 'unverified-signals').exists(), 'Lost child custody must refuse numeric group signals'
        assert run.is_dir()
        assert outsider.poll() is None


def test_a_process_table_missing_the_pinned_leader_cannot_confirm_cleanup(tmp_path: Path) -> None:
    with scenario(tmp_path, mode='missing-leader') as (jail, owned, outsider, run):
        os.kill(jail.pid, signal.SIGTERM)
        assert jail.wait(timeout=8) != 0
        assert jail.stderr is not None
        assert 'cleanup unconfirmed; retained' in jail.stderr.read(8192)
        assert run.is_dir(), 'An incomplete process table is not proof of complete cleanup'
        assert outsider.poll() is None
