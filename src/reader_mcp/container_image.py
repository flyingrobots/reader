"""Prepare only Reader's fixed, finite managed image from cached immutable base images.

No repository Dockerfile, package installation, pull, compiler output or host mount enters this build.
The legacy builder is required for explicit build CPU/memory flags; unsupported engines fail closed.
"""
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import sys
import time

from .container_host_storage import measure as host_usage
from .container_lease import Lease
from .container_process import ProcessError, execute

GIB = 1024**3
TAG = 'reader-coding:local'
NAME = 'reader-coding-image'
RECIPE = {
    'Dockerfile': 'de24fd4d182bd674b1e639095318815ce46c2fa589fbc3841093b094793603f2',
    'entrypoint.sh': '9f5f696f18a050272d4b6dcd73e2b77c14c4cee7eb2074236de45808c704f5b4',
    '.dockerignore': '6b3387fe13e4fc8f566093049083faaae894ccc6cc207874fb82e50e5822cebb',
}
BASES = {'node:24.18.0': 'sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059',
         'python:3.12-bookworm': 'sha256:14a4933e6cef421424f7a66d89a3f4eafcbd0d90e0a822251f298e05132dc735'}
ENTRYPOINT = ['/bin/sh', '/usr/local/bin/reader-development-entrypoint']


def recipe(folder=None):
    folder = Path(folder) if folder else Path(__file__).parent / 'runtime_image'
    files = {}
    for name in RECIPE:
        with (folder / name).open('rb') as stream:
            files[name] = stream.read(65537)
    if sum(map(len, files.values())) > 65536 or any(hashlib.sha256(data).hexdigest() != RECIPE[name] for name, data in files.items()):
        raise ProcessError('Managed image recipe changed; review its fixed inputs before building')
    return files, hashlib.sha256(json.dumps(RECIPE, sort_keys=True).encode()).hexdigest()


