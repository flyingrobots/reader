"""Stop only a previous Reader run's proven-owned worker, preserving its persistent workspace.

The caller must hold Reader's exclusive supervisor ownership. A restart never relaunches an agent.
The saved lease receipt fences recovery; unresolved ownership is reported instead of being stolen.
"""
import hashlib
import json
import os
import math
import time
import re

from .container_lease import Lease
from .container_process import ProcessError, execute


def recover(root, repo, run_id, record, *, docker, lock_tool, run=execute):
    key = hashlib.sha256(repo.casefold().encode()).hexdigest()[:16]
    name = 'reader-coding-' + key
    owner = hashlib.sha256(str(root.resolve()).encode()).hexdigest()
    labels = {'reader.coding.repo': repo.casefold(), 'reader.coding.owner': owner, 'reader.coding.run': run_id}
    saved = record.get('lease') or {}
    if (record.get('owner') != owner or record.get('run_id') != run_id or record.get('name') != name
            or record.get('volume') != name + '-work' or saved.get('key') != 'host/docker/' + name + '/'
            or not isinstance(saved.get('store'), str) or not os.path.isabs(saved['store'])
            or not isinstance(saved.get('job'), str) or not saved['job'].startswith('reader-container-')):
        raise ProcessError('Incomplete or mismatched container recovery identity')
    expiry = record.get('expires')
    if not isinstance(expiry, (int, float)) or not math.isfinite(expiry):
        raise ProcessError('Invalid saved worker deadline')
    lease = Lease(lock_tool, saved['store'], saved['key'], max(60, math.ceil(expiry - time.time())), run=run)
    state = run([lock_tool, 'show', '--job', saved['job']], env=lease.env, timeout=10, limit=65536)
    if state.returncode == 0:
        try:
            prior = json.loads(state.stdout)
            if prior['job'] != saved['job'] or prior['holder'] != 'reader-coding-job' or prior['paths'] != [saved['key']]:
                raise ValueError()
            acquisition = saved.get('acquisition')
            if acquisition is None:
                # Creation intent was durably recorded before the claim; cover the crash window before receipt saving.
                intent = record.get('lease_intent_at')
                if not isinstance(intent, (float, int)) or not int(intent) <= prior['claimed'] <= intent + 20:
                    raise ValueError()
                acquisition = prior['acquisition']
            if prior['acquisition'] != acquisition:
                raise ValueError()
        except (ValueError, TypeError, KeyError) as exc:
            raise ProcessError('The saved container lease was replaced; recovery refused') from exc
        if prior.get('state') == 'live':
            result = run([lock_tool, 'extend', '--job', saved['job'], '--acquisition', acquisition, '--ttl', str(max(180, math.ceil(expiry - time.time()) + 120, math.ceil(prior['expires'] - time.time())))],
                         env=lease.env, timeout=15, limit=65536)
            if result.returncode:
                raise ProcessError('Could not renew the proven-owned recovery lease')
            lease.job, lease.acquisition = saved['job'], acquisition
        elif prior.get('state') == 'expired':
            lease.acquire()
        else:
            raise ProcessError('Unrecognized container lease state')
    else:
        # git-locks emits a missing event on stderr for an absent job. Other responses remain fail-closed.
        try:
            answer = json.loads(state.stderr)
            missing = answer.get('event') == 'missing' and answer.get('job') == saved['job']
        except (ValueError, AttributeError):missing = False
        if state.returncode == 1 and missing:
            lease.acquire()
        else:
            raise ProcessError('Cannot establish the recovery lease state')
    confirmed = False
    try:
        target = record.get('id') or name
        if record.get('id') and not re.fullmatch(r'[0-9a-f]{64}', record['id']):
            raise ProcessError('Invalid saved container identity')
        info = run([docker, 'container', 'inspect', target], timeout=15)
        if info.returncode:
            if re.search(r'no such (?:object|container)', info.stderr, re.I):
                confirmed = True
                return record | {'state': 'stopped'}
            raise ProcessError('Docker could not inspect the previous worker')
        values = json.loads(info.stdout)
        item = values[0]
        actual = (item.get('Config') or {}).get('Labels') or {}
        cid = item.get('Id')
        if (len(values) != 1 or not isinstance(cid, str) or not re.fullmatch(r'[0-9a-f]{64}', cid)
                or any(actual.get(k) != value for k, value in labels.items())
                or (record.get('id') and cid != record['id'])):
            raise ProcessError('Previous worker ownership does not match; it was not stopped')
        result = run([docker, 'stop', '--time', '1', cid], timeout=15)
        if result.returncode:
            raise ProcessError('Could not stop the previous container')
        result = run([docker, 'container', 'inspect', cid], timeout=15)
        if result.returncode or json.loads(result.stdout)[0]['State']['Running']:
            raise ProcessError('Previous container stop could not be confirmed')
        result = run([docker, 'rm', cid], timeout=15)
        if result.returncode:
            raise ProcessError('Could not remove the stopped worker; workspace volume was retained')
        confirmed = True
        return record | {'id': cid, 'state': 'stopped'}
    finally:
        if confirmed:
            lease.release()
