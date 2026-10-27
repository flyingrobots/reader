"""Coding jobs across every failure phase (RW-44): preflight, worktree, agent, issue, verification, push,
pull request, lost acknowledgements, cancellation, restart, output budget and archive failure.

Only a verified push and a pull request read back with the right repository, base, branch, head and issue
reach `pr_opened`. Everything here uses the real local Git fixture and the fake GitHub; nothing reaches the network."""
import json
import os
import signal
import subprocess
import sys
import time

import pytest

from coding_fixture import World, git, snapshot
from reader_mcp import coding_store
from reader_mcp.github import GitHubError


@pytest.fixture
def world(tmp_path):
    made = []

    def build(**options):
        folder = tmp_path / f'w{len(made)}'
        folder.mkdir()
        made.append(World(folder, **options))
        return made[-1]
    yield build
    for item in made:
        item.close()


def unpublished(w, run):
    assert run['pr'] is None and 'create_pull_request' not in w.github.calls
    assert set(w.remote_heads()) == {'refs/heads/main'}, 'nothing was pushed'


# Preflight: every refusal is `blocked`, before any worktree exists. -----------------------------------

@pytest.mark.parametrize('case', ['auth', 'no-push', 'wrong-repo-issue', 'pull-request-issue', 'missing-issue', 'agent-missing',
                                  'guard-missing', 'capacity', 'remote-identity', 'push-url', 'base-missing'])
def test_preflight_refusals_are_blocked_and_touch_nothing(world, case):
    options = {}
    if case == 'guard-missing':
        options['entry'] = {'verify': {'argv': ['true'], 'timeout_seconds': 120, 'lock': None}}
    w = world(**options)
    if case == 'auth':
        w.github.fail['viewer'] = GitHubError('gh: Bad credentials (HTTP 401)')
    elif case == 'no-push':
        w.github.can_push = False
    elif case == 'wrong-repo-issue':
        w.github.issues[277]['repo'] = 'other/repo'
    elif case == 'pull-request-issue':
        (w.vault / w.doc).write_text((w.vault / w.doc).read_text().replace('"issue":277', '"issue":5'))
    elif case == 'missing-issue':
        del w.github.issues[277]
    elif case == 'agent-missing':
        w.entry['executables']['codex'] = str(w.tmp / 'no-such-codex')
        w.write_registry()
    elif case == 'guard-missing':
        store = w.tmp / 'locks.git'
        git('init', '-q', '--bare', str(store), cwd=w.tmp)
        w.entry['verify'] = {'argv': ['true'], 'timeout_seconds': 120, 'lock': {'store': str(store), 'keys': ['host/heavy-work']}}
        w.write_registry()
    elif case == 'capacity':
        w.jobs.capacity = lambda path: os.path.realpath(path) != os.path.realpath(w.worktrees)
    elif case == 'remote-identity':
        git('remote', 'set-url', 'origin', 'https://github.com/someone/else.git', cwd=w.checkout)
        w.before = snapshot(w.checkout)
    elif case == 'push-url':
        git('remote', 'set-url', '--push', 'origin', 'https://github.com/someone/else.git', cwd=w.checkout)
        w.before = snapshot(w.checkout)
    elif case == 'base-missing':
        w.entry['base'] = 'develop'
        w.write_registry()
    run, _ = w.run()
    assert run['outcome'] == 'blocked', run['message']
    assert run['git']['worktree'] is None and not list(w.worktrees.iterdir())
    assert w.calls() == [] and snapshot(w.checkout) == w.before
    unpublished(w, run)


# The agent: failures are `failed` (or `blocked` when it says so) and publish nothing. -----------------

@pytest.mark.parametrize('scenario,needle', [
    ({'exit': 3}, 'exited with status 3'),
    ({'outcome': None}, 'no reader-result block'),
    ({'outcome': 'bad-json'}, 'not valid JSON'),
    ({'dirty': True}, 'uncommitted changes'),
    ({'switch': True}, 'no longer on'),
    ({'commit': False}, 'committed nothing'),
    ({'outcome': 'already_fixed', 'commit': True}, 'already fixed but committed'),
])
def test_agent_failures_are_failed_and_unpublished(world, scenario, needle):
    w = world(scenario=scenario)
    run, _ = w.run()
    assert run['outcome'] == 'failed' and needle in run['message'], run['message']
    unpublished(w, run)
    assert os.path.isdir(run['git']['worktree']), 'the worktree is kept for inspection'


