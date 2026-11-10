"""The process table without `ps` (#252). Oracles: the kernel's own answers for processes this test controls
(os.getpid, os.getppid, os.getpgid, a child started in its own session), never the module under test."""
import os
import subprocess
import sys
import time

import pytest

from reader_mcp import process_table


@pytest.fixture
def group():
    """A process group of three: a shell leader and two sleeping children."""
    leader = subprocess.Popen(['/bin/sh', '-c', 'sleep 30 & sleep 30 & wait'], start_new_session=True)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and sum(g == leader.pid for _, _, g, _ in process_table.rows()) < 3:
        time.sleep(.05)
    yield leader
    if leader.poll() is None:
        os.killpg(leader.pid, 9)
        leader.wait()


def test_rows_report_this_process_with_its_parent_group_and_memory():
    me = [row for row in process_table.rows() if row[0] == os.getpid()]
    assert len(me) == 1
    pid, parent, group, rss = me[0]
    assert parent == os.getppid() and group == os.getpgid(0)
    assert rss > 1024**2  # a running Python interpreter holds more than a MiB


def test_a_new_session_is_its_own_group_and_its_children_join_it(group):
    members = [(pid, parent) for pid, parent, g, _ in process_table.rows() if g == group.pid]
    assert len(members) == 3
    assert (group.pid, os.getpid()) in members
    assert sum(parent == group.pid for _, parent in members) == 2
    assert process_table.group_alive(group.pid)
    assert process_table.group_rss(group.pid) > 0


def test_a_killed_group_is_gone_and_a_reaped_child_is_not_running(group):
    os.killpg(group.pid, 9)
    # The signal is delivered asynchronously; wait for the leader to exit. Unreaped, it stays a zombie.
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and process_table.running(group.pid):
        time.sleep(.05)
    assert not process_table.running(group.pid)
    assert group.wait(timeout=10) == -9  # it had not been reaped yet: not running is not the same as gone
    while time.monotonic() < deadline and process_table.group_alive(group.pid):
        time.sleep(.05)
    assert not process_table.group_alive(group.pid)
    assert process_table.started(group.pid) is None


def test_start_time_uses_the_ps_lstart_format_and_is_stable(group):
    started = process_table.started(group.pid)
    parsed = time.strptime(started, process_table.LSTART)
    assert abs(time.mktime(parsed) - time.time()) < 60
    assert process_table.started(group.pid) == started
    assert process_table.running(group.pid)


@pytest.mark.skipif(sys.platform != 'darwin', reason='macOS reads the table through libproc')
def test_an_unreadable_table_raises_instead_of_reporting_no_processes(monkeypatch):
    class Refusing:
        def proc_listallpids(self, buffer, size):
            return -1

        def proc_listpgrppids(self, group, buffer, size):
            return -1

    monkeypatch.setattr(process_table, '_libproc', Refusing())
    with pytest.raises(OSError):
        process_table.rows()
    with pytest.raises(OSError):
        process_table.group_alive(os.getpgid(0))
