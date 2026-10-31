#!/usr/bin/env python3
"""Try Reader's inferred, ephemeral devcontainer without a host clone.

Run under the documented workstation resource lock. This bounded trial uses an already cached
Node base plus a tiny configuration layer, no features/socket/host mounts, and capped tmpfs. It does not launch a coding agent,
copy credentials, push, or install a general Coding Jobs execution backend.
"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
GIB = 1024**3
NAME = 'reader-development'
LIMIT = 16 * 1024**2
TIMEOUT = 300


def call(*args, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=15)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-2000:] or 'Command failed: ' + args[0])
    return result


def measure(container):
    info = json.loads(call('docker', 'inspect', NAME).stdout)[0]
    host = info['HostConfig']
    mounts = info['Mounts']
    if (not host['ReadonlyRootfs'] or host['Memory'] != 4 * GIB or host['NanoCpus'] != 2_000_000_000
            or host['PidsLimit'] != 256 or host['ShmSize'] != 64*1024**2 or host['Privileged'] or host.get('Binds')
            or any(m['Type'] != 'tmpfs' for m in mounts)
            or host['LogConfig'] != {'Type': 'local', 'Config': {'max-size':'4m','max-file':'1','compress':'false'}}):
        raise RuntimeError('Container resource/mount contract differs from the approved trial')
    if not info['State']['Running']:
        raise RuntimeError('Trial container stopped unexpectedly')
    free = int(call('docker', 'exec', NAME, 'df', '-Pk', '/').stdout.splitlines()[-1].split()[3]) * 1024
    if free < 50 * GIB:
        raise RuntimeError('Docker VM free space below 50 GiB')
    for path, expected in [('/work', 1536 * 1024**2), ('/tmp', 512 * 1024**2), ('/etc', 16 * 1024**2), ('/dev/shm', 64 * 1024**2)]:
        actual = int(call('docker', 'exec', NAME, 'df', '-Pk', path).stdout.splitlines()[-1].split()[1]) * 1024
        if actual != expected:
            raise RuntimeError('Unexpected tmpfs capacity for ' + path)
    # tmpfs is the hard bound; this measurement supplements it and is not presented as a quota.
    usage = call('docker', 'exec', NAME, 'du', '-sk', '/work', '/tmp').stdout
    container.update(vm_free=free, usage=usage)


def trial():
    if shutil.disk_usage(ROOT).free < 50 * GIB:
        raise RuntimeError('Host free space below 50 GiB')
    config = ROOT / 'planning/devcontainers/devcontainer.json'
    data = json.loads(config.read_text())
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
    if call('docker', 'inspect', NAME, check=False).returncode == 0:
        raise RuntimeError('Trial worker already exists; inspect it before reusing its name')
    call('docker', 'image', 'inspect', 'node:24.18.0')  # No implicit base image acquisition.
    # A tiny configuration-only image layer: no package installation, compiler or source tree.
    built = subprocess.run(['docker', 'build', '--pull=false', '--tag', data['image'], str(config.parent)], capture_output=True, text=True, timeout=60)
    if built.returncode:
        raise RuntimeError('Configuration image build failed: ' + built.stderr[-3000:])
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
    with tempfile.TemporaryDirectory(prefix='reader-devcontainer-trial-') as scratch:
        scratch = Path(scratch)
        # Only the candidate config enters the host-side workspace, never a source checkout.
        config_dir = scratch / '.devcontainer'
        config_dir.mkdir()
        trial_config = config_dir / 'devcontainer.json'
        trial_config.write_text(config.read_text())
        env = dict(os.environ, TMPDIR=str(scratch), XDG_CACHE_HOME=str(scratch / 'cache'))
        log_path = scratch / 'cli.log'
        process = None
        try:
            with log_path.open('wb') as log:
                process = subprocess.Popen([cli, 'up', '--workspace-folder', str(scratch), '--config', str(trial_config),
                    '--id-label', 'reader.development=trial', '--container-data-folder', '/work/.devcontainer-data',
                    '--container-system-data-folder', '/work/.devcontainer-system',
                    '--update-remote-user-uid-default', 'never', '--default-user-env-probe', 'none'],
                    env=env, stdout=log, stderr=log, start_new_session=True)
                deadline = time.monotonic() + TIMEOUT
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Devcontainer trial exceeded its deadline')
                    if shutil.disk_usage(ROOT).free < 50 * GIB:
                        raise RuntimeError('Host free space fell below 50 GiB')
                    if sum(p.stat().st_size for p in scratch.rglob('*') if p.is_file()) > LIMIT:
                        raise RuntimeError('Host CLI data/log limit reached')
                    if call('docker', 'inspect', NAME, check=False).returncode == 0:
                        measure(contract)
                    time.sleep(.25)
                if process.returncode:
                    raise RuntimeError('Dev Container CLI failed:\n' + log_path.read_text(errors='replace')[-6000:])
            measure(contract)
            facts = call('docker', 'exec', NAME, 'bash', '-euc',
                         'git -C /work/reader rev-parse HEAD; node --version; python3 --version; git --version').stdout
            # The trial deliberately runs no agent and creates no source edits to preserve on teardown.
            call('docker', 'exec', NAME, 'git', '-C', '/work/reader', 'diff', '--exit-code')
            print(json.dumps({'outcome':'prepared', 'facts':facts, 'measurements':contract}), flush=True)
        finally:
            # Removing this owned container terminates all container processes, including lifecycle children.
            if process and process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            try:
                result = call('docker', 'rm', '-f', NAME, check=False)
                if call('docker', 'inspect', NAME, check=False).returncode == 0:
                    raise RuntimeError('Could not terminate the owned trial container: ' + result.stderr[-1000:])
            finally:
                # Docker failure must not skip local CLI/child termination and reaping.
                if process:
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)


if __name__ == '__main__':
    try:
        trial()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'outcome': 'blocked', 'error': str(error)}), flush=True)
        raise SystemExit(1)
