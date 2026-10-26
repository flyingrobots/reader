"""One coding job's server-owned workflow (RW-44): preflight, worktree, agent, issue, verify, push, PR.

Git administration and publication are deterministic operations Reader performs itself; the coding
agent only investigates, edits and commits in the job's worktree. Every phase records events and
stops with an explicit outcome (`Stop`): `pr_opened` only after the pushed SHA and the pull request were
read back from the remote; `already_fixed`, `blocked`, `failed`, `cancelled` and `needs_reconciliation`
otherwise. Nothing here resets a branch, force-pushes, reuses an unknown worktree, merges, or deletes a
worktree, branch or remote artifact: they are kept for inspection after success and failure alike.

A worktree isolates Git changes, not the filesystem, build caches or credentials. The agent runs under
the registry's permission mode with the user's environment; the repository's own guarded workflow and
the configured verification command remain the resource and quality policy."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid

from . import coding_agents
from .coding_store import CaptureFailed
from .display import shown
from .github import GitHubError
from .repositories import inspect as inspect_entry
from .voice_runner import SHIM, kill_group, process_group_rss

MAX_RSS = 4 * 1024**3
CHECK_EVERY = 5
TAIL = 64 * 1024
GIT_TIMEOUT = 120
PUSH_TIMEOUT = 300


class Stop(Exception):
    def __init__(self, outcome, message):
        super().__init__(message)
        self.outcome = outcome
        self.message = message


def process_started(pid):
    """The process's start time as `ps` reports it, to recognize it after a restart (pids are reused)."""
    try:
        return subprocess.run(['ps', '-o', 'lstart=', '-p', str(pid)], capture_output=True, text=True, timeout=5).stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


