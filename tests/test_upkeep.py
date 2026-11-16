import importlib.util
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4
import pytest

spec=importlib.util.spec_from_file_location('upkeep',Path(__file__).resolve().parents[1]/'skills/upkeep/scripts/check.py')
upkeep=importlib.util.module_from_spec(spec);spec.loader.exec_module(upkeep)

def test_claims_prevent_overlapping_workers_and_release_only_owner(tmp_path):
    inbox=tmp_path/'inbox';inbox.mkdir();(inbox/'README.md').write_text('guide');(inbox/'.DS_Store').touch()
    (inbox/'a').mkdir();(inbox/'a'/'attachment').touch();(inbox/'b.md').touch()
    assert len(upkeep.arrivals(tmp_path))==2
    first,second=str(uuid4()),str(uuid4())
    def claim(owner):
        try:upkeep.claims(tmp_path,claim=owner,paths=['inbox/a'],role='librarian');return True
        except ValueError:return False
    with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(claim,[first,second]))==[False,True]
    state=upkeep.claims(tmp_path);winner=state['inbox/a'];other=second if winner==first else first
    upkeep.claims(tmp_path,claim=other,paths=['inbox/b.md'],role='librarian')
    assert upkeep.claims(tmp_path,release=winner,role='librarian')=={'inbox/b.md':other}
    assert upkeep.claims(tmp_path,release=other,role='librarian')=={}

def test_runner_and_missing_paths_block_claims(tmp_path):
    (tmp_path/'inbox').mkdir();(tmp_path/'inbox/a').touch();(tmp_path/'.reader/inbox-runner').mkdir(parents=True)
    (tmp_path/'.reader/inbox-runner/state.json').write_text('{"status":"running"}')
    with pytest.raises(ValueError):upkeep.claims(tmp_path,claim=str(uuid4()),paths=['inbox/a'],role='librarian')
    with pytest.raises(ValueError):upkeep.claims(tmp_path,claim=str(uuid4()),paths=['library/no'],role='librarian')


def test_inbox_runner_refuses_active_upkeep_claim(tmp_path):
    from reader_mcp.inbox_runner import run
    (tmp_path/'inbox').mkdir();(tmp_path/'inbox/a').touch()
    upkeep.claims(tmp_path,claim=str(uuid4()),paths=['inbox/a'],role='librarian')
    assert run(tmp_path,'/a/codex/that/must/not/launch')==2
    import json
    state=json.loads((tmp_path/'.reader/inbox-runner/state.json').read_text())
    assert state['status']=='failed' and 'Upkeep' in state['message']


@pytest.mark.parametrize('operation', ['claim', 'release'])
def test_observer_cannot_mutate_an_existing_intake_assignment(tmp_path, operation):
    (tmp_path/'inbox').mkdir(); (tmp_path/'inbox/a').mkdir()
    owner=str(uuid4())
    upkeep.claims(tmp_path,claim=owner,paths=['inbox/a'],role='librarian')
    file=tmp_path/'.reader/upkeep-claims.json'
    before=file.read_bytes()
    request={operation:owner}
    if operation=='claim':request['paths']=['inbox/a']
    with pytest.raises(ValueError,match='require --role librarian'):
        upkeep.claims(tmp_path,**request)
    assert file.read_bytes()==before
    assert upkeep.claims(tmp_path)=={'inbox/a':owner}


@pytest.mark.parametrize('operation', ['claim', 'release'])
def test_cli_rejects_observer_mutation_before_resolving_the_vault(monkeypatch, operation):
    def unexpected_resolution(*args, **kwargs):
        pytest.fail('Observer mutation must refuse before vault/configuration access')
    monkeypatch.setattr(upkeep.runpy,'run_path',unexpected_resolution)
    args=['--'+operation,str(uuid4())]
    if operation=='claim':args.append('inbox/a')
    with pytest.raises(SystemExit) as error:
        upkeep.main(args)
    assert error.value.code==2


