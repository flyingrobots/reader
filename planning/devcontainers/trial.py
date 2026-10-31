#!/usr/bin/env python3
"""Try Reader's inferred, ephemeral devcontainer without a host clone.

Run under the documented workstation resource lock. This bounded trial uses an already cached
Node base plus a tiny configuration layer, no features/socket/host mounts, and capped tmpfs. It does not launch a coding agent,
copy credentials, push, or install a general Coding Jobs execution backend.
"""
import hashlib
import json
from functools import partial
import os
from pathlib import Path
import shutil
import signal
import selectors
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
GIB = 1024**3
NAME = 'reader-development'
LIMIT = 16 * 1024**2
TIMEOUT = 300
APPROVED_IMAGE_INPUTS = {'Dockerfile': 'd5fc371f7dad331f4f2abdb57b46b78731c07c2dc9b6a1b4c23f525b217ff024', 'entrypoint.sh': '3faf3837f60680be5e2e8c16e5b8aafb1c99eb26b663d2ac1a46665eb4153f88', '.dockerignore': '6b3387fe13e4fc8f566093049083faaae894ccc6cc207874fb82e50e5822cebb'}


def remaining(deadline, cap=15):
    left = deadline - time.monotonic()
    if left <= 0:
        raise TimeoutError('Devcontainer trial exceeded its deadline')
    return min(cap, left)


def call(*args, check=True, deadline=None):
    result = subprocess.run(args, capture_output=True, text=True, timeout=remaining(deadline) if deadline is not None else 15)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-2000:] or 'Command failed: ' + args[0])
    return result


def measure(container, execute=call):
    info = json.loads(execute('docker', 'inspect', NAME).stdout)[0]
    host = info['HostConfig']
    mounts = info['Mounts']
    if (not host['ReadonlyRootfs'] or host['Memory'] != 4 * GIB or host['NanoCpus'] != 2_000_000_000
            or host['PidsLimit'] != 256 or host['ShmSize'] != 64*1024**2 or host['Privileged'] or host.get('Binds')
            or any(m['Type'] != 'tmpfs' for m in mounts)
            or host['LogConfig'] != {'Type': 'local', 'Config': {'max-size':'4m','max-file':'1','compress':'false'}}):
        raise RuntimeError('Container resource/mount contract differs from the approved trial')
    if not info['State']['Running']:
        raise RuntimeError('Trial container stopped unexpectedly')
    free = int(execute('docker', 'exec', NAME, 'df', '-Pk', '/').stdout.splitlines()[-1].split()[3]) * 1024
    if free < 50 * GIB:
        raise RuntimeError('Docker VM free space below 50 GiB')
    for path, expected in [('/work', 1536 * 1024**2), ('/tmp', 512 * 1024**2), ('/etc', 16 * 1024**2), ('/dev/shm', 64 * 1024**2)]:
        actual = int(execute('docker', 'exec', NAME, 'df', '-Pk', path).stdout.splitlines()[-1].split()[1]) * 1024
        if actual != expected:
            raise RuntimeError('Unexpected tmpfs capacity for ' + path)
    # tmpfs is the hard bound; this measurement supplements it and is not presented as a quota.
    usage = execute('docker', 'exec', NAME, 'du', '-sk', '/work', '/tmp').stdout
    container.update(vm_free=free, usage=usage)