def test_an_agent_that_reports_blocked_is_blocked(world):
    w = world(scenario={'outcome': 'blocked', 'summary': 'The parser module is missing.'})
    run, _ = w.run()
    assert run['outcome'] == 'blocked' and 'The parser module is missing.' in run['message']
    unpublished(w, run)


# Verification. ------------------------------------------------------------------------------------

def test_a_failed_check_publishes_nothing_and_its_output_is_kept(world):
    w = world(verify_exit=1)
    run, _ = w.run()
    assert run['outcome'] == 'failed' and 'exit status 1' in run['message']
    assert run['verification']['exit_code'] == 1
    step = [e for e in w.events(run['id']) if e['type'] == 'step' and e['title'].startswith('Verify:')][-1]
    assert step['status'] == 'failed' and step['exit_code'] == 1 and '1 failed, 2 passed' in step['output']
    unpublished(w, run)


def test_a_check_that_moves_the_head_publishes_nothing(world):
    w = world()
    w.entry['verify']['argv'].append('move-head')
    w.write_registry()
    run, _ = w.run()
    assert run['outcome'] == 'failed' and 'head changed during verification' in run['message']
    unpublished(w, run)


def test_verification_runs_inside_the_configured_lock(world):
    w = world()
    store = w.tmp / 'locks.git'
    git('init', '-q', '--bare', str(store), cwd=w.tmp)
    calls = w.tmp / 'locks-calls.jsonl'
    fake = w.tmp / 'git-locks'
    fake.write_text(f'#!{sys.executable}\nimport json,os,sys\nargs=sys.argv[1:]\nopen({str(calls)!r},"a").write(json.dumps({{"args":args,"store":os.environ.get("GIT_LOCKS_STORE")}})+"\\n")\n'
                    'command=args[args.index("--")+1:]\nos.execvp(command[0],command)\n')
    fake.chmod(0o755)
    w.entry['verify']['lock'] = {'store': str(store), 'keys': ['host/heavy-work'], 'ttl_seconds': 3600, 'wait_seconds': 60}
    w.write_registry()
    w.jobs = w.make(git_locks=str(fake))
    run, _ = w.run()
    assert run['outcome'] == 'pr_opened', run['message']
    locked = [json.loads(line) for line in calls.read_text().splitlines()]
    verify = [c for c in locked if 'host/heavy-work' in c['args']]
    assert len(verify) == 1 and verify[0]['store'] == str(store) and verify[0]['args'][0] == 'with'
    assert [c for c in locked if '.git/' in c['args']], 'worktree administration took the repository .git/ key'


# Publication and reconciliation. ------------------------------------------------------------------

def test_an_agent_that_pushed_the_same_head_is_reconciled_not_pushed_again(world):
    w = world(scenario={'push': 'same'})
    run, _ = w.run()
    assert run['outcome'] == 'pr_opened', run['message']
    assert w.remote_heads()[f'refs/heads/{run["git"]["branch"]}'] == run['git']['head_sha']


def test_a_remote_branch_at_another_commit_needs_reconciliation(world):
    w = world(scenario={'push': 'other'})
    run, _ = w.run()
    assert run['outcome'] == 'needs_reconciliation' and 'already exists at' in run['message']
    assert w.remote_heads()[f'refs/heads/{run["git"]["branch"]}'] != run['git']['head_sha'], 'Reader never overwrote it'
    assert 'create_pull_request' not in w.github.calls


def test_a_refused_pull_request_is_failed_after_a_verified_push(world):
    w = world()
    w.github.fail['create_pull_request'] = GitHubError('Validation Failed (HTTP 422)')
    run, _ = w.run()
    assert run['outcome'] == 'failed' and run['push']['verified'] and run['pr'] is None


def test_a_lost_pull_request_acknowledgement_is_reconciled_to_the_one_pull_request(world):
    w = world()
    w.github.fail['create_pull_request'] = 'lost-ack'
    run, _ = w.run()
    assert run['outcome'] == 'pr_opened', run['message']
    assert len(w.github.pulls) == 1 and w.github.calls.count('create_pull_request') == 1


def test_an_unanswered_pull_request_that_did_not_happen_is_not_retried(world):
    w = world()
    w.github.fail['create_pull_request'] = 'no-effect'
    run, _ = w.run()
    assert run['outcome'] == 'needs_reconciliation' and w.github.pulls == {}
    assert w.github.calls.count('create_pull_request') == 1