@pytest.mark.parametrize('role, workers', [('observer',0),('librarian',1)])
def test_ready_inbox_is_discovered_without_promoting_observer_to_intake(tmp_path, monkeypatch, capsys, role, workers):
    code=tmp_path/'code';vault=tmp_path/'vault';(vault/'inbox/a').mkdir(parents=True)
    (vault/'inbox/a/document.md').write_text('preserved arrival')
    monkeypatch.setattr(upkeep.runpy,'run_path',lambda _: {'runtime':lambda:(code,vault,code/'.venv/bin/python',{})})
    def attention(*args, **kwargs):
        if 'curation' in args[0]:
            assert role=='librarian'
            return SimpleNamespace(returncode=0,stderr='',stdout=json.dumps({'participant':'Project courier','pending':[], 'total':0, 'next_offset':None}))
        request=json.loads(kwargs['input'])
        assert request=={'operation':'attention','participant':'Project courier'}
        return SimpleNamespace(returncode=0,stderr='',stdout=json.dumps({'participant':'Project courier','pending':[],'total':0,'next_offset':None}))
    monkeypatch.setattr(upkeep.subprocess,'run',attention)
    args=['--participant','Project courier']
    if role=='librarian':args.extend(['--role','librarian'])
    upkeep.main(args)
    result=json.loads(capsys.readouterr().out)
    assert result['role']==role and result['intake_allowed']==(role=='librarian')
    assert result['intake_workers']==workers
    assert result['inbox']==[{'path':'inbox/a','bundle':True,'symlink':False,'claimed_by':None}]
    assert result['claims']=={}
    assert (result['curation'] is not None)==(role=='librarian')
    assert not (vault/'.reader').exists()
    assert (vault/'inbox/a/document.md').read_text()=='preserved arrival'


def test_unavailable_curation_is_explicit_and_does_not_hide_inbox(tmp_path, monkeypatch, capsys):
    code=tmp_path/'code';vault=tmp_path/'vault';(vault/'inbox/a').mkdir(parents=True)
    monkeypatch.setattr(upkeep.runpy,'run_path',lambda _: {'runtime':lambda:(code,vault,code/'.venv/bin/python',{})})
    def response(args,**kwargs):
        if 'curation' in args:return SimpleNamespace(returncode=1,stderr='Missing versioned frontmatter; finish filing',stdout='')
        return SimpleNamespace(returncode=0,stderr='',stdout='{"pending":[],"total":0,"next_offset":null}')
    monkeypatch.setattr(upkeep.subprocess,'run',response)
    upkeep.main(['--role','librarian','--participant','Curator'])
    result=json.loads(capsys.readouterr().out)
    assert result['inbox'][0]['path']=='inbox/a' and result['intake_workers']==1
    assert result['curation']['status']=='unavailable'
    assert 'finish filing' in result['curation']['error'] and 'total' not in result['curation']


def test_curation_timeout_preserves_discovery_report(tmp_path,monkeypatch,capsys):
    code=tmp_path/'code';vault=tmp_path/'vault';(vault/'inbox/a').mkdir(parents=True)
    monkeypatch.setattr(upkeep.runpy,'run_path',lambda _: {'runtime':lambda:(code,vault,code/'.venv/bin/python',{})})
    def response(args,**kwargs):
        if 'curation' in args:raise upkeep.subprocess.TimeoutExpired(args,30)
        return SimpleNamespace(returncode=0,stderr='',stdout='{"pending":[],"total":0,"next_offset":null}')
    monkeypatch.setattr(upkeep.subprocess,'run',response)
    upkeep.main(['--role','librarian'])
    result=json.loads(capsys.readouterr().out)
    assert result['inbox'][0]['path']=='inbox/a'
    assert result['curation']['status']=='unavailable' and 'deadline' in result['curation']['error']


def run_with_bundles(tmp_path, monkeypatch, capsys, count, role='librarian', claimed=0, runner=None):
    code=tmp_path/'code';vault=tmp_path/'vault';(vault/'inbox').mkdir(parents=True)
    for n in range(count):(vault/f'inbox/b{n:02}').mkdir()
    if claimed:upkeep.claims(vault,claim=str(uuid4()),paths=[f'inbox/b{n:02}' for n in range(claimed)],role='librarian')
    if runner:(vault/'.reader/inbox-runner').mkdir(parents=True,exist_ok=True);(vault/'.reader/inbox-runner/state.json').write_text(json.dumps({'status':runner}))
    monkeypatch.setattr(upkeep.runpy,'run_path',lambda _: {'runtime':lambda:(code,vault,code/'.venv/bin/python',{})})
    monkeypatch.setattr(upkeep.subprocess,'run',lambda *a,**k: SimpleNamespace(returncode=0,stderr='',stdout='{"pending":[],"total":0,"next_offset":null}'))
    upkeep.main(['--participant','Curator']+(['--role',role] if role=='librarian' else []))
    return json.loads(capsys.readouterr().out)


