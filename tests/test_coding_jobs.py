"""Coding jobs end to end against a real local Git fixture, a fake coding CLI and a fake GitHub (RW-44).

No test reaches GitHub or the network: the "remote" is a bare repository in tmp_path, and every GitHub
call goes to tests/fake_github.py. A real GitHub sandbox run is a separate, separately authorized check."""
import gzip
import hashlib
import json

import pytest

from coding_fixture import REPO, World, git, snapshot
from reader_mcp import llm_logs


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


def branch_changes(before, after):
    old = dict(line.split(' ') for line in before.splitlines())
    new = dict(line.split(' ') for line in after.splitlines())
    return {ref: sha for ref, sha in new.items() if old.get(ref) != sha}, set(old) - set(new)


def test_a_verified_change_becomes_a_pull_request_and_nothing_else_moves(world):
    w = world()
    run, admitted = w.run()
    assert admitted['status'] == 'queued' and admitted['active'] and not admitted['source']['path'].startswith('/')
    assert run['outcome'] == 'pr_opened', run['message']
    branch, head = run['git']['branch'], run['git']['head_sha']
    assert branch == f'reader/bound-parser-depth-{run["id"][:8]}'
    # The user's dirty checkout is byte-identical; its only new ref is the job's branch.
    after = snapshot(w.checkout)
    assert {k: v for k, v in after.items() if k != 'branches'} == {k: v for k, v in w.before.items() if k != 'branches'}
    changed, removed = branch_changes(w.before['branches'], after['branches'])
    assert changed == {f'refs/heads/{branch}': head} and not removed
    # The worktree was created from the pinned base and holds exactly the agent's commit.
    worktree = run['git']['worktree']
    assert worktree.startswith(str(w.worktrees)) and run['git']['base_sha'] == w.base_sha
    assert git('rev-parse', 'HEAD~1', cwd=worktree) == w.base_sha
    assert git('status', '--porcelain', cwd=worktree) == ''
    assert run['git']['changed_paths'] == ['src/depth.txt', 'tests/test_depth.txt']
    # Only the assigned branch reached the remote; main is untouched.
    assert w.remote_heads() == {'refs/heads/main': w.base_sha, f'refs/heads/{branch}': head}
    # The issue was verified, not created; the PR was read back with branch, base, head and issue.
    assert run['issue'] == {'number': 277, 'url': f'https://github.com/{REPO}/issues/277', 'state': 'open', 'created': False}
    pr = w.github.pulls[run['pr']['number']]
    assert (pr['head'], pr['base'], pr['head_sha']) == (branch, 'main', head) and 'Closes #277' in pr['body']
    assert f'reader-run:{run["id"]}' in pr['body'] and str(w.vault) not in pr['body'] and str(w.worktrees) not in pr['body']
    assert run['pr']['head_sha'] == head and run['push'] == {'sha': head, 'sent': True, 'verified': True}
    assert 'create_issue' not in w.github.calls and w.github.calls.count('create_pull_request') == 1
    # The agent ran once, in the worktree, with Reader's fixed argv and the brief plus the prompt on stdin.
    [call] = w.calls()
    assert call['cwd'] == worktree and call['argv'][:2] == ['exec', '--cd'] and '--sandbox' in call['argv']
    assert 'workspace-write' in call['argv'] and call['argv'][-1] == '-'
    assert 'This is a Reader coding job for the GitHub repository acme/widget' in call['stdin_head']
    # Verification ran in the worktree, after the agent.
    [verify] = [json.loads(line) for line in w.verify_record.read_text().splitlines()]
    assert verify['cwd'] == worktree