def reap(process):
    if process is None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    finally:
        # A reaped leader does not prove that its process group is empty.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def watch(argv, log_path, deadline, env=None, tick=None):
    """One bounded stream and absolute deadline, including image preparation."""
    process = subprocess.Popen(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    selector = None
    next_check = 0
    try:
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        with log_path.open('wb') as log:
            while selector.get_map():
                remaining(deadline)
                if time.monotonic() >= next_check:
                    if tick:
                        tick()
                    next_check = time.monotonic() + .25
                for key, _ in selector.select(min(.1, remaining(deadline))):
                    chunk = os.read(key.fd, 16384)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    used = sum(p.stat().st_size for p in log_path.parent.rglob('*') if p.is_file())
                    if used + len(chunk) > LIMIT:
                        raise RuntimeError('Host CLI data/log limit reached')
                    log.write(chunk)
                    log.flush()
            code = process.wait(timeout=remaining(deadline))
            if code:
                with log_path.open('rb') as evidence:
                    evidence.seek(max(0, log_path.stat().st_size - 6000))
                    tail = evidence.read().decode('utf-8', 'replace')
                raise RuntimeError('Trial command failed: ' + tail)
    finally:
        try:
            if selector:
                selector.close()
        finally:
            try:
                reap(process)
            finally:
                process.stdout.close()


def build_image(config, image, scratch, deadline, tick):
    # Freeze the tiny context; no host clone or compiler output enters the image.
    context = scratch / 'image'
    context.mkdir()
    for name in ('Dockerfile', 'entrypoint.sh', '.dockerignore'):
        with (config.parent / name).open('rb') as source:
            data = source.read(64 * 1024 + 1)
        if len(data) > 64 * 1024 or hashlib.sha256(data).hexdigest() != APPROVED_IMAGE_INPUTS[name]:
            raise RuntimeError('Image configuration changed; review required: ' + name)
        (context / name).write_bytes(data)
    watch(['docker', 'build', '--pull=false', '--tag', image, str(context)], scratch / 'build.log', deadline, tick=tick)


def trial():
    expires = time.monotonic() + TIMEOUT
    deadline = expires - 45  # Reserve CLI reaping and Docker cleanup inside the overall bound.
    execute = partial(call, deadline=deadline)
    if shutil.disk_usage(ROOT).free < 50 * GIB:
        raise RuntimeError('Host free space below 50 GiB')
    config = ROOT / 'planning/devcontainers/devcontainer.json'
    with config.open('rb') as source:
        config_bytes = source.read(64 * 1024 + 1)
    if len(config_bytes) > 64 * 1024:
        raise RuntimeError('Unexpectedly large devcontainer configuration')
    data = json.loads(config_bytes)
    expected = {
        'workspaceMount':'type=tmpfs,target=/work,tmpfs-size=1610612736,tmpfs-mode=1777',
        'workspaceFolder':'/work', 'image':'reader-development:local', 'remoteUser':'root', 'userEnvProbe':'none',
    }
    if any(data.get(k) != v for k, v in expected.items()) or set(data) - {
            'name', *expected, 'containerEnv', 'runArgs', 'onCreateCommand', 'customizations', 'overrideCommand'}:
        raise RuntimeError('This trial supports only the reviewed Reader image configuration')
    # Do not accept new startup commands through an otherwise familiar config.
    hook = ['bash', '-euc', 'mkdir -p /work/home /work/cache; if [ ! -e /work/reader ]; then git clone --filter=blob:none --single-branch https://github.com/flyingrobots/reader.git /work/reader; fi; test "$(git -C /work/reader remote get-url origin)" = https://github.com/flyingrobots/reader.git']
    if data.get('onCreateCommand') != hook:
        raise RuntimeError('Unexpected startup hook; review before running it')
    args = ['--name=reader-development','--read-only','--cpus=2','--memory=4g','--memory-swap=4g',
            '--pids-limit=256','--tmpfs=/tmp:rw,exec,size=536870912','--log-driver=local',
            '--log-opt=max-size=4m','--log-opt=max-file=1','--log-opt=compress=false','--tmpfs=/etc:rw,exec,size=16777216','--shm-size=64m']
    if data.get('runArgs') != args or data.get('overrideCommand') is not False:
        raise RuntimeError('Unexpected runtime limits')
    cli = shutil.which('devcontainer')
    if not cli:
        raise RuntimeError('The Dev Container CLI is not installed')
    contract = dict(worker=NAME, image=data['image'], workspace='tmpfs /work: 1536 MiB',
                    temporary='tmpfs /tmp: 512 MiB; /etc: 16 MiB', host_free=shutil.disk_usage(ROOT).free,
                    read_only_root=True, shared_memory='64 MiB', mounts='no host source or socket', cpus=2, memory='4 GiB',
                    logs='4 MiB Docker + 16 MiB CLI', build='existing Node base, small public /etc copy and entrypoint; no compiler output',
                    timeout=TIMEOUT, stop='docker rm -f reader-development; kill CLI process group',
                    lock='host/docker/reader-development/ in workstation store')
    print(json.dumps({'launch_contract':contract}), flush=True)
    if execute('docker', 'inspect', NAME, check=False).returncode == 0:
        raise RuntimeError('Trial worker already exists; inspect it before reusing its name')
    execute('docker', 'image', 'inspect', 'node:24.18.0')
    with tempfile.TemporaryDirectory(prefix='reader-devcontainer-trial-') as scratch:
        scratch = Path(scratch)
        # Only the candidate config enters the host-side workspace, never a source checkout.
        config_dir = scratch / '.devcontainer'
        config_dir.mkdir()
        trial_config = config_dir / 'devcontainer.json'
        trial_config.write_bytes(config_bytes)
        env = dict(os.environ, TMPDIR=str(scratch), XDG_CACHE_HOME=str(scratch / 'cache'))
        def check_host():
            remaining(deadline)
            if shutil.disk_usage(ROOT).free < 50 * GIB:
                raise RuntimeError('Host free space fell below 50 GiB')
            if sum(p.stat().st_size for p in scratch.rglob('*') if p.is_file()) > LIMIT:
                raise RuntimeError('Host CLI data/log limit reached')

        def check_runtime():
            check_host()
            if execute('docker', 'inspect', NAME, check=False).returncode == 0:
                measure(contract, execute=execute)

        try:
            # A read-only, finite probe checks the backing filesystem before image preparation.
            probe = execute('docker', 'run', '--rm', '--name', NAME, '--read-only', '--cpus', '1',
                '--memory', '128m', '--pids-limit', '64', '--shm-size', '64m', '--log-driver', 'none',
                '--entrypoint', 'df', 'node:24.18.0', '-Pk', '/')
            if int(probe.stdout.splitlines()[-1].split()[3]) * 1024 < 50 * GIB:
                raise RuntimeError('Docker VM free space below 50 GiB')
            build_image(config, data['image'], scratch, deadline, check_host)
            watch([cli, 'up', '--workspace-folder', str(scratch), '--config', str(trial_config),
                '--id-label', 'reader.development=trial', '--container-data-folder', '/work/.devcontainer-data',
                '--container-system-data-folder', '/work/.devcontainer-system', '--user-data-folder', str(scratch / 'state'),
                '--update-remote-user-uid-default', 'never', '--default-user-env-probe', 'none'],
                scratch / 'cli.log', deadline, env=env, tick=check_runtime)
            measure(contract, execute=execute)
            facts = execute('docker', 'exec', NAME, 'bash', '-euc',
                'git -C /work/reader rev-parse HEAD; node --version; python3 --version; git --version').stdout
            execute('docker', 'exec', NAME, 'git', '-C', '/work/reader', 'diff', '--exit-code')
            print(json.dumps({'outcome':'prepared', 'facts':facts, 'measurements':contract}), flush=True)
        finally:
            # watch always reaps its CLI group, even if these Docker calls fail.
            cleanup = partial(call, deadline=expires)
            result = cleanup('docker', 'rm', '-f', NAME, check=False)
            if cleanup('docker', 'inspect', NAME, check=False).returncode == 0:
                raise RuntimeError('Could not terminate the owned trial container: ' + result.stderr[-1000:])


if __name__ == '__main__':
    try:
        trial()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'outcome': 'blocked', 'error': str(error)}), flush=True)
        raise SystemExit(1)
