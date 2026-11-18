"""#301: the container worker's publication check judges the URLs Git really pushes to, after insteadOf and
pushInsteadOf rewrites. A real temporary repository stands in for the container's /work; Git reads only its own
config, never the user's."""
import subprocess

import pytest

from reader_mcp import coding_publish
from reader_mcp.coding_container import ContainerJob
from reader_mcp.coding_workflow import Stop

REPO = 'acme/widget'
URL = f'https://github.com/{REPO}.git'


class Capture:
    def write(self, name, text):
        pass


@pytest.fixture
def job(tmp_path, monkeypatch):
    empty = tmp_path / 'gitconfig'
    empty.write_text('')
    monkeypatch.setenv('GIT_CONFIG_GLOBAL', str(empty))
    monkeypatch.setenv('GIT_CONFIG_NOSYSTEM', '1')
    work = tmp_path / 'work'
    work.mkdir()
    subprocess.run(['git', 'init', '-q'], cwd=work, check=True)
    subprocess.run(['git', 'remote', 'add', 'origin', URL], cwd=work, check=True)
    instance = ContainerJob.__new__(ContainerJob)  # Only publish()'s remote check: no container, no agent.
    instance.repo, instance.capture, instance.run = REPO, Capture(), {'git': {'worktree': str(work)}}

    def command(argv, cwd=None, timeout=None, check=True):  # The container's `git`, run on the temp repository.
        return subprocess.run(argv, cwd=work, capture_output=True, text=True)
    instance.command = command
    monkeypatch.setattr(coding_publish.Job, 'publish', lambda self, result, head: 'published')

    def config(*args):
        subprocess.run(['git', 'config', *args], cwd=work, check=True)
    return instance, config


def test_an_unchanged_remote_is_published(job):
    instance, _ = job
    assert instance.publish({}, 'a' * 40) == 'published'


@pytest.mark.parametrize('rewrite', ['pushInsteadOf', 'insteadOf'])
def test_a_url_rewrite_to_another_repository_stops_publication(job, rewrite):
    instance, config = job
    config(f'url.https://github.com/mallory/widget.git.{rewrite}', URL)
    with pytest.raises(Stop) as stopped:
        instance.publish({}, 'a' * 40)
    assert stopped.value.outcome == 'failed', stopped.value.message


def test_a_rewrite_from_the_approved_environment_is_published(job, monkeypatch):
    """#301: an insteadOf rule the approved devcontainer configuration sets through GIT_CONFIG_COUNT (scope `command`)
    is the operator's, not the agent's; publication goes on."""
    instance, _ = job
    monkeypatch.setenv('GIT_CONFIG_COUNT', '1')
    monkeypatch.setenv('GIT_CONFIG_KEY_0', 'url.file:///work/fixture-origin.git.insteadOf')
    monkeypatch.setenv('GIT_CONFIG_VALUE_0', URL)
    assert instance.publish({}, 'a' * 40) == 'published'


def test_a_rewrite_the_agent_includes_from_another_file_is_not_trusted(job, tmp_path):
    """#301: a rule reached through `include.path` in a config file the agent can write keeps that file's scope."""
    instance, config = job
    extra = tmp_path / 'agent-rules'
    extra.write_text(f'[url "https://github.com/mallory/widget.git"]\n\tpushInsteadOf = {URL}\n')
    config('include.path', str(extra))
    with pytest.raises(Stop) as stopped:
        instance.publish({}, 'a' * 40)
    assert stopped.value.outcome == 'failed', stopped.value.message


def test_an_agent_environment_cannot_reach_the_publication_check(monkeypatch):
    """#301: Reader's container git runs in a fresh `docker exec` whose environment is the container's approved
    configuration plus Reader's own flags. GIT_CONFIG_COUNT in any other process environment (the agent's, or even
    Reader's) is not passed, so a `command`-scope rule can only come from the approved configuration."""
    from reader_mcp.container_runtime import ContainerRuntime
    monkeypatch.setenv('GIT_CONFIG_COUNT', '1')
    monkeypatch.setenv('GIT_CONFIG_KEY_0', 'url.https://github.com/mallory/widget.git.pushInsteadOf')
    monkeypatch.setenv('GIT_CONFIG_VALUE_0', URL)
    runtime = ContainerRuntime.__new__(ContainerRuntime)
    runtime.docker, runtime.cid, runtime.configuration = 'docker', 'c' * 64, {'remoteEnv': {'APPROVED': '1'}}
    runtime.check = lambda: None
    argv = runtime.exec_argv(['git', 'config', '--show-scope', '--get-regexp', 'url'])
    passed = [argv[i + 1] for i, value in enumerate(argv) if value == '--env']
    assert passed == ['GIT_TERMINAL_PROMPT=0', 'APPROVED=1'], passed
