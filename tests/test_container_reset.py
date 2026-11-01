"""Reset admission and destructive boundary with synthetic Docker/lease ports."""
import hashlib
import json
from types import SimpleNamespace

import pytest

from reader_mcp import container_reset as module
from reader_mcp.container_process import ProcessError
from test_container_registry import registered


class Supervisor:
    def __init__(self,*a,**k):pass
    def acquire(self):return True
    def release(self):pass


class Lease:
    def __init__(self,tool,store,key,seconds,**k):
        self.job='fixture';self.key=key;self.env={'GIT_LOCKS_STORE':store};self.acquisition=None
    def acquire(self):self.acquisition='receipt'
    def check(self):pass
    def release(self):self.acquisition=None


@pytest.fixture
def control(registered,monkeypatch):
    world,entry=registered;world.jobs.registry.register('acme/widget',entry)
    monkeypatch.setattr(module,'Lease',Lease)
    monkeypatch.setattr(module,'measure',lambda *a:0)
    root=world.vault;name='reader-coding-b9d71e86eeaf925d';volume=name+'-work';calls=[]
    state={'volume':{'Name':volume,'Driver':'local','Options':None,'Labels':{
        'reader.coding.owner':hashlib.sha256(str(root.resolve()).encode()).hexdigest(),'reader.coding.repo':'acme/widget'}},'worker':None}
    def run(argv,**kwargs):
        calls.append(argv)
        assert kwargs['env']['TMPDIR'].startswith(str(root))
        if argv[1:3]==['volume','rm']:state['volume']=None;return SimpleNamespace(returncode=0,stdout='',stderr='')
        value=state['worker'] if argv[1]=='container' else state['volume']
        return SimpleNamespace(returncode=0 if value else 1,stdout=json.dumps([value]) if value else '',stderr='' if value else 'No such '+argv[1])
    def reset(confirm=volume):
        return module.reset(root,'acme/widget',confirm,tools={'docker':'docker','git-locks':'locks'},run=run,supervisor_factory=Supervisor)
    return world,reset,state,calls


def test_exact_confirmation_is_required_before_destructive_commands(control):
    _,reset,state,calls=control
    with pytest.raises(ProcessError,match='permanently erases'):reset('yes')
    assert calls==[] and state['volume']


def test_owned_inactive_volume_reset_never_starts_a_worker(control):
    world,reset,state,calls=control
    assert reset()['state']=='removed' and state['volume'] is None
    assert not any(c[1] in ('create','run','start','exec') for c in calls)
    record=json.loads(next((world.vault/'.reader/container-runtime').glob('*/reset.json')).read_text())
    assert record['state']=='completed' and record['control_clients']==[]


@pytest.mark.parametrize('problem',['foreign','driver','worker','setup','run','labels'])
def test_recoverable_or_foreign_state_is_preserved(control,problem,monkeypatch):
    world,reset,state,calls=control
    if problem=='foreign':state['volume']['Labels']['reader.coding.owner']='foreign'
    elif problem=='driver':state['volume']['Driver']='nfs'
    elif problem=='labels':state['volume']['Labels']=['malformed']
    elif problem=='worker':state['worker']={'Id':'existing'}
    elif problem=='setup':
        folder=world.vault/'.reader/container-runtime/b9d71e86eeaf925d';folder.mkdir(parents=True)
        (folder/'setup.json').write_text('{"state":"needs_reconciliation"}')
    else:monkeypatch.setattr(module.Store,'runs',lambda self:[{'source':{'repo':'acme/widget'},'status':'running'}])
    with pytest.raises(ProcessError):reset()
    assert state['volume'] and not any(c[1:3]==['volume','rm'] for c in calls)


def test_interrupted_reset_is_not_repeated_implicitly(control):
    world,reset,state,calls=control
    folder=world.vault/'.reader/container-runtime/b9d71e86eeaf925d';folder.mkdir(parents=True)
    (folder/'reset.json').write_text('{"state":"removing","control_clients":[]}')
    with pytest.raises(ProcessError,match='Previous reset is unconfirmed'):reset()
    assert calls==[] and state['volume']