class Workflow:
    def __init__(self, jobs, run, entry, capture, github, cancelled):
        self.jobs, self.run, self.entry, self.capture, self.github = jobs, run, entry, capture, github
        self.cancelled = cancelled
        self.root = jobs.root
        self.repo = entry['repo']
        self.git_exe = jobs.git
        self.env = {k: v for k, v in (jobs.environ or os.environ).items() if k != 'GIT_LOCKS_STORE'} | {'GIT_TERMINAL_PROMPT': '0'}
        self.steps = 0

    # Events, steps and Git -------------------------------------------------------------------------

    def emit(self, kind, **data):
        return self.capture.event(self.run['id'], kind, **data)

    def phase(self, name, detail=None):
        self.check_cancel()
        self.run['phase'] = name
        self.jobs.store.save(self.run)
        self.emit('phase', phase=name, state='started', detail=detail)

    def check_cancel(self):
        if self.cancelled():
            raise Stop('cancelled', 'Stopped by you. Completed effects (a pushed branch, a created issue) stay recorded.')

    def private(self, text):
        """Text safe for GitHub and the browser: no vault, home or worktree folders."""
        text = shown(text, self.root)
        for path in filter(None, [self.run['git'].get('worktree'), self.entry['checkout']]):
            text = text.replace(path, '<worktree>' if path == self.run['git'].get('worktree') else '<checkout>')
        return text

    def step(self, title, status='running', output='', exit_code=None, step_id=None):
        if step_id is None:
            self.steps += 1
            step_id = f'step-{self.steps}'
        self.emit('step', id=step_id, title=title, status=status, output=self.private(output)[-TAIL:], exit_code=exit_code)
        return step_id

    def git(self, args, cwd=None, title=None, timeout=GIT_TIMEOUT, check=True):
        cwd = cwd or self.run['git'].get('worktree') or self.entry['checkout']
        step = self.step(title) if title else None
        try:
            result = subprocess.run([self.git_exe, *args], cwd=cwd, capture_output=True, text=True, timeout=timeout,
                                    env=self.env, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            if step:
                self.step(title, 'failed', f'Timed out after {timeout} s', None, step)
            raise Stop('failed', f'git {args[0]} timed out after {timeout} s')
        output = (result.stdout + result.stderr).strip()
        self.capture.write('git.log', f'$ git {" ".join(args)}\n{output}\n[exit {result.returncode}]\n')
        if step:
            self.step(title, 'completed' if result.returncode == 0 else 'failed', output, result.returncode, step)
        if check and result.returncode:
            raise Stop('failed', f'git {args[0]} failed: {self.private(output)[-400:]}')
        return result

    def locked(self, args):
        """Wrap a Git metadata mutation of the user's repository in its `.git/` git-locks key, when installed."""
        tool = self.jobs.git_locks()
        if not tool:
            return None
        return [tool, 'with', '--job', 'reader-coding-' + uuid.uuid4().hex, '--holder', 'reader-coding-job', '--ttl', '300',
                '--wait', '120', '--note', 'Reader coding job worktree', '.git/', '--', self.git_exe, *args]

    def git_admin(self, args, title):
        command = self.locked(args)
        if not command:
            return self.git(args, self.entry['checkout'], title)
        step = self.step(title)
        result = subprocess.run(command, cwd=self.entry['checkout'], capture_output=True, text=True, timeout=GIT_TIMEOUT + 130,
                                env=self.env, stdin=subprocess.DEVNULL)
        output = (result.stdout + result.stderr).strip()
        self.capture.write('git.log', f'$ git-locks … git {" ".join(args)}\n{output}\n[exit {result.returncode}]\n')
        self.step(title, 'completed' if result.returncode == 0 else 'failed', output, result.returncode, step)
        if result.returncode:
            raise Stop('failed', f'git {args[0]} failed: {self.private(output)[-400:]}')
        return result

    def remote_sha(self, ref):
        result = self.git(['ls-remote', '--', self.entry['remote'], ref], self.entry['checkout'], timeout=GIT_TIMEOUT, check=False)
        if result.returncode:
            raise Stop('blocked', f'Could not read {self.entry["remote"]}: {self.private(result.stderr)[-300:]}')
        rows = [line.split('\t') for line in result.stdout.splitlines() if '\t' in line]
        return next((sha for sha, name in rows if name == ref), None)

    # Phases -----------------------------------------------------------------------------------------

    def preflight(self):
        self.phase('preflight')
        problems = inspect_entry(self.entry)
        if problems:
            raise Stop('blocked', ' '.join(problems))
        agent = self.run['agent']
        if agent not in self.entry['agents']:
            raise Stop('blocked', f'{agent} is not an agent this repository allows.')
        path = coding_agents.executable(agent, self.entry, self.jobs.environ)
        if not path:
            raise Stop('blocked', f'{coding_agents.LABELS[agent]} is not installed where Reader can find it.')
        self.agent_path = path
        lock = self.entry['verify']['lock']
        if lock and not self.jobs.git_locks():
            raise Stop('blocked', 'Verification is configured to run under git-locks, which is not installed; Reader will not run it unguarded.')
        if not self.jobs.capacity(self.root) or not self.jobs.capacity(self.entry['worktree_root']):
            raise Stop('blocked', 'Free disk space is below Reader’s reserve for the run archive or the worktree folder.')
        self.run['tools'] = {'agent': coding_agents.version(path), 'gh': self.github.version(),
                             'git': (subprocess.run([self.git_exe, '--version'], capture_output=True, text=True, timeout=10).stdout.strip() or None)}
        step = self.step('Check GitHub access')
        try:
            login = self.github.viewer().get('login')
            info = self.github.repository(self.repo)
        except GitHubError as exc:
            self.step('Check GitHub access', 'failed', str(exc), 1, step)
            raise Stop('blocked', f'GitHub access: {exc}')
        if (info.get('full_name') or '').casefold() != self.repo.casefold() or not info.get('can_push') or info.get('archived'):
            self.step('Check GitHub access', 'failed', f'{login} cannot push to {self.repo}', 1, step)
            raise Stop('blocked', f'The GitHub login {login or "(unknown)"} cannot push to {self.repo}.')
        self.step('Check GitHub access', 'completed', f'{login} can push to {info["full_name"]}', 0, step)
        if self.run['source']['issue']:
            self.verify_issue(self.run['source']['issue'])
        base = self.entry['base']
        if not self.remote_sha('refs/heads/' + base):
            raise Stop('blocked', f'{self.entry["remote"]} has no branch {base}.')
        branch = self.run['git']['branch']
        if self.remote_sha('refs/heads/' + branch) or self.git(['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch],
                                                               self.entry['checkout'], check=False).returncode == 0:
            raise Stop('blocked', f'Branch {branch} already exists; Reader never reuses or resets a branch.')
        self.emit('phase', phase='preflight', state='completed')

    def verify_issue(self, number):
        step = self.step(f'Check issue #{number}')
        try:
            issue = self.github.issue(self.repo, number)
        except GitHubError as exc:
            self.step(f'Check issue #{number}', 'failed', str(exc), 1, step)
            raise Stop('blocked', f'Issue #{number}: {exc}')
        if (issue.get('repository') or '').casefold() != self.repo.casefold() or issue.get('is_pull_request') or issue.get('number') != number:
            self.step(f'Check issue #{number}', 'failed', f'#{number} is not an issue in {self.repo}', 1, step)
            raise Stop('blocked', f'#{number} is not an issue in {self.repo}.')
        self.run['issue'] = {'number': number, 'url': issue['url'], 'state': issue['state'], 'created': False}
        self.step(f'Check issue #{number}', 'completed', f'{issue["url"]} ({issue["state"]})', 0, step)
        self.emit('github', action='issue_linked', number=number, url=issue['url'], state=issue['state'])

    def isolate(self):
        self.phase('worktree')
        remote, base, branch = self.entry['remote'], self.entry['base'], self.run['git']['branch']
        self.git_admin(['fetch', '--no-tags', '--no-write-fetch-head', remote, f'+refs/heads/{base}:refs/remotes/{remote}/{base}'],
                       f'Fetch {remote}/{base}')
        base_sha = self.git(['rev-parse', '--verify', f'refs/remotes/{remote}/{base}^{{commit}}'], self.entry['checkout']).stdout.strip()
        worktree = Path(self.entry['worktree_root']) / ('reader-' + self.run['id'])
        if os.path.lexists(worktree):
            raise Stop('blocked', 'The job’s worktree folder already exists; Reader never reuses an unknown worktree.')
        self.run['git'].update(base_sha=base_sha)
        self.git_admin(['worktree', 'add', '-b', branch, str(worktree), base_sha], f'Create worktree on {branch} from {base_sha[:12]}')
        self.run['git']['worktree'] = str(worktree)
        common = self.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], worktree).stdout.strip()
        self.run['git']['common_dir'] = common
        head = self.git(['rev-parse', 'HEAD'], worktree).stdout.strip()
        current = self.git(['symbolic-ref', '--short', 'HEAD'], worktree).stdout.strip()
        if head != base_sha or current != branch:
            raise Stop('failed', 'The new worktree is not on the pinned base commit and assigned branch.')
        self.jobs.store.save(self.run)
        self.emit('phase', phase='worktree', state='completed', detail=f'{branch} at {base_sha[:12]}')

    def agent(self):
        self.phase('agent', coding_agents.LABELS[self.run['agent']])
        run, worktree = self.run, Path(self.run['git']['worktree'])
        lock = self.entry['verify']['lock']
        job = {'repo': self.repo, 'branch': run['git']['branch'], 'base': self.entry['base'], 'base_sha': run['git']['base_sha'],
               'issue': (run.get('issue') or {}).get('number'), 'lock_store': lock['store'] if lock else None}
        system = coding_agents.brief(job)
        self.capture.write('system.txt', system)
        scratch = self.jobs.scratch(run['id'])
        stdin = scratch / 'stdin.txt'
        stdin.write_text(system + self.jobs.prompt_text(run))
        last = scratch / 'last-message.md'
        writable = [run['git']['common_dir'], *([lock['store']] if lock else [])]
        argv = coding_agents.argv(run['agent'], self.agent_path, self.entry['agent_modes'][run['agent']], worktree, writable, last)
        run['argv'] = self.private(' '.join(argv))
        stream = coding_agents.STREAMS[run['agent']]
        final = {'text': None}

        def on_line(text):
            line = text.strip()
            if not line.startswith('{'):
                return
            try:
                event = json.loads(line)
            except ValueError:
                return
            if not isinstance(event, dict):
                return
            if stream == 'claude' and event.get('type') == 'result' and isinstance(event.get('result'), str):
                final['text'] = event['result']
            self.emit('agent', stream=stream, event=event)
        with stdin.open('rb') as handle:
            state, code, error = self.supervise(argv, worktree, handle, dict(self.env, TMPDIR=str(scratch)), self.entry['agent_timeout_seconds'],
                                                'stdout.jsonl', 'stderr.log', on_line)
        if state == 'cancelled':
            raise Stop('cancelled', error)
        if state:
            raise Stop('failed', error)
        if code:
            raise Stop('failed', f'{coding_agents.LABELS[run["agent"]]} exited with status {code}.')
        message = last.read_text(errors='replace')[:coding_agents.MAX_REPORT * 2] if last.is_file() and not last.is_symlink() else final['text']
        if message:
            self.capture.write('last-message.md', message)
        result, problem = coding_agents.report(message)
        if problem:
            raise Stop('failed', problem)
        self.emit('phase', phase='agent', state='completed', detail=result['outcome'])
        return result

    def inspect_commits(self, expect_change):
        worktree = self.run['git']['worktree']
        base_sha, branch = self.run['git']['base_sha'], self.run['git']['branch']
        if self.git(['symbolic-ref', '--short', 'HEAD'], worktree, check=False).stdout.strip() != branch:
            raise Stop('failed', f'The worktree is no longer on {branch}.')
        if self.git(['status', '--porcelain', '--untracked-files=all'], worktree).stdout.strip():
            raise Stop('failed', 'The worktree has uncommitted changes; only committed, verified work is published.')
        head = self.git(['rev-parse', 'HEAD'], worktree).stdout.strip()
        if self.git(['merge-base', '--is-ancestor', base_sha, head], worktree, check=False).returncode:
            raise Stop('failed', 'The branch no longer descends from the pinned base commit.')
        log = self.git(['log', '--format=%H%x09%s', f'{base_sha}..{head}'], worktree).stdout.splitlines()
        commits = [{'sha': line.split('\t', 1)[0], 'subject': line.split('\t', 1)[-1][:300]} for line in log[:200]]
        changes = []
        for line in self.git(['diff', '--name-status', '--no-renames', f'{base_sha}..{head}'], worktree).stdout.splitlines()[:2000]:
            status, _, path = line.partition('\t')
            changes.append({'path': path, 'kind': 'add' if status == 'A' else 'delete' if status == 'D' else 'update'})
        self.run['git'].update(head_sha=head, commits=commits, changed_paths=[c['path'] for c in changes])
        self.jobs.store.save(self.run)
        if changes:
            self.emit('files', changes=changes)
        for commit in reversed(commits[:20]):
            self.emit('commit', sha=commit['sha'], subject=commit['subject'], branch=branch)
        if expect_change and not commits:
            raise Stop('failed', 'The agent reported a change but committed nothing.')
        if expect_change and not changes:
            raise Stop('failed', 'The agent’s commits change no files.')
        if not expect_change and commits:
            raise Stop('failed', 'The agent reported the finding already fixed but committed changes; nothing was published.')
        return head

    def supervise(self, argv, cwd, stdin, env, timeout, out_name, err_name, on_line=None):
        """Run one command in its own process group; every byte goes to the archive. (state, code, error).
        Without `err_name`, stderr is merged into stdout's artifact."""
        command = [sys.executable, '-I', '-c', SHIM, str(max(3600, timeout + 60)), *argv]
        failure = {'error': None}
        worker = subprocess.Popen(command, cwd=cwd, stdin=stdin, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE if err_name else subprocess.STDOUT, env=env, start_new_session=True)
        self.run['process'] = {'group': worker.pid, 'started': process_started(worker.pid), 'host': self.jobs.host}
        self.jobs.store.save(self.run)

        def pump(pipe, name, lines):
            try:
                for raw in iter(pipe.readline, b''):
                    self.capture.write(name, raw)
                    if lines:
                        lines(raw.decode('utf-8', 'replace'))
            except CaptureFailed as exc:
                failure['error'] = str(exc)
                kill_group(worker.pid)
            except Exception as exc:  # A failed event write or parse must stop the workload, not leave it unwatched.
                failure['error'] = f'Reader could not record the job’s output: {exc}'
                kill_group(worker.pid)
        readers = [threading.Thread(target=pump, args=(worker.stdout, out_name, on_line), daemon=True)]
        if err_name:  # Otherwise stderr is merged into stdout (verification output reads in order).
            readers.append(threading.Thread(target=pump, args=(worker.stderr, err_name, None), daemon=True))
        for reader in readers:
            reader.start()
        deadline, next_check, state, error = time.monotonic() + timeout, 0, None, None
        try:
            while worker.poll() is None:
                if failure['error']:
                    state, error = 'failed', failure['error']
                    break
                if self.cancelled():
                    state, error = 'cancelled', 'Stopped by you. The worktree and its changes are kept for inspection.'
                    break
                if time.monotonic() > deadline:
                    state, error = 'failed', f'Timed out after {timeout} s.'
                    break
                if self.jobs.limits and time.monotonic() >= next_check:
                    next_check = time.monotonic() + CHECK_EVERY
                    if not self.jobs.capacity(self.root) or not self.jobs.capacity(self.entry['worktree_root']):
                        state, error = 'failed', 'Free disk space fell below Reader’s reserve.'
                        break
                    if process_group_rss(worker.pid) > MAX_RSS:
                        state, error = 'failed', 'The job exceeded its 4 GiB process-group memory limit.'
                        break
                time.sleep(.1)
        except Exception as exc:  # A failed measurement stops the owned workload.
            state, error = 'failed', 'Resource check failed: ' + str(exc)[:300]
        finally:
            kill_group(worker.pid)
            worker.wait()
            for reader in readers:
                reader.join(timeout=5)
            self.run['process'] = None
            self.jobs.store.save(self.run)
        if failure['error'] and state != 'cancelled':
            state, error = 'failed', failure['error']
        return state, worker.returncode, error
