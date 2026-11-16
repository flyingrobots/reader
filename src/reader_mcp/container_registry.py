"""Static registry contract for container-only coding repositories; no checkout is required."""
import hashlib
import json
from pathlib import Path
import re

from .devcontainer_config import proposal, validate as validate_configuration
from .devcontainer_discovery import SHA

IMAGE = re.compile(r'sha256:[0-9a-f]{64}')
DIGEST = re.compile(r'[0-9a-f]{64}')
BRANCH = re.compile(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,199}')
FIELDS = {'environment', 'base', 'agents', 'executables', 'agent_modes', 'agent_timeout_seconds', 'verify'}
ENVIRONMENT = {'kind', 'revision', 'path', 'blob_sha', 'sha256', 'configuration', 'inferred', 'consent',
               'image_id', 'lock_store', 'timeout_seconds'}


def normalize(repo, raw, vault):
    # Imported lazily: the existing registry delegates this entry kind to this module.
    from .repositories import AGENTS, MODES, RegistryError, _absolute_dir, _seconds
    if set(raw) - FIELDS:
        raise RegistryError('Container registration has unknown fields: ' + ', '.join(sorted(set(raw) - FIELDS)))
    base = raw.get('base')
    if (not isinstance(base, str) or not BRANCH.fullmatch(base) or '..' in base or '//' in base
            or any(part.startswith('.') or part.endswith(('.', '.lock')) for part in base.split('/')) or base.endswith('/')):
        raise RegistryError('Expected an ordinary Git base branch name')
    environment = raw.get('environment')
    if (not isinstance(environment, dict) or set(environment) != ENVIRONMENT
            or environment.get('kind') != 'devcontainer'):
        raise RegistryError('Expected the complete devcontainer environment approval')
    if not isinstance(environment['revision'], str) or not SHA.fullmatch(environment['revision']):
        raise RegistryError('Container configuration requires a full pinned commit identity')
    if not isinstance(environment['sha256'], str) or not DIGEST.fullmatch(environment['sha256']):
        raise RegistryError('Container configuration requires its source digest')
    try:
        config = validate_configuration(environment['configuration'])
    except ValueError as exc:
        raise RegistryError(str(exc)) from exc
    if type(environment['inferred']) is not bool or type(environment['consent']) is not bool:
        raise RegistryError('Inference and consent must be explicit booleans')
    if environment['inferred']:
        digest = hashlib.sha256(json.dumps(config, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        if config != proposal(repo) or not environment['consent'] or environment['path'] is not None or environment['blob_sha'] is not None or digest != environment['sha256']:
            raise RegistryError('Inferred configuration consent must match this exact proposal and revision')
    elif (not isinstance(environment['path'], str) or not re.fullmatch(r'\.devcontainer\.json|\.devcontainer/(?:[^/]+/)?devcontainer\.json', environment['path'])
            or not isinstance(environment['blob_sha'], str) or not SHA.fullmatch(environment['blob_sha'])):
        raise RegistryError('Selected configuration needs a supported path and Git blob identity')
    if not isinstance(environment['image_id'], str) or not IMAGE.fullmatch(environment['image_id']):
        raise RegistryError('Approve the immutable local image identity')
    store = _absolute_dir(environment['lock_store'], 'environment.lock_store')
    if not (Path(store) / 'HEAD').is_file() or not (Path(store) / 'objects').is_dir():
        raise RegistryError('environment.lock_store must be an existing git-locks Git directory')
    agents = raw.get('agents')
    if (not isinstance(agents, list) or not agents or not all(isinstance(a, str) and a in AGENTS for a in agents)
            or len(set(agents)) != len(agents)):
        raise RegistryError('Select one or more supported coding agents')
    executables, modes = raw.get('executables', {}), raw.get('agent_modes', {})
    if (not isinstance(executables, dict) or set(executables) - set(agents)
            or any(not isinstance(v, str) or not v or len(v) > 1024 or '\x00' in v for v in executables.values())):
        raise RegistryError('Executables must name commands or paths inside the container')
    if not isinstance(modes, dict) or any(name not in agents or mode not in MODES[name] for name, mode in modes.items()):
        raise RegistryError('Unsupported coding-agent permission mode')
    verify = raw.get('verify')
    if not isinstance(verify, dict) or set(verify) - {'argv', 'timeout_seconds'}:
        raise RegistryError('Container verification needs argv and an optional timeout; host verification locks are not imported')
    argv = verify.get('argv')
    if (not isinstance(argv, list) or not 0 < len(argv) <= 64
            or not all(isinstance(a, str) and 0 < len(a) <= 4096 and '\x00' not in a for a in argv)):
        raise RegistryError('verify.argv must be a nonempty argument list')
    timeout = _seconds(verify.get('timeout_seconds'), 1800, 60, 86400, 'verify.timeout_seconds')
    agent_timeout = _seconds(raw.get('agent_timeout_seconds'), 3600, 60, 86400, 'agent_timeout_seconds')
    lifetime = _seconds(environment['timeout_seconds'], 7200, 300, 86400, 'environment.timeout_seconds')
    if lifetime < agent_timeout + timeout + 600:
        raise RegistryError('Runtime deadline must leave at least 600 seconds beyond agent and verification limits for setup/publication')
    env = dict(environment, configuration=config, lock_store=store, timeout_seconds=lifetime)
    return {'repo': repo, 'remote': 'origin', 'base': base, 'checkout': None, 'worktree_root': None,
            'environment': env, 'agents': list(agents), 'executables': dict(executables),
            'agent_modes': {a: modes.get(a, 'danger-full-access' if a == 'codex' else 'acceptEdits') for a in agents},
            'agent_timeout_seconds': agent_timeout, 'verify': {'argv': list(argv), 'timeout_seconds': timeout, 'lock': None}}