def test_a_pull_request_that_reads_back_wrong_is_not_pr_opened(world):
    w = world()
    w.github.wrong_head = True
    run, _ = w.run()
    assert run['outcome'] == 'needs_reconciliation' and run['pr'] is None


def test_a_lost_issue_acknowledgement_is_reconciled_by_marker(world):
    w = world(issue=None)
    w.github.fail['create_issue'] = 'lost-ack'
    run, _ = w.run()
    assert run['outcome'] == 'pr_opened', run['message']
    assert len([i for i in w.github.issues.values() if f'reader-run:{run["id"]}' in i['body']]) == 1


def test_an_unsettled_issue_creation_stops_before_pushing(world):
    w = world(issue=None)
    w.github.fail['create_issue'] = 'lost-ack'
    w.github.lag = True
    run, _ = w.run()
    assert run['outcome'] == 'needs_reconciliation' and f'reader-run:{run["id"]}' in run['message']
    assert w.github.calls.count('create_issue') == 1
    unpublished(w, run)


# Stop, restart, budgets and archive failure. -------------------------------------------------------

def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # A zombie still answers kill(0); ps says whether it really runs.
    state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(state) and not state.startswith('Z')


def test_stop_kills_the_agent_process_group_and_keeps_the_worktree(world):
    w = world(scenario={'sleep': 30})
    admitted = w.jobs.dispatch(w.request())
    deadline = time.monotonic() + 20
    while not w.calls() and time.monotonic() < deadline:
        time.sleep(0.05)
    [call] = w.calls()
    stopped = w.jobs.dispatch({'action': 'stop', 'id': admitted['id']})
    assert stopped['stopped']
    run = w.wait(admitted['id'])
    assert run['outcome'] == 'cancelled' and not alive(call['pid'])
    assert os.path.isdir(run['git']['worktree']) and run['pr'] is None
    assert w.jobs.dispatch({'action': 'stop', 'id': admitted['id']})['stopped'] is False


def test_stop_before_start_cancels_a_queued_run(world):
    w = world(scenario={'sleep': 30})
    first = w.jobs.dispatch(w.request())
    second = w.jobs.dispatch(w.request(prompt='A second queued task.\n'))
    w.jobs.dispatch({'action': 'stop', 'id': second['id']})
    cancelled = w.jobs.store.load(second['id'])
    assert cancelled['outcome'] == 'cancelled' and 'before it started' in cancelled['message']
    w.jobs.dispatch({'action': 'stop', 'id': first['id']})
    w.wait(first['id'])
    time.sleep(0.5)
    assert w.jobs.store.load(second['id'])['git']['worktree'] is None, 'the cancelled run never started'
    assert all(call['cwd'].endswith('reader-' + first['id']) for call in w.calls())


def interrupted_run(w, **fields):
    """A run record and archive as a crashed server would leave them."""
    import uuid
    from reader_mcp import llm_logs
    run_id = str(uuid.uuid4())
    log = llm_logs.RunLog(w.vault, 'coding-job', run_id, {'runner': 'coding-job'})
    log.write('events.jsonl', json.dumps({'run_id': run_id, 'seq': 1, 'at': 'x', 'type': 'phase', 'phase': 'agent', 'state': 'started'}) + '\n')
    log.write('stdout.jsonl', '{"type":"turn.started"}\n')
    run = {'schema_version': 1, 'id': run_id, 'request_id': str(uuid.uuid4()), 'created_at': 'x', 'status': 'running', 'phase': 'agent',
           'outcome': None, 'agent': 'codex', 'log': log.relative, 'source': {'repo': 'acme/widget', 'path': w.doc, 'block_id': 'bound-parser-depth',
                                                                               'title': 'Bound parser depth', 'issue': 277},
           'git': {'branch': f'reader/x-{run_id[:8]}', 'base': 'main', 'remote': 'origin'}, 'issue': None, 'push': None, 'pr': None,
           'pr_pending': None, 'issue_pending': None, 'process': None}
    run.update(fields)
    w.jobs.store.save(run)
    return run


