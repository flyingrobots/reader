"""Explicit local container setup, tool/authentication checks and fenced recovery.

Commands run only inside the same managed worker used by Coding Jobs. This terminal interface
never imports host credentials or starts a coding task. Setup intent is durable before admission.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time
import uuid

from .container_process import ProcessError
from .container_recovery import recover
from .container_runtime import ContainerRuntime
from .repositories import Registry


def arguments(parser):
    parser.add_argument('action', choices=['check', 'exec', 'recover'])
    parser.add_argument('repo', help='Registered GitHub owner/name')
    parser.add_argument('--seconds', type=int, default=600, help='Setup lifetime, including cleanup (60–3600)')
    parser.add_argument('argv', nargs='*', help='For exec: container command and arguments, after --')


def _save(path, record):
    temporary = path.with_suffix('.next')
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), 'w') as stream:
        json.dump(record, stream, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def setup(root, action, repo, argv=(), seconds=600, *, runtime_factory=ContainerRuntime,
          recovery=recover, tools=None, output=None):
    if type(seconds) is not int or not 60 <= seconds <= 3600:
        raise ValueError('Setup lifetime must be between 60 and 3600 seconds')
    if action not in ('check', 'exec', 'recover') or bool(argv) != (action == 'exec'):
        raise ValueError('Only exec accepts a nonempty container command after --')
    root = Path(root).resolve(strict=True)
    entry = Registry(root).entry(repo, require_container=True)
    if not entry:
        raise ValueError('Register a container configuration in Reader Admin first')
    repo, env = entry['repo'], entry['environment']
    found = tools if tools is not None else {name: shutil.which(name) for name in ('docker', 'devcontainer', 'git-locks')}
    if not all(found.get(name) for name in ('docker', 'devcontainer', 'git-locks')):
        raise ProcessError('Docker, the Dev Container CLI and git-locks are required; no host execution fallback')
    folder = root
    for part in ('.reader', 'container-runtime', hashlib.sha256(repo.casefold().encode()).hexdigest()[:16]):
        folder /= part
        if folder.is_symlink():raise ProcessError('Setup directories must not be symlinks')
        folder.mkdir(exist_ok=True)
    path = folder / 'setup.json'
    if path.is_symlink():raise ProcessError('Setup record must not be a symlink')
    with os.fdopen(os.open(folder / 'setup.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'w') as lock:
        try:fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:raise ProcessError('Another setup command owns this repository') from exc
        if path.exists() and path.stat().st_size > 65536:
            raise ProcessError('Setup record exceeds its bound')
        record = json.loads(path.read_text()) if path.exists() else {}
        if action == 'recover':
            if not record or record.get('state') == 'stopped':return {'repo': repo, 'state': 'stopped'}
            restored = recovery(root, repo, record['run_id'], record, docker=found['docker'], lock_tool=found['git-locks'])
            _save(path, restored)
            return {'repo': repo, 'state': restored['state']}
        if record and record.get('state') != 'stopped':
            raise ProcessError('Previous setup did not confirm shutdown; run container recover first')
        record = {}
        def save(update):
            record.update(update)
            _save(path, record)
        command_deadline = time.monotonic() + seconds - 30
        runtime = runtime_factory(root, repo, str(uuid.uuid4()), docker=found['docker'], devcontainer=found['devcontainer'],
            lock_tool=found['git-locks'], lock_store=env['lock_store'], seconds=seconds, record=save)
        try:
            runtime.prepare(env['configuration'], env['image_id'])
            if action == 'exec':
                def terminal(channel, data):
                    stream = sys.stdout.buffer if channel == 'stdout' else sys.stderr.buffer
                    stream.write(data)
                    stream.flush()
                remaining = command_deadline - time.monotonic()
                if remaining <= 0:
                    raise ProcessError('Setup exhausted its command budget; reserving time for cleanup')
                result = runtime.command(list(argv), timeout=remaining, check=False,
                    output=output or terminal,
                    limit=64 * 1024**2, capture_limit=0)
                return {'repo': repo, 'exit_code': result.returncode}
            agents = []
            for name in entry['agents']:
                executable = entry['executables'].get(name, name)
                version = runtime.command([executable, '--version'], check=False)
                auth = runtime.command([executable, 'login', 'status'] if name == 'codex' else [executable, 'auth', 'status'], check=False)
                agents.append({'name': name, 'installed': version.returncode == 0, 'signed_in': auth.returncode == 0})
            git = runtime.command(['git', 'ls-remote', '--exit-code', 'https://github.com/' + repo + '.git', 'refs/heads/' + entry['base']], timeout=30, check=False)
            sha = git.stdout.split()[0] if git.returncode == 0 and git.stdout.split() else None
            return {'repo': repo, 'revision': env['revision'], 'image_id': env['image_id'], 'agents': agents,
                'base_matches': sha == env['revision'], 'ready': sha == env['revision'] and all(a['installed'] and a['signed_in'] for a in agents),
                'measurement': runtime.measure()}
        finally:
            runtime.close()
            save({'state': 'stopped'})
