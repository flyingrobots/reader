import json
from pathlib import Path
import subprocess
import sys
import time

from reader_mcp.inbox_runner import inventory, run


def fixture(tmp_path,script):
    (tmp_path/'inbox').mkdir();(tmp_path/'library').mkdir()
    (tmp_path/'inbox/README.md').write_text('Guide')
    (tmp_path/'inbox/test.md').write_text('A document')
    fake=tmp_path/'fake-codex';fake.write_text('#!'+sys.executable+'\n'+script);fake.chmod(0o755)
    return fake


def test_runner_launches_without_shell_and_keeps_report(tmp_path):
    fake=fixture(tmp_path,'''import sys,pathlib
args=sys.argv
pathlib.Path('arguments.json').write_text(__import__('json').dumps(args))
pathlib.Path('received-prompt.txt').write_text(sys.stdin.read())
pathlib.Path('inbox/test.md').rename('library/test.md')
pathlib.Path(args[args.index('--output-last-message')+1]).write_text('Filed test.md; verified.')
''')
    assert run(tmp_path,str(fake))==0
    state=json.loads((tmp_path/'.reader/inbox-runner/state.json').read_text())
    assert state['status']=='finished' and not state['remaining']
    args=json.loads((tmp_path/'arguments.json').read_text())
    assert args[args.index('--cd')+1]==str(tmp_path)
    assert '--dangerously-bypass-approvals-and-sandbox' not in args
    prompt=(tmp_path/'received-prompt.txt').read_text()
    assert 'never manufacture' in prompt and 'wide-md' in prompt
    assert 'inbox/test.md' in prompt and 'inbox/README.md' not in prompt


def test_failure_and_empty_inbox_do_not_claim_processing(tmp_path):
    fake=fixture(tmp_path,'raise SystemExit(7)\n')
    assert run(tmp_path,str(fake))==7
    state=json.loads((tmp_path/'.reader/inbox-runner/state.json').read_text())
    assert state['status']=='failed' and state['exit_code']==7
    (tmp_path/'inbox/test.md').unlink()
    assert run(tmp_path,str(fake))==0
    assert json.loads((tmp_path/'.reader/inbox-runner/state.json').read_text())['status']=='empty'


def test_duplicate_launch_and_cancel(tmp_path):
    fake=fixture(tmp_path,'import time\ntime.sleep(20)\n')
    process=subprocess.Popen([sys.executable,'-m','reader_mcp.inbox_runner','--root',str(tmp_path),'--codex',str(fake)])
    runtime=tmp_path/'.reader/inbox-runner'
    try:
        for _ in range(100):
            if (runtime/'state.json').exists() and json.loads((runtime/'state.json').read_text())['status']=='running':break
            time.sleep(.05)
        assert json.loads((runtime/'state.json').read_text())['status']=='running'
        assert run(tmp_path,str(fake))==2
        (runtime/'cancel').write_text('stop')
        assert process.wait(timeout=5)==1
        assert json.loads((runtime/'state.json').read_text())['status']=='stopped'
    finally:
        if process.poll() is None:process.kill();process.wait()
