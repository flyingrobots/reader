"""Recovery ownership/fencing oracle. Docker and git-locks ports are fake; no host worker is touched."""
from copy import deepcopy
import hashlib
import json
import time
from types import SimpleNamespace
import uuid

import pytest

from reader_mcp.container_process import ProcessError
from reader_mcp.container_recovery import recover

CID = 'c' * 64


class Control:
    def __init__(self, root):
        self.calls, self.stop_failed = [], False
        self.run_id = str(uuid.uuid4())
        key = hashlib.sha256(b'acme/widget').hexdigest()[:16]
        name = 'reader-coding-' + key
        owner = hashlib.sha256(str(root.resolve()).encode()).hexdigest()
        self.record = {'id': CID, 'owner': owner, 'run_id': self.run_id, 'name': name, 'volume': name + '-work',
            'expires': time.time() + 3600, 'lease_intent_at': time.time() - 1,
            'lease': {'job': 'reader-container-old', 'acquisition': 'old-receipt', 'key': 'host/docker/' + name + '/', 'store': str(root / 'authority.git')}}
        self.lease = {'job': 'reader-container-old', 'acquisition': 'old-receipt', 'holder': 'reader-coding-job',
            'paths': [self.record['lease']['key']], 'state': 'live', 'expires': time.time() + 3720, 'claimed': int(time.time())}
        self.container = {'Id': CID, 'State': {'Running': True}, 'Config': {'Labels': {
            'reader.coding.owner': owner, 'reader.coding.repo': 'acme/widget', 'reader.coding.run': self.run_id}}}

    def __call__(self, argv, **kwargs):
        self.calls.append(argv)
        value = ''
        if argv[0] == 'locks':
            if argv[1] == 'show':value = self.lease
        elif argv[1:3] == ['container', 'inspect']:value = [self.container]
        elif argv[1] == 'stop':
            if self.stop_failed:return SimpleNamespace(returncode=1, stdout='', stderr='daemon unavailable')
            self.container['State']['Running'] = False
        elif argv[1] == 'rm':self.container = None
        else:raise AssertionError(argv)
        return SimpleNamespace(returncode=0, stdout=value if isinstance(value, str) else json.dumps(value), stderr='')


def call(root, control, record=None):
    return recover(root, 'acme/widget', control.run_id, record or control.record, docker='docker', lock_tool='locks', run=control)


def test_recovery_renews_exact_receipt_stops_worker_and_preserves_volume(tmp_path):
    control = Control(tmp_path)
    result = call(tmp_path, control)
    assert result['state'] == 'stopped' and result['volume'] == control.record['volume']
    assert control.container is None
    extension = next(c for c in control.calls if c[:2] == ['locks', 'extend'])
    assert extension[extension.index('--acquisition') + 1] == 'old-receipt'
    assert int(extension[extension.index('--ttl') + 1]) >= 3600, 'Recovery must not shorten the old worker’s deadline coverage'
    assert any(c[:2] == ['locks', 'release'] for c in control.calls)
    assert not any(c[1:3] == ['volume', 'rm'] for c in control.calls)


def test_recovery_covers_crash_after_claim_before_receipt_save(tmp_path):
    control = Control(tmp_path)
    control.record['lease']['acquisition'] = None
    assert call(tmp_path, control)['state'] == 'stopped'


def test_replaced_lease_is_not_stolen(tmp_path):
    control = Control(tmp_path)
    control.lease['acquisition'] = 'replacement'
    with pytest.raises(ProcessError, match='replaced'):
        call(tmp_path, control)
    assert not any(c[0] == 'docker' for c in control.calls)


def test_foreign_worker_is_not_stopped(tmp_path):
    control = Control(tmp_path)
    control.container['Config']['Labels']['reader.coding.run'] = str(uuid.uuid4())
    with pytest.raises(ProcessError, match='ownership'):
        call(tmp_path, control)
    assert not any(c[1] in ('stop', 'rm') for c in control.calls)
    assert not any(c[:2] == ['locks', 'release'] for c in control.calls)


def test_failed_stop_does_not_release_admission_or_destroy_data(tmp_path):
    control = Control(tmp_path)
    control.stop_failed = True
    with pytest.raises(ProcessError, match='stop'):
        call(tmp_path, control)
    assert control.container['State']['Running']
    assert not any(c[:2] == ['locks', 'release'] or c[1] == 'rm' for c in control.calls)


@pytest.mark.parametrize('answer', [(1, '', ''), (1, '', '{"event":"missing","job":"somebody-else"}'), (2, '', 'Store unavailable')])
def test_unknown_lease_answer_does_not_acquire_or_touch_a_worker(tmp_path, answer):
    control = Control(tmp_path)
    original = control.__call__
    def ambiguous(argv, **kwargs):
        if argv[:2] == ['locks', 'show']:
            control.calls.append(argv)
            return SimpleNamespace(returncode=answer[0], stdout=answer[1], stderr=answer[2])
        return original(argv, **kwargs)
    with pytest.raises(ProcessError):
        recover(tmp_path, 'acme/widget', control.run_id, control.record, docker='docker', lock_tool='locks', run=ambiguous)
    assert not any(c[:2] == ['locks', 'claim'] or c[0] == 'docker' for c in control.calls)


def test_explicit_missing_job_reacquires_before_stopping(tmp_path):
    control = Control(tmp_path)
    original = control.__call__
    def missing(argv, **kwargs):
        if argv[:2] == ['locks', 'show']:
            control.calls.append(argv)
            return SimpleNamespace(returncode=1, stdout='', stderr=json.dumps({'event': 'missing', 'job': control.record['lease']['job']}))
        if argv[:2] == ['locks', 'claim']:
            control.calls.append(argv)
            return SimpleNamespace(returncode=0, stdout=json.dumps({'event': 'claimed', 'job': argv[argv.index('--job') + 1],
                'paths': [control.record['lease']['key']], 'acquisition': 'new-receipt'}), stderr='')
        return original(argv, **kwargs)
    result = recover(tmp_path, 'acme/widget', control.run_id, control.record, docker='docker', lock_tool='locks', run=missing)
    assert result['state'] == 'stopped'
    claim = next(i for i, c in enumerate(control.calls) if c[:2] == ['locks', 'claim'])
    inspect = next(i for i, c in enumerate(control.calls) if c[0] == 'docker')
    assert claim < inspect
    release = next(c for c in control.calls if c[:2] == ['locks', 'release'])
    assert release[release.index('--acquisition') + 1] == 'new-receipt'


def test_unconfirmed_host_client_requires_manual_review_before_worker_recovery(tmp_path):
    control=Control(tmp_path)
    control.record['client_cleanup_unconfirmed']=[12345]
    with pytest.raises(ProcessError,match='manual verification'):
        call(tmp_path,control)
    assert control.calls == []