def test_events_are_sequenced_and_the_archive_is_sealed_with_hashes(world):
    w = world()
    run, _ = w.run()
    events = w.events(run['id'])
    assert [e['seq'] for e in events] == list(range(1, len(events) + 1))
    assert all(e['run_id'] == run['id'] and e['at'] for e in events)
    kinds = [e['type'] for e in events]
    assert kinds[0] == 'phase' and kinds[-1] == 'outcome' and events[-1]['outcome'] == 'pr_opened'
    phases = [e['phase'] for e in events if e['type'] == 'phase' and e['state'] == 'started']
    assert phases == ['queued', 'preflight', 'worktree', 'agent', 'issue', 'verify', 'push', 'pull_request']
    actions = [e['action'] for e in events if e['type'] == 'github']
    assert actions == ['issue_linked', 'branch_pushed', 'pull_request_opened']
    agent = [e for e in events if e['type'] == 'agent']
    assert agent and all(e['stream'] == 'codex' for e in agent)
    assert not any('not json' in json.dumps(e) for e in events), 'unrecognized output stays in the raw log only'
    assert any(e['type'] == 'step' and e['title'].startswith('Verify:') and e['status'] == 'completed' and '3 passed' in e['output'] for e in events)
    # Sealed archive: every artifact gzipped with size and SHA-256 recorded; no .partial left.
    folder = w.vault / run['log']
    assert run['log'].startswith('logs/llm/coding-job/') and not list(folder.glob('*.partial'))
    meta = json.loads((folder / 'meta.json').read_text())
    assert meta['status'] == 'pr_opened' and meta['kind'] == 'coding-job' and meta['source']['block_id'] == 'bound-parser-depth'
    assert meta['source']['sha256'] == w.sha() and meta['prompt']['submitted_sha256'] == run['prompt']['submitted_sha256']
    assert meta['git']['base_sha'] == w.base_sha and meta['git']['head_sha'] == run['git']['head_sha'] and meta['pr']['number'] == run['pr']['number']
    assert meta['tools']['agent'] is not None or meta['tools']['gh'] == 'gh version 0.0.0-fake'
    for name in ('request.json', 'prompt.txt', 'system.txt', 'stdout.jsonl', 'stderr.log', 'events.jsonl', 'verify.log', 'git.log',
                 'last-message.md', 'result.json'):
        data = gzip.decompress((folder / (name + '.gz')).read_bytes())
        assert meta['files'][name]['sha256'] == hashlib.sha256(data).hexdigest() and meta['files'][name]['bytes'] == len(data), name
    request = json.loads(gzip.decompress((folder / 'request.json.gz').read_bytes()))
    assert request['original_prompt'] == request['submitted_prompt'] and request['block']['repo'] == REPO
    assert b'not json: a progress line' in gzip.decompress((folder / 'stdout.jsonl.gz').read_bytes())
    git_log = gzip.decompress((folder / 'git.log.gz').read_bytes()).decode()
    assert '--force' not in git_log and ' -f ' not in git_log and 'reset' not in git_log
    assert f'push --porcelain -- origin {run["git"]["head_sha"]}:refs/heads/reader/' in git_log and '+refs/heads/reader' not in git_log


def test_an_edited_prompt_is_archived_beside_the_original_and_the_article_is_unchanged(world):
    w = world()
    text_before = (w.vault / w.doc).read_bytes()
    run, _ = w.run(prompt='Edited by the reader: only bound the depth.\n')
    assert run['prompt']['edited'] and run['outcome'] == 'pr_opened'
    request = json.loads(llm_logs.read(w.vault, run['log'], 'request.json', 64 * 1024)[0])
    assert request['submitted_prompt'] == 'Edited by the reader: only bound the depth.\n'
    assert request['original_prompt'].startswith('Check issue #277')
    assert (w.vault / w.doc).read_bytes() == text_before
    assert 'Edited by the reader' in w.calls()[0]['stdin_head']


def test_a_null_issue_is_created_from_the_confirmed_task_and_linked(world):
    w = world(issue=None)
    run, _ = w.run()
    assert run['outcome'] == 'pr_opened', run['message']
    number = run['issue']['number']
    assert run['issue']['created'] and w.github.calls.count('create_issue') == 1
    issue = w.github.issues[number]
    assert f'reader-run:{run["id"]}' in issue['body'] and str(w.vault) not in issue['body']
    assert f'Closes #{number}' in w.github.pulls[run['pr']['number']]['body']


