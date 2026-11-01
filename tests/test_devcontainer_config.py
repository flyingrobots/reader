import base64
import hashlib
import json

import pytest

from reader_mcp.devcontainer_config import ConfigurationError, parse, select, validate
from reader_mcp.github import GitHubError
from test_devcontainer_discovery import COMMIT, ROOT, Remote, item


@pytest.mark.parametrize('source', [
    b'{ // comment\n "image": "reader-development:local", /* next */ }',
    b'\xef\xbb\xbf{"image":"reader-development:local",}',
])
def test_jsonc_comments_and_trailing_commas(source):
    assert parse(source) == {'image': 'reader-development:local'}


def test_comment_like_text_and_trailing_commas_inside_strings_are_unchanged():
    source = b'{"url":"https://example.test/a/*b*/", "text":"comma,} and escaped \\\" //", "list":[1,2,],}'
    assert parse(source) == {'url': 'https://example.test/a/*b*/', 'text': 'comma,} and escaped " //', 'list': [1, 2]}


@pytest.mark.parametrize('source', [b'[]', b'{/*unfinished', b'{"a":"unterminated}', b'{"a":1/*x*/2}', b'\xff'])
def test_malformed_jsonc_is_rejected(source):
    with pytest.raises(ConfigurationError):
        parse(source)


@pytest.mark.parametrize('field,value', [
    ('initializeCommand', 'touch host'), ('mounts', ['source=/,target=/host,type=bind']),
    ('runArgs', ['--privileged']), ('features', {}), ('build', {'dockerfile': 'Dockerfile'}),
    ('dockerComposeFile', 'compose.yml'), ('workspaceFolder', '/host-selected-path'),
    ('remoteEnv', {'TOKEN': '${localEnv:SECRET}'}), ('containerEnv', {'TMPDIR': '/elsewhere'}),
    ('remoteUser', 'vscode'), ('userEnvProbe', 'loginShell'),
])
def test_unsupported_host_effects_and_resource_overrides_are_refused(field, value):
    with pytest.raises(ConfigurationError):
        validate({'image': 'reader-development:local', field: value})


def test_image_environment_and_lifecycle_commands_survive_validation():
    config = {'image': 'reader-development:local', 'containerEnv': {'PROJECT': 'reader'},
              'onCreateCommand': ['npm', 'ci'], 'postCreateCommand': {'python': 'uv sync', 'node': ['npm', 'ci']}}
    assert validate(config) == config


def test_selected_blob_is_read_by_immutable_identity_and_hashed():
    source = b'{"image":"reader-development:local"}'
    sha = hashlib.sha1(b'blob ' + str(len(source)).encode() + b'\0' + source).hexdigest()
    class Source(Remote):
        def blob(self, repo, wanted):
            assert wanted == sha
            return {'sha': sha, 'size': len(source), 'encoding': 'base64', 'content': base64.b64encode(source).decode()}
    result = select(Source({ROOT: [item('.devcontainer.json', sha)]}), 'acme/widget', COMMIT, '.devcontainer.json')
    assert result['revision'] == COMMIT and result['blob_sha'] == sha
    assert result['sha256'] == hashlib.sha256(source).hexdigest() and not result['inferred']


@pytest.mark.parametrize('bad', ['identity', 'size', 'encoding'])
def test_tampered_blob_never_becomes_a_selected_configuration(bad):
    source = b'{}'
    sha = hashlib.sha1(b'blob 2\0' + source).hexdigest()
    class Source(Remote):
        def blob(self, repo, wanted):
            result = {'sha': sha, 'size': 2, 'encoding': 'base64', 'content': base64.b64encode(source).decode()}
            if bad == 'identity':result['content'] = base64.b64encode(b'[]').decode()
            elif bad == 'size':result['size'] = 3
            else:result['encoding'] = 'utf-8'
            return result
    with pytest.raises(GitHubError):
        select(Source({ROOT: [item('.devcontainer.json', sha)]}), 'acme/widget', COMMIT, '.devcontainer.json')
