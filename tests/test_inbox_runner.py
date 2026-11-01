import json
from pathlib import Path
import subprocess
import sys
import time

import pytest

from reader_mcp.inbox_runner import inventory, run, sandbox_writable_paths
from reader_mcp import intake
from test_intake import vault, plan_for


def test_workstation_store_must_exist_and_be_a_git_directory(tmp_path):
    with pytest.raises((ValueError, FileNotFoundError)):
        sandbox_writable_paths(tmp_path,'relative-store')
    with pytest.raises((ValueError, FileNotFoundError)):
        sandbox_writable_paths(tmp_path,str(tmp_path/'missing'))
    store=tmp_path/'not-git';store.mkdir()
    with pytest.raises(ValueError,match='existing Git directory'):
        sandbox_writable_paths(tmp_path,str(store))


def test_discovers_repository_store_from_installed_git_locks(tmp_path, monkeypatch):
    import reader_mcp.inbox_runner as runner
    store=tmp_path/'separate-store';store.mkdir()
    tool=tmp_path/'git-locks';tool.write_text('#!'+sys.executable+'\nimport json\nprint(json.dumps({"store":'+repr(str(store))+'}))\n');tool.chmod(0o755)
    monkeypatch.setenv('READER_GIT_LOCKS',str(tool))
    paths=sandbox_writable_paths(tmp_path)
    assert str(store) in paths
    assert str(tmp_path.parent) not in paths




@pytest.fixture
def executable(vault, monkeypatch):
    tool = vault / '.reader/fake-git-locks'
    tool.write_text('#!' + sys.executable + '\nimport sys,json\nprint(json.dumps({"event":"claimed","acquisition":"test-acquisition"} if "claim" in sys.argv else {"event":"released"}))\n')
    tool.chmod(0o755)
    monkeypatch.setenv('READER_GIT_LOCKS', str(tool))
    source = vault / 'inbox/test.md'
    source.write_text('Source bytes\n')
    def make(before='', output=None):
        fake = vault / '.reader/fake-codex'
        fake.write_text('#!' + sys.executable + '\n' + '''import sys,pathlib,json,os
args=sys.argv
base=pathlib.Path(__file__).parent
prompt=sys.stdin.read()
context=json.loads(prompt.rsplit("\\n\\n",1)[1])
(base/'arguments.json').write_text(json.dumps(args))
''' + before + '\n' + '''value=dict(source=context['source'],snapshot_sha256=context['snapshot_sha256'],disposition='file',collection='reports',slug='example',title='Example',author='',summary='A bounded source description.',reason='')
pathlib.Path(args[args.index('--output-last-message')+1]).write_text(''' + (repr(output) if output is not None else 'json.dumps(value)') + ')\n')
        fake.chmod(0o755)
        return fake
    return make


def test_runner_owns_filing_and_model_only_returns_a_read_only_decision(vault, executable):
    fake = executable()
    assert run(vault, str(fake)) == 0
    runtime = vault / '.reader/inbox-runner'
    state = json.loads((runtime / 'state.json').read_text())
    assert state['status'] == 'finished' and state['result']['commit'] and not state['remaining']
    args = json.loads((vault / '.reader/arguments.json').read_text())
    assert args[args.index('--sandbox') + 1] == 'read-only'
    assert '--ignore-user-config' in args and '--output-schema' in args and '--add-dir' not in args
    assert '--dangerously-bypass-approvals-and-sandbox' not in args
    assert 'reader_mcp.intake' in state['command']
    result = json.loads((runtime / 'result.json').read_text())
    assert (vault / result['filed'][0] / 'originals/test.md').read_text() == 'Source bytes\n'
    assert not (runtime / 'pending.json').exists()


def test_progress_allows_a_finite_queue_to_exceed_one_step_deadline(vault, executable):
    for name in ('second', 'third', 'fourth'):
        (vault / 'inbox' / (name + '.md')).write_text('Another source')
    fake = executable(before='import time; time.sleep(1)')
    assert run(vault, str(fake), timeout=2.5) == 0
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['result']['filed_count'] == 4


def test_stalled_model_still_hits_the_progress_deadline(vault, executable):
    fake = executable(before='import time; time.sleep(60)')
    assert run(vault, str(fake), timeout=1.5) == 1
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert 'time limit' in state['message'] and (vault / 'inbox/test.md').is_file()


def test_shutdown_allows_lock_release_cleanup_to_finish(tmp_path):
    from reader_mcp.inbox_runner import WorkerProcesses
    marker = tmp_path / 'released'
    code = "import signal,time,pathlib\ndef stop(*args):\n time.sleep(4)\n pathlib.Path(" + repr(str(marker)) + ").write_text('released')\n raise SystemExit(0)\nsignal.signal(signal.SIGTERM,stop)\nprint('ready',flush=True)\ntime.sleep(60)"
    child = subprocess.Popen([sys.executable, '-c', code], stdout=subprocess.PIPE, text=True, start_new_session=True)
    try:
        assert child.stdout.readline().strip() == 'ready'
        WorkerProcesses(child).stop()
        assert marker.read_text() == 'released'
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()


