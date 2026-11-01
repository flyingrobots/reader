"""Run the actual host CodingJobs control plane against real Docker, producing bounded evidence.

This is an executable synthetic application fixture, not a host test suite. Run its evidence assertions
inside the bounded Docker validation worker (test_real_container_evidence.py). Only GitHub and the
coding CLI are synthetic. All source initialization, clones, tasks, verification and pushes happen in
the managed Docker volume. No host Git checkout, credentials, socket mount or real publication.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import uuid

from reader_mcp.coding_api import CodingJobs
from reader_mcp.container_process import execute
from reader_mcp.container_setup import setup
from reader_mcp.prompt_blocks import find
from reader_mcp.repositories import Registry
from fake_github import FakeGitHub

REPO = 'acme/widget'
URL = 'https://github.com/acme/widget.git'


class GitHub(FakeGitHub):
    def __init__(self, metadata):
        super().__init__(REPO)
        self.metadata, self.jobs = metadata, None
    def revision(self, repo, ref):
        self.calls.append('revision')
        return {'sha':self.metadata['head'],'commit':{'tree':{'sha':self.metadata['tree']}}}
    def tree(self, repo, sha):
        self.calls.append('tree')
        return {'sha':sha,'truncated':False,'tree':self.metadata['entries']}
    def blob(self, repo, sha):
        self.calls.append('blob')
        blob=self.metadata['config_blob']
        if sha!=blob['sha']:raise RuntimeError('Unexpected synthetic blob request')
        return blob
    def head(self, branch):
        run=self.jobs.store.load(self.jobs.active)
        result=execute(['docker','exec',run['container']['id'],'git','--git-dir','/work/fixture-origin.git',
            'rev-parse','--verify','--quiet','refs/heads/'+branch],timeout=15)
        return result.stdout.strip() if result.returncode==0 else None


def run_fixture(root, lock_store):
    code=Path(__file__).resolve().parents[1]
    inputs=[*sorted((code/'src/reader_mcp').rglob('*.py')),Path(__file__),Path(__file__).with_name('fake_coding_cli.py'),Path(__file__).with_name('fake_github.py')]
    def source_hashes():return {str(p.relative_to(code)):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
    hashes=source_hashes()
    head=execute(['git','-C',str(code),'rev-parse','HEAD']).stdout.strip()
    root=Path(root).resolve();root.mkdir(exist_ok=True)
    image=json.loads(execute(['docker','image','inspect','reader-coding:local']).stdout)[0]['Id']
    lifecycle=['python3','-I','-c','import json,os;from pathlib import Path;p=Path("/work/fixture/lifecycle.jsonl");p.open("a").write(json.dumps({"cwd":os.getcwd(),"source_exists":Path("README.md").is_file()})+"\\n")']
    config={'image':'reader-coding:local','userEnvProbe':'none','remoteUser':'root','onCreateCommand':lifecycle,'containerEnv':{
        'GIT_AUTHOR_NAME':'Fixture','GIT_AUTHOR_EMAIL':'fixture@example.invalid','GIT_COMMITTER_NAME':'Fixture','GIT_COMMITTER_EMAIL':'fixture@example.invalid',
        'GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'url.file:///work/fixture-origin.git.insteadOf','GIT_CONFIG_VALUE_0':URL,
        'FAKE_CODING_SCENARIO':'/work/fixture/scenario.json'}}
    source=json.dumps(config,sort_keys=True,separators=(',',':')).encode()
    blob_sha=hashlib.sha1(b'blob '+str(len(source)).encode()+b'\0'+source).hexdigest()
    entry={'base':'main','agents':['codex'],'executables':{'codex':'/work/tools/bin/fixture-codex'},'agent_timeout_seconds':120,
        'verify':{'argv':['python3','verify.py'],'timeout_seconds':60},'environment':{'kind':'devcontainer','revision':'a'*40,'path':'.devcontainer.json','blob_sha':blob_sha,
        'sha256':hashlib.sha256(source).hexdigest(),'configuration':config,
        'inferred':False,'consent':False,'image_id':image,'lock_store':str(lock_store),'timeout_seconds':900}}
    registry=Registry(root);registry.register(REPO,entry)
    agent=base64.b64encode(Path(__file__).with_name('fake_coding_cli.py').read_bytes()).decode()
    # Every source/Git operation below executes through setup's real managed container transport.
    seed='''import base64,json,os,subprocess
from pathlib import Path
fixture=Path('/work/fixture');fixture.mkdir(exist_ok=True)
(fixture/'fake_cli.py').write_bytes(base64.b64decode(AGENT))
Path('/work/tools/bin').mkdir(parents=True,exist_ok=True)
wrapper=Path('/work/tools/bin/fixture-codex')
wrapper.write_text('#!/bin/sh\\nif [ "$1" = login ] && [ "$2" = status ]; then exit 0; fi\\nexec python3 /work/fixture/fake_cli.py "$@"\\n');wrapper.chmod(0o755)
(fixture/'scenario.json').write_text(json.dumps({'record':'/work/fixture/calls.jsonl'}))
bare=Path('/work/fixture-origin.git')
def git(*args,cwd='/work'):
 return subprocess.check_output(['git',*args],cwd=cwd,text=True,stderr=subprocess.DEVNULL).strip()
if not bare.exists():
 git('init','-q','--bare','-b','main',str(bare))
 source=Path('/work/fixture-seed');source.mkdir()
 git('init','-q','-b','main',str(source))
 (source/'README.md').write_text('# Synthetic widget\\n')
 (source/'pyproject.toml').write_text('[project]\\nname="fixture"\\nversion="0.0.0"\\n')
 (source/'verify.py').write_text('from pathlib import Path\\nimport sys\\nif Path("/work/fixture/fail-verification").exists():sys.exit(8)\\nif Path("src/depth.txt").read_text()!="max depth: 256\\\\n":sys.exit(2)\\nprint("actual fixture verification passed")\\n')
 git('add','.',cwd=source);git('commit','-q','-m','Synthetic baseline',cwd=source)
 git('remote','add','origin',str(bare),cwd=source);git('push','-q','origin','main',cwd=source)
source=Path('/work/fixture-seed')
config_bytes=base64.b64decode(CONFIG)
(source/'.devcontainer.json').write_bytes(config_bytes)
git('add','.devcontainer.json',cwd=source)
if subprocess.run(['git','diff','--cached','--quiet'],cwd=source).returncode:
 git('commit','-q','-m','Declare selected fixture devcontainer',cwd=source)
 git('push','-q','origin','main',cwd=source)
head=git('--git-dir',str(bare),'rev-parse','main');tree=git('--git-dir',str(bare),'rev-parse',head+'^{tree}')
entries=[]
for line in git('--git-dir',str(bare),'ls-tree',tree).splitlines():
 meta,path=line.split('\\t',1);mode,kind,sha=meta.split();entries.append({'path':path,'mode':mode,'type':kind,'sha':sha})
print(json.dumps({'head':head,'tree':tree,'entries':entries,'config_blob':{'sha':git('hash-object','.devcontainer.json',cwd=source),'size':len(config_bytes),'encoding':'base64','content':CONFIG}}))
'''.replace('AGENT',repr(agent)).replace('CONFIG',repr(base64.b64encode(source).decode()))
    output=[]
    setup(root,'exec',REPO,['python3','-I','-c',seed],seconds=240,output=lambda c,b:output.append(b.decode()))
    metadata=json.loads(''.join(output));entry['environment']['revision']=metadata['head'];registry.register(REPO,entry)
    doc=root/'library/audit.md';doc.parent.mkdir(exist_ok=True)
    prompt='Implement the synthetic parser depth change and report its evidence.\n'
    doc.write_text('# Synthetic audit\n\n<!-- reader:prompt '+json.dumps({'v':1,'id':'depth','title':'Synthetic depth','repo':REPO,'issue':277})+' -->\n\n```text\n'+prompt+'```\n\n<!-- /reader:prompt -->\n')
    def articles(path):
        data=(root/path).read_bytes();return data.decode(),hashlib.sha256(data).hexdigest()
    cases=[]
    for scenario in ('success','verification-failure','cancel'):
        output=[]
        prepare='''import json,sys
from pathlib import Path
p=Path('/work/fixture/fail-verification');p.unlink(missing_ok=True)
if sys.argv[1]=='verification-failure':p.touch()
Path('/work/fixture/scenario.json').write_text(json.dumps({'record':'/work/fixture/calls.jsonl','sleep':20 if sys.argv[1]=='cancel' else 0}))
p=Path('/work/fixture/calls.jsonl');print(len(p.read_text().splitlines()) if p.exists() else 0)
'''
        setup(root,'exec',REPO,['python3','-I','-c',prepare,scenario],seconds=180,output=lambda c,b:output.append(b.decode()))
        before=int(''.join(output).strip());github=GitHub(metadata)
        jobs=CodingJobs(root,articles,github=github,environ=dict(os.environ),git_locks=shutil.which('git-locks'));github.jobs=jobs
        admitted=None
        try:
            request={'action':'submit','request_id':str(uuid.uuid4()),'path':'library/audit.md','sha256':articles('library/audit.md')[1],
                'block_id':'depth','prompt':find(doc.read_text(),'depth')['prompt'],'agent':'codex'}
            admitted=jobs.dispatch(request);expires=time.monotonic()+240;stopped=False
            while time.monotonic()<expires:
                run=jobs.store.load(admitted['id'])
                if run['status']=='finished':break
                if scenario=='cancel' and run.get('phase')=='agent' and run.get('process') and not stopped and any(e.get('type')=='agent' and (e.get('event') or {}).get('type')=='turn.started' for e in jobs.events(run['id'])['events']):
                    jobs.stop(run['id']);stopped=True
                time.sleep(.05)
            else:
                jobs.stop(admitted['id']);raise RuntimeError('Actual fixture job did not finish within 240 seconds')
            cid=(run.get('container') or {}).get('id')
            inspection=execute(['docker','container','inspect',cid],timeout=15) if cid else None
            output=[]
            probe='''import json,subprocess,sys
from pathlib import Path
p=Path('/work/fixture/calls.jsonl');calls=[json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []
git=subprocess.run(['git','--git-dir','/work/fixture-origin.git','rev-parse','--verify','--quiet','refs/heads/'+sys.argv[1]],capture_output=True,text=True)
l=Path('/work/fixture/lifecycle.jsonl');print(json.dumps({'calls':calls,'remote_sha':git.stdout.strip() if git.returncode==0 else None,'lifecycle':[json.loads(x) for x in l.read_text().splitlines()] if l.exists() else []}))
'''
            setup(root,'exec',REPO,['python3','-I','-c',probe,run['git']['branch']],seconds=180,output=lambda c,b:output.append(b.decode()))
            cases.append({'scenario':scenario,'run':run,'factory':jobs.job_factory.__module__,'before_calls':before,
                'probe':json.loads(''.join(output)),'github_calls':github.calls,'pulls':list(github.pulls.values()),
                'worker_inspection':{'returncode':inspection.returncode,'stdout':inspection.stdout,'stderr':inspection.stderr} if inspection else None})
            print(scenario,run.get('outcome'),run.get('message'),flush=True)
        finally:
            if admitted and jobs.active:jobs.stop(admitted['id'])
            jobs.close()
    if source_hashes()!=hashes:raise RuntimeError('Executed source changed during the real Docker fixture')
    return {'source_identity':{'head':head,'sha256':hashes},'image_id':image,'cases':cases,'host_source_checkouts':[str(p) for p in root.rglob('.git') if p.is_dir()],
        'boundary':'Actual Docker/devcontainer/Git/agent process/verification/push; synthetic coding CLI and in-memory GitHub; no external publication'}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--lock-store',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();result=run_fixture(args.root,args.lock_store);Path(args.output).write_text(json.dumps(result,indent=2))
