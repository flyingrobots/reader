"""Control-plane state/refusal contracts; these fakes are not real Docker integration evidence."""
from copy import deepcopy
import json
from types import SimpleNamespace
import uuid
import time

import pytest

from reader_mcp.container_process import ProcessError
from reader_mcp.container_runtime import ContainerRuntime, GIB

CID, IMAGE = 'c' * 64, 'sha256:' + 'd' * 64


class Lease:
    def __init__(self, *args, **kwargs):
        self.acquired = self.released = False
        self.key, self.env = args[2], {'GIT_LOCKS_STORE': str(args[1])}
        self.job, self.acquisition = 'fixture-job', 'fixture-acquisition'
    def acquire(self):self.acquired = True
    def check(self):assert self.acquired
    def release(self):self.released = True


class Docker:
    def __init__(self):
        self.runtime = None
        self.calls, self.volume, self.container = [], None, None
        self.used, self.extra_mount, self.bad_tmpfs = 0, False, False
        self.measure_error = False

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        value = ''
        if args[0] == 'devcontainer':return SimpleNamespace(returncode=0, stdout='{}', stderr='')
        op = args[1:3]
        if op == ['image', 'inspect']:
            value = [{'Id': IMAGE, 'Config': {'Entrypoint': ['/bin/sh', '/usr/local/bin/reader-development-entrypoint']}}]
        elif op == ['volume', 'inspect']:
            if self.volume is None:return SimpleNamespace(returncode=1, stdout='', stderr='No such volume')
            value = [self.volume]
        elif op == ['volume', 'create']:
            self.volume = {'Driver': 'local', 'Options': None, 'Labels': self.runtime._labels()}
        elif op == ['container', 'inspect']:
            if self.container is None:return SimpleNamespace(returncode=1, stdout='', stderr='No such container')
            value = [self.container]
        elif args[1] == 'create':
            self.container = {'Id': CID, 'Config': {'Labels': self.runtime._container_labels()}, 'State': {'Running': False},
                'HostConfig': {'ReadonlyRootfs': True, 'Memory': 4 * GIB, 'MemorySwap': 4 * GIB,
                    'NanoCpus': 2_000_000_000, 'PidsLimit': 256, 'ShmSize': 67108864, 'CapDrop': ['ALL'],
                    'NetworkMode': 'bridge', 'SecurityOpt': ['no-new-privileges'], 'IpcMode': 'private',
                    'LogConfig': {'Type': 'local', 'Config': {'max-size': '4m', 'max-file': '1', 'compress': 'false'}},
                    'Tmpfs': {'/tmp': 'rw,exec,size=268435456', '/etc': 'rw,exec,size=16777216'}},
                'Mounts': [{'Type': 'volume', 'Name': self.runtime.volume, 'Destination': '/work'}]}
            if self.extra_mount:self.container['Mounts'].append({'Type': 'bind', 'Source': '/', 'Destination': '/host'})
            value = CID
        elif args[1] == 'start':self.container['State']['Running'] = True
        elif args[1] == 'stop':self.container['State']['Running'] = False
        elif args[1] == 'rm':self.container = None
        elif args[1] == 'exec' and self.measure_error:
            return SimpleNamespace(returncode=1, stdout='', stderr='Cannot account for a mapped workspace file')
        elif args[1] == 'exec':value = {'workspace_bytes': self.used, 'vm_free_bytes': 100 * GIB,
            'tmpfs_bytes': {'/tmp': 1 if self.bad_tmpfs else 256 * 1024**2, '/etc': 16 * 1024**2, '/dev/shm': 64 * 1024**2}}
        else:raise AssertionError(args)
        return SimpleNamespace(returncode=0, stdout=value if isinstance(value, str) else json.dumps(value), stderr='')


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    import reader_mcp.container_runtime as module
    monkeypatch.setattr(module, 'Lease', Lease)
    monkeypatch.setattr(module.shutil, 'disk_usage', lambda _: SimpleNamespace(free=100 * GIB))
    docker, records = Docker(), []
    value = ContainerRuntime(tmp_path, 'acme/widget', str(uuid.uuid4()), docker='docker', devcontainer='devcontainer',
        lock_tool='git-locks', lock_store=str(tmp_path / 'locks.git'), seconds=300, record=records.append, run=docker)
    docker.runtime = value
    yield value, docker, records
    value.close()


def test_normal_teardown_keeps_the_persistent_volume(runtime):
    value, docker, records = runtime
    value.prepare({'image': 'reader-development:local'}, IMAGE)
    assert records[0]['state'] == 'claiming' and records[0]['lease']['acquisition'] is None
    assert any(record.get('launch_contract') for record in records) and records[-1]['id'] == CID
    value.close()
    assert docker.volume is not None and docker.container is None and value.lease.released
    assert not any(args[1:3] == ['volume', 'rm'] for args in docker.calls)


@pytest.mark.parametrize('problem', ['usage', 'host-mount', 'tmpfs-size'])
def test_resource_refusal_stops_container_and_preserves_workspace(runtime, problem):
    value, docker, records = runtime
    if problem == 'usage':docker.used = 3 * GIB
    elif problem == 'host-mount':docker.extra_mount = True
    else:docker.bad_tmpfs = True
    with pytest.raises(ProcessError, match='3 GiB|contract|tmpfs'):
        value.prepare({'image': 'reader-development:local'}, IMAGE)
    assert docker.volume is not None and docker.container is None
    assert any(args[1] == 'stop' for args in docker.calls)
    assert not any(args[0] == 'devcontainer' for args in docker.calls), 'No setup after a failed resource check'


def test_an_unknown_workspace_volume_is_never_adopted(runtime):
    value, docker, records = runtime
    docker.volume = {'Driver': 'local', 'Labels': {'reader.coding.owner': 'someone else'}}
    original = deepcopy(docker.volume)
    with pytest.raises(ProcessError, match='another owner'):
        value.prepare({'image': 'reader-development:local'}, IMAGE)
    assert docker.volume == original and not any(args[1] == 'create' for args in docker.calls)


def test_control_storage_symlink_is_refused_before_worker_creation(runtime, tmp_path):
    value, docker, records = runtime
    (tmp_path / '.reader').mkdir()
    outside = tmp_path / 'outside';outside.mkdir()
    (tmp_path / '.reader/container-runtime').symlink_to(outside, target_is_directory=True)
    with pytest.raises(ProcessError, match='symlink'):
        value.prepare({'image': 'reader-development:local'}, IMAGE)
    assert not list(outside.iterdir()) and not any(args[1] == 'create' for args in docker.calls)


def test_low_host_space_refuses_all_container_mutations(runtime, monkeypatch):
    import reader_mcp.container_runtime as module
    value, docker, records = runtime
    monkeypatch.setattr(module.shutil, 'disk_usage', lambda _: SimpleNamespace(free=GIB))
    with pytest.raises(ProcessError, match='Host free space'):
        value.prepare({'image': 'reader-development:local'}, IMAGE)
    assert docker.calls == [] and docker.volume is None


def test_a_live_monitor_measurement_failure_stops_the_whole_worker(runtime):
    value, docker, records = runtime
    value.prepare({'image': 'reader-development:local'}, IMAGE)
    docker.measure_error = True
    deadline = time.monotonic() + 3
    while docker.container['State']['Running'] and time.monotonic() < deadline:
        time.sleep(.01)
    assert not docker.container['State']['Running'] and 'Cannot account' in value.error
    assert docker.volume is not None, 'Failed accounting must preserve the recovery workspace'
    with pytest.raises(ProcessError, match='Cannot account'):
        value.check()