def test_already_fixed_links_evidence_and_publishes_nothing(world):
    w = world(scenario={'outcome': 'already_fixed', 'existing_pr': 'https://github.com/acme/widget/pull/5'})
    w.github.pulls[5] = {'number': 5, 'title': 'Earlier fix', 'body': '', 'base': 'main', 'head': 'fix', 'head_sha': 'a' * 40}
    run, _ = w.run()
    assert run['outcome'] == 'already_fixed' and run['existing_pr']['number'] == 5
    assert run['push'] is None and run['pr'] is None and 'create_pull_request' not in w.github.calls
    assert set(w.remote_heads()) == {'refs/heads/main'}


def test_the_claude_adapter_reads_its_final_result_event(world):
    w = world()
    run, _ = w.run(agent='claude')
    assert run['outcome'] == 'pr_opened', run['message']
    [call] = w.calls()
    assert call['argv'][:4] == ['-p', '--output-format', 'stream-json', '--verbose'] and 'acceptEdits' in call['argv']
    assert any(e['type'] == 'agent' and e['stream'] == 'claude' for e in w.events(run['id']))


def test_repeated_requests_return_the_same_run_and_different_input_conflicts(world):
    from reader_mcp.coding_jobs import JobConflict
    w = world(scenario={'sleep': 0.5})
    request = w.request()
    first = w.jobs.dispatch(dict(request))
    again = w.jobs.dispatch(dict(request))
    assert again['id'] == first['id'] and again['duplicate']
    with pytest.raises(JobConflict) as conflict:
        w.jobs.dispatch(dict(request, prompt='A different prompt under the same request ID.\n'))
    assert conflict.value.code == 'request-conflict'
    w.wait(first['id'])
    assert len(w.jobs.store.runs()) == 1 and len(w.calls()) == 1
    # After it finished, the same request is still the same run, never a rerun.
    assert w.jobs.dispatch(dict(request))['id'] == first['id'] and len(w.calls()) == 1


def test_a_rerun_gets_a_new_run_linked_to_its_predecessor_and_reuses_its_issue(world):
    w = world(issue=None)
    first, _ = w.run()
    second, _ = w.run(predecessor=first['id'])
    assert second['id'] != first['id'] and second['predecessor'] == first['id']
    assert second['source']['issue'] == first['issue']['number'] and w.github.calls.count('create_issue') == 1
    assert second['outcome'] == 'pr_opened' and second['git']['branch'] != first['git']['branch']


@pytest.mark.parametrize('field,value', [('block_id', 'another-block'), ('path', 'library/another.md')])
def test_a_rerun_refuses_a_predecessor_from_another_prompt_block(world, field, value):
    from reader_mcp.coding_jobs import JobConflict
    w = world(issue=None)
    first, _ = w.run()
    # A finished run of a different block or article is not this block's predecessor, so its issue is not inherited.
    record = w.jobs.store.load(first['id'])
    record['source'][field] = value
    w.jobs.store.save(record)
    with pytest.raises(JobConflict) as refused:
        w.jobs.dispatch(w.request(predecessor=first['id']))
    assert refused.value.code == 'predecessor' and len(w.jobs.store.runs()) == 1


@pytest.mark.parametrize('change,code', [
    ('stale', 'stale'), ('missing', 'missing-block'), ('example', 'missing-block'), ('unregistered', 'unregistered'), ('agent', 'agent')])
def test_admission_refuses_stale_forged_and_unregistered_requests(world, change, code):
    from reader_mcp.coding_jobs import JobConflict
    w = world()
    request = w.request()
    if change == 'stale':
        request['sha256'] = '0' * 64
    elif change in ('missing', 'example'):
        request['block_id'] = 'example' if change == 'example' else 'no-such-block'
    elif change == 'unregistered':
        (w.vault / w.doc).write_text((w.vault / w.doc).read_text().replace('"repo":"acme/widget","issue":277', '"repo":"other/repo","issue":277'))
        request['sha256'] = w.sha()
    elif change == 'agent':
        w.entry['agents'] = ['claude']
        w.entry['executables'] = {'claude': w.entry['executables']['claude']}
        w.write_registry()
    with pytest.raises(JobConflict) as refused:
        w.jobs.dispatch(request)
    assert refused.value.code == code
    assert w.jobs.store.runs() == [] and w.calls() == []
    assert not (w.vault / 'logs').exists()


