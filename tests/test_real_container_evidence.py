"""Assertions for the real host-control-plane fixture; run inside the bounded Docker worker.

Set READER_REAL_CONTAINER_EVIDENCE to the exported real_container_control.py JSON. Without a real
fixture export these checks are explicitly skipped, never reported as real-daemon evidence.
"""
import json
import os
from pathlib import Path

import pytest

EVIDENCE=os.environ.get('READER_REAL_CONTAINER_EVIDENCE')
pytestmark=pytest.mark.skipif(not EVIDENCE,reason='Requires explicit real Docker control-plane fixture evidence')


@pytest.fixture(scope='module')
def evidence():return json.loads(Path(EVIDENCE).read_text())


def test_no_host_source_clone_and_no_running_job_worker(evidence):
    assert evidence['host_source_checkouts']==[]
    assert len(evidence['cases'])==3
    for case in evidence['cases']:
        assert case['factory']=='reader_mcp.coding_container'
        inspection=case['worker_inspection']
        assert inspection and inspection['returncode']==1 and 'No such' in inspection['stderr']
        assert case['run']['container']['state']=='stopped'


@pytest.mark.parametrize('scenario,outcome',[('success','pr_opened'),('verification-failure','failed'),('cancel','cancelled')])
def test_actual_clone_task_verify_push_and_stop(evidence,scenario,outcome):
    case=next(c for c in evidence['cases'] if c['scenario']==scenario)
    run,probe=case['run'],case['probe']
    assert run['outcome']==outcome,run['message']
    assert len(probe['calls'])-case['before_calls']==1,'One actual task process; probes are not tasks'
    assert any(item['cwd']==run['git']['worktree'] and item['source_exists'] for item in probe['lifecycle'])
    assert run['git']['worktree'].startswith('/work/jobs/')
    if scenario=='success':
        assert run['verification']['exit_code']==0 and run['push']['verified']
        assert run['git']['head_sha']==probe['remote_sha']==run['pr']['head_sha']
        assert len(case['pulls'])==1 and 'create_pull_request' in case['github_calls']
    else:
        assert run['push'] is None and run['pr'] is None and probe['remote_sha'] is None
        assert case['pulls']==[] and 'create_pull_request' not in case['github_calls']
        if scenario=='verification-failure':assert run['verification']['exit_code']==8 and run['git']['commits']