def test_restart_interrupts_without_relaunching_and_stops_the_left_process(world):
    w = world()
    sleeper = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], start_new_session=True)
    from reader_mcp.coding_workflow import process_started
    run = interrupted_run(w, process={'group': sleeper.pid, 'started': process_started(sleeper.pid), 'host': w.jobs.host})
    # With no Reader server owning jobs, every view already shows the same interruption, before anyone reconciles it.
    reader = w.make()
    shown = reader.detail(run['id'])
    assert (shown['status'], shown['outcome'], shown['unreconciled']) == ('finished', 'interrupted', True)
    assert reader.store.load(run['id'])['status'] == 'running', 'a view writes nothing'
    w.jobs.close()
    restarted = w.make()
    assert restarted.own()
    sleeper.wait(timeout=10)
    assert sleeper.returncode == -signal.SIGKILL
    done = restarted.store.load(run['id'])
    assert done['outcome'] == 'interrupted' and done['recovered'] and 'not restarted' in done['message']
    assert 'stopped the process' in done['message']
    assert w.calls() == [], 'no coding agent was launched'
    events = restarted.events(run['id'])['events']
    assert [e['seq'] for e in events] == [1, 2] and events[-1]['type'] == 'outcome'
    folder = w.vault / run['log']
    assert not list(folder.glob('*.partial')) and json.loads((folder / 'meta.json').read_text())['status'] == 'interrupted'
    w.jobs = restarted


def test_restart_reconciles_a_pending_pull_request(world):
    w = world()
    branch = 'reader/x-pending'
    head = git('rev-parse', 'refs/heads/main', cwd=w.bare)
    git('update-ref', f'refs/heads/{branch}', head, cwd=w.bare)
    # A run reaches the pull request phase only with its issue linked.
    run = interrupted_run(w, phase='pull_request', pr_pending={'branch': branch}, push={'sha': head, 'sent': True, 'verified': True},
                          git={'branch': branch, 'base': 'main', 'remote': 'origin'}, issue={'number': 277})
    w.github.pulls[400] = {'number': 400, 'title': 'T', 'body': f'Closes #277\n<!-- reader-run:{run["id"]} -->', 'base': 'main', 'head': branch, 'head_sha': head}
    w.jobs.close()
    restarted = w.make()
    restarted.own()
    done = restarted.store.load(run['id'])
    assert done['outcome'] == 'pr_opened' and done['pr']['number'] == 400 and 'Reconciled after a restart' in done['message']
    w.jobs = restarted


@pytest.mark.parametrize('lag,outcome', [(False, 'interrupted'), (True, 'needs_reconciliation')])
def test_restart_reconciles_a_pending_issue_by_marker(world, lag, outcome):
    w = world()
    run = interrupted_run(w, phase='issue', issue_pending={'marker': 'reader-run:pending'})
    w.github.issues[500] = {'number': 500, 'title': 'T', 'body': 'x <!-- reader-run:pending -->', 'state': 'open', 'repo': 'acme/widget', 'pull': False}
    w.github.lag = lag
    w.jobs.close()
    restarted = w.make()
    restarted.own()
    done = restarted.store.load(run['id'])
    assert done['outcome'] == outcome
    assert (done['issue'] or {}).get('number') == (None if lag else 500)
    w.jobs = restarted


def test_the_output_budget_stops_the_agent_and_keeps_the_evidence(world, monkeypatch):
    monkeypatch.setattr(coding_store, 'OUTPUT_BUDGET', 256 * 1024)
    w = world(scenario={'flood': 2 * 1024**2, 'sleep': 10})
    run, _ = w.run()
    assert run['outcome'] == 'failed' and 'output budget' in run['message']
    [call] = w.calls()
    assert not alive(call['pid'])
    unpublished(w, run)
    folder = w.vault / run['log']
    meta = json.loads((folder / 'meta.json').read_text())
    assert meta['status'] == 'failed' and 0 < meta['files']['stdout.jsonl']['bytes'] <= 256 * 1024


def test_an_archive_write_failure_stops_the_job_before_publication(world, monkeypatch):
    w = world(scenario={'sleep': 10})
    real = coding_store.Capture._handle

    class Full:
        def write(self, data):
            raise OSError(28, 'No space left on device')
        def flush(self):
            pass
        def close(self):
            pass

    def handle(self, name):
        return Full() if name == 'stdout.jsonl' else real(self, name)
    monkeypatch.setattr(coding_store.Capture, '_handle', handle)
    run, _ = w.run()
    assert run['outcome'] == 'failed' and 'Writing the run archive failed' in run['message']
    [call] = w.calls()
    assert not alive(call['pid'])
    unpublished(w, run)
    assert run.get('archive_error'), 'the final event could not be written either, and that is recorded'


