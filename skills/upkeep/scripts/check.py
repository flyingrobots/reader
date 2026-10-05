#!/usr/bin/env python3
"""Turn-boundary discovery, with explicit claims to coordinate intake sessions."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
from uuid import UUID


def arrivals(root):
    return [dict(path=p.relative_to(root).as_posix(),bundle=p.is_dir(),symlink=p.is_symlink())
            for p in sorted((root/'inbox').iterdir())
            if p.name not in ('README.md','.DS_Store') and not p.name.startswith('.delivery-')]


def claims(root,claim=None,release=None,paths=()):
    runtime=root/'.reader';runtime.mkdir(exist_ok=True)
    file=runtime/'upkeep-claims.json'
    with (runtime/'upkeep.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        state=json.loads(file.read_text()) if file.exists() else {}
        changed=False
        if release:
            release=str(UUID(release));state={p:owner for p,owner in state.items() if owner!=release};changed=True
        if claim:
            claim=str(UUID(claim))
            eligible={p['path'] for p in arrivals(root) if not p['symlink']}
            if not paths or any(p not in eligible for p in paths):raise ValueError('Claim explicit existing, non-symlink inbox bundles')
            if any(p in state and state[p]!=claim for p in paths):raise ValueError('An arrival is already claimed; do not overlap intake workers')
            runner=runtime/'inbox-runner/state.json'
            if runner.exists() and json.loads(runner.read_text()).get('status') in ('starting','running','interrupted'):
                raise ValueError('Inspect/finish the existing inbox runner before claiming intake')
            state.update({p:claim for p in paths});changed=True
        if changed:
            temporary=None
            try:
                with tempfile.NamedTemporaryFile(dir=runtime,prefix='.upkeep-',mode='w',delete=False) as out:
                    temporary=Path(out.name);json.dump(state,out);out.flush();os.fsync(out.fileno())
                os.replace(temporary,file)
            finally:
                if temporary:temporary.unlink(missing_ok=True)
        return state


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--participant',default='Reader librarian')
    group=parser.add_mutually_exclusive_group()
    group.add_argument('--claim',help='Unique coordinator UUID; atomically claim the explicit paths')
    group.add_argument('--release',help='Release only this coordinator UUID after its workers stop')
    parser.add_argument('paths',nargs='*')
    args=parser.parse_args()
    code,root=runpy.run_path(str(Path(__file__).resolve().parents[3] / 'scripts/reader_paths.py'))['paths']()
    owners=claims(root,args.claim,args.release,args.paths)
    inbox=arrivals(root)
    for item in inbox:item['claimed_by']=owners.get(item['path'])
    result=subprocess.run([str(code/'.venv/bin/reader'),'--root',str(root),'annotate','-'],input=json.dumps(dict(operation='attention',participant=args.participant)),capture_output=True,text=True,timeout=30)
    if result.returncode:raise RuntimeError(result.stderr or result.stdout)
    state=root/'.reader/inbox-runner/state.json'
    runner=json.loads(state.read_text()) if state.exists() else None
    available=sum(not i['claimed_by'] and not i['symlink'] for i in inbox)
    if runner and runner.get('status') in ('starting','running','interrupted'):available=0
    print(json.dumps(dict(inbox=inbox,claims=owners,intake_workers=min(3,(available+9)//10),runner=runner,discussion=json.loads(result.stdout)),ensure_ascii=False,indent=2))

if __name__=='__main__':main()
