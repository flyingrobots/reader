"""Article prompts that become coding jobs (RW-44): admission, the job runner, recovery and views.

This is a repository-job runner, separate from the chat runner (whose working directory and change
detector belong to the vault). One Reader server per vault owns coding jobs (`.reader/coding-jobs/
supervisor.lock`, the chat supervisor's lock); it runs one job at a time from a FIFO queue. Others serve
them read-only and answer 409 to submissions and Stop.

Admission is explicit and idempotent. A run starts only from a POST that names a request UUID, the
article path and its expected SHA-256, a block ID, the prompt (possibly edited) and an agent. Reader
re-reads the article, parses its Markdown tokens, finds the block and its registered repository, and
stores the exact original and submitted prompts in the archive before any work. The same request UUID
with the same input returns the same run; with different input it is a conflict. Viewing an article,
listing jobs or streaming events never starts anything.

A restart never relaunches a coding agent. Unfinished runs are reconciled: a process group the previous
server left running is stopped (when its recorded start time proves it is the same process), pending
issue or pull-request creations are looked up by marker or branch, and the run ends `interrupted`, or
`pr_opened` when the pull request reads back correctly, or `needs_reconciliation` when GitHub cannot
settle what happened."""
from collections import deque
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import threading
import traceback
import uuid

from . import coding_agents, llm_logs, prompt_blocks
from .coding_publish import Job, closes, ours
from .coding_store import CaptureFailed, Capture, Live, Store, archived_events, stamp, valid_id
from .coding_workflow import Stop, process_started
from .display import shown
from .github import GhCli, GitHubError
from .repositories import AGENTS, Registry, RegistryError
from .resources import has_capacity
from .voice_runner import Supervisor, kill_group

OUTCOMES = ('pr_opened', 'already_fixed', 'blocked', 'failed', 'cancelled', 'interrupted', 'needs_reconciliation')
PHASES = ('queued', 'preflight', 'worktree', 'agent', 'issue', 'verify', 'push', 'pull_request')
ARTIFACTS = ('meta.json', 'request.json', 'prompt.txt', 'system.txt', 'stdout.jsonl', 'stderr.log', 'events.jsonl',
             'verify.log', 'git.log', 'last-message.md', 'result.json')
MAX_ARTIFACT = 1024**2
OWNED = 'Another Reader server owns coding jobs for this vault'


class JobsOwned(Exception):
    """Another server owns coding jobs (409)."""


class JobConflict(Exception):
    """A request UUID reused with different input, or a stale source (409)."""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def fingerprint(request):
    keys = ('path', 'sha256', 'block_id', 'prompt', 'agent', 'predecessor')
    return hashlib.sha256(json.dumps({k: request.get(k) for k in keys}, sort_keys=True).encode()).hexdigest()