@pytest.mark.parametrize('count, workers', [(0,0),(1,1),(10,1),(11,2),(20,2),(21,3),(45,3)])
def test_recommended_intake_workers_is_a_recommendation_by_batch_size(tmp_path, monkeypatch, capsys, count, workers):
    result=run_with_bundles(tmp_path,monkeypatch,capsys,count)
    assert result['recommended_intake_workers']==workers
    assert result['intake_workers']==workers, 'the deprecated alias keeps its value during migration'
    assert result['deprecated']=={'intake_workers':'renamed recommended_intake_workers: a recommended delegation count, not a live worker count'}


@pytest.mark.parametrize('count', [0,1,25])
def test_observers_are_never_recommended_workers(tmp_path, monkeypatch, capsys, count):
    result=run_with_bundles(tmp_path,monkeypatch,capsys,count,role='observer')
    assert result['recommended_intake_workers']==0 and result['intake_workers']==0


def test_claims_and_blocking_runner_states_keep_their_exclusions(tmp_path, monkeypatch, capsys):
    assert run_with_bundles(tmp_path/'a',monkeypatch,capsys,12,claimed=2)['recommended_intake_workers']==1
    for status in ('starting','running','interrupted'):
        assert run_with_bundles(tmp_path/status,monkeypatch,capsys,5,runner=status)['recommended_intake_workers']==0
    assert run_with_bundles(tmp_path/'done',monkeypatch,capsys,5,runner='succeeded')['recommended_intake_workers']==1


# Confidentiality gate: upkeep reads the vault only for an opted-in caller repository or for Reader's own repositories.

REPO=Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def caller_is_this_reader_checkout(monkeypatch):
    """By default the caller is this code checkout, one of Reader's own repositories, which needs no opt-in marker."""
    monkeypatch.chdir(REPO)
    monkeypatch.delenv('AGENT_SESSION_ID',raising=False)


def repository(path,*markers):
    (path/'.git').mkdir(parents=True)
    for marker in markers:(path/marker).write_text('')
    return path


def observed_vault(tmp_path,monkeypatch,calls):
    """A synthetic vault with one arrival; records every subprocess call so a skip can prove nothing ran."""
    vault=repository(tmp_path/'vault');(vault/'library').mkdir();(vault/'inbox/a').mkdir(parents=True)
    monkeypatch.setattr(upkeep.runpy,'run_path',lambda _: {'runtime':lambda:(tmp_path/'code',vault,tmp_path/'code/.venv/bin/python',{})})
    def run(args,**kwargs):
        calls.append(kwargs.get('input'))
        return SimpleNamespace(returncode=0,stderr='',stdout='{"pending":[],"total":0,"next_offset":null}')
    monkeypatch.setattr(upkeep.subprocess,'run',run)
    return vault


@pytest.mark.parametrize('markers',[(),('.no-reader',),('.no-reader','.reader-opt-in')])
def test_unmarked_or_restricted_repository_skips_before_any_vault_access(tmp_path,monkeypatch,capsys,markers):
    calls=[];vault=observed_vault(tmp_path,monkeypatch,calls)
    project=repository(tmp_path/'client',*markers);(project/'src').mkdir();monkeypatch.chdir(project/'src')
    upkeep.main(['--participant','Project courier'])
    out=capsys.readouterr().out
    assert out.startswith('Reader upkeep skipped: ') and out.count('\n')==1, out
    assert ('.no-reader' in out)==('.no-reader' in markers) and ('.reader-opt-in' in out)==(not markers)
    assert calls==[], 'a skipped check must not query Reader discussion'
    assert not (vault/'.reader').exists()