@pytest.mark.parametrize('change', [{'repository': 'other/repo'}, {'base': 'release'}, {'head_repository': 'other/fork'},
                                    {'state': 'closed'}, {'body': 'no issue link'}])
def test_restart_recovery_accepts_only_a_pull_request_that_reads_back_as_the_jobs(world, monkeypatch, change):
    w = world()
    head = w.base_sha
    run = interrupted_run(w, phase='pull_request', pr_pending={'branch': 'reader/pending'}, issue={'number': 277},
                          push={'sha': head, 'sent': True, 'verified': True},
                          git={'branch': 'reader/pending', 'base': 'main', 'remote': 'origin'})
    w.github.pulls[400] = {'number': 400, 'title': 'T', 'body': f'Closes #277\n<!-- reader-run:{run["id"]} -->',
                           'base': 'main', 'head': 'reader/pending', 'head_sha': head}
    original = w.github.pull_request
    body = change.get('body')
    patched = {k: v for k, v in change.items() if k != 'body'}
    monkeypatch.setattr(w.github, 'pull_request', lambda *a: dict(original(*a), **patched, **({'body': f'{body} <!-- reader-run:{run["id"]} -->'} if body else {})))
    outcome, _ = w.jobs.reconcile(run, w.jobs.registry.entry('acme/widget'), [])
    assert outcome == 'needs_reconciliation'


def test_output_without_a_newline_still_counts_against_the_budget(world):
    from reader_mcp import coding_workflow, llm_logs
    w = world()
    run = interrupted_run(w)
    capture = coding_store.Capture(llm_logs.RunLog(w.vault, 'coding-job', 'no-newline', {}), budget=1024)
    workflow = coding_workflow.Workflow(w.jobs, run, w.jobs.registry.entry('acme/widget'), capture, w.github, lambda: False)
    try:
        # 8 KiB on one unterminated line, then the process waits: the budget must stop it, not the timeout.
        started = time.monotonic()
        state, _, error = workflow.supervise([sys.executable, '-c', 'import os,time; os.write(1,b"x"*8192); time.sleep(20)'],
                                             w.checkout, subprocess.DEVNULL, workflow.env, 10, 'stdout.jsonl', 'stderr.log')
        assert state == 'failed' and 'budget' in error, error
        assert time.monotonic() - started < 5, 'the budget stops the process, not the 10 s timeout'
    finally:
        capture.close()


def test_restart_after_the_pull_request_was_saved_reconciles_it_as_opened(world):
    w = world()
    branch = 'reader/x-saved'
    head = git('rev-parse', 'refs/heads/main', cwd=w.bare)
    # The server stopped after publish() saved the pull request but before finish() recorded the outcome.
    run = interrupted_run(w, phase='pull_request', pr_pending=None, push={'sha': head, 'sent': True, 'verified': True},
                          git={'branch': branch, 'base': 'main', 'remote': 'origin'}, issue={'number': 277},
                          pr={'number': 400, 'url': 'https://github.com/acme/widget/pull/400', 'state': 'open', 'head_sha': head, 'base': 'main'})
    w.github.pulls[400] = {'number': 400, 'title': 'T', 'body': f'Closes #277\n<!-- reader-run:{run["id"]} -->', 'base': 'main', 'head': branch, 'head_sha': head}
    outcome, _ = w.jobs.reconcile(run, w.jobs.registry.entry('acme/widget'), [])
    assert outcome == 'pr_opened'
    # A saved pull request that no longer reads back as the job's is not reported opened.
    w.github.pulls[400]['body'] = 'edited'
    assert w.jobs.reconcile(run, w.jobs.registry.entry('acme/widget'), [])[0] == 'needs_reconciliation'


def test_restart_writes_its_outcome_after_a_torn_final_event(world):
    w = world()
    run = interrupted_run(w)
    with (w.vault / run['log'] / 'events.jsonl.partial').open('ab') as out:
        out.write(b'{"seq":2,"type":"agent"')  # The server stopped in the middle of writing an event.
    w.jobs.recover()
    done = w.jobs.store.load(run['id'])
    events = w.jobs.events(run['id'])['events']
    assert events[-1]['type'] == 'outcome' and events[-1]['seq'] == done['seq']
