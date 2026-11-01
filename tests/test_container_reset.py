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


class Contended(Lease):
    def __init__(self,*args,busy,**kwargs):super().__init__(*args,**kwargs);self.run=kwargs['run'];self.busy=busy
    def acquire(self):
        if self.busy():
            self.run(['locks','claim'],env=self.env,timeout=15,limit=65536)
            raise ProcessError('resource is unavailable')
        super().acquire()


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
        if state.get('before'):state['before'](argv,kwargs)
        responses=state.get('responses',{})
        key=tuple(argv[:3]) if tuple(argv[:3]) in responses else tuple(argv[:2])
        if key in responses:return responses[key]()
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


def test_deletion_confirmation_and_release_have_a_reserved_cleanup_budget(control,monkeypatch):
    _,reset,state,calls=control
    clock={'now':0.0}
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:clock['now'],time=module.time.time))
    class Releasing(Lease):
        def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.run=kwargs['run']
        def release(self):
            self.run(['locks','release'],timeout=15,limit=65536)
            super().release()
    monkeypatch.setattr(module,'Lease',Releasing)
    def before(argv,kwargs):
        if argv[1:3]==['volume','rm']:clock['now']=61.0
        elif argv[:2]==['locks','release'] or (argv[1:3]==['volume','inspect'] and clock['now']>60):
            assert kwargs['timeout']>=10,'Cleanup must not inherit an expired work deadline'
    state['before']=before
    assert reset()['state']=='removed'


def test_known_missing_claim_is_refused_and_can_be_retried(control,monkeypatch):
    world,reset,state,calls=control
    monkeypatch.setattr(module,'Lease',lambda *args,**kwargs:Contended(*args,busy=lambda:state.get('busy'),**kwargs))
    state['busy']=True
    state['responses']={('locks','claim'):lambda:SimpleNamespace(returncode=1,stdout='',stderr='conflict'),
        ('locks','show'):lambda:SimpleNamespace(returncode=1,stdout='',stderr=json.dumps({'event':'missing','job':'fixture'}))}
    with pytest.raises(ProcessError,match='unavailable'):reset()
    record=json.loads(next((world.vault/'.reader/container-runtime').glob('*/reset.json')).read_text())
    assert record['state']=='refused'
    state['busy']=False
    assert reset()['state']=='removed'


def test_definitive_in_use_rejection_is_refused_and_can_be_retried(control):
    world,reset,state,calls=control
    state['responses']={('docker','volume','rm'):lambda:SimpleNamespace(returncode=1,stdout='',stderr='Error response from daemon: volume is in use')}
    with pytest.raises(ProcessError):reset()
    record=json.loads(next((world.vault/'.reader/container-runtime').glob('*/reset.json')).read_text())
    assert record['state']=='refused' and state['volume']
    state['responses']={}
    assert reset()['state']=='removed'


def test_reset_refuses_concurrent_terminal_setup_before_writing_intent(control):
    import fcntl,os
    world,reset,state,calls=control
    folder=world.vault/'.reader/container-runtime/b9d71e86eeaf925d';folder.mkdir(parents=True)
    with (folder/'setup.lock').open('w') as held:
        fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with pytest.raises(ProcessError,match='setup'):reset()
    assert not (folder/'reset.json').exists() and not calls


@pytest.mark.parametrize('answer',[(1,'malformed'),(1,'{"event":"missing","job":"foreign"}'),(2,'store unavailable')])
def test_unknown_claim_state_remains_unconfirmed(control,monkeypatch,answer):
    world,reset,state,calls=control
    monkeypatch.setattr(module,'Lease',lambda *args,**kwargs:Contended(*args,busy=lambda:True,**kwargs))
    state['responses']={('locks','claim'):lambda:SimpleNamespace(returncode=1,stdout='',stderr='conflict'),
        ('locks','show'):lambda:SimpleNamespace(returncode=answer[0],stdout='',stderr=answer[1])}
    with pytest.raises(ProcessError,match='unavailable'):reset()
    record=json.loads(next((world.vault/'.reader/container-runtime').glob('*/reset.json')).read_text())
    assert record['state']=='claiming'
    count=len(calls)
    with pytest.raises(ProcessError,match='Previous reset is unconfirmed'):reset()
    assert len(calls)==count and state['volume']


def test_ambiguous_remove_failure_retains_ownership_and_does_not_repeat(control,monkeypatch):
    world,reset,state,calls=control
    releases=[]
    original=Lease.release
    def release(self):releases.append(self.job);original(self)
    monkeypatch.setattr(Lease,'release',release)
    state['responses']={('docker','volume','rm'):lambda:SimpleNamespace(returncode=1,stdout='',stderr='connection lost')}
    with pytest.raises(ProcessError,match='unconfirmed'):reset()
    record=json.loads(next((world.vault/'.reader/container-runtime').glob('*/reset.json')).read_text())
    assert record['state']=='removing' and state['volume'] and not releases
    count=len(calls)
    with pytest.raises(ProcessError,match='Previous reset is unconfirmed'):reset()
    assert len(calls)==count
