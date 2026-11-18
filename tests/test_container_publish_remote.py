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
