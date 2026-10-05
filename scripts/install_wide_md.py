#!/usr/bin/env python3
"""Build a pinned wide-md locally with bounded, monitored output and no global install."""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import resource
import shutil
import signal
import subprocess
import time

REVISION = 'c167101b32bbe37954429e9de5db33efcdc0a16c'
REPOSITORY = 'https://github.com/flyingrobots/wide-md'
from reader_paths import paths
CODE, ROOT = paths()
WORK = ROOT / '.reader/tooling'
GIB = 1024 ** 3


def size(path):
    if not path.exists():
        return 0
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file() and not p.is_symlink())


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    with (WORK / 'setup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        source, target, temp = (WORK / p for p in ('wide-md-source', 'target', 'tmp'))
        temp.mkdir(exist_ok=True)
        cargo_home = Path(os.environ.get('CARGO_HOME', Path.home() / '.cargo')).resolve()
        caches = [cargo_home / 'registry', cargo_home / 'git']
        log = WORK / 'setup.log'
        log.write_bytes(b'')
        env = dict(os.environ, CARGO_HOME=str(cargo_home), CARGO_TARGET_DIR=str(target),
                   CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='2', TMPDIR=str(temp))
        def measure():
            free = shutil.disk_usage(ROOT).free
            data = size(ROOT / '.reader')
            build = size(target) + sum(size(p) for p in caches) + size(ROOT / '.venv') + size(ROOT / 'plugins/reader/node_modules')
            logs = log.stat().st_size
            if free < 50 * GIB or data > 4 * GIB or build > 20 * GIB or logs > 16 * 1024 ** 2:
                raise RuntimeError('wide-md setup resource limit reached; inspect owned outputs before retrying')
            return dict(host_free=free, reader_data=data, build_and_shared_caches=build, log_bytes=logs)
        receipt = dict(revision=REVISION, source=str(source), target=str(target), temporary=str(temp),
                       reused_cargo_caches=[str(p) for p in caches], lock=str(WORK / 'setup.lock'),
                       limits=dict(data_bytes=4*GIB, build_bytes=20*GIB, log_bytes=16*1024**2,
                                   rss_bytes=4*GIB, cpu_seconds=1800, timeout_seconds=600, jobs=2),
                       guard='polling; kills process group on monitoring error or limit; not a disk quota', before=measure())
        (WORK / 'launch.json').write_text(json.dumps(receipt, indent=2))
        def limits():
            resource.setrlimit(resource.RLIMIT_CPU, (1800, 1800))
            resource.setrlimit(resource.RLIMIT_FSIZE, (512*1024**2, 512*1024**2))
        def run(args, cwd=ROOT):
            with log.open('ab') as output:
                worker = subprocess.Popen(args, cwd=cwd, env=env, stdout=output, stderr=output,
                                          start_new_session=True, preexec_fn=limits)
                receipt['process_group'] = worker.pid
                (WORK / 'launch.json').write_text(json.dumps(receipt, indent=2))
                deadline = time.monotonic() + 600
                try:
                    while worker.poll() is None:
                        measure()
                        process_rows = subprocess.check_output(['ps','-axo','pgid=,rss='], text=True, timeout=5)
                        rss = sum(int(parts[1])*1024 for line in process_rows.splitlines()
                                  if len(parts := line.split()) == 2 and int(parts[0]) == worker.pid)
                        if rss > 4*GIB or time.monotonic() > deadline:
                            raise RuntimeError('wide-md setup memory/time limit reached')
                        time.sleep(1)
                    if worker.returncode:
                        raise RuntimeError(f'wide-md setup command failed ({worker.returncode}); see {log}')
                finally:
                    try: os.killpg(worker.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                    worker.wait()
                measure()
        if not source.exists():
            run(['git','clone','--no-checkout',REPOSITORY,str(source)])
        else:
            if subprocess.check_output(['git','remote','get-url','origin'],cwd=source,text=True).strip().removesuffix('.git') != REPOSITORY:
                raise RuntimeError('Unexpected existing tool checkout; refusing to replace it')
            if subprocess.check_output(['git','status','--porcelain'],cwd=source,text=True).strip():
                raise RuntimeError('Tool checkout contains edits; preserve them before setup')
        run(['git','checkout','--detach',REVISION],source)
        run(['cargo','build','--locked','--release','--jobs','2'],source)
        executable = target / 'release/wide-md'
        dest = WORK / 'bin/wide-md'
        dest.parent.mkdir(exist_ok=True)
        shutil.copy2(executable,dest.with_suffix('.new'))
        os.replace(dest.with_suffix('.new'),dest)
        receipt.update(after=measure(), executable_sha256=hashlib.sha256(dest.read_bytes()).hexdigest(), status='installed')
        (WORK / 'installed.json').write_text(json.dumps(receipt,indent=2)+'\n')
        print(json.dumps({'executable':str(dest),'revision':REVISION,'measurements':receipt['after']},indent=2))


if __name__ == '__main__':
    main()