def test_viewing_listing_and_streaming_never_start_anything(world):
    w = world()
    for _ in range(3):
        actions = w.jobs.actions(w.doc)
        w.jobs.runs()
        w.jobs.repositories()
    [block] = actions['blocks']
    assert block['id'] == 'bound-parser-depth' and block['registered'] and block['base'] == 'main'
    assert [a['name'] for a in block['agents']] == ['codex', 'claude'] and all(a['available'] for a in block['agents'])
    assert block['issue_url'] == 'https://github.com/acme/widget/issues/277' and block['runs'] == []
    assert w.jobs.store.runs() == [] and w.calls() == [] and w.github.calls == []
    assert not (w.vault / 'logs').exists()


@pytest.mark.parametrize('change', [
    {'state': 'closed', 'merged': False},          # closed straight after it was opened
    {'head_repository': 'other/fork'},             # the same branch name and SHA from another repository
])
def test_a_pull_request_that_does_not_read_back_as_ours_and_open_is_not_reported_opened(world, monkeypatch, change):
    w = world()
    original = w.github.pull_request
    monkeypatch.setattr(w.github, 'pull_request', lambda *a: dict(original(*a), **change))
    run, _ = w.run()
    assert run['outcome'] == 'needs_reconciliation', run['message']


def test_the_pull_request_must_close_exactly_the_jobs_issue(world, monkeypatch):
    w = world()
    original = w.github.pull_request
    # For issue 277, "Closes #2770" contains "#277" but links another issue.
    monkeypatch.setattr(w.github, 'pull_request', lambda *a: (lambda pr: dict(pr, body=pr['body'].replace('Closes #277', 'Closes #2770')))(original(*a)))
    run, _ = w.run()
    assert run['outcome'] == 'needs_reconciliation', run['message']


def test_a_published_run_completes_its_pull_request_phase(world):
    w = world()
    run, _ = w.run()
    assert run['outcome'] == 'pr_opened'
    phases = [(e['phase'], e['state']) for e in w.events(run['id']) if e['type'] == 'phase']
    assert phases[-1] == ('pull_request', 'completed')


def test_a_verification_command_named_without_a_path_is_found_on_path(world):
    w = world()
    # The documented form: a command name such as python3, not an absolute path.
    w.entry['verify']['argv'][0] = 'python3'
    (w.vault / '.reader/repositories.json').write_text(json.dumps({'schema_version': 1, 'repositories': {REPO: w.entry}}))
    run, _ = w.run()
    assert run['outcome'] == 'pr_opened', run['message']
    assert run['verification']['exit_code'] == 0


def test_a_verification_command_that_is_not_installed_blocks_the_job(world):
    w = world()
    w.entry['verify']['argv'][0] = 'no-such-verifier'
    (w.vault / '.reader/repositories.json').write_text(json.dumps({'schema_version': 1, 'repositories': {REPO: w.entry}}))
    run, _ = w.run()
    assert run['outcome'] == 'blocked' and 'no-such-verifier' in run['message'], run['message']
    assert run['phase'] == 'preflight' and not w.calls(), 'blocked before the agent ran'


def test_live_events_hide_host_folders_as_archived_events_do(world):
    from types import SimpleNamespace
    w = world()
    run, _ = w.run()
    seq = run['seq']
    # As while the run is active: its capture is open and a live event names a vault file by its host path.
    w.jobs.captures[run['id']] = SimpleNamespace(seq=seq + 1)
    w.jobs.live.push({'run_id': run['id'], 'seq': seq + 1, 'at': 'now', 'type': 'agent', 'stream': 'codex',
                      'event': {'command': f'cat {w.vault}/library/audit.md'}})
    page = w.jobs.events(run['id'], seq)
    assert page['source'] == 'live' and page['events'], page
    assert str(w.vault) not in json.dumps(page) and str(w.vault.parent) not in json.dumps(page['events'])