def prepare(root, lock_store, *, run=execute, docker=None, lock_tool=None, recipe_folder=None):
    files, digest = recipe(recipe_folder)
    root, store = Path(root).resolve(strict=True), Path(lock_store)
    if not store.is_absolute() or not (store / 'HEAD').is_file() or not (store / 'objects').is_dir():
        raise ProcessError('Pass the existing absolute workstation git-locks store')
    docker, lock_tool = docker or shutil.which('docker'), lock_tool or shutil.which('git-locks')
    if not docker or not lock_tool:raise ProcessError('Docker and git-locks are required')
    lease = Lease(lock_tool, store, 'host/docker/' + NAME + '/', 300, run=run)
    lease.acquire()
    clients = set()
    deadline = time.monotonic() + 240
    folder = root
    env = None
    probe_started = False
    def call(args, check=True, timeout=15, cleanup=False, **kwargs):
        result = run([docker, *args], env=env, timeout=timeout if cleanup else min(timeout, max(.01, deadline-time.monotonic())), **kwargs)
        if check and result.returncode:
            raise ProcessError((result.stderr or result.stdout or 'Image preparation command failed')[-2000:])
        return result
    def inspect(kind, name, optional=False, cleanup=False):
        result = call([kind, 'inspect', name], check=False, cleanup=cleanup)
        if result.returncode:
            if optional and ('no such ' in result.stderr.lower()):return None
            raise ProcessError('Could not inspect ' + kind + ': ' + result.stderr[-1000:])
        rows = json.loads(result.stdout)
        if not isinstance(rows, list) or len(rows) != 1:raise ProcessError('Invalid image preparation inspection')
        return rows[0]
    def capacity():
        nonlocal probe_started
        if shutil.disk_usage(root).free < 50*GIB:raise ProcessError('Host free space is below 50 GiB')
        probe_started = True
        result = call(['run','--pull=never','--rm','--name',NAME,'--label','reader.coding.image-probe='+lease.job,
            '--read-only','--cpus','.25','--memory','64m','--memory-swap','64m','--pids-limit','32',
            '--network','none','--log-driver','none','--entrypoint','/bin/df',bases[list(BASES).index('python:3.12-bookworm')]['Id'],'-Pk','/'])
        probe_started = False
        try:free = int(result.stdout.splitlines()[-1].split()[3])*1024
        except (ValueError, IndexError) as exc:raise ProcessError('Cannot measure Docker backing free space') from exc
        if free < 50*GIB:raise ProcessError('Docker backing free space is below 50 GiB')
        return free
    try:
        lease.check()
        for part in ('.reader', 'container-image'):
            folder /= part
            if folder.is_symlink():raise ProcessError('Image control directories must not be symlinks')
            folder.mkdir(exist_ok=True)
        for part in ('tmp','cache','context'):
            path = folder / part
            if path.is_symlink():raise ProcessError('Image control directories must not be symlinks')
            path.mkdir(exist_ok=True)
        env = dict(os.environ, DOCKER_BUILDKIT='0', TMPDIR=str(folder/'tmp'), XDG_CACHE_HOME=str(folder/'cache'))
        host_usage(folder, clients)
        # The FROM pin is a manifest reference; Docker's local Id can instead be a configuration digest.
        bases = [inspect('image', tag+'@'+digest) for tag,digest in BASES.items()]
        if any(not isinstance(image.get('Id'), str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', image['Id'])
                or image.get('Size', 4*GIB) > 2*GIB or (image.get('Config') or {}).get('Volumes') for image in bases):
            raise ProcessError('Cached immutable base images differ or exceed the fixed input bound; no pull was attempted')
        if inspect('container', NAME, optional=True) is not None:
            raise ProcessError('An image preparation probe already exists; inspect it before retrying')
        vm_free = capacity()
        prior = inspect('image', TAG, optional=True)
        if prior and ((prior.get('Config') or {}).get('Labels') or {}).get('reader.coding.managed-image') != 'true':
            raise ProcessError('The managed image tag belongs to an unrecognized image; it was not replaced')
        if prior and ((prior.get('Config') or {}).get('Labels') or {}).get('reader.coding.recipe') == digest:
            if prior['Config'].get('Entrypoint') != ENTRYPOINT or prior.get('Size', 4*GIB) > 3*GIB:
                raise ProcessError('The labelled managed image does not match its contract')
            return {'image': TAG, 'image_id': prior['Id'], 'recipe_sha256': digest, 'reused': True}
        for name,data in files.items():
            with os.fdopen(os.open(folder/'context'/name, os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW, 0o600),'wb') as stream:stream.write(data)
        contract = {'image': TAG,'recipe_sha256':digest,'lock_key':lease.key,'lock_store':str(store),
            'inputs':BASES,'local_base_image_ids':{tag:image['Id'] for tag,image in zip(BASES,bases)},'context_bytes':sum(map(len,files.values())),'build':'finite fixed COPY + public /etc copy; no pull, network RUN, repository source or dependency installation',
            'output_bound':'copies subsets of two immutable <=2GiB inputs, with no data-generating command',
            'control_limit_bytes':8*1024**2,'build_log_limit_bytes':4*1024**2,'cpu':2,'memory_bytes':512*1024**2,
            'timeout_seconds':240,'host_free':shutil.disk_usage(root).free,'vm_free':vm_free}
        print(json.dumps({'launch_contract':contract}), file=sys.stderr, flush=True)
        next_probe = 0
        def guard():
            nonlocal next_probe
            if time.monotonic() >= next_probe:
                lease.check();capacity();host_usage(folder, clients)
                next_probe = time.monotonic()+3
            return False
        with os.fdopen(os.open(folder/'build.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600),'wb') as log:
            call(['build','--pull=false','--network=none','--memory=512m','--memory-swap=512m',
                '--cpu-period=100000','--cpu-quota=200000','--shm-size=64m','--force-rm',
                '--label','reader.coding.managed-image=true','--label','reader.coding.recipe='+digest,
                '--tag',TAG,str(folder/'context')], timeout=deadline-time.monotonic(),
                output=lambda channel,data:log.write(data), cancelled=guard, started=clients.add, finished=clients.discard)
        capacity();host_usage(folder, clients)
        image = inspect('image', TAG)
        if image['Config'].get('Entrypoint') != ENTRYPOINT or image['Config'].get('Labels',{}).get('reader.coding.recipe') != digest or image.get('Size',4*GIB)>3*GIB:
            raise ProcessError('Prepared image differs from the managed contract')
        return {'image':TAG,'image_id':image['Id'],'recipe_sha256':digest,'reused':False}
    finally:
        # A timed-out probe has a unique ownership label. Never remove somebody else's container.
        confirmed = not probe_started
        if probe_started:
            item = inspect('container', NAME, optional=True, cleanup=True)
            if item is None:confirmed=True
            elif ((item.get('Config') or {}).get('Labels') or {}).get('reader.coding.image-probe') == lease.job:
                call(['rm','-f',item['Id']],cleanup=True);confirmed=True
        if clients:
            raise ProcessError('Image control-plane client cleanup is unconfirmed; the resource lease is retained')
        if confirmed:lease.release()
