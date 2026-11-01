"""A bounded, persistent local Docker worker configured by the Dev Container CLI.

One canonical worker and volume per repository. Source and credentials created inside the container
stay in the labelled volume. No host source/credential/socket mounts, host clone or host agent fallback.
The volume has a monitored threshold, not an advertised filesystem quota.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import threading
import time
import uuid

from .prompt_blocks import repository_name

from .container_lease import Lease
from .container_process import ProcessError, execute
from .container_storage import MEASURE
from .container_host_storage import measure as host_usage
from .devcontainer_config import validate

GIB = 1024**3
WORK_LIMIT = 3 * GIB
FREE_FLOOR = 50 * GIB
IMAGE_ID = re.compile(r'sha256:[0-9a-f]{64}')
WATCHDOG = '''import signal,sys,time
signal.signal(signal.SIGTERM,lambda *_:sys.exit(0))
time.sleep(max(0,float(sys.argv[1])-time.time()))
'''


class ContainerRuntime:
    def __init__(self, root, repo, run_id, *, docker, devcontainer, lock_tool, lock_store,
                 seconds, record, cancelled=lambda: False, output=None, run=execute):
        if (type(seconds) is not int or not 30 <= seconds <= 86400
                or not isinstance(lock_store, (str, Path)) or not Path(lock_store).is_absolute()):
            raise ProcessError('An explicit shared lock store and bounded runtime deadline are required')
        try:
            valid_run = str(uuid.UUID(run_id, version=4)) == run_id
        except (ValueError, TypeError, AttributeError):
            valid_run = False
        if not valid_run or not repository_name(repo):
            raise ProcessError('Expected a GitHub repository and UUID run identity')
        self.root, self.repo, self.run_id = Path(root).resolve(), repo, run_id
        self.docker, self.devcontainer, self.run = docker, devcontainer, run
        self.record, self.cancelled, self.output = record, cancelled, output
        self.owner = hashlib.sha256(str(self.root).encode()).hexdigest()
        self.key = hashlib.sha256(repo.casefold().encode()).hexdigest()[:16]
        self.name = 'reader-coding-' + self.key
        self.volume = self.name + '-work'
        self.lease = Lease(lock_tool, lock_store, 'host/docker/' + self.name + '/', seconds, run=run)
        self.expires, self.wall_expires = time.monotonic() + seconds, time.time() + seconds
        self.cid, self.error, self.monitor = None, None, None
        self.done = threading.Event()
        self.config = None
        self.clients, self.clients_lock = set(), threading.Lock()
        self.client_env = None
        self.configuration = None

    def _started(self, pid):
        with self.clients_lock:
            self.clients.add(pid)

    def _finished(self, pid):
        with self.clients_lock:
            self.clients.discard(pid)

    def invoke(self, argv, timeout=15, check=True, cleanup=False, stdin=None, output=None,
               started=None, finished=None, limit=4 * 1024**2, capture_limit=4 * 1024**2):
        if not cleanup:
            self.check()
        remaining = self.expires - time.monotonic()
        result = self.run(argv, timeout=timeout if cleanup else min(timeout, remaining),
                          env=self.client_env, started=lambda pid: (self._started(pid), started(pid) if started else None),
                          finished=lambda pid: (self._finished(pid), finished(pid) if finished else None),
                          limit=limit, capture_limit=capture_limit,
                          cancelled=(lambda: False) if cleanup else (lambda: bool(self.error) or self.cancelled()),
                          **({'stdin': stdin} if stdin is not None else {}), output=output)
        if check and result.returncode:
            raise ProcessError((result.stderr or result.stdout or 'Container command failed')[-2000:])
        return result

    def check(self):
        if self.error:
            raise ProcessError(self.error)
        if self.cancelled():
            raise ProcessError('Container job cancelled')
        if time.monotonic() >= self.expires:
            raise ProcessError('Container job deadline exceeded')

    def _inspect(self, kind, name, optional=False):
        result = self.invoke([self.docker, kind, 'inspect', name], check=False)
        if result.returncode:
            # Only a positive "not found" answer is absence. A daemon/auth failure is not.
            if optional and re.search(r'no such (?:object|container|volume|image)', result.stderr, re.I):
                return None
            raise ProcessError('Cannot inspect managed ' + kind + ': ' + result.stderr[-800:])
        try:
            values = json.loads(result.stdout)
            if len(values) != 1 or not isinstance(values[0], dict):
                raise ValueError()
            return values[0]
        except (ValueError, TypeError, KeyError) as exc:
            raise ProcessError('Malformed Docker inspection response') from exc

    def _labels(self):
        return {'reader.coding.owner': self.owner, 'reader.coding.repo': self.repo.casefold()}

    def _container_labels(self):
        return self._labels() | {'reader.coding.run': self.run_id}

    def _owned(self, labels):
        return isinstance(labels, dict) and all(labels.get(k) == v for k, v in self._labels().items())

    def prepare(self, configuration, image_id):
        config = validate(configuration)
        self.configuration = config
        if not isinstance(image_id, str) or not IMAGE_ID.fullmatch(image_id):
            raise ProcessError('Approve a full immutable local image identity before setup')
        self.record({'id': None, 'name': self.name, 'volume': self.volume, 'owner': self.owner,
                     'image': image_id, 'expires': self.wall_expires, 'run_id': self.run_id, 'state': 'claiming',
                     'lease_intent_at': time.time(), 'lease': {'job': self.lease.job, 'acquisition': None,
                         'key': self.lease.key, 'store': self.lease.env['GIT_LOCKS_STORE']}})
        self.lease.acquire()
        try:
            self.record({'id': None, 'name': self.name, 'volume': self.volume, 'owner': self.owner,
                         'image': image_id, 'expires': self.wall_expires, 'run_id': self.run_id, 'state': 'leased',
                         'lease': {'job': self.lease.job, 'acquisition': self.lease.acquisition,
                                   'key': self.lease.key, 'store': self.lease.env['GIT_LOCKS_STORE']}})
            if shutil.disk_usage(self.root).free < FREE_FLOOR:
                raise ProcessError('Host free space is below 50 GiB')
            folder = self.root / '.reader/container-runtime' / self.key
            ancestor = self.root
            for part in ('.reader', 'container-runtime', self.key):
                ancestor = ancestor / part
                if ancestor.is_symlink():
                    raise ProcessError('Runtime configuration folders must not be symlinks')
                ancestor.mkdir(exist_ok=True)
            for part in ('tmp', 'cache', 'cli'):
                directory = folder / part
                if directory.is_symlink():
                    raise ProcessError('Runtime control directories must not be symlinks')
                directory.mkdir(exist_ok=True)
            self.client_env = dict(os.environ, TMPDIR=str(folder / 'tmp'), XDG_CACHE_HOME=str(folder / 'cache'))
            image = self._inspect('image', config['image'])
            if image.get('Id') != image_id or (image.get('Config') or {}).get('Volumes'):
                raise ProcessError('Image identity differs or requests additional anonymous volumes')
            if (image.get('Config') or {}).get('Entrypoint') != ['/bin/sh', '/usr/local/bin/reader-development-entrypoint']:
                raise ProcessError('Prepare a compatible managed image with the documented read-only /etc entrypoint')
            previous = self._inspect('container', self.name, optional=True)
            if previous is not None:
                raise ProcessError('A previous worker exists; reconcile it before starting another job')
            self.record({'id': None, 'name': self.name, 'volume': self.volume, 'owner': self.owner,
                         'image': image_id, 'expires': self.wall_expires, 'run_id': self.run_id,
                         'workspace_limit_bytes': WORK_LIMIT, 'state': 'preparing',
                         'lease': {'job': self.lease.job, 'acquisition': self.lease.acquisition,
                                   'key': self.lease.key, 'store': self.lease.env['GIT_LOCKS_STORE']},
                         'launch_contract': {'lock_key': self.lease.key, 'lock_store': self.lease.env['GIT_LOCKS_STORE'],
                             'outputs': {'volume': self.volume, 'host_control': str(self.root / '.reader/container-runtime'),
                                         'tmpfs': {'/tmp': 256 * 1024**2, '/dev/shm': 64 * 1024**2}},
                             'cpu': 2, 'memory_bytes': 4 * GIB, 'pids': 256, 'docker_log_bytes': 4 * 1024**2,
                             'host_control_limit_bytes': 8 * 1024**2, 'deadline': self.wall_expires}})
            self.config = folder / 'devcontainer.json'
            if self.config.is_symlink():
                raise ProcessError('Runtime configuration file must not be a symlink')
            with os.fdopen(os.open(self.config, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), 'w') as stream:
                json.dump(config | {'workspaceFolder': '/work/jobs/' + self.run_id,
                    'userEnvProbe': 'none', 'remoteUser': 'root', 'containerUser': 'root'}, stream)
            volume = self._inspect('volume', self.volume, optional=True)
            if volume is None:
                args = [self.docker, 'volume', 'create']
                for key, value in self._labels().items():
                    args += ['--label', key + '=' + value]
                self.invoke(args + [self.volume])
                volume = self._inspect('volume', self.volume)
            if (not self._owned(volume.get('Labels')) or volume.get('Driver') != 'local'
                    or volume.get('Options')):
                raise ProcessError('The persistent workspace volume belongs to another owner')
            args = [self.docker, 'create', '--name', self.name, '--read-only', '--user', 'root',
                    '--cpus', '2', '--memory', '4g', '--memory-swap', '4g', '--pids-limit', '256',
                    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--network', 'bridge',
                    '--ipc', 'private', '--shm-size', '64m', '--tmpfs', '/tmp:rw,exec,size=268435456',
                    '--log-driver', 'local',
                    '--log-opt', 'max-size=4m', '--log-opt', 'max-file=1', '--log-opt', 'compress=false',
                    '--mount', 'type=volume,source=' + self.volume + ',target=/work']
            for key, value in self._container_labels().items():
                args += ['--label', key + '=' + value]
            env = {'HOME': '/work/home', 'TMPDIR': '/tmp', 'XDG_CACHE_HOME': '/work/cache',
                   'npm_config_cache': '/work/cache/npm',
                   'PATH': '/work/tools/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'} | config.get('containerEnv', {})
            for key, value in env.items():
                args += ['--env', key + '=' + value]
            self.cid = self.invoke(args + [image_id, '/usr/bin/python3', '-I', '-S', '-c', WATCHDOG,
                                          str(self.wall_expires)]).stdout.strip()
            if not re.fullmatch(r'[0-9a-f]{64}', self.cid):
                raise ProcessError('Docker did not return an immutable container identity')
            self.record({'id': self.cid, 'name': self.name, 'volume': self.volume, 'owner': self.owner,
                         'image': image_id, 'expires': self.wall_expires, 'run_id': self.run_id})
            self.invoke([self.docker, 'start', self.cid])
            admitted = self.measure()
            self.record({'id': self.cid, 'name': self.name, 'volume': self.volume, 'owner': self.owner,
                         'image': image_id, 'expires': self.wall_expires, 'run_id': self.run_id,
                         'state': 'admitted', 'measurement': admitted})
            self.monitor = threading.Thread(target=self._watch, name='reader-container-guard', daemon=True)
            self.monitor.start()
            self.command(['/usr/bin/python3', '-I', '-S', '-c',
                'import os,sys;[os.makedirs(p,exist_ok=True) for p in ("/work/home","/work/cache","/work/jobs","/work/runtime")];os.mkdir(sys.argv[1]);os.makedirs(sys.argv[2],exist_ok=False)',
                '/work/jobs/' + self.run_id, '/work/runtime/' + self.run_id])
            self.invoke([self.devcontainer, 'set-up', '--container-id', self.cid, '--config', str(self.config),
                         '--container-system-data-folder', '/work/.devcontainer/' + self.run_id, '--container-data-folder', '/work/.devcontainer/' + self.run_id,
                         '--user-data-folder', str(folder / 'cli'), '--skip-post-create', '--default-user-env-probe', 'none'],
                        timeout=120, output=self.output)
            return self
        except BaseException:
            self.close()
            raise

    def exec_argv(self, argv, cwd='/work', interactive=False):
        self.check()
        args = [self.docker, 'exec']
        if interactive:
            args.append('-i')
        args += ['--workdir', str(cwd), '--env', 'GIT_TERMINAL_PROMPT=0']
        for key, value in (self.configuration or {}).get('remoteEnv', {}).items():
            args += ['--env', key + '=' + value]
        return args + ['--', self.cid, *map(str, argv)]

    def command(self, argv, cwd='/work', timeout=15, check=True, stdin=None, **options):
        return self.invoke(self.exec_argv(argv, cwd, stdin is not None), timeout=timeout,
                           check=check, stdin=stdin, **options)

    def lifecycle(self):
        folder = self.config.parent
        control = '/work/.devcontainer/' + self.run_id
        return self.invoke([self.devcontainer, 'run-user-commands', '--container-id', self.cid,
            '--config', str(self.config), '--container-system-data-folder', control,
            '--container-data-folder', control, '--user-data-folder', str(folder / 'cli'),
            '--default-user-env-probe', 'none'], timeout=min(600, self.expires - time.monotonic()), output=self.output)

    def measure(self):
        info = self._inspect('container', self.cid)
        host = info.get('HostConfig') or {}
        mounts = info.get('Mounts') or []
        volumes = [m for m in mounts if m.get('Type') == 'volume']
        if (not self._owned((info.get('Config') or {}).get('Labels'))
                or ((info.get('Config') or {}).get('Labels') or {}).get('reader.coding.run') != self.run_id or info.get('Id') != self.cid
                or not (info.get('State') or {}).get('Running') or not host.get('ReadonlyRootfs')
                or host.get('Memory') != 4 * GIB or host.get('MemorySwap') != 4 * GIB
                or host.get('NanoCpus') != 2_000_000_000 or host.get('PidsLimit') != 256
                or host.get('ShmSize') != 64 * 1024**2 or host.get('Privileged') or host.get('Binds')
                or host.get('CapDrop') != ['ALL'] or host.get('Devices') or host.get('DeviceRequests')
                or host.get('NetworkMode') != 'bridge' or host.get('PidMode') or host.get('IpcMode') not in ('private', '')
                or not any(s in ('no-new-privileges', 'no-new-privileges:true') for s in host.get('SecurityOpt') or [])
                or host.get('LogConfig') != {'Type': 'local', 'Config': {'max-size': '4m', 'max-file': '1', 'compress': 'false'}}
                or host.get('Tmpfs') != {'/tmp': 'rw,exec,size=268435456'}
                or len(volumes) != 1 or volumes[0].get('Name') != self.volume or volumes[0].get('Destination') != '/work'
                or any(m.get('Type') not in ('tmpfs', 'volume') for m in mounts)):
            raise ProcessError('Container resource/mount contract changed')
        if shutil.disk_usage(self.root).free < FREE_FLOOR:
            raise ProcessError('Host free space fell below 50 GiB')
        with self.clients_lock:
            clients = set(self.clients)
        control_bytes = host_usage(self.root / '.reader/container-runtime', clients)
        result = self.invoke([self.docker, 'exec', '--env', 'LD_PRELOAD=', '--env', 'LD_LIBRARY_PATH=', self.cid, '/usr/bin/python3', '-I', '-S', '-c', MEASURE], timeout=8)
        try:
            measured = json.loads(result.stdout)
            used, free = measured['workspace_bytes'], measured['vm_free_bytes']
            if measured.get('tmpfs_bytes') != {'/tmp': 256 * 1024**2, '/dev/shm': 64 * 1024**2}:
                raise ProcessError('Actual tmpfs capacities differ from the resource contract')
            measured['host_control_bytes'] = control_bytes
            if type(used) is not int or type(free) is not int or used < 0 or free < 0:
                raise ValueError()
        except (ValueError, TypeError, KeyError) as exc:
            raise ProcessError('Workspace measurement failed') from exc
        if used >= WORK_LIMIT or free < FREE_FLOOR:
            raise ProcessError('Workspace reached 3 GiB or Docker free space fell below 50 GiB')
        return measured

    def _watch(self):
        next_lease = 0
        try:
            while not self.done.wait(.5):
                self.check()
                self.measure()
                if time.monotonic() >= next_lease:
                    self.lease.check()
                    next_lease = time.monotonic() + 5
        except BaseException as exc:
            self.error = str(exc) or 'Container monitoring failed'
            try:
                self.record({'guard_error': self.error, 'state': 'stopping'})
            except BaseException as recording:
                self.error += '; could not record guard failure: ' + str(recording)
            try:
                self.stop()
            except BaseException as failure:
                self.error += '; could not confirm stop: ' + str(failure)

    def stop(self):
        if not self.cid:
            return
        self.invoke([self.docker, 'stop', '--time', '1', self.cid], timeout=15, cleanup=True)
        result = self.invoke([self.docker, 'container', 'inspect', self.cid], cleanup=True)
        if json.loads(result.stdout)[0]['State']['Running']:
            raise ProcessError('Container stop could not be confirmed; reconciliation is required')

    def close(self):
        self.done.set()
        if self.monitor and self.monitor is not threading.current_thread():
            self.monitor.join(timeout=20)
            if self.monitor.is_alive():
                raise ProcessError('Container monitor did not stop; reconciliation is required')
        # Preserve the volume on every path. A failed stop retains the lease for reconciliation/expiry.
        if self.cid:
            self.stop()
        with self.clients_lock:
            remaining_clients = sorted(self.clients)
        if remaining_clients:
            self.record({'client_cleanup_unconfirmed': remaining_clients, 'state': 'needs_reconciliation'})
            raise ProcessError('Host control-plane client cleanup was not confirmed; worker state and lease are retained')
        if self.cid:
            self.invoke([self.docker, 'rm', self.cid], cleanup=True)
            self.cid = None
        self.lease.release()
