"""Real process/launch-gate checks, executed only in the bounded Docker test worker."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

from reader_mcp import container_clients as module
from reader_mcp.container_clients import Clients, identity
from reader_mcp.container_process import ProcessError, execute, group_finished


def test_failed_durable_save_cannot_start_the_real_command(tmp_path):
    marker=tmp_path/'started'
    def denied(pid):
        # Give an ungated child time to expose the launch race.
        deadline=time.monotonic()+.3
        while not marker.exists() and time.monotonic()<deadline:time.sleep(.01)
        raise OSError('disk unavailable')
    with pytest.raises(OSError,match='disk unavailable'):
        execute([sys.executable,'-c','from pathlib import Path;Path('+repr(str(marker))+').touch()'],started=denied)
    assert not marker.exists(), 'The client must wait for durable admission'


def test_gated_client_records_kernel_birth_before_execution(tmp_path):
    changes=[];journal=Clients(changes.append)
    result=execute([sys.executable,'-c','print("task")'],started=journal.started,finished=journal.finished)
    assert result.stdout=='task\n'
    assert changes[0]['control_clients'][0]['pid']>1 and changes[0]['control_clients'][0]['boot']
    assert changes[-1]=={'control_clients':[]}


def test_pid_reuse_or_lost_leader_never_signals_an_unproven_group(monkeypatch):
    token={'pid':54321,'group':54321,'started':'old','host':'host','boot':'boot'}
    journal=Clients(lambda _:None,[token]);signals=[]
    monkeypatch.setattr(module,'group_finished',lambda _:False)
    monkeypatch.setattr(module,'identity',lambda _:token|{'started':'new'})
    monkeypatch.setattr(module.os,'killpg',lambda *args:signals.append(args))
    with pytest.raises(ProcessError,match='safely identified'):journal.reconcile()
    assert signals==[] and journal.values


def test_journal_refuses_unreadable_group_proof_without_erasing_it(monkeypatch):
    token={'pid':54321,'group':54321,'started':'old','host':'host','boot':'boot'}
    journal=Clients(lambda _:None,[token])
    monkeypatch.setattr(module,'group_finished',lambda _:False)
    monkeypatch.setattr(module,'identity',lambda pid: {'host':'host','boot':'boot'} if pid==os.getpid() else None)
    with pytest.raises(ProcessError):journal.reconcile()
    assert journal.values


def test_supervisor_death_retains_and_recovers_a_closed_pipe_client(tmp_path):
    record=tmp_path/'journal.json';ready=tmp_path/'ready'
    # This controlled CLI closes both pipes, keeps an unlinked 1MiB file, and has a child.
    task='''import os,subprocess,sys,time
from pathlib import Path
f=open(sys.argv[1],"wb");f.write(b"x"*1048576);f.flush();os.unlink(sys.argv[1])
subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"])
Path(sys.argv[2]).touch();os.close(1);os.close(2);time.sleep(30)
'''
    supervisor='''import json,os,sys
from pathlib import Path
from reader_mcp.container_clients import Clients
from reader_mcp.container_process import execute
path=Path(sys.argv[1])
def save(data):
 with path.open('w') as stream:json.dump(data,stream);stream.flush();os.fsync(stream.fileno())
journal=Clients(save)
execute([sys.executable,'-c',sys.argv[3],sys.argv[4],sys.argv[2]],timeout=40,started=journal.started,finished=journal.finished)
'''
    parent=subprocess.Popen([sys.executable,'-c',supervisor,str(record),str(ready),task,str(tmp_path/'unlinked')],env=dict(os.environ,PYTHONPATH=str(Path(__file__).resolve().parents[1]/'src')))
    journal=None
    try:
        deadline=time.monotonic()+5
        while not ready.exists() and parent.poll() is None and time.monotonic()<deadline:time.sleep(.02)
        assert ready.exists()
        saved=json.loads(record.read_text())['control_clients'];assert len(saved)==1
        parent.kill();parent.wait(timeout=5)
        assert not group_finished(saved[0]['group']), 'Only Reader died; its CLI group is still live'
        changes=[];journal=Clients(changes.append,saved);journal.reconcile()
        assert not journal.values and group_finished(saved[0]['group'])
        assert changes[-1]=={'control_clients':[]}
    finally:
        if parent.poll() is None:parent.kill();parent.wait(timeout=5)
        if record.exists():
            for value in json.loads(record.read_text()).get('control_clients',[]):
                if identity(value['pid'])==value:
                    try:os.killpg(value['pid'],9)
                    except ProcessLookupError:pass
