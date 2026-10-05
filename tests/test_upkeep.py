import importlib.util
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
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
        try:upkeep.claims(tmp_path,claim=owner,paths=['inbox/a']);return True
        except ValueError:return False
    with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(claim,[first,second]))==[False,True]
    state=upkeep.claims(tmp_path);winner=state['inbox/a'];other=second if winner==first else first
    upkeep.claims(tmp_path,claim=other,paths=['inbox/b.md'])
    assert upkeep.claims(tmp_path,release=winner)=={'inbox/b.md':other}
    assert upkeep.claims(tmp_path,release=other)=={}

def test_runner_and_missing_paths_block_claims(tmp_path):
    (tmp_path/'inbox').mkdir();(tmp_path/'inbox/a').touch();(tmp_path/'.reader/inbox-runner').mkdir(parents=True)
    (tmp_path/'.reader/inbox-runner/state.json').write_text('{"status":"running"}')
    with pytest.raises(ValueError):upkeep.claims(tmp_path,claim=str(uuid4()),paths=['inbox/a'])
    with pytest.raises(ValueError):upkeep.claims(tmp_path,claim=str(uuid4()),paths=['library/no'])


def test_inbox_runner_refuses_active_upkeep_claim(tmp_path):
    from reader_mcp.inbox_runner import run
    (tmp_path/'inbox').mkdir();(tmp_path/'inbox/a').touch()
    upkeep.claims(tmp_path,claim=str(uuid4()),paths=['inbox/a'])
    assert run(tmp_path,'/a/codex/that/must/not/launch')==2
    import json
    state=json.loads((tmp_path/'.reader/inbox-runner/state.json').read_text())
    assert state['status']=='failed' and 'Upkeep' in state['message']
