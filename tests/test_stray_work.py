"""scripts/stray_work.py on a synthetic repository: what landed, what did not, and which checkouts can go."""
import importlib.util
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / 'scripts/stray_work.py'
spec = importlib.util.spec_from_file_location('stray_work', SCRIPT)
stray = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stray)


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()


def commit(cwd, name, text, message):
    (Path(cwd) / name).write_text(text)
    git(cwd, 'add', name)
    git(cwd, 'commit', '-q', '-m', message)


@pytest.fixture
def repo(tmp_path):
    origin, repo = tmp_path / 'origin.git', tmp_path / 'repo'
    git(tmp_path, 'init', '-q', '--bare', '-b', 'main', str(origin))
    git(tmp_path, 'init', '-q', '-b', 'main', str(repo))
    for key, value in (('user.name', 'Test'), ('user.email', 'test@example.invalid'), ('commit.gpgsign', 'false')):
        git(repo, 'config', key, value)
    git(repo, 'remote', 'add', 'origin', str(origin))
    commit(repo, 'a.txt', 'a\n', 'start')
    git(repo, 'push', '-q', '-u', 'origin', 'main')

    git(repo, 'switch', '-q', '-c', 'merged')  # an ancestor of main
    git(repo, 'switch', '-q', 'main')
    git(repo, 'switch', '-q', '-c', 'squashed')  # its content lands on main under another hash
    commit(repo, 'b.txt', 'b\n', 'add b')
    git(repo, 'switch', '-q', 'main')
    git(repo, 'merge', '-q', '--squash', 'squashed')
    git(repo, 'commit', '-q', '-m', 'add b (squash)')
    git(repo, 'push', '-q', 'origin', 'main')

    git(repo, 'switch', '-q', '-c', 'stranded')  # finished, committed, never pushed
    commit(repo, 'c.txt', 'c\n', 'finished but unpushed')
    git(repo, 'switch', '-q', '-c', 'pushed', 'main')  # pushed with no merge
    commit(repo, 'd.txt', 'd\n', 'pushed feature')
    git(repo, 'push', '-q', '-u', 'origin', 'pushed')
    git(repo, 'switch', '-q', '-c', 'older', 'main~1')  # an older copy of b that conflicts with main
    commit(repo, 'b.txt', 'b, first draft\n', 'draft of b')
    git(repo, 'switch', '-q', 'main')

    git(repo, 'worktree', 'add', '-q', str(tmp_path / 'wt-done'), 'merged')
    git(repo, 'worktree', 'add', '-q', str(tmp_path / 'wt-dirty'), 'squashed')
    (tmp_path / 'wt-dirty/notes.txt').write_text('unsaved\n')
    git(repo, 'worktree', 'add', '-q', str(tmp_path / 'wt-open'), 'stranded')
    git(repo, 'worktree', 'add', '-q', '--detach', str(tmp_path / 'live'), 'main')
    git(repo, 'switch', '-q', '-c', 'followed', 'main')
    git(repo, 'switch', '-q', 'main')
    git(repo, 'fetch', '-q', 'origin')
    return repo


def test_survey_separates_landed_from_unlanded_work(repo):
    service = {'source': 'followed', 'live': str(repo.parent / 'live'), 'repo': str(repo)}
    report = stray.survey(repo, service=service)
    unlanded = {row['branch']: row for row in report['unlanded']}
    assert set(unlanded) == {'stranded', 'pushed', 'older'}
    assert 'upstream' in unlanded['stranded'] and unlanded['stranded']['upstream'] is None, 'never pushed'
    assert unlanded['pushed']['upstream'] == 'origin/pushed' and unlanded['pushed']['unpushed'] == 0
    assert unlanded['stranded']['ahead'] == 1 and unlanded['stranded']['subject'] == 'finished but unpushed'
    assert unlanded['older']['ahead'] == 1, 'a conflicting older copy is reported, not called landed'
    landed = {row['branch']: row for row in report['landed_branches']}
    assert {'main', 'merged', 'squashed', 'followed'} <= set(landed), 'a squash-landed branch counts as landed'
    assert landed['followed']['in_use'] == 'followed by the Reader service'
    assert [row['ref'] for row in report['remote_unlanded']] == ['origin/pushed']
    states = {Path(row['path']).name: row['state'] for row in report['worktrees']}
    assert states == {'repo': 'main checkout', 'wt-done': 'removable', 'wt-dirty': 'uncommitted changes',
                      'wt-open': 'unlanded commits', 'live': 'Reader service live checkout'}


def test_cli_text_report_and_strict_exit(repo, capsys, monkeypatch):
    monkeypatch.setattr(stray, 'reader_service', lambda: {})
    assert stray.main(['--repo', str(repo)]) == 0
    out = capsys.readouterr().out
    assert 'Unlanded local branches: 3' in out and 'stranded: 1 commits' in out and 'not pushed' in out
    assert 'removable: ' + str(repo.parent / 'wt-done') in out
    assert stray.main(['--repo', str(repo), '--strict']) == 1
    git(repo, 'branch', '-q', '-D', 'pushed', 'older')
    git(repo, 'worktree', 'remove', '--force', str(repo.parent / 'wt-open'))
    git(repo, 'branch', '-q', '-D', 'stranded')
    git(repo, 'push', '-q', 'origin', '--delete', 'pushed')
    git(repo, 'fetch', '-q', '--prune', 'origin')
    assert stray.main(['--repo', str(repo), '--strict']) == 0


def test_nothing_is_deleted(repo):
    before = git(repo, 'for-each-ref'), git(repo, 'worktree', 'list')
    stray.survey(repo, service={})
    assert (git(repo, 'for-each-ref'), git(repo, 'worktree', 'list')) == before
