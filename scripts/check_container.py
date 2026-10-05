#!/usr/bin/env python3
"""Run bounded copy-isolated checks using existing Python and Node Docker images."""
import argparse
import fcntl
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import time

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.reader/review'
GIB = 1024**3


def docker(*args, **kwargs):
    return subprocess.run(['docker', *args], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['python', 'node', 'formatter'])
    args = parser.parse_args()
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with (RUNTIME / 'validation.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if shutil.disk_usage(ROOT).free < 50 * GIB:
            raise RuntimeError('Host free space below 50 GiB')
        kind = args.kind
        name = 'reader-' + kind + '-checks'
        image = {'python':'python:3.12-bookworm','node':'node:24.18.0','formatter':'rust:1.96.0'}[kind]
        docker('image', 'inspect', image, stdout=subprocess.DEVNULL)
        prior = subprocess.run(['docker', 'inspect', name], capture_output=True, text=True)
        if prior.returncode == 0:
            raise RuntimeError('Owned worker still exists; inspect it before reusing its name: ' + name)
        # Only selected software paths. No host mount and no vault files enter the worker.
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as archive:
            for top in ['src','tests','scripts','skills','schemas','plugins','pyproject.toml','uv.lock','.reader/tooling/bin/wide-md','.reader/tooling/installed.json']:
                for path in ([ROOT/top] if (ROOT/top).is_file() else sorted((ROOT/top).rglob('*'))):
                    rel = path.relative_to(ROOT)
                    if path.is_file() and not path.is_symlink() and not any(p in ('node_modules','dist','__pycache__') for p in rel.parts):
                        archive.add(path, arcname=str(rel), recursive=False)
        if stream.tell() > 24 * 1024**2:
            raise RuntimeError('Unexpectedly large software input')
        contract = dict(worker=name,image=image,host_free=shutil.disk_usage(ROOT).free,
                        writable_paths={'/work':2*GIB,'/tmp':1024**3},read_only_root=True,
                        cpus=2,memory='4g',timeout_seconds=900,log_limit=4*1024**2,
                        mounts=[],lock=str(RUNTIME/'validation.lock'))
        (RUNTIME/(kind+'-contract.json')).write_text(json.dumps(contract, indent=2))
        try:
            docker('run','-d','--name',name,'--read-only','--cpus','2','--memory','4g','--pids-limit','256',
                   '--tmpfs','/work:rw,exec,size=2147483648','--tmpfs','/tmp:rw,exec,size=1073741824',
                   '--log-driver','local','--log-opt','max-size=4m','--log-opt','max-file=1','--log-opt','compress=false',
                   '-e','TMPDIR=/tmp','-e','HOME=/work','-w','/work',image,'sleep','1000',stdout=subprocess.DEVNULL)
            free = docker('exec',name,'df','-Pk','/',capture_output=True,text=True).stdout
            contract['vm_df'] = free
            if int(free.splitlines()[-1].split()[3])*1024 < 50*GIB:
                raise RuntimeError('Docker VM free space below 50 GiB')
            (RUNTIME/(kind+'-contract.json')).write_text(json.dumps(contract, indent=2))
            docker('exec','-i',name,'tar','xf','-','-C','/work',input=stream.getvalue())
            cmd = ('python -m pip install --disable-pip-version-check --no-cache-dir --target /work/tools uv && '
                   'PYTHONPATH=/work/tools UV_CACHE_DIR=/work/cache python -m uv sync --locked && '
                   '.venv/bin/python -m pytest -q') if kind == 'python' else (
                   'npm --prefix plugins/reader ci --cache /work/npm-cache && '
                   'npm --prefix plugins/reader run check && npm --prefix plugins/reader test && '
                   'npm --prefix plugins/reader run build')
            if kind=='formatter':
                cmd = ('git init /work/formatter && git -C /work/formatter fetch --depth=1 '
                       'https://github.com/flyingrobots/wide-md c167101b32bbe37954429e9de5db33efcdc0a16c && '
                       'git -C /work/formatter checkout --detach FETCH_HEAD && '
                       'CARGO_HOME=/work/cargo CARGO_TARGET_DIR=/work/target CARGO_INCREMENTAL=0 '
                       'cargo build --manifest-path /work/formatter/Cargo.toml --release --locked -j 2')
            log = RUNTIME/(kind+'.log')
            with log.open('wb') as output:
                process = subprocess.Popen(['docker','exec',name,'sh','-c',cmd],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
                import selectors
                selector = selectors.DefaultSelector();selector.register(process.stdout, selectors.EVENT_READ)
                deadline = time.monotonic()+900;size=0
                try:
                    while True:
                        if time.monotonic()>deadline:
                            raise TimeoutError('Validation exceeded 900 seconds')
                        events=selector.select(1)
                        if events:
                            chunk=process.stdout.read1(8192)
                            if not chunk:break
                            size+=len(chunk)
                            if size>4*1024**2:raise RuntimeError('Validation log limit reached')
                            output.write(chunk);output.flush()
                        elif process.poll() is not None:break
                    if process.wait(timeout=10):raise RuntimeError('Validation failed; inspect '+str(log))
                finally:
                    selector.close()
                    if process.poll() is None:process.kill();process.wait()
            usage=docker('exec',name,'du','-sk','/work','/tmp',capture_output=True,text=True).stdout
            (RUNTIME/(kind+'-usage.txt')).write_text(usage)
            if kind=='formatter':
                import hashlib
                data=docker('exec',name,'cat','/work/target/release/wide-md',capture_output=True).stdout
                if len(data)>16*1024**2:raise RuntimeError('Formatter artifact limit reached')
                target=ROOT/'.reader/tooling/bin/wide-md';target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(data);target.chmod(0o755)
                (ROOT/'.reader/tooling/installed.json').write_text(json.dumps({
                    'revision':'c167101b32bbe37954429e9de5db33efcdc0a16c',
                    'executable_sha256':hashlib.sha256(data).hexdigest(),'platform':'linux-container'}))
            if kind=='node':
                (ROOT/'plugins/reader/dist').mkdir(exist_ok=True)
                for file in ['main.js','styles.css','manifest.json']:
                    data=docker('exec',name,'cat','/work/plugins/reader/dist/'+file,capture_output=True).stdout
                    if len(data)>8*1024**2:raise RuntimeError('Build artifact limit reached')
                    (ROOT/'plugins/reader/dist'/file).write_bytes(data)
            print('PASS',kind,usage.strip())
        finally:
            subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,check=False)


if __name__=='__main__':main()