def test_a_finished_run_releases_its_live_event_buffer(world):
    w = world()
    run, _ = w.run()
    # Finished runs are read from the archive; their in-memory events would otherwise stay for the server's lifetime.
    assert run['id'] not in w.jobs.live.events
    page = w.jobs.events(run['id'], 0)
    assert page['source'] == 'archive' and page['done'] and page['events']


def test_live_event_pages_keep_the_byte_cap(world):
    from reader_mcp import coding_store
    w = world()
    w.jobs.work = lambda: None  # Admitted but not started, so the run's live capture stays open.
    run = w.jobs.submit(w.request())
    capture = w.jobs.captures[run['id']]
    after = capture.seq
    for _ in range(4):
        capture.event(run['id'], 'agent', text='x' * 200_000)
    page = w.jobs.events(run['id'], after)
    assert sum(len(json.dumps(e, ensure_ascii=False).encode()) + 1 for e in page['events']) <= coding_store.MAX_PAGE_BYTES
    assert page['events'] and page['more']
    w.jobs.stop(run['id'])


def test_issue_and_pull_request_titles_hide_host_folders(world, monkeypatch):
    from coding_fixture import article
    from reader_mcp.coding_publish import Job
    w = world()
    (w.vault / w.doc).write_text(article(issue=None))
    agent = Job.agent
    monkeypatch.setattr(Job, 'agent', lambda self: dict(agent(self), issue_title=f'Fix {w.checkout}/src', pr_title=f'Fix {w.checkout}/src'))
    run, _ = w.run()
    assert run['outcome'] == 'pr_opened', run['message']
    assert str(w.checkout) not in w.github.issues[run['issue']['number']]['title']
    assert str(w.checkout) not in w.github.pulls[run['pr']['number']]['title']


def test_the_push_sends_the_verified_commit_even_if_the_branch_moves(world, monkeypatch):
    from reader_mcp.coding_publish import Job
    w = world()
    remote, moved = Job.remote_sha, []

    def move(self, ref):
        if self.run['phase'] == 'push' and not moved:
            moved.append(True)  # Something commits on the job's branch after verification.
            git('commit', '-q', '--allow-empty', '-m', 'unverified', cwd=self.run['git']['worktree'])
        return remote(self, ref)
    monkeypatch.setattr(Job, 'remote_sha', move)
    run, _ = w.run()
    assert w.remote_heads().get('refs/heads/' + run['git']['branch']) == run['git']['head_sha']


def test_stop_during_the_remote_lookup_starts_no_push(world, monkeypatch):
    from reader_mcp.coding_publish import Job
    w = world()
    remote = Job.remote_sha

    def stop(self, ref):
        if self.run['phase'] == 'push':
            self.jobs.cancels.add(self.run['id'])
        return remote(self, ref)
    monkeypatch.setattr(Job, 'remote_sha', stop)
    run, _ = w.run()
    assert run['outcome'] == 'cancelled' and 'refs/heads/' + run['git']['branch'] not in w.remote_heads()


def test_finish_keeps_the_runner_alive_when_the_final_record_cannot_be_written(world, monkeypatch):
    w = world()
    w.jobs.work = lambda: None
    run = w.jobs.submit(w.request())
    record = w.jobs.store.load(run['id'])
    write = w.jobs.store._write

    def full(path, data):
        if data.get('status') == 'finished':
            raise OSError(28, 'synthetic full runtime disk')
        write(path, data)
    monkeypatch.setattr(w.jobs.store, '_write', full)
    w.jobs.finish(record, 'failed', 'synthetic failure')  # Never raises.
    # Reads see the finished run although its file could not be written; a later save retries it.
    assert w.jobs.store.load(run['id'])['status'] == 'finished' and run['id'] not in w.jobs.live.events
    monkeypatch.setattr(w.jobs.store, '_write', write)
    w.jobs.store.retry()
    assert json.loads((w.jobs.store.runtime / 'runs' / (run['id'] + '.json')).read_text())['status'] == 'finished'
