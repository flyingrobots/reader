#!/usr/bin/env python3
"""Observe Reader by default; explicit librarian mode coordinates intake."""
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


def claims(root,claim=None,release=None,paths=(),*,role='observer'):
    if role not in ('observer','librarian'):
        raise ValueError('Unknown Upkeep role')
    if (claim or release) and role!='librarian':
        raise ValueError('Intake claims/releases require --role librarian in an authorized Reader intake session')
    runtime=root/'.reader'
    file=runtime/'upkeep-claims.json'
    # Writers publish by atomic replacement. Observation needs no coordination
    # directory or write lock and cannot turn an arrival into assigned work.
    if not claim and not release:
        return json.loads(file.read_text()) if file.exists() else {}
    runtime.mkdir(exist_ok=True)
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


def parse_args(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role',choices=('observer','librarian'),default='observer',
                        help='Observer reports arrivals only; librarian mode requires an authorized intake assignment')
    parser.add_argument('--participant',default='Reader librarian')
    parser.add_argument('--curation-offset',type=int,default=0)
    parser.add_argument('--curation-limit',type=int,default=10,
                        help='Librarian queue page size; 1–100, discovery never marks reviewed/read')
    parser.add_argument('--curation-snapshot',help='Queue snapshot returned by the preceding page')
    group=parser.add_mutually_exclusive_group()
    group.add_argument('--claim',help='Unique coordinator UUID; atomically claim the explicit paths')
    group.add_argument('--release',help='Release only this coordinator UUID after its workers stop')
    parser.add_argument('paths',nargs='*')
    args=parser.parse_args(argv)
    if (args.claim or args.release) and args.role!='librarian':
        parser.error('Intake claims/releases require --role librarian in an authorized Reader intake session')
    return args


def main(argv=None):
    args=parse_args(argv)
    code,root=runpy.run_path(str(Path(__file__).resolve().parents[3] / 'scripts/reader_paths.py'))['paths']()
    owners=claims(root,args.claim,args.release,args.paths,role=args.role)
    inbox=arrivals(root)
    for item in inbox:item['claimed_by']=owners.get(item['path'])
    result=subprocess.run([str(code/'.venv/bin/reader'),'--root',str(root),'annotate','-'],input=json.dumps(dict(operation='attention',participant=args.participant)),capture_output=True,text=True,timeout=30)
    if result.returncode:raise RuntimeError(result.stderr or result.stdout)
    state=root/'.reader/inbox-runner/state.json'
    runner=json.loads(state.read_text()) if state.exists() else None
    available=sum(not i['claimed_by'] and not i['symlink'] for i in inbox)
    if runner and runner.get('status') in ('starting','running','interrupted'):available=0
    intake_allowed=args.role=='librarian'
    curation=None
    if intake_allowed:
        curation_command=[str(code/'.venv/bin/reader'),'--root',str(root),
                          'curation','list','--participant',args.participant,
                          '--offset',str(args.curation_offset),'--limit',str(args.curation_limit)]
        if args.curation_snapshot:
            curation_command.extend(['--expected-snapshot',args.curation_snapshot])
        try:
            queued=subprocess.run(curation_command,
                                  capture_output=True,text=True,timeout=30)
            curation=(json.loads(queued.stdout) if not queued.returncode else
                      dict(status='unavailable',error=(queued.stderr or queued.stdout)[-4000:]))
        except subprocess.TimeoutExpired:
            curation=dict(status='unavailable',error='Curation discovery exceeded its 30-second deadline')
    print(json.dumps(dict(role=args.role,intake_allowed=intake_allowed,inbox=inbox,claims=owners,
                         intake_workers=min(3,(available+9)//10) if intake_allowed else 0,
                         runner=runner,discussion=json.loads(result.stdout),curation=curation),ensure_ascii=False,indent=2))

if __name__=='__main__':main()
