"""Pinned devcontainer selection and the explicitly supported managed-runtime configuration.

Reading a configuration never executes it. Host initialization, Docker builds/features, mounts and
resource overrides are refused, not silently removed. The runtime supplies its own bounded workspace.
"""
import base64
import binascii
import hashlib
import json
import re

from .devcontainer_discovery import discover
from .github import GitHubError

MAX_CONFIG = 64 * 1024
ALLOWED = {'name', 'image', 'containerEnv', 'remoteEnv', 'remoteUser', 'containerUser',
           'onCreateCommand', 'updateContentCommand', 'postCreateCommand', 'postStartCommand',
           'postAttachCommand', 'waitFor', 'customizations', 'userEnvProbe', '$schema'}
COMMANDS = ('onCreateCommand', 'updateContentCommand', 'postCreateCommand', 'postStartCommand', 'postAttachCommand')
ENV_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
# Strings are matched first so URL slashes and comment-like string contents stay unchanged.
COMMENTS = re.compile(r'("(?:[^"\\]|\\.)*")|//[^\r\n]*|/\*[\s\S]*?\*/')
TRAILING = re.compile(r'("(?:[^"\\]|\\.)*")|,(\s*[}\]])')


class ConfigurationError(ValueError):
    """A selected or inferred configuration is unsupported or no longer matches its evidence."""


def parse(source):
    if not isinstance(source, bytes) or len(source) > MAX_CONFIG:
        raise ConfigurationError('devcontainer.json exceeds 64 KiB')
    try:
        text = source.decode('utf-8-sig')
        text = COMMENTS.sub(lambda m: m[1] if m[1] is not None else ' ', text)
        text = TRAILING.sub(lambda m: m[1] if m[1] is not None else m[2], text)
        value = json.loads(text)
    except (ValueError, UnicodeError) as exc:
        raise ConfigurationError('devcontainer.json must be valid UTF-8 JSON with optional comments and trailing commas') from exc
    if not isinstance(value, dict):
        raise ConfigurationError('devcontainer.json must contain an object')
    return value


def _command(command):
    if isinstance(command, str):
        return bool(command.strip()) and '\x00' not in command
    if isinstance(command, list):
        return bool(command) and all(isinstance(x, str) and x and '\x00' not in x for x in command)
    if isinstance(command, dict):
        return bool(command) and all(isinstance(k, str) and k and not isinstance(v, dict) and _command(v) for k, v in command.items())
    return False


def validate(value):
    """A JSON-only copy of a supported image configuration, with no host environment interpolation."""
    if not isinstance(value, dict):
        raise ConfigurationError('Expected a devcontainer object')
    unsupported = set(value) - ALLOWED
    if unsupported:
        raise ConfigurationError('Managed Coding Jobs does not support these devcontainer fields: ' + ', '.join(sorted(unsupported)))
    image = value.get('image')
    if (not isinstance(image, str) or not image or len(image) > 300 or image.startswith('-')
            or any(c.isspace() for c in image) or '\x00' in image):
        raise ConfigurationError('An image is required; Dockerfile/Compose/Features configurations are not supported')
    for field in ('remoteUser', 'containerUser'):
        if value.get(field, 'root') != 'root':
            raise ConfigurationError('The managed runtime currently requires root inside its restricted container')
    if value.get('userEnvProbe', 'none') != 'none':
        raise ConfigurationError('userEnvProbe must be none; host or login-shell environments are not imported')
    for field in ('containerEnv', 'remoteEnv'):
        env = value.get(field, {})
        if not isinstance(env, dict) or any(not isinstance(k, str) or not ENV_NAME.fullmatch(k)
                or not isinstance(v, str) or '\x00' in v for k, v in env.items()):
            raise ConfigurationError(field + ' must map environment names to string values')
        reserved = {'HOME', 'TMPDIR', 'XDG_CACHE_HOME', 'npm_config_cache', 'GIT_LOCKS_STORE'} & env.keys()
        if reserved:
            raise ConfigurationError('The runtime owns these resource/authentication paths: ' + ', '.join(sorted(reserved)))
    for field in COMMANDS:
        if field in value and not _command(value[field]):
            raise ConfigurationError(field + ' must be a command string, argv or named command map')
    if 'waitFor' in value and value['waitFor'] not in COMMANDS:
        raise ConfigurationError('waitFor must name a supported lifecycle command')
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ConfigurationError('Configuration must contain JSON values') from exc
    if len(encoded.encode()) > MAX_CONFIG or '${' in encoded:
        raise ConfigurationError('Configuration is too large or uses unsupported variable interpolation')
    return json.loads(encoded)


def select(github, repo, revision, path):
    """Read the exact blob from a fresh immutable inventory; never infer on a failed read."""
    inventory = discover(github, repo, revision)
    if inventory['base_sha'] != revision:
        raise ConfigurationError('Select a configuration using its full pinned commit identity')
    candidate = next((c for c in inventory['configurations'] if c['path'] == path), None)
    if not candidate:
        raise ConfigurationError('The selected configuration is not in this revision’s inventory')
    blob = github.blob(repo, candidate['blob_sha'])
    if (not isinstance(blob, dict) or blob.get('encoding') != 'base64'
            or blob.get('sha') != candidate['blob_sha'] or type(blob.get('size')) is not int
            or not 0 <= blob['size'] <= MAX_CONFIG or not isinstance(blob.get('content'), str)
            or len(blob['content']) > MAX_CONFIG * 2):
        raise GitHubError('GitHub did not return a bounded configuration blob')
    try:
        source = base64.b64decode(''.join(blob['content'].split()), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise GitHubError('GitHub configuration blob is not valid base64') from exc
    actual = hashlib.sha1(b'blob ' + str(len(source)).encode() + b'\x00' + source).hexdigest()
    if len(source) != blob['size'] or actual != candidate['blob_sha']:
        raise GitHubError('Configuration blob does not match its pinned Git identity')
    config = validate(parse(source))
    return {'repo': repo, 'revision': revision, 'path': path, 'blob_sha': actual,
            'sha256': hashlib.sha256(source).hexdigest(), 'configuration': config, 'inferred': False}