class Runner:
    def __init__(self, root, articles, github=None, environ=None, git_locks=None, limits=True, capacity=None):
        self.root = Path(root).resolve()
        self.articles = articles  # path -> (text, sha256) of a current library document
        self.environ = environ
        self.github = github or GhCli(environ=environ)
        self.git = shutil.which('git') or 'git'
        self._git_locks = git_locks
        self.limits = limits
        self.capacity = capacity or has_capacity
        self.host = socket.gethostname()
        self.store = Store(self.root)
        self.registry = Registry(self.root)
        self.live = Live()
        self.supervisor = Supervisor(self.root / '.reader/coding-jobs', name='reader-coding-supervisor')
        self.lock = threading.RLock()
        self.queue = deque()
        self.wake = threading.Event()
        self.cancels = set()
        self.captures = {}
        self.logs = {}
        self.active = None
        self.closed = False
        self.worker = None

    # Ownership -------------------------------------------------------------------------------------

    def git_locks(self):
        if self._git_locks is False:
            return None
        if self._git_locks:
            return self._git_locks
        from .companions import find_git_locks
        return find_git_locks(self.environ, self.root)

    def own(self):
        with self.lock:
            if self.supervisor.fd is not None:
                return True
            if not self.supervisor.acquire():
                return False
            self.recover()
            self.worker = threading.Thread(target=self.work, name='reader-coding-jobs', daemon=True)
            self.worker.start()
            return True

    def owner(self):
        return self.supervisor.fd is not None

    def start(self):
        """At server start: take ownership and reconcile leftovers when this vault has registered repositories."""
        if self.registry.configured():
            self.own()

    def close(self):
        self.closed = True
        self.wake.set()
        self.live.close()
        if self.worker:
            self.worker.join(timeout=10)
            if self.worker.is_alive():
                return  # Still inside a job step: the worker releases ownership when it exits, never before.
        self.supervisor.release()

    def scratch(self, run_id):
        path = self.store.folder('tmp') / run_id
        path.mkdir(exist_ok=True)
        return path

    def prompt_text(self, run):
        return llm_logs.read(self.root, run['log'], 'prompt.txt', 64 * 1024)[0] or ''

    # Admission -------------------------------------------------------------------------------------

    def submit(self, request):
        allowed = {'action', 'request_id', 'path', 'sha256', 'block_id', 'prompt', 'agent', 'predecessor'}
        if set(request) - allowed:
            raise ValueError('Unexpected job request fields: ' + ', '.join(sorted(set(request) - allowed)))
        if not valid_id(request.get('request_id')):
            raise ValueError('Expected request_id, a UUID chosen by the browser for this Run')
        prompt = request.get('prompt')
        if not isinstance(prompt, str) or len(prompt.encode('utf-8', 'surrogatepass')) > prompt_blocks.MAX_PROMPT or prompt_blocks.BLANK.fullmatch(prompt):
            raise ValueError('The prompt must be non-blank and at most 32 KiB')
        if request.get('agent') not in AGENTS:
            raise ValueError('Unknown coding agent')
        if not isinstance(request.get('sha256'), str) or len(request['sha256']) != 64:
            raise ValueError('Expected the article’s SHA-256')
        if request.get('predecessor') is not None and not valid_id(request['predecessor']):
            raise ValueError('Expected the predecessor run ID')
        if not self.own():
            raise JobsOwned(OWNED)
        with self.lock, (self.store.folder('') / 'admit.lock').open('a') as admit:
            fcntl.flock(admit, fcntl.LOCK_EX)
            print_ = fingerprint(request)
            known = self.store.request(request['request_id'])
            if known:
                if known.get('fingerprint') != print_:
                    raise JobConflict('This request ID already started a different run; reload to run again.', 'request-conflict')
                return self.view(self.store.load(known['run_id'])) | {'duplicate': True}
            text, sha = self.articles(request.get('path'))
            if sha != request['sha256']:
                raise JobConflict('The article changed since you opened it. Reload it to see its current prompt.', 'stale')
            block = prompt_blocks.find(text, request.get('block_id'))
            if not block:
                raise JobConflict('The article has no valid prompt block with that ID.', 'missing-block')
            entry = self.registry.entry(block['repo'])
            if not entry:
                raise JobConflict(f'{block["repo"]} is not a registered repository. Set it up in Reader Admin first.', 'unregistered')
            if request['agent'] not in entry['agents']:
                raise JobConflict(f'{request["agent"]} is not an agent {entry["repo"]} allows.', 'agent')
            if not self.capacity(self.root):
                raise JobConflict('Free disk space is below Reader’s reserve, so the run archive could not be kept.', 'capacity')
            issue = block['issue']
            predecessor = None
            if request.get('predecessor'):
                predecessor = self.store.load(request['predecessor'])
                if not predecessor or predecessor.get('status') != 'finished':
                    raise JobConflict('The run this reruns is unknown or still active.', 'predecessor')
                # A rerun follows a run of this article's same block; only then does it inherit that run's issue.
                source = predecessor.get('source') or {}
                if source.get('path') != request['path'] or source.get('block_id') != block['id']:
                    raise JobConflict('The run this reruns started from a different prompt block.', 'predecessor')
                if issue is None and (predecessor.get('issue') or {}).get('number') and source.get('repo') == block['repo']:
                    issue = predecessor['issue']['number']
            run_id = str(uuid.uuid4())
            branch = f'reader/{block["id"][:40]}-{run_id[:8]}'
            run = {'schema_version': 1, 'id': run_id, 'request_id': request['request_id'], 'predecessor': request.get('predecessor'),
                   'created_at': stamp(), 'started_at': None, 'finished_at': None, 'status': 'queued', 'phase': 'queued',
                   'outcome': None, 'message': 'Waiting to start', 'agent': request['agent'],
                   'source': {'path': request['path'], 'sha256': sha, 'block_id': block['id'], 'line': block['line'], 'title': block['title'],
                              'repo': entry['repo'], 'issue': issue, 'block_issue': block['issue']},
                   'prompt': {'original_sha256': block['prompt_sha256'], 'submitted_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
                              'edited': prompt != block['prompt']},
                   'git': {'remote': entry['remote'], 'base': entry['base'], 'branch': branch, 'base_sha': None, 'head_sha': None,
                           'worktree': None, 'commits': [], 'changed_paths': []},
                   'issue': None, 'issue_pending': None, 'push': None, 'pr': None, 'pr_pending': None, 'existing_pr': None,
                   'verification': None, 'tools': None, 'process': None, 'owner': {'host': self.host, 'pid': os.getpid()}}
            log = llm_logs.RunLog(self.root, 'coding-job', run_id, {
                'runner': 'coding-job', 'request_id': request['request_id'], 'predecessor': request.get('predecessor'),
                'source': run['source'], 'prompt': run['prompt'], 'agent': request['agent'], 'repository': entry['repo'],
                'branch': branch, 'base': entry['base']})
            llm_logs.forget_usage(self.root)
            run['log'] = log.relative
            capture = Capture(log, on_event=self.live.push)
            # The exact request, original prompt and submitted prompt are archived before any work begins.
            capture.write('request.json', json.dumps({'request_id': request['request_id'], 'path': request['path'], 'sha256': sha,
                                                      'block': {k: block[k] for k in ('id', 'title', 'repo', 'issue', 'line', 'prompt_sha256')},
                                                      'original_prompt': block['prompt'], 'submitted_prompt': prompt,
                                                      'agent': request['agent'], 'predecessor': request.get('predecessor'),
                                                      'admitted_at': run['created_at']}, ensure_ascii=False, indent=1) + '\n')
            capture.write('prompt.txt', prompt)
            capture.event(run_id, 'phase', phase='queued', state='started', detail=f'{entry["repo"]} · {coding_agents.LABELS[request["agent"]]}')
            self.store.save(run)
            try:
                self.store.remember(request['request_id'], run_id, print_)
            except BaseException:
                # Without its receipt the run is not admitted: no record is left to wait unqueued, and a retry
                # with the same request ID admits exactly one run. The archive keeps the attempt, sealed as failed.
                self.store.discard(run_id)
                capture.close()
                try:
                    log.finish('failed', message='Admission failed: the request receipt could not be saved.')
                except (OSError, ValueError):
                    pass
                raise
            self.captures[run_id], self.logs[run_id] = capture, log
            self.queue.append(run_id)
            self.wake.set()
            return self.view(run)

    def stop(self, run_id):
        if not self.own():
            raise JobsOwned(OWNED)
        run = self.store.load(run_id)
        if not run:
            raise ValueError('No coding job with that ID')
        with self.lock:
            if run.get('status') == 'finished':
                return self.view(run) | {'stopped': False}
            self.cancels.add(run_id)
            if run_id in self.queue:
                self.queue.remove(run_id)
                self.finish(run, 'cancelled', 'Stopped by you before it started.')
        return self.view(self.store.load(run_id)) | {'stopped': True}

    # Running ---------------------------------------------------------------------------------------

    def work(self):
        try:
            while not self.closed:
                self.wake.wait(1)
                self.wake.clear()
                self.store.retry()
                while not self.closed:
                    with self.lock:
                        if not self.queue:
                            break
                        run_id = self.queue.popleft()
                        run = self.store.load(run_id)
                        self.active = run_id
                    try:
                        if run and run.get('status') == 'queued':
                            self.execute(run)
                    finally:
                        with self.lock:
                            self.active = None
        finally:
            if self.closed:
                self.supervisor.release()  # Ownership ends with the worker, so no other server takes over a live run.

    def execute(self, run):
        capture = self.captures[run['id']]
        run.update(status='running', started_at=stamp(), message='Running')
        outcome, message = 'failed', 'Reader stopped this job unexpectedly.'
        try:
            self.store.save(run)  # Inside the handler: a failed write finishes the job, never the queue worker.
            entry = self.registry.entry(run['source']['repo'])
            if not entry:
                raise Stop('blocked', f'{run["source"]["repo"]} is no longer registered.')
            job = Job(self, run, entry, capture, self.github, lambda: run['id'] in self.cancels or self.closed)
            outcome, message = job.execute()
        except Stop as stop:
            outcome, message = stop.outcome, stop.message
        except CaptureFailed as exc:
            outcome, message = 'failed', str(exc)
        except RegistryError as exc:
            outcome, message = 'blocked', str(exc)
        except Exception as exc:
            outcome, message = 'failed', f'Reader error: {exc.__class__.__name__}: {exc}'
            try:
                capture.write('stderr.log', '\n[reader] ' + traceback.format_exc())
            except CaptureFailed:
                pass
        finally:
            self.finish(run, outcome, message)

    def finish(self, run, outcome, message):
        """Record the outcome, seal the archive and publish the final event. Never raises."""
        capture, log = self.captures.pop(run['id'], None), self.logs.pop(run['id'], None)
        run.update(status='finished', outcome=outcome, message=shown(message, self.root), finished_at=stamp(), process=None)
        if capture:
            try:
                capture.event(run['id'], 'outcome', outcome=outcome, message=run['message'], phase=run['phase'])
                capture.write('result.json', json.dumps({k: run.get(k) for k in ('id', 'outcome', 'message', 'phase', 'source', 'prompt', 'agent',
                                                                                  'git', 'issue', 'push', 'pr', 'existing_pr', 'verification', 'tools')},
                                                        ensure_ascii=False, indent=1) + '\n')
            except CaptureFailed as exc:
                run['archive_error'] = str(exc)
            run['seq'] = capture.seq
            capture.close()
        if log:
            try:
                log.finish(outcome, outcome=outcome, message=run['message'], phase=run['phase'], git=run['git'], issue=run['issue'],
                           pr=run['pr'], push=run['push'], tools=run['tools'], verification=run['verification'], existing_pr=run['existing_pr'])
            except (OSError, ValueError) as exc:
                run['archive_error'] = f'Sealing the run archive failed: {exc}'
        self.cancels.discard(run['id'])
        try:
            self.store.save(run)
        except OSError as exc:  # The store keeps the finished record in memory and retries; the runner carries on.
            run['archive_error'] = f'Saving the finished run failed ({exc}); Reader keeps it in memory and retries.'
        llm_logs.forget_usage(self.root)
        self.live.release(run['id'])
        threading.Thread(target=self.commit_log, args=(run,), daemon=True).start()

    def commit_log(self, run):
        try:
            llm_logs.commit(self.root, [run['log']], f'Coding job: {run["source"]["title"][:80]} — {run["outcome"]}',
                            [('Reader-Log', llm_logs.trailer(run['log']))], git_locks=self._git_locks if self._git_locks is False else None,
                            holder='reader-coding-job', note='Reader coding-job log commit')
        except Exception:
            pass  # The archive is already sealed on disk; a later commit includes it.

    # Recovery --------------------------------------------------------------------------------------

    def recover(self):
        """Reconcile runs a previous server left unfinished. Never relaunches an agent."""
        for run in self.store.runs():
            if run.get('status') == 'finished':
                continue
            notes, outcome = [], 'interrupted'
            process = run.get('process') or {}
            if process.get('group') and process.get('host') == self.host and process.get('started') and \
                    process_started(process['group']) == process['started']:
                kill_group(process['group'])
                notes.append('Reader stopped the process the previous server left running.')
            entry = None
            try:
                entry = self.registry.entry(run['source']['repo'])
            except RegistryError:
                pass
            outcome, found = self.reconcile(run, entry, notes)
            message = ('Reader stopped before this job finished; it was not restarted. ' + ' '.join(notes)).strip() if outcome != 'pr_opened' else \
                ('Reconciled after a restart: pull request #' + str(run['pr']['number']) + ' is open. ' + ' '.join(notes)).strip()
            run.update(status='finished', outcome=outcome, message=message, finished_at=stamp(), process=None, recovered=True)
            if run.get('log'):
                try:
                    events, _ = archived_events(self.root, run['log'], 0, limit=10**6, max_bytes=64 * 1024**2)
                    seq = max([e['seq'] for e in events] or [0]) + 1
                    folder = llm_logs.safe_dir(self.root, run['log'])
                    if (folder / 'events.jsonl.partial').is_file():
                        with (folder / 'events.jsonl.partial').open('ab+') as out:
                            # A server that stopped mid-write leaves a torn last line: end it, or the outcome joins it.
                            if out.seek(0, 2):
                                out.seek(-1, 2)
                                if out.read(1) != b'\n':
                                    out.write(b'\n')
                            out.write((json.dumps({'run_id': run['id'], 'seq': seq, 'at': stamp(), 'type': 'outcome', 'outcome': outcome,
                                                   'message': message, 'phase': run.get('phase'), 'recovered': True}) + '\n').encode())
                        run['seq'] = seq
                    llm_logs.seal(self.root, run['log'], outcome, message)
                except (OSError, ValueError) as exc:
                    run['archive_error'] = f'Sealing the run archive failed: {exc}'
            self.store.save(run)

    def reconcile(self, run, entry, notes):
        """(outcome, detail) for an unfinished run's publication state."""
        repo, branch = run['source']['repo'], run['git']['branch']
        try:
            if run.get('pr') and not run.get('pr_pending') and (run.get('push') or {}).get('verified'):
                # publish() saved the pull request, then the server stopped before finish(): read it back once more.
                pr = self.github.pull_request(repo, run['pr']['number'])
                if ours(pr, repo, run['git']['base'], branch, run['push']['sha']) and closes(pr.get('body'), (run.get('issue') or {}).get('number'), run['id']):
                    return 'pr_opened', None
                notes.append(f'Pull request #{run["pr"]["number"]} no longer reads back as this job’s.')
                return 'needs_reconciliation', None
            if run.get('pr_pending') and (run.get('push') or {}).get('verified'):
                head = run['push']['sha']
                pulls = [p for p in self.github.pull_requests(repo, branch)
                         if p.get('head') == branch and p.get('head_sha') == head and p.get('base') == run['git']['base']]
                if len(pulls) == 1:
                    # The same read-back a live publication requires (coding_publish.ours and closes).
                    pr = self.github.pull_request(repo, pulls[0]['number'])
                    issue = (run.get('issue') or {}).get('number')
                    if ours(pr, repo, run['git']['base'], branch, head) and closes(pr.get('body'), issue, run['id']):
                        run['pr'] = {'number': pr['number'], 'url': pr['url'], 'state': pr['state'], 'head_sha': head, 'base': pr['base']}
                        run['pr_pending'] = None
                        return 'pr_opened', None
                    return 'needs_reconciliation', None
                if pulls:
                    notes.append(f'Several pull requests exist for {branch}.')
                    return 'needs_reconciliation', None
                notes.append('No pull request was opened.')
            if run.get('issue_pending'):
                found = [i for i in self.github.find_issues(repo, run['issue_pending']['marker']) if not i.get('is_pull_request')]
                if len(found) == 1:
                    run['issue'] = {'number': found[0]['number'], 'url': found[0]['url'], 'state': found[0]['state'], 'created': True}
                    run['issue_pending'] = None
                    notes.append(f'Its issue #{found[0]["number"]} was created.')
                else:
                    notes.append(f'An issue may have been created; search {repo} for “{run["issue_pending"]["marker"]}”.')
                    return 'needs_reconciliation', None
        except GitHubError as exc:
            notes.append(f'GitHub could not confirm what was published ({exc}).')
            return 'needs_reconciliation', None
        if (run.get('push') or {}).get('sent') and not run['push'].get('verified'):
            notes.append(f'A push of {branch} was started; check {run["git"]["remote"]}/{branch}.')
            return 'needs_reconciliation', None
        return 'interrupted', None
