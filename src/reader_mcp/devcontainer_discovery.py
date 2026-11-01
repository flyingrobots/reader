"""Read-only devcontainer discovery at an immutable GitHub revision, without a host clone.

Missing is returned only after all supported configuration locations have been inspected. Transport,
authentication, incomplete inventories and unsupported symlink locations are errors, never permission
to infer a configuration. This helper does not build an image or execute repository hooks.
"""
import re

from .github import GitHubError
from .prompt_blocks import repository_name

SHA = re.compile(r'[0-9a-f]{40}')
MAX_ENTRIES = 4096
MAX_NAMED = 64


def _sha(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise GitHubError('GitHub did not return an immutable Git object identity')
    return value


def _tree(github, repo, sha):
    data = github.tree(repo, _sha(sha))
    if not isinstance(data, dict) or data.get('truncated') is not False or not isinstance(data.get('tree'), list):
        raise GitHubError('Devcontainer inventory is incomplete; Reader cannot infer absence')
    _sha(data.get('sha'))
    if data['sha'] != sha or len(data['tree']) > MAX_ENTRIES:
        raise GitHubError('Devcontainer inventory identity or entry limit is invalid')
    entries = {}
    for item in data['tree']:
        if not isinstance(item, dict):
            raise GitHubError('Malformed devcontainer inventory entry')
        name = item.get('path')
        if (not isinstance(name, str) or not name or name in ('.', '..') or '/' in name
                or '\\' in name or any(ord(c) < 32 for c in name) or name in entries):
            raise GitHubError('Ambiguous path in devcontainer inventory')
        _sha(item.get('sha'))
        entries[name] = item
    return entries


def _directory(item, path):
    if item.get('type') != 'tree' or item.get('mode') != '040000':
        raise GitHubError(f'{path} is not an ordinary Git directory; configuration discovery stopped')
    return item['sha']


def _candidate(item, path):
    if item.get('type') != 'blob' or item.get('mode') not in ('100644', '100755'):
        raise GitHubError(f'{path} is not an ordinary configuration file; configuration discovery stopped')
    return {'path': path, 'blob_sha': item['sha']}


def discover(github, repo, ref):
    """Configuration choices bound to one commit; found/missing never means runtime-ready."""
    if not repository_name(repo):
        raise ValueError('Expected a GitHub owner/repository')
    if (not isinstance(ref, str) or not 0 < len(ref) <= 200
            or any(ord(c) < 32 for c in ref)):
        raise ValueError('Expected a branch, tag or commit reference')
    revision = github.revision(repo, ref)
    if not isinstance(revision, dict):
        raise GitHubError('GitHub did not return a revision')
    commit = _sha(revision.get('sha'))
    metadata = revision.get('commit')
    if not isinstance(metadata, dict) or not isinstance(metadata.get('tree'), dict):
        raise GitHubError('GitHub did not return the revision tree')
    tree = _sha(metadata['tree'].get('sha'))
    root = _tree(github, repo, tree)
    choices = []
    if '.devcontainer.json' in root:
        choices.append(_candidate(root['.devcontainer.json'], '.devcontainer.json'))
    if '.devcontainer' in root:
        inside = _tree(github, repo, _directory(root['.devcontainer'], '.devcontainer'))
        if 'devcontainer.json' in inside:
            choices.append(_candidate(inside['devcontainer.json'], '.devcontainer/devcontainer.json'))
        named = [(name, item) for name, item in inside.items() if item.get('type') == 'tree']
        if len(named) > MAX_NAMED:
            raise GitHubError('Too many named devcontainer directories; Reader cannot infer absence')
        for name, item in sorted(named):
            path = '.devcontainer/' + name
            children = _tree(github, repo, _directory(item, path))
            if 'devcontainer.json' in children:
                choices.append(_candidate(children['devcontainer.json'], path + '/devcontainer.json'))
        # Symlinks, gitlinks and unknown kinds can hide named configurations.
        # Only ordinary files and directories establish a complete local inventory.
        if any((item.get('type'), item.get('mode')) not in
               {('blob', '100644'), ('blob', '100755'), ('tree', '040000')} for item in inside.values()):
            raise GitHubError('Unsupported entry in .devcontainer; resolve it before configuration discovery')
    return {'repo': repo, 'ref': ref, 'base_sha': commit, 'configurations': choices,
            'state': 'found' if choices else 'missing', 'requires_inference_consent': not bool(choices)}
