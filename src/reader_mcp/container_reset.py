"""Explicit destructive reset of one proven-owned, inactive persistent coding volume.

This does not start a worker, so a full volume cannot block its own reset. The exact volume-name
confirmation acknowledges deletion of source, tools, caches and credentials; archives stay in the vault.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

from .container_clients import Clients
from .container_host_storage import measure
from .container_lease import Lease
from .container_process import ProcessError, execute
from .coding_store import Store
from .prompt_blocks import repository_name
from .voice_runner import Supervisor


def reset(root, repo, confirmation, *, tools=None, run=execute, supervisor_factory=Supervisor):
    from .container_setup import _save
    root=Path(root).resolve(strict=True)
    if not repository_name(repo):raise ValueError('Expected a GitHub owner/repository')
    key=hashlib.sha256(repo.casefold().encode()).hexdigest()[:16]
    name='reader-coding-'+key;volume=name+'-work'
    if confirmation!=volume:
        raise ProcessError('Reset permanently erases this volume’s source, tools, caches and credentials. Export what you need, then pass --confirm-volume '+volume)
    found=tools or {tool:shutil.which(tool) for tool in ('docker','git-locks')}
    if not found.get('docker') or not found.get('git-locks'):raise ProcessError('Docker and git-locks are required')
    supervisor=supervisor_factory(root/'.reader/coding-jobs',name='reader-coding-supervisor')
    if not supervisor.acquire():raise ProcessError('Stop the owning Reader server before resetting a coding volume')
    lease=None;removal_attempted=False;release_attempted=False;journal=None;save=None
    try:
        for job in Store(root).runs():
            if (job.get('source') or {}).get('repo','').casefold()==repo.casefold() and (
                    job.get('status')!='finished' or (job.get('container') and job['container'].get('state')!='stopped')):
                raise ProcessError('Reconcile queued, running and unclean jobs before resetting this volume')
        folder=root
        for part in ('.reader','container-runtime',key):
            folder/=part
            if folder.is_symlink():raise ProcessError('Reset control folders must not be symlinks')
            folder.mkdir(exist_ok=True)
        def read(path):
            if path.is_symlink() or (path.exists() and path.stat().st_size>65536):raise ProcessError('Invalid reset/setup control record')
            value=json.loads(path.read_text()) if path.exists() else {}
            if not isinstance(value,dict):raise ProcessError('Invalid reset/setup control record')
            return value
        previous=read(folder/'reset.json')
        if previous and previous.get('state') not in ('completed','refused'):
            raise ProcessError('Previous reset is unconfirmed; verify its saved host-client identities, exact lease and volume state before manual reconciliation')
        setup=read(folder/'setup.json')
        if setup and setup.get('state')!='stopped':raise ProcessError('Recover the previous terminal setup before resetting the volume')
        record={'repo':repo,'volume':volume,'state':'claiming','started_at':time.time(),'control_clients':[]}
        def save(update):
            record.update(update);_save(folder/'reset.json',record)
        journal=Clients(save)
        deadline=time.monotonic()+60
        env=dict(os.environ,TMPDIR=str(folder),XDG_CACHE_HOME=str(folder))
        def transport(argv,**kwargs):
            measure(root/'.reader/container-runtime',set(journal.values))
            result=run(argv,env=dict(kwargs.pop('env',env),TMPDIR=str(folder),XDG_CACHE_HOME=str(folder)),started=journal.started,finished=journal.finished,
                       timeout=min(kwargs.pop('timeout',15),max(.01,deadline-time.monotonic())),**kwargs)
            measure(root/'.reader/container-runtime',set(journal.values))
            return result
        # Use the already registered authority; no new store is created or guessed for other hosts.
        from .repositories import Registry
        entry=Registry(root).entry(repo,require_container=True)
        if not entry:raise ProcessError('A container registration with its explicit existing lock store is required')
        lock_store=entry['environment']['lock_store']
        lease=Lease(found['git-locks'],lock_store,'host/docker/'+name+'/',60,run=transport)
        save({'lease':{'job':lease.job,'acquisition':None,'store':lock_store,'key':lease.key}})
        lease.acquire();save({'lease':record['lease']|{'acquisition':lease.acquisition}})
        def inspect(kind,target):
            value=transport([found['docker'],kind,'inspect',target],limit=65536)
            if value.returncode:
                if 'no such '+kind in value.stderr.lower():return None
                raise ProcessError('Cannot inspect reset '+kind+': '+value.stderr[-800:])
            try:
                rows=json.loads(value.stdout)
                if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict):raise ValueError()
                return rows[0]
            except (ValueError,TypeError) as exc:raise ProcessError('Malformed reset inspection') from exc
        if inspect('container',name) is not None:raise ProcessError('A worker still exists; reconcile it before reset')
        item=inspect('volume',volume)
        if item is not None:
            labels=item.get('Labels') or {}
            if not isinstance(labels,dict):raise ProcessError('Malformed reset volume labels')
            if (item.get('Name')!=volume or item.get('Driver')!='local' or item.get('Options')
                    or labels.get('reader.coding.owner')!=hashlib.sha256(str(root).encode()).hexdigest()
                    or labels.get('reader.coding.repo')!=repo.casefold()):
                raise ProcessError('The volume is foreign or has unsupported storage options; it was not removed')
            lease.check();save({'state':'removing'})
            removal_attempted=True
            result=transport([found['docker'],'volume','rm',volume],timeout=30,limit=65536)
            if result.returncode or inspect('volume',volume) is not None:raise ProcessError('Volume deletion is unconfirmed; ownership retained')
        release_attempted=True
        lease.release();save({'state':'completed','finished_at':time.time()})
        return {'repo':repo,'volume':volume,'state':'removed','archives':'retained'}
    finally:
        # Errors keep the journal and receipt. Never advertise completion or release unknown effects.
        try:
            if lease and lease.acquisition and not removal_attempted and not release_attempted and journal and not journal.values:
                lease.release()
                save({'state':'refused'})
        finally:supervisor.release()
