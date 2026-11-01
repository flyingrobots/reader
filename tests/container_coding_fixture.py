"""Workflow-port fixture executed inside Docker. It is not a real nested Docker daemon.

The transport maps virtual managed paths into owned fixture paths in the bounded test container.
Git, the synthetic agent and verification really run there; GitHub and Docker lifecycle are fakes.
"""
import hashlib
import json
import sys
from pathlib import Path

from reader_mcp.container_process import execute

IMAGE = 'sha256:' + 'a' * 64


def entry(world, store):
    from coding_fixture import git
    from reader_mcp.devcontainer_config import proposal
    config = proposal('acme/widget')
    seed=world.tmp/'seed'
    (seed/'pyproject.toml').write_text('[project]\nname="fixture"\nversion="0.0.0"\n')
    git('add','pyproject.toml',cwd=seed);git('commit','-q','-m','Declare fixture toolchain',cwd=seed)
    git('push','-q','origin','main',cwd=seed)
    world.base_sha=git('rev-parse','HEAD',cwd=seed)
    return {'base': 'main', 'agents': ['codex', 'claude'], 'executables': dict(world.entry['executables']),
        'agent_timeout_seconds': 60, 'verify': {'argv': world.entry['verify']['argv'], 'timeout_seconds': 60},
        'environment': {'kind': 'devcontainer', 'revision': world.base_sha, 'path': None, 'blob_sha': None,
            'configuration': config, 'sha256': hashlib.sha256(json.dumps(config, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'inferred': True, 'consent': True, 'image_id': IMAGE, 'lock_store': str(store), 'timeout_seconds': 900}}


class Runtime:
    def __init__(self, world, root, repo, run_id, **options):
        self.world, self.id = world, run_id
        self.root = world.tmp / 'managed'
        self.root.mkdir(exist_ok=True)
        self.options, self.calls = options, []
        self.closed, self.stopped = False, False
        self.signed_in = True

    def prepare(self, config, image):
        (self.root / 'jobs' / self.id).mkdir(parents=True)
        (self.root / 'runtime' / self.id).mkdir(parents=True)
        self.options['record']({'id': 'c' * 64, 'volume': 'fixture-workspace', 'run_id': self.id, 'state': 'admitted'})

    def check(self):
        pass

    def translate(self, value):
        return str(self.root) + value[5:] if isinstance(value, str) and (value == '/work' or value.startswith(('/work/jobs/', '/work/runtime/'))) else value

    def command(self, argv, cwd='/work', check=True, **options):
        self.calls.append((list(argv), str(cwd)))
        if len(argv) >= 3 and argv[1:3] in (['login', 'status'], ['auth', 'status']):
            import subprocess
            return subprocess.CompletedProcess(argv, 0 if self.signed_in else 1, '', '')
        env = dict(self.world.environ, GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='url.' + str(self.world.bare) + '.insteadOf',
                   GIT_CONFIG_VALUE_0='https://github.com/acme/widget.git')
        wrapper = 'import os,sys;os.chdir(sys.argv[1]);os.execvpe(sys.argv[2],sys.argv[2:],os.environ)'
        result = execute([sys.executable, '-I', '-c', wrapper, self.translate(str(cwd)),
                          *[self.translate(str(x)) for x in argv]], env=env,
                         cancelled=self.options['cancelled'], **options)
        if check and result.returncode:
            from reader_mcp.container_process import ProcessError
            raise ProcessError(result.stderr)
        return result

    def lifecycle(self):
        self.calls.append((['lifecycle'], '/work'))

    def stop(self):
        self.stopped = True

    def close(self):
        self.closed = True


def reset_marker(root, state='removing', clients=None):
    key = hashlib.sha256(b'acme/widget').hexdigest()[:16]
    path = Path(root) / '.reader/container-runtime' / key / 'reset.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'repo': 'acme/widget', 'volume': 'reader-coding-' + key + '-work',
        'state': state, 'control_clients': clients or [], 'lease': {'expires': 1}}))
    return path
