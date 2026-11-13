import json
from pathlib import Path
import subprocess
import sys
import time

import pytest

from reader_mcp import arrival_choices, process_table, uploads
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
''' + before + '\n' + '''value=dict(source=context['source'],snapshot_sha256=context['snapshot_sha256'],disposition='file',collection='reports',slug='example',title='Example',author='',project='',summary='A bounded source description.',reason='')
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
    assert args[args.index('suppress_unstable_features_warning=true') - 1] == '-c'  # The user's config is ignored, so its own setting cannot quiet this.
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


def test_shutdown_allows_lock_release_cleanup_to_finish(tmp_path, monkeypatch):
    from reader_mcp.inbox_runner import WorkerProcesses
    marker = tmp_path / 'released'
    code = "import signal,time,pathlib\ndef stop(*args):\n time.sleep(4)\n pathlib.Path(" + repr(str(marker)) + ").write_text('released')\n raise SystemExit(0)\nsignal.signal(signal.SIGTERM,stop)\nprint('ready',flush=True)\ntime.sleep(60)"
    child = subprocess.Popen([sys.executable, '-c', code], stdout=subprocess.PIPE, text=True, start_new_session=True)
    try:
        assert child.stdout.readline().strip() == 'ready'
        tree = WorkerProcesses(child)
        tree.stop()
        assert marker.read_text() == 'released'
        def no_more_signals(*args):
            raise AssertionError('Shutdown must not signal retained process IDs again')
        monkeypatch.setattr(tree, 'signal_group', no_more_signals)
        tree.stop()
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
        assert not process_table.running(int(child_file.read_text()))
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
    monkeypatch.setattr(process_table, 'group_alive', lambda group: group in (111, 222))
    WorkerProcesses.signal_group(333, signal.SIGKILL)
    with pytest.raises(PermissionError):
        WorkerProcesses.signal_group(222, signal.SIGKILL)
    def unreadable(group):
        raise OSError('process table unreadable')
    monkeypatch.setattr(process_table, 'group_alive', unreadable)
    with pytest.raises(OSError, match='unreadable'):
        WorkerProcesses.signal_group(333, signal.SIGKILL)


