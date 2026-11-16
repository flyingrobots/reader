"""Fixed image builder contracts with synthetic Docker/lease ports. Not daemon build proof."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from reader_mcp import container_image as module
from reader_mcp.container_process import ProcessError


class Lease:
    def __init__(self, *args, **kwargs):self.job='fixture';self.key=args[2];self.released=False;self.lost=False
    def acquire(self):pass
    def check(self):
        if self.lost:raise ProcessError('lease lost')
    def release(self):self.released=True


class Docker:
    def __init__(self):self.calls=[];self.image=None;self.free=100*module.GIB;self.probe_error=False;self.foreign=None
    def __call__(self, argv, **kwargs):
        self.calls.append((argv,kwargs));value=''
        if argv[1:3]==['image','inspect']:
            tag=argv[3]
            if tag in module.BASES or tag in [name+'@'+digest for name,digest in module.BASES.items()]:
                value=[{'Id':'sha256:'+'c'*64,'Size':module.GIB,'Config':{}}]
            elif self.image:value=[self.image]
            else:return SimpleNamespace(returncode=1,stdout='',stderr='No such image')
        elif argv[1:3]==['container','inspect']:
            if self.foreign:value=[self.foreign]
            else:return SimpleNamespace(returncode=1,stdout='',stderr='No such container')
        elif argv[1]=='run':
            value='Filesystem Blocks Used Available Capacity Mounted\nroot 1 1 '+str(self.free//1024)+' 1% /\n'
        elif argv[1]=='build':
            kwargs['cancelled']()
            assert kwargs['env']['DOCKER_BUILDKIT']=='0'
            digest=module.recipe()[1]
            self.image={'Id':'sha256:'+'a'*64,'Size':module.GIB,'Config':{'Entrypoint':module.ENTRYPOINT,'Labels':{'reader.coding.recipe':digest,'reader.coding.managed-image':'true'}}}
            kwargs['output']('stdout',b'finite build output\n')
        else:raise AssertionError(argv)
        return SimpleNamespace(returncode=0,stdout=value if isinstance(value,str) else json.dumps(value),stderr='')


@pytest.fixture
def control(tmp_path,monkeypatch):
    store=tmp_path/'authority.git';store.mkdir();(store/'HEAD').write_text('fixture');(store/'objects').mkdir()
    docker=Docker();leases=[]
    def lease(*args,**kwargs):
        value=Lease(*args,**kwargs);leases.append(value);return value
    monkeypatch.setattr(module,'Lease',lease)
    monkeypatch.setattr(module.shutil,'disk_usage',lambda _:SimpleNamespace(free=100*module.GIB))
    monkeypatch.setattr(module,'host_usage',lambda *args:0)
    return tmp_path,store,docker,leases


def prepare(control):
    root,store,docker,_=control
    return module.prepare(root,store,run=docker,docker='docker',lock_tool='locks')


def test_fixed_build_then_reuse_does_not_create_another_build(control):
    result=prepare(control)
    assert result['reused'] is False
    calls=control[2].calls
    build=next(argv for argv,_ in calls if argv[1]=='build')
    assert all(flag in build for flag in ['--pull=false','--network=none','--memory=512m','--memory-swap=512m','--cpu-quota=200000','--force-rm'])
    assert set(p.name for p in Path(build[-1]).iterdir())==set(module.RECIPE)
    assert control[3][-1].released
    assert prepare(control)['reused'] is True
    assert sum(argv[1]=='build' for argv,_ in calls)==1


def test_changed_packaged_recipe_is_refused_before_admission(control,tmp_path):
    changed=tmp_path/'changed';changed.mkdir()
    for name in module.RECIPE:(changed/name).write_text('unexpected executable input')
    with pytest.raises(ProcessError,match='recipe changed'):
        module.prepare(control[0],control[1],run=control[2],recipe_folder=changed)
    assert control[3]==[] and control[2].calls==[]


def test_low_vm_capacity_stops_before_build(control):
    control[2].free=49*module.GIB
    with pytest.raises(ProcessError,match='backing free space'):prepare(control)
    assert not any(argv[1]=='build' for argv,_ in control[2].calls)
    assert control[3][-1].released


def test_foreign_probe_is_never_removed(control):
    control[2].foreign={'Id':'foreign','Config':{'Labels':{'reader.coding.image-probe':'somebody-else'}}}
    with pytest.raises(ProcessError,match='already exists'):prepare(control)
    assert not any(argv[1] in ('run','rm','build') for argv,_ in control[2].calls)


def test_unknown_existing_image_is_not_retagged(control):
    control[2].image={'Id':'sha256:'+'b'*64,'Size':module.GIB,'Config':{'Labels':None}}
    with pytest.raises(ProcessError,match='not replaced'):prepare(control)
    assert not any(argv[1]=='build' for argv,_ in control[2].calls)


def test_failed_host_client_cleanup_does_not_release_the_image_lease(control):
    original=control[2].__call__
    def failed(argv,**kwargs):
        if argv[1]=='build':
            kwargs['started'](777)
            raise PermissionError('client cleanup unconfirmed')
        return original(argv,**kwargs)
    with pytest.raises(ProcessError,match='cleanup is unconfirmed'):
        module.prepare(control[0],control[1],run=failed,docker='docker',lock_tool='locks')
    assert not control[3][-1].released


def test_mutable_tag_cannot_substitute_for_an_unavailable_manifest_pin(control):
    original=control[2].__call__
    def missing_pin(argv,**kwargs):
        if argv[1:3]==['image','inspect'] and '@' in argv[3]:
            return SimpleNamespace(returncode=1,stdout='',stderr='No such image: pinned reference')
        return original(argv,**kwargs)
    with pytest.raises(ProcessError,match='Could not inspect'):
        module.prepare(control[0],control[1],run=missing_pin,docker='docker',lock_tool='locks')
    assert not any(argv[1] in ('run','build') for argv,_ in control[2].calls)


def test_capacity_probe_uses_inspected_image_id_and_never_pulls(control):
    prepare(control)
    probes = [argv for argv, _ in control[2].calls if argv[1] == 'run']
    assert probes and all('--pull=never' in argv for argv in probes)
    assert all(argv[argv.index('--entrypoint') + 2] == 'sha256:' + 'c'*64 for argv in probes)
    assert all('python:3.12-bookworm' not in argv for argv in probes)
