"""Scratch adversarial probes (Moriarty). Untracked; synthetic fixtures only."""
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time

import pytest

from coding_fixture import World
from reader_mcp import coding_agents
from reader_mcp.coding_workflow import process_started


@pytest.fixture
def world(tmp_path):
    made = []

    def build(**options):
        folder = tmp_path / f'w{len(made)}'
        folder.mkdir()
        made.append(World(folder, **options))
        return made[-1]
    yield build
    for item in made:
        item.close()


def test_m1_admission_whose_run_record_cannot_be_saved_leaves_no_orphan(world, monkeypatch):
    w = world()
    w.jobs.work = lambda: None
    write, failed = w.jobs.store._write, []

    def once(path, data):
        if data.get('status') == 'queued' and 'fingerprint' not in data and not failed:
            failed.append(True)
            raise OSError(28, 'synthetic full runtime disk')
        write(path, data)
    monkeypatch.setattr(w.jobs.store, '_write', once)
    request = w.request()
    with pytest.raises(OSError):
        w.jobs.submit(request)
    w.jobs.store.retry()  # What the queue worker does every second.
    second = w.jobs.submit(dict(request))  # The browser retries with the same request UUID.
    mine = [r for r in w.jobs.store.runs() if r['request_id'] == request['request_id']]
    orphan = [r for r in mine if r['id'] != second['id']]
    stopped = w.jobs.stop(orphan[0]['id']) if orphan else None
    assert len(mine) == 1, (f'one request UUID owns {len(mine)} run records; orphan status={orphan[0]["status"]!r} '
                            f'not queued={orphan[0]["id"] not in w.jobs.queue}; Stop answered stopped={stopped["stopped"]} '
                            f'but the record stays {w.jobs.store.load(orphan[0]["id"])["status"]!r}')


def test_m2_server_shutdown_is_not_recorded_as_the_users_stop(world, monkeypatch):
    w = world()
    entered, release = threading.Event(), threading.Event()
    viewer = w.github.viewer

    def blocked():
        entered.set()
        assert release.wait(30)
        return viewer()
    monkeypatch.setattr(w.github, 'viewer', blocked)
    admitted = w.jobs.submit(w.request())
    assert entered.wait(10)
    w.jobs.close()  # Reader is quitting; nobody pressed Stop.
    release.set()
    w.jobs.worker.join(timeout=20)
    run = w.jobs.store.load(admitted['id'])
    assert not (run['outcome'] == 'cancelled' and 'Stopped by you' in run['message']), (run['outcome'], run['message'])


def test_m3_pull_request_closes_only_the_jobs_issue(world, monkeypatch):
    w = world()
    report = coding_agents.report

    def extra(text):
        result, problem = report(text)
        if result:
            result['pr_body'] += '\n\nFixes #1'
        return result, problem
    monkeypatch.setattr(coding_agents, 'report', extra)
    run, _ = w.run()
    body = w.github.pulls[run['pr']['number']]['body'] if run.get('pr') else ''
    others = re.findall(r'(?im)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?) #(\d+)', body)
    assert not (run['outcome'] == 'pr_opened' and set(others) - {'277'}), (run['outcome'], others)


def test_m4_a_stop_before_the_issue_creation_records_no_issue_intent(world, monkeypatch):
    w = world(issue=None)
    save = w.jobs.store.save

    def hook(record):
        save(record)
        if record.get('issue_pending'):
            w.jobs.cancels.add(record['id'])  # Stop acknowledged while the intent is saved.
    monkeypatch.setattr(w.jobs.store, 'save', hook)
    run, _ = w.run()
    assert run['outcome'] == 'cancelled' and 'create_issue' not in w.github.calls
    assert run['issue_pending'] is None, run['issue_pending']


def test_m5_recovery_keeps_the_outcome_a_sealed_archive_already_records(world, monkeypatch):
    w = world(scenario={'outcome': 'already_fixed', 'commit': False})
    write = w.jobs.store._write

    def full(path, data):
        if data.get('status') == 'finished':
            raise OSError(28, 'synthetic full runtime disk')
        write(path, data)
    monkeypatch.setattr(w.jobs.store, '_write', full)
    admitted = w.jobs.submit(w.request())
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline and (w.jobs.store.load(admitted['id']) or {}).get('status') != 'finished':
        time.sleep(.05)
    w.jobs.close()  # Then the process dies before a retry reaches the disk.
    monkeypatch.setattr(w.jobs.store, '_write', write)
    jobs = w.make()
    w.jobs = jobs
    assert jobs.own()
    run = jobs.store.load(admitted['id'])
    from reader_mcp import llm_logs
    meta = json.loads((llm_logs.safe_dir(w.vault, run['log']) / 'meta.json').read_text())
    assert run['outcome'] == meta['status'], (run['outcome'], run['message'], meta['status'])


def test_m6_recovery_stops_a_left_group_whose_leader_already_exited(world, tmp_path):
    w = world()
    pidfile = tmp_path / 'child.pid'
    leader = subprocess.Popen([sys.executable, '-c',
                               f'import subprocess;p=subprocess.Popen(["sleep","120"]);open({str(pidfile)!r},"w").write(str(p.pid));import time;time.sleep(1)'],
                              start_new_session=True)
    started = process_started(leader.pid)
    leader.wait()  # The agent died (say, SIGPIPE after the server crashed); its test run did not.
    child = int(pidfile.read_text())
    from test_coding_failures import interrupted_run
    w.jobs.close()
    jobs = w.make()
    w.jobs = jobs
    interrupted_run(w, process={'group': leader.pid, 'started': started, 'host': jobs.host})
    try:
        assert jobs.own()
        time.sleep(.3)
        alive = True
        try:
            os.kill(child, 0)
            alive = open(f'/proc/{child}/stat').read().split()[2] != 'Z'
        except (ProcessLookupError, FileNotFoundError):
            alive = False
        assert not alive, f'process {child} of the left group {leader.pid} still runs after recovery'
    finally:
        try:
            os.killpg(leader.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