def test_restricted_repository_skips_without_resolving_the_vault(tmp_path,monkeypatch,capsys):
    monkeypatch.setattr(upkeep.runpy,'run_path',lambda _: pytest.fail('.no-reader must skip before vault/configuration access'))
    project=repository(tmp_path/'client','.no-reader')
    upkeep.main(['--participant','Project courier','--repo',str(project)])
    assert capsys.readouterr().out.startswith('Reader upkeep skipped: ')


def test_opted_in_repository_is_observed(tmp_path,monkeypatch,capsys):
    calls=[];observed_vault(tmp_path,monkeypatch,calls)
    project=repository(tmp_path/'personal','.reader-opt-in');monkeypatch.chdir(project)
    upkeep.main(['--participant','Project courier'])
    result=json.loads(capsys.readouterr().out)
    assert result['role']=='observer' and result['inbox'][0]['path']=='inbox/a'
    assert [json.loads(c)['participant'] for c in calls]==['Project courier']


def test_reader_vault_and_its_worktrees_need_no_opt_in(tmp_path,monkeypatch,capsys):
    calls=[];vault=observed_vault(tmp_path,monkeypatch,calls)
    linked=vault/'.git/worktrees/cleanup';linked.mkdir(parents=True);(linked/'commondir').write_text('../..\n')
    worktree=tmp_path/'vault-cleanup';worktree.mkdir();(worktree/'.git').write_text(f'gitdir: {linked}\n')
    for caller in (vault/'library',worktree):
        upkeep.main(['--participant','Project courier','--repo',str(caller)])
        assert json.loads(capsys.readouterr().out)['inbox'][0]['path']=='inbox/a'
    assert len(calls)==2


def test_unrelated_worktree_of_another_repository_is_not_reader(tmp_path,monkeypatch,capsys):
    calls=[];observed_vault(tmp_path,monkeypatch,calls)
    other=repository(tmp_path/'other');linked=other/'.git/worktrees/w';linked.mkdir(parents=True);(linked/'commondir').write_text('../..\n')
    worktree=tmp_path/'other-w';worktree.mkdir();(worktree/'.git').write_text('gitdir: ../other/.git/worktrees/w\n')
    upkeep.main(['--participant','Project courier','--repo',str(worktree)])
    assert capsys.readouterr().out.startswith('Reader upkeep skipped: ') and calls==[]


def test_this_code_checkout_needs_no_opt_in(tmp_path,monkeypatch,capsys):
    calls=[];observed_vault(tmp_path,monkeypatch,calls)
    upkeep.main(['--participant','Project courier','--repo',str(REPO/'skills/upkeep')])
    assert json.loads(capsys.readouterr().out)['role']=='observer' and len(calls)==1


def test_missing_vault_configuration_skips_unmarked_but_reports_for_opted_in(tmp_path,monkeypatch,capsys):
    def unconfigured():raise ValueError('No private vault configured.')
    monkeypatch.setattr(upkeep.runpy,'run_path',lambda _: {'runtime':unconfigured})
    upkeep.main(['--participant','Project courier','--repo',str(repository(tmp_path/'client'))])
    assert capsys.readouterr().out.startswith('Reader upkeep skipped: ')
    with pytest.raises(ValueError,match='No private vault'):
        upkeep.main(['--participant','Project courier','--repo',str(repository(tmp_path/'personal','.reader-opt-in'))])


def test_observer_participant_is_required_without_a_session_label(monkeypatch,capsys):
    monkeypatch.setattr(upkeep.runpy,'run_path',lambda _: pytest.fail('A missing participant must refuse before vault access'))
    with pytest.raises(SystemExit) as error:upkeep.main([])
    assert error.value.code==2 and 'participant' in capsys.readouterr().err


@pytest.mark.parametrize('role, expected',[('observer','claude-session-1234'),('librarian','Reader librarian')])
def test_default_participant_is_the_session_label_for_observers_only(tmp_path,monkeypatch,capsys,role,expected):
    calls=[];observed_vault(tmp_path,monkeypatch,calls)
    monkeypatch.setenv('AGENT_SESSION_ID','claude-session-1234')
    upkeep.main(['--role',role])
    capsys.readouterr()
    assert json.loads(calls[0])['participant']==expected
