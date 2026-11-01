"""New default workflow and real Git/agent/verify execution through a synthetic container port."""
import hashlib
import json
from pathlib import Path
import subprocess

import pytest

from coding_fixture import World, snapshot, git
from container_coding_fixture import Runtime, entry
from reader_mcp.coding_container import ContainerJob
from reader_mcp.coding_jobs import JobConflict
from reader_mcp.repositories import validate


@pytest.fixture
def world(tmp_path, monkeypatch):
    world = World(tmp_path)
    store = tmp_path / 'locks.git'
    subprocess.run(['git', 'init', '--bare', str(store)], check=True, capture_output=True)
    raw = entry(world, store)
    world.jobs.registry.write({'acme/widget': raw})
    world.jobs.job_factory = ContainerJob
    world.jobs._git_locks = '/fixture/git-locks'
    monkeypatch.setattr('reader_mcp.coding_container.shutil.which', lambda name, **kwargs: '/fixture/' + name)
    runtimes = []
    def factory(*args, **kwargs):
        value = Runtime(world, *args, **kwargs);runtimes.append(value);return value
    world.jobs.runtime_factory = factory
    world.container_entry, world.runtimes = raw, runtimes
    yield world
    world.close()


def test_container_job_preserves_user_checkout_and_reconciles_publication(world):
    run, _ = world.run()
    assert run['outcome'] == 'pr_opened', run['message']
    assert run['git']['worktree'].startswith('/work/jobs/')
    assert run['tools']['runtime'] == 'devcontainer' and run['push']['verified']
    assert snapshot(world.checkout) == world.before, 'The registered host checkout is never used or mutated'
    assert len(world.calls()) == 1, 'Version and authentication probes must not execute the task'
    [runtime] = world.runtimes
    assert runtime.closed and (runtime.root / 'jobs' / run['id'] / '.git').is_dir()
    commands = [a for a, _ in runtime.calls]
    assert any(a[:2] == ['git', 'clone'] for a in commands) and any(a == ['lifecycle'] for a in commands)
    pushes = [a for a in commands if a[:2] == ['git', 'push']]
    assert len(pushes) == 1 and 'https://github.com/acme/widget.git' in pushes[0]
    assert any(a == world.container_entry['verify']['argv'] for a in commands)


def test_default_admission_refuses_a_legacy_host_checkout(tmp_path):
    world = World(tmp_path)
    try:
        world.jobs.job_factory = ContainerJob
        with pytest.raises(JobConflict, match='Host checkouts'):
            world.jobs.submit(world.request())
        assert world.jobs.store.runs() == [] and snapshot(world.checkout) == world.before
    finally:world.close()


def test_unavailable_container_agent_does_not_fall_back_to_host(world):
    original = world.jobs.runtime_factory
    def factory(*args, **kwargs):
        value = original(*args, **kwargs)
        command = value.command
        def missing(argv, *a, **k):
            if argv[:2] == ['/bin/sh', '-c'] and argv[-1] == world.container_entry['executables']['codex']:
                return subprocess.CompletedProcess(argv, 1, '', 'not found')
            return command(argv, *a, **k)
        value.command = missing
        return value
    world.jobs.runtime_factory = factory
    run, _ = world.run()
    assert run['outcome'] == 'blocked' and 'inside the container' in run['message']
    assert world.runtimes[0].closed and not world.github.pulls
    assert not world.record.exists(), 'The host synthetic agent was never launched'


def test_changed_base_requires_configuration_refresh_before_clone(world):
    seed = world.tmp / 'seed'
    (seed / 'next.txt').write_text('A later mainline change')
    git('add', 'next.txt', cwd=seed);git('commit', '-m', 'Advance main', cwd=seed);git('push', 'origin', 'main', cwd=seed)
    run, _ = world.run()
    assert run['outcome'] == 'blocked' and 'base branch changed' in run['message']
    assert not world.github.pulls and not world.record.exists()
    assert len(world.runtimes) == 1 and not any(a[:2] == ['git', 'clone'] for a, _ in world.runtimes[0].calls)


def test_claude_uses_the_same_container_boundary_and_final_event(world):
    run, _ = world.run(agent='claude')
    assert run['outcome'] == 'pr_opened', run['message']
    assert world.runtimes[0].closed and snapshot(world.checkout) == world.before
    assert len(world.calls()) == 1 and world.calls()[0]['argv'][:2] == ['-p', '--output-format']


def test_already_fixed_performs_no_publication(world):
    world.scenario(outcome='already_fixed')
    run, _ = world.run()
    assert run['outcome'] == 'already_fixed' and not world.github.pulls and run['push'] is None
    assert world.runtimes[0].closed and len(world.calls()) == 1


def test_uncommitted_work_is_retained_and_never_published(world):
    world.scenario(dirty=True)
    run, _ = world.run()
    assert run['outcome'] == 'failed' and 'uncommitted' in run['message']
    assert (world.runtimes[0].root / 'jobs' / run['id'] / 'src/uncommitted.txt').is_file()
    assert not world.github.pulls and not world.verify_record.exists()


def test_verification_failure_keeps_commits_without_push(world):
    raw = json.loads(json.dumps(world.container_entry));raw['verify']['argv'][-1] = '1'
    world.jobs.registry.write({'acme/widget': raw})
    run, _ = world.run()
    assert run['outcome'] == 'failed' and 'Verification failed' in run['message']
    assert run['git']['commits'] and run['push'] is None and not world.github.pulls
    assert world.runtimes[0].closed


def test_cancellation_reaps_client_and_stops_the_worker(world):
    import time
    world.scenario(sleep=30)
    admitted = world.jobs.dispatch(world.request())
    deadline = time.monotonic() + 5
    while not world.record.exists() and time.monotonic() < deadline:time.sleep(.01)
    assert world.record.exists()
    world.jobs.stop(admitted['id'])
    run = world.wait(admitted['id'])
    assert run['outcome'] == 'cancelled' and world.runtimes[0].stopped and world.runtimes[0].closed
    assert not world.github.pulls and snapshot(world.checkout) == world.before


def test_legacy_default_views_do_not_inspect_host_checkouts(tmp_path, monkeypatch):
    from reader_mcp import repositories, coding_agents
    world = World(tmp_path)
    try:
        world.jobs.job_factory = ContainerJob
        monkeypatch.setattr(repositories, 'git', lambda *a, **k: (_ for _ in ()).throw(AssertionError('Host Git probe')))
        monkeypatch.setattr(coding_agents, 'executable', lambda *a, **k: (_ for _ in ()).throw(AssertionError('Host agent probe')))
        row = world.jobs.repositories(check=True)['repositories'][0]
        assert row['legacy'] and row['problems']
        block = world.jobs.actions(world.doc)['blocks'][0]
        assert not block['registered'] and 'Legacy host checkout' in block['problem']
        with pytest.raises(JobConflict):
            world.jobs.submit(world.request())
    finally:world.close()