def upload(vault, name, privacy):
    import hashlib, io
    from uuid import uuid4
    from reader_mcp import uploads
    data = f'# {name}\n'.encode()
    header = {'upload': 1, 'request_id': str(uuid4()), 'title': name, 'privacy': privacy,
              'files': [{'path': f'{name}.md', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}
    body = json.dumps(header).encode() + b'\n' + data
    return uploads.receive(vault, io.BytesIO(body), len(body), {'via': 'local'})['id']


def test_a_no_cloud_upload_never_reaches_a_cloud_model(vault, executable):
    (vault / 'inbox/test.md').unlink(missing_ok=True)
    fake = executable(before="(base/'cloud-saw-it').write_text('yes')")
    (vault / 'inbox/test.md').unlink(missing_ok=True)
    arrival = upload(vault, 'confidential', 'no-cloud')
    assert run(vault, str(fake)) == 0
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['status'] == 'finished' and state['result']['deferred_count'] == 1 and not (vault / '.reader/cloud-saw-it').exists()
    assert (vault / 'inbox' / arrival / 'confidential.md').is_file()
    assert not (vault / '.reader/inbox-runner/queue.json').exists(), 'it must not pin the queue for later uploads'
    steps = json.loads((vault / '.reader/inbox-runner/model-chain.json').read_text())['steps']
    assert steps[-1]['state'] == 'unanswered' and 'No permitted model' in steps[-1]['message']
    later = upload(vault, 'later', 'normal')
    assert run(vault, str(fake), only={later}) == 0
    assert not (vault / 'inbox' / later).exists() and (vault / 'inbox' / arrival).exists()


def test_a_scoped_run_files_only_the_chosen_arrival(vault, executable):
    fake = executable()
    chosen, other = upload(vault, 'chosen', 'normal'), upload(vault, 'other', 'normal')
    assert run(vault, str(fake), only={chosen}) == 0
    selection = json.loads((vault / '.reader/inbox-runner/selection.json').read_text())
    assert selection['arrivals'] == ['inbox/' + chosen]
    assert not (vault / 'inbox' / chosen).exists()
    assert (vault / 'inbox' / other / 'other.md').is_file() and (vault / 'inbox/test.md').is_file()


def test_no_cloud_default_keeps_an_unlabelled_arrival_off_cloud_models(vault, executable, monkeypatch):
    monkeypatch.delenv('READER_UNMARKED_PRIVACY')
    uploads.settings(vault, {'default_privacy': 'no-cloud'})
    fake = executable(before="(base/'cloud-saw-it').write_text('yes')")
    assert run(vault, str(fake)) == 0
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['result']['deferred_count'] == 1 and not (vault / '.reader/cloud-saw-it').exists()
    assert (vault / 'inbox/test.md').is_file()


def test_initial_default_files_an_unlabelled_arrival_with_cloud_models(vault, executable, monkeypatch):
    monkeypatch.delenv('READER_UNMARKED_PRIVACY')
    fake = executable(before="(base/'cloud-saw-it').write_text('yes')")
    assert run(vault, str(fake)) == 0
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['result']['filed_count'] == 1
    assert (vault / '.reader/cloud-saw-it').read_text() == 'yes'
    assert not (vault / 'inbox/test.md').exists()


def test_allowing_cloud_models_files_an_arrival_with_no_level(vault, executable, monkeypatch):
    monkeypatch.delenv('READER_UNMARKED_PRIVACY')
    uploads.settings(vault, {'default_privacy': 'no-cloud'})
    arrival_choices.choose(vault, 'test.md', arrival_choices.CLOUD)
    assert run(vault, str(executable())) == 0
    assert not (vault / 'inbox/test.md').exists()


@pytest.mark.parametrize('default', ['normal', 'no-cloud'])
@pytest.mark.parametrize('level', ['no-cloud', 'machine-only', 'NORMAL', ['normal']])
def test_restricted_or_unknown_levels_stay_local(vault, monkeypatch, default, level):
    monkeypatch.delenv('READER_UNMARKED_PRIVACY')
    uploads.settings(vault, {'default_privacy': default})
    assert arrival_choices.local_only(vault, 'x', {'privacy': level}) is True


def test_a_held_arrival_is_left_out_of_every_run(vault, executable):
    fake = executable(before="(base/'model-saw-it').write_text('yes')")
    held = upload(vault, 'held', 'normal')
    arrival_choices.choose(vault, held, arrival_choices.HOLD)
    (vault / 'inbox/test.md').unlink()
    assert run(vault, str(fake)) == 0
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['status'] == 'empty' and 'on hold' in state['message'] and not (vault / '.reader/model-saw-it').exists()
    assert run(vault, str(fake), only={held}) == 0, 'naming it does not get past the hold'
    assert (vault / 'inbox' / held / 'held.md').is_file() and not (vault / '.reader/model-saw-it').exists()
    assert held not in subprocess.run(['git', 'log', '--all', '-p'], cwd=vault, capture_output=True, text=True).stdout
    arrival_choices.choose(vault, held, None)
    assert run(vault, str(fake)) == 0
    assert not (vault / 'inbox' / held).exists()


def test_a_run_files_what_is_not_held(vault, executable):
    fake = executable()
    held = upload(vault, 'held', 'normal')
    arrival_choices.choose(vault, held, arrival_choices.HOLD)
    assert run(vault, str(fake)) == 0
    assert not (vault / 'inbox/test.md').exists() and (vault / 'inbox' / held / 'held.md').is_file()


def test_a_hold_placed_during_a_run_stops_that_arrivals_model_call(vault, executable):
    held = upload(vault, 'held', 'normal')
    # The first arrival's model call places a hold on the other, as a person pressing Hold mid-run would.
    fake = executable(before=f"""(base/'calls').open('a').write(context['source']+chr(10))
import reader_mcp.arrival_choices as choices
choices.choose(base.parent, 'test.md' if context['source'].endswith({held!r}) else {held!r}, choices.HOLD)""")
    assert run(vault, str(fake)) == 0
    calls = (vault / '.reader/calls').read_text().split()
    assert len(calls) == 1, calls
    left = (vault / 'inbox/test.md') if calls[0].endswith(held) else (vault / 'inbox' / held / 'held.md')
    assert left.is_file()


def test_an_unreadable_choices_file_stops_the_run(vault, executable):
    (vault / '.reader/arrival-choices.json').write_text('not json')
    assert run(vault, str(executable())) != 0
    assert (vault / 'inbox/test.md').is_file()
    with pytest.raises(ValueError):
        arrival_choices.choose(vault, 'test.md', arrival_choices.HOLD)
    assert (vault / '.reader/arrival-choices.json').read_text() == 'not json'


def test_a_choice_needs_a_waiting_arrival(vault):
    with pytest.raises(ValueError):
        arrival_choices.choose(vault, '../escape', arrival_choices.HOLD)
    with pytest.raises(ValueError):
        arrival_choices.choose(vault, 'test.md', 'sometimes')
    with pytest.raises(ValueError):
        arrival_choices.choose(vault, 'not-waiting.md', arrival_choices.HOLD)
    assert arrival_choices.read(vault) == {}


def test_progress_counts_are_shown_only_when_plausible():
    from reader_mcp.inbox_runner import progress_counts
    assert progress_counts({'phase': 'decision', 'done': 3, 'total': 7}) == {'done': 3, 'total': 7}
    assert progress_counts({'phase': 'decision', 'done': 0, 'total': 7}) == {'done': 0, 'total': 7}
    for bad in ({}, {'done': 3}, {'done': 8, 'total': 7}, {'done': -1, 'total': 7}, {'done': 0, 'total': 0},
                {'done': '3', 'total': 7}, {'done': True, 'total': 7}, {'done': 3.0, 'total': 7}):
        assert progress_counts({'phase': 'decision', **bad}) is None, bad


def test_a_finished_run_reports_every_arrival_decided(vault, executable):
    for name in ('second', 'third'):
        (vault / 'inbox' / (name + '.md')).write_text('Another source')
    assert run(vault, str(executable())) == 0
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert state['phase'] == 'committed' and state['progress'] == {'done': 3, 'total': 3}
