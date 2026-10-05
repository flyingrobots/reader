"""Install from a separate checkout without replacing unrelated client configuration."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import pytest


@pytest.fixture
def setup(tmp_path):
    code=tmp_path/'software';vault=tmp_path/'private';home=tmp_path/'codex-home';bin=tmp_path/'bin'
    for p in [code/'scripts',code/'.venv/bin',vault/'library',vault/'inbox',home/'skills',bin]:p.mkdir(parents=True)
    shutil.copy2(Path(__file__).parents[1]/'scripts/install.py',code/'scripts/install.py')
    (code/'.venv/bin/python').symlink_to(sys.executable)
    for name in ['reader','upkeep','reflective-reading']:(code/'skills'/name).mkdir(parents=True)
    state=tmp_path/'server.json'
    fake=bin/'codex';fake.write_text('''#!/usr/bin/env python3
import sys,os,json
from pathlib import Path
state=Path(os.environ['SERVER_STATE']);args=sys.argv[1:]
if args[:2]==['mcp','get']:
 if not state.exists():print('No MCP server named reader',file=sys.stderr);sys.exit(1)
 print(state.read_text())
elif args[:2]==['mcp','remove']:state.unlink()
elif args[:2]==['mcp','add']:
 command=args[args.index('--')+1:]
 state.write_text(json.dumps({'transport':{'command':command[0],'args':command[1:]}}))
else:sys.exit(2)
''');fake.chmod(0o755)
    env=dict(os.environ,CODEX_HOME=str(home),SERVER_STATE=str(state),PATH=str(bin)+os.pathsep+os.environ['PATH'])
    return code,vault,home,state,env


def run(setup,*args):
    code,vault,_,_,env=setup
    return subprocess.run([sys.executable,str(code/'scripts/install.py'),'--vault',str(vault),*args],env=env,capture_output=True,text=True)


def test_installs_explicit_vault_and_all_skills_idempotently(setup):
    code,vault,home,state,_=setup
    first=run(setup);assert first.returncode==0,first.stderr
    assert json.loads((code/'.reader/config.json').read_text())=={'vault':str(vault)}
    transport=json.loads(state.read_text())['transport']
    assert transport=={'command':str(code/'.venv/bin/python'),'args':['-m','reader_mcp.cli','--root',str(vault),'serve']}
    for name in ['reader','upkeep','reflective-reading']:assert (home/'skills'/name).resolve()==code/'skills'/name
    assert run(setup).returncode==0
    assert not (code/'library').exists()


def test_unrelated_registration_is_preserved(setup):
    code,_,home,state,_=setup
    original=json.dumps({'transport':{'command':'unrelated-python','args':['serve']}});state.write_text(original)
    result=run(setup,'--replace-existing')
    assert result.returncode!=0 and 'different MCP' in result.stderr
    assert state.read_text()==original and not (code/'.reader/config.json').exists()
    assert not list((home/'skills').iterdir())


def test_migrates_only_matching_legacy_vault(setup):
    code,vault,home,state,_=setup
    state.write_text(json.dumps({'transport':{'command':str(vault/'.venv/bin/python'),'args':['-m','reader_mcp.cli','--root',str(vault),'serve']}}))
    for name in ['reader','upkeep','reflective-reading']:
        old=vault/'skills'/name;old.mkdir(parents=True);(home/'skills'/name).symlink_to(old)
    assert run(setup).returncode!=0
    result=run(setup,'--replace-existing');assert result.returncode==0,result.stderr
    assert json.loads(state.read_text())['transport']['command']==str(code/'.venv/bin/python')
    assert (home/'skills/upkeep').resolve()==code/'skills/upkeep'
