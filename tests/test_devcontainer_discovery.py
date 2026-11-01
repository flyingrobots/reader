"""Absence must be established before asking the operator to infer a configuration."""
from types import SimpleNamespace

import pytest

from reader_mcp.devcontainer_discovery import discover
from reader_mcp.github import GhCli, GitHubError

COMMIT, ROOT, DEV, NAMED, BLOB = [c * 40 for c in 'abcde']


def item(path, sha=BLOB, mode='100644', kind='blob'):
    return {'path': path, 'sha': sha, 'mode': mode, 'type': kind}


class Remote:
    def __init__(self, trees):
        self.trees, self.calls = trees, []

    def revision(self, repo, ref):
        self.calls.append(('revision', repo, ref))
        return {'sha': COMMIT, 'commit': {'tree': {'sha': ROOT}}}

    def tree(self, repo, sha):
        self.calls.append(('tree', repo, sha))
        return {'sha': sha, 'truncated': False, 'tree': self.trees[sha]}


def test_complete_empty_inventory_is_the_only_missing_result():
    remote = Remote({ROOT: []})
    result = discover(remote, 'acme/widget', 'main')
    assert result == {'repo': 'acme/widget', 'ref': 'main', 'base_sha': COMMIT,
                      'configurations': [], 'state': 'missing', 'requires_inference_consent': True}
    assert remote.calls == [('revision', 'acme/widget', 'main'), ('tree', 'acme/widget', ROOT)]


def test_root_default_and_named_choices_keep_their_pinned_blob_identities():
    remote = Remote({ROOT: [item('.devcontainer', DEV, '040000', 'tree'), item('.devcontainer.json')],
                     DEV: [item('devcontainer.json'), item('python', NAMED, '040000', 'tree')],
                     NAMED: [item('devcontainer.json', mode='100755')]})
    result = discover(remote, 'acme/widget', 'feature/next')
    assert result['state'] == 'found' and not result['requires_inference_consent']
    assert result['configurations'] == [{'path': path, 'blob_sha': BLOB} for path in
        ['.devcontainer.json', '.devcontainer/devcontainer.json', '.devcontainer/python/devcontainer.json']]
    assert remote.calls[1:] == [('tree', 'acme/widget', sha) for sha in (ROOT, DEV, NAMED)], 'Later reads use immutable trees, never the moving branch'


def test_authentication_or_network_failure_is_never_inference_permission():
    class Failed(Remote):
        def revision(self, repo, ref):
            raise GitHubError('HTTP 403: denied')
    with pytest.raises(GitHubError, match='403'):
        discover(Failed({}), 'acme/widget', 'main')


@pytest.mark.parametrize('bad', [{'truncated': True}, {'truncated': None}, {'tree': None}, {'sha': BLOB}])
def test_incomplete_or_wrong_tree_identity_is_not_absence(bad):
    class Incomplete(Remote):
        def tree(self, repo, sha):
            return super().tree(repo, sha) | bad
    with pytest.raises(GitHubError):
        discover(Incomplete({ROOT: []}), 'acme/widget', 'main')


@pytest.mark.parametrize('entries', [
    [item('.devcontainer.json', mode='120000')],
    [item('.devcontainer', DEV, '120000')],
    [item('.devcontainer.json'), item('.devcontainer.json')],
    [item('../.devcontainer.json')],
])
def test_ambiguous_or_symlink_configuration_locations_fail_closed(entries):
    with pytest.raises(GitHubError):
        discover(Remote({ROOT: entries}), 'acme/widget', 'main')


def test_named_configuration_inventory_failure_does_not_fall_back_to_inference():
    class Failed(Remote):
        def tree(self, repo, sha):
            if sha == NAMED:
                raise GitHubError('API unavailable')
            return super().tree(repo, sha)
    remote = Failed({ROOT: [item('.devcontainer', DEV, '040000', 'tree')],
                     DEV: [item('python', NAMED, '040000', 'tree')]})
    with pytest.raises(GitHubError, match='unavailable'):
        discover(remote, 'acme/widget', 'main')


def test_discovery_stops_at_its_explicit_directory_budget(monkeypatch):
    import reader_mcp.devcontainer_discovery as discovery
    monkeypatch.setattr(discovery, 'MAX_NAMED', 1)
    remote = Remote({ROOT: [item('.devcontainer', DEV, '040000', 'tree')],
                     DEV: [item(n, NAMED, '040000', 'tree') for n in ('one', 'two')]})
    with pytest.raises(GitHubError, match='Too many'):
        discover(remote, 'acme/widget', 'main')
    assert not any(call[-1] == NAMED for call in remote.calls)


def test_gh_revision_reference_is_one_url_component():
    calls = []
    def run(argv, **kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=0, stdout=COMMIT if 'Accept: application/vnd.github.sha' in argv else '{\"sha\":\"'+COMMIT+'\",\"tree\":{\"sha\":\"'+ROOT+'\"}}', stderr='')
    api = GhCli(executable='gh', runner=run)
    api.revision('acme/widget', 'feature/next?x=y')
    api.tree('acme/widget', ROOT)
    assert calls[0][-1] == 'repos/acme/widget/commits/feature%2Fnext%3Fx%3Dy'
    assert calls[1][-1] == 'repos/acme/widget/git/commits/' + COMMIT
    assert calls[2][-1] == 'repos/acme/widget/git/trees/' + ROOT


@pytest.mark.parametrize('kind,mode', [('commit', '160000'), ('unknown', '040000'), ('blob', '120000')])
def test_named_unsupported_location_is_never_permission_to_infer(kind, mode):
    remote = Remote({ROOT: [item('.devcontainer', DEV, '040000', 'tree')],
                     DEV: [item('python', NAMED, mode, kind)]})
    with pytest.raises(GitHubError):
        discover(remote, 'acme/widget', 'main')
