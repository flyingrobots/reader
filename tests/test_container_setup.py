"""Setup state and command routing; fake runtime ports, no real daemon/authentication claim."""
import argparse
import json
from types import SimpleNamespace

import pytest

from reader_mcp.container_process import ProcessError
from reader_mcp.container_setup import arguments, setup
from test_container_registry import registered


class Runtime:
    instances = []
    def __init__(self, root, repo, run_id, **kwargs):
        self.record = kwargs['record']
        self.calls = []
        self.closed = False
        self.run_id = run_id
        self.instances.append(self)
    def prepare(self, config, image):
        self.record({'state': 'admitted', 'run_id': self.run_id})
    def command(self, argv, **kwargs):
        self.calls.append((argv, kwargs))
        return SimpleNamespace(returncode=0, stdout='')
    def measure(self):return {'workspace_bytes': 0}
    def close(self):self.closed = True


@pytest.fixture
def configured(registered):
    world, entry = registered
    world.jobs.registry.register('acme/widget', entry)
    yield world


def call(world, action='exec', argv=('echo', 'hello'), **kwargs):
    return setup(world.vault, action, 'acme/widget', argv, tools={n: n for n in ('docker', 'devcontainer', 'git-locks')}, runtime_factory=Runtime, **kwargs)


def test_exec_routes_only_to_container_and_confirms_shutdown(configured):
    result = call(configured)
    instance = Runtime.instances[-1]
    assert result['exit_code'] == 0 and instance.closed
    assert instance.calls[0][0] == ['echo', 'hello']
    assert instance.calls[0][1]['capture_limit'] == 0
    record = next((configured.vault / '.reader/container-runtime').glob('*/setup.json'))
    assert json.loads(record.read_text())['state'] == 'stopped'


def test_failed_shutdown_keeps_recovery_required(configured, monkeypatch):
    def fail(self):raise ProcessError('stop uncertain')
    monkeypatch.setattr(Runtime, 'close', fail)
    with pytest.raises(ProcessError, match='uncertain'):call(configured)
    with pytest.raises(ProcessError, match='recover'):call(configured)


def test_check_is_actual_probe_and_does_not_claim_ready_from_registration(configured):
    result = call(configured, 'check', ())
    assert not result['ready'] and not result['base_matches']
    commands = [a for a, _ in Runtime.instances[-1].calls]
    assert any(a[1:] == ['login', 'status'] for a in commands)
    assert any(a[1:] == ['auth', 'status'] for a in commands)
    assert any(a[:2] == ['git', 'ls-remote'] for a in commands)


def test_recover_uses_saved_identity_without_starting_another_runtime(configured, monkeypatch):
    def fail(self):raise ProcessError('stop uncertain')
    monkeypatch.setattr(Runtime, 'close', fail)
    with pytest.raises(ProcessError):call(configured)
    count = len(Runtime.instances)
    def recovery(root, repo, run_id, record, **kwargs):
        assert run_id == Runtime.instances[-1].run_id
        return record | {'state': 'stopped'}
    result = call(configured, 'recover', (), recovery=recovery)
    assert result['state'] == 'stopped' and len(Runtime.instances) == count


def test_command_arguments_keep_literal_tokens():
    parser = argparse.ArgumentParser()
    arguments(parser)
    args = parser.parse_args(['exec', 'acme/widget', '--', 'echo', '$(touch /host)', '--version'])
    assert args.argv == ['echo', '$(touch /host)', '--version']


def test_seconds_can_precede_the_action_without_becoming_command_tokens():
    parser = argparse.ArgumentParser()
    arguments(parser)
    args = parser.parse_args(['--seconds', '900', 'exec', 'acme/widget', '--', 'codex', 'login', '--device-auth'])
    assert args.seconds == 900 and args.argv == ['codex', 'login', '--device-auth']


def test_setup_does_not_spend_cleanup_reserve_on_the_command(configured, monkeypatch):
    import reader_mcp.container_setup as module
    now = [0]
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: now[0]))
    original = Runtime.prepare
    def slow(self, *args):
        original(self, *args)
        now[0] = 45
    monkeypatch.setattr(Runtime, 'prepare', slow)
    with pytest.raises(ProcessError, match='reserving time'):
        call(configured, seconds=60)
    assert Runtime.instances[-1].closed and not Runtime.instances[-1].calls


@pytest.mark.parametrize('command', ['container','container-image'])
def test_container_cli_expands_literal_tilde_root(monkeypatch,command):
    import sys
    from pathlib import Path
    from reader_mcp import cli,container_image,container_setup
    seen=[]
    monkeypatch.setenv('READER_ROOT','~')
    def setup(root,*args,**kwargs):seen.append(root);return {'ready':True}
    monkeypatch.setattr(container_setup,'setup',setup)
    monkeypatch.setattr(container_image,'prepare',setup)
    argv=['reader',command]+(['check','acme/widget'] if command=='container' else ['--lock-store','/fixture/authority.git'])
    monkeypatch.setattr(sys,'argv',argv)
    cli.main()
    assert seen==[str(Path.home().resolve())]


@pytest.mark.parametrize('action,argv', [('check', ()), ('exec', ('echo', 'hello'))])
def test_unconfirmed_reset_blocks_ordinary_setup(configured, action, argv):
    from container_coding_fixture import reset_marker
    path = reset_marker(configured.vault)
    before, count = path.read_bytes(), len(Runtime.instances)
    with pytest.raises(ProcessError, match='reset'):
        call(configured, action, argv)
    assert len(Runtime.instances) == count and path.read_bytes() == before


def test_reset_fence_keeps_recovery_available(configured, monkeypatch):
    from container_coding_fixture import reset_marker
    def fail(self):raise ProcessError('stop uncertain')
    monkeypatch.setattr(Runtime, 'close', fail)
    with pytest.raises(ProcessError):call(configured)
    path = reset_marker(configured.vault)
    before = path.read_bytes()
    def recovery(root, repo, run_id, record, **kwargs):return record | {'state': 'stopped'}
    assert call(configured, 'recover', (), recovery=recovery)['state'] == 'stopped'
    assert path.read_bytes() == before


@pytest.mark.parametrize('state', ['completed', 'refused'])
def test_settled_reset_permits_setup(configured, state):
    from container_coding_fixture import reset_marker
    reset_marker(configured.vault, state)
    assert call(configured)['exit_code'] == 0
