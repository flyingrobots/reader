import json
import time
from types import SimpleNamespace

import pytest

from reader_mcp.container_lease import Lease
from reader_mcp.container_process import ProcessError


def test_release_is_fenced_to_the_exact_acquisition(tmp_path):
    calls = []
    lease = None
    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        if argv[1] == 'claim':
            data = {'event': 'claimed', 'job': lease.job, 'paths': [lease.key], 'acquisition': 'receipt-1'}
        else:data = {}
        return SimpleNamespace(returncode=0, stdout=json.dumps(data), stderr='')
    lease = Lease('git-locks', tmp_path / 'store.git', 'host/docker/fixture/', 60, run=run)
    lease.acquire();lease.release()
    assert calls[0][1]['env']['GIT_LOCKS_STORE'] == str(tmp_path / 'store.git')
    assert calls[-1][0][-2:] == ['--acquisition', 'receipt-1']


@pytest.mark.parametrize('replacement', ['receipt-2', None])
def test_a_replaced_lease_is_not_permission_to_continue(tmp_path, replacement):
    lease = None
    def run(argv, **kwargs):
        data = {'event': 'claimed', 'job': lease.job, 'paths': [lease.key], 'acquisition': 'receipt-1'}
        if argv[1] == 'show':data.update(state='live', expires=time.time() + 100, acquisition=replacement)
        return SimpleNamespace(returncode=0, stdout=json.dumps(data), stderr='')
    lease = Lease('git-locks', tmp_path / 'store.git', 'host/docker/fixture/', 60, run=run)
    lease.acquire()
    with pytest.raises(ProcessError, match='lease was lost'):
        lease.check()