def test_bad_model_response_and_failure_never_claim_success(vault, executable):
    fake = executable(output='Done! Everything is filed.')
    assert run(vault, str(fake)) == 1
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['status'] == 'failed'
    assert (vault / 'inbox/test.md').read_text() == 'Source bytes\n'
    assert not (vault / 'library/reports').exists()
    fake = executable(before='raise SystemExit(7)')
    assert run(vault, str(fake)) == 1
    assert (vault / 'inbox/test.md').is_file()


def test_later_arrivals_stay_outside_the_selected_batch(vault, executable):
    fake = executable(before="(base.parent/'inbox/later.md').write_text('A later arrival')")
    assert run(vault, str(fake)) == 0
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['remaining'] == ['inbox/later.md']
    assert (vault / 'inbox/later.md').read_text() == 'A later arrival'
    assert state['result']['filed_count'] == 1


def test_resume_works_with_empty_inbox_and_never_reinvokes_the_model(vault, executable):
    fake = executable(before="raise RuntimeError('must not reclassify')")
    plan = plan_for(vault, 'inbox/test.md')
    hook = vault / '.git/hooks/pre-commit'
    hook.write_text('#!/bin/sh\nexit 1\n')
    hook.chmod(0o755)
    with pytest.raises(ValueError):
        intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    assert inventory(vault) == []
    hook.write_text('#!/bin/sh\nexit 0\n')
    assert run(vault, str(fake)) == 0
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['status'] == 'finished' and state['result']['batch_id'] == plan['batch_id']
    assert not (vault / '.reader/arguments.json').exists()


def test_duplicate_launch_and_cancel_stop_model_descendants_in_another_group(vault, executable):
    fake = executable(before="""import subprocess,time
child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'],start_new_session=True)
(base/'descendant.pid').write_text(str(child.pid))
time.sleep(60)
""")
    process = subprocess.Popen([sys.executable, '-m', 'reader_mcp.inbox_runner', '--root', str(vault), '--codex', str(fake)])
    runtime = vault / '.reader/inbox-runner'
    child_file = vault / '.reader/descendant.pid'
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not child_file.exists():
            time.sleep(.05)
        assert child_file.exists()
        assert run(vault, str(fake)) == 2
        (runtime / 'cancel').write_text('stop')
        assert process.wait(timeout=10) == 1
        assert json.loads((runtime / 'state.json').read_text())['status'] == 'stopped'
        status = subprocess.run(['ps', '-p', child_file.read_text(), '-o', 'stat='], capture_output=True, text=True)
        assert not status.stdout.strip() or status.stdout.strip().startswith('Z')
        assert (vault / 'inbox/test.md').is_file()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def test_empty_inbox_and_resource_refusal_do_not_run_model(vault, executable, monkeypatch):
    import reader_mcp.inbox_runner as runner
    fake = executable()
    monkeypatch.setattr(runner, 'has_capacity', lambda root: False)
    assert run(vault, str(fake)) == 1
    assert not (vault / '.reader/arguments.json').exists()
    (vault / 'inbox/test.md').unlink()
    assert run(vault, str(fake)) == 0
    assert json.loads((vault / '.reader/inbox-runner/state.json').read_text())['status'] == 'empty'


def test_inventory_includes_hidden_attachments_and_refuses_symlinks(vault):
    folder = vault / 'inbox/packet'
    folder.mkdir()
    (folder / '.notes.txt').write_text('substantive')
    (folder / '.DS_Store').write_text('OS junk')
    assert inventory(vault) == ['inbox/packet/.notes.txt']
    (folder / 'alias').symlink_to(folder / '.notes.txt')
    with pytest.raises(ValueError, match='symlinks'):
        inventory(vault)


def test_runner_preserves_a_lower_inherited_cpu_limit(vault, executable):
    import resource
    fake = executable()
    result = subprocess.run([sys.executable, '-m', 'reader_mcp.inbox_runner', '--root', str(vault), '--codex', str(fake)],
        capture_output=True, text=True, timeout=20,
        preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_CPU, (20, 20)))
    assert result.returncode == 0, result.stderr
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['status'] == 'finished' and state['limits']['cpu_seconds'] == 20


def test_group_permission_error_requires_proof_that_group_is_gone(monkeypatch):
    from reader_mcp.inbox_runner import WorkerProcesses
    import os
    import signal
    def denied(*args):
        raise PermissionError('group disappeared or remains protected')
    monkeypatch.setattr(os, 'killpg', denied)
    monkeypatch.setattr(subprocess, 'check_output', lambda *args, **kwargs: '111\n222\n')
    WorkerProcesses.signal_group(333, signal.SIGKILL)
    with pytest.raises(PermissionError):
        WorkerProcesses.signal_group(222, signal.SIGKILL)
    def unreadable(*args, **kwargs):
        raise subprocess.CalledProcessError(1, 'ps')
    monkeypatch.setattr(subprocess, 'check_output', unreadable)
    with pytest.raises(subprocess.CalledProcessError):
        WorkerProcesses.signal_group(333, signal.SIGKILL)
