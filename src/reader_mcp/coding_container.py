"""Coding-job workflow with development operations inside a managed devcontainer.

Issue/PR operations reuse the existing reconciled GitHub adapter. Source clone, Git inspection,
agent and verification commands execute only inside the labelled persistent Docker workspace.
"""
import json
from pathlib import PurePosixPath
import shutil
import subprocess

from . import coding_agents
from .coding_publish import Job
from .coding_workflow import GIT_TIMEOUT, MAX_LINE, Stop, process_started
from .container_process import ProcessError
from .container_runtime import ContainerRuntime
from .devcontainer_config import ConfigurationError, infer, select
from .github import GitHubError


class ContainerJob(Job):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.runtime = None
        self.env = {'GIT_TERMINAL_PROMPT': '0'}
        self.workspace = '/work/jobs/' + self.run['id']
        self.scratch = '/work/runtime/' + self.run['id']

    def execute(self):
        try:
            return super().execute()
        except ProcessError as exc:
            raise Stop('cancelled' if self.cancelled() else 'failed', self.private(getattr(self.runtime, 'error', None) or str(exc))) from exc
        finally:
            if self.runtime:
                try:
                    self.runtime.close()
                    if self.run.get('container'):
                        self.run['container']['state'] = 'stopped'
                        self.jobs.store.save(self.run)
                except Exception as exc:
                    raise Stop('needs_reconciliation', 'Container shutdown could not be confirmed. The workspace is retained: ' + self.private(str(exc))) from exc

    def check_cancel(self):
        super().check_cancel()
        if self.runtime:
            self.runtime.check()

    def preflight(self):
        self.phase('preflight')
        env = self.entry.get('environment')
        if not env or env.get('kind') != 'devcontainer':
            raise Stop('blocked', 'This repository still uses a host checkout. Reconfigure it for a devcontainer in Reader Admin; no host fallback is available.')
        if self.run['agent'] not in self.entry['agents']:
            raise Stop('blocked', 'This repository does not allow the selected agent.')
        if not self.jobs.capacity(self.root):
            raise Stop('blocked', 'Free disk space is below Reader’s archive reserve.')
        try:
            login, repository = self.github.viewer(), self.github.repository(self.repo)
            if ((repository.get('full_name') or '').casefold() != self.repo.casefold()
                    or not repository.get('can_push') or repository.get('archived')):
                raise Stop('blocked', 'The GitHub login cannot publish to this repository.')
            if env['inferred']:
                inferred = infer(self.github, self.repo, env['revision'], env['consent'])
                if inferred['configuration'] != env['configuration'] or inferred['sha256'] != env['sha256']:
                    raise Stop('blocked', 'The inferred configuration no longer matches its approved missing-configuration inventory.')
            else:
                selected = select(self.github, self.repo, env['revision'], env['path'])
                if (selected['sha256'] != env['sha256'] or selected['blob_sha'] != env['blob_sha']
                        or selected['configuration'] != env['configuration']):
                    raise Stop('blocked', 'The approved configuration does not match its pinned GitHub source.')
        except (GitHubError, ConfigurationError) as exc:
            raise Stop('blocked', 'GitHub configuration check failed: ' + str(exc)) from exc
        if self.run['source']['issue']:
            self.verify_issue(self.run['source']['issue'])
        docker = shutil.which('docker', path=(self.jobs.environ or {}).get('PATH'))
        cli = shutil.which('devcontainer', path=(self.jobs.environ or {}).get('PATH'))
        locks = self.jobs.git_locks()
        if not docker or not cli or not locks:
            raise Stop('blocked', 'Docker, the Dev Container CLI and git-locks are required; the job will not run on the host.')
        def record(data):
            self.run['container'] = dict(self.run.get('container') or {}, **data)
            self.jobs.store.save(self.run)
            if data.get('launch_contract'):
                self.emit('runtime', state='preparing', contract=data['launch_contract'])
        factory = getattr(self.jobs, 'runtime_factory', ContainerRuntime)
        self.runtime = factory(self.root, self.repo, self.run['id'], docker=docker, devcontainer=cli,
            lock_tool=locks, lock_store=env['lock_store'], seconds=env['timeout_seconds'], record=record,
            cancelled=self.cancelled, output=lambda channel, data: self.capture.write('stderr.log', data))
        self.runtime.prepare(env['configuration'], env['image_id'])
        self.run['tools'] = {'gh': self.github.version(), 'git': self.command(['git', '--version']).stdout.strip(),
                             'runtime': 'devcontainer', 'image': env['image_id']}
        if self.remote_sha('refs/heads/' + self.entry['base']) != env['revision']:
            raise Stop('blocked', 'The base branch changed after configuration approval. Refresh repository setup before running.')
        if self.remote_sha('refs/heads/' + self.run['git']['branch']):
            raise Stop('blocked', 'The assigned remote branch already exists; it will not be reused.')
        self.emit('phase', phase='preflight', state='completed')

    def command(self, argv, cwd='/work', timeout=GIT_TIMEOUT, check=True, **options):
        return self.runtime.command(argv, cwd=cwd, timeout=timeout, check=check, **options)

    def git(self, args, cwd=None, title=None, timeout=GIT_TIMEOUT, check=True):
        step = self.step(title) if title else None
        args = list(args)
        if args and args[0] == 'push':
            separator = args.index('--')
            if args[separator + 1] != 'origin':
                raise Stop('failed', 'Unexpected publication remote')
            args[separator + 1] = 'https://github.com/' + self.repo + '.git'
        result = self.command(['git', *args], cwd=cwd or self.run['git'].get('worktree') or '/work', timeout=timeout, check=False)
        output = result.stdout + result.stderr
        self.capture.write('git.log', '$ git ' + ' '.join(args) + '\n' + output + '\n')
        if step:
            self.step(title, 'completed' if result.returncode == 0 else 'failed', output, result.returncode, step)
        if check and result.returncode:
            raise Stop('failed', 'Container git ' + args[0] + ' failed: ' + self.private(output)[-400:])
        return result

    def remote_sha(self, ref):
        # Use the server-derived URL, not a remote the agent could reconfigure.
        result = self.git(['ls-remote', '--', 'https://github.com/' + self.repo + '.git', ref], cwd='/work', check=False)
        if result.returncode:
            raise Stop('blocked', 'Container Git cannot read the remote. Sign in inside the container; host credentials are not copied.')
        rows = [line.split('\t') for line in result.stdout.splitlines() if '\t' in line]
        return next((sha for sha, name in rows if name == ref), None)

    def isolate(self):
        self.phase('worktree')
        self.command(['/usr/bin/python3', '-I', '-S', '-c',
            'import os,sys;assert os.path.isdir(sys.argv[1]) and not os.listdir(sys.argv[1]),"Job workspace is not empty"', self.workspace])
        self.git(['clone', '--no-checkout', '--no-hardlinks', '--filter=blob:none', '--single-branch', '--branch', self.entry['base'],
                  '--', 'https://github.com/' + self.repo + '.git', self.workspace], cwd='/work', title='Clone inside devcontainer')
        base = self.entry['environment']['revision']
        if self.git(['rev-parse', 'refs/remotes/origin/' + self.entry['base']], self.workspace).stdout.strip() != base:
            raise Stop('blocked', 'The base changed during clone; no agent was started.')
        self.git(['checkout', '-b', self.run['git']['branch'], base], self.workspace, title='Create the pinned job branch')
        self.run['git'].update(worktree=self.workspace, common_dir=self.workspace + '/.git', base_sha=base)
        self.jobs.store.save(self.run)
        self.runtime.lifecycle()
        self.agent_path = self.resolve(self.entry['executables'].get(self.run['agent'], self.run['agent']))
        self.verify_argv()
        self.run['tools']['agent'] = self.command([self.agent_path, '--version'], self.workspace).stdout.strip()[:100]
        status = [self.agent_path, 'login', 'status'] if self.run['agent'] == 'codex' else [self.agent_path, 'auth', 'status']
        if self.command(status, self.workspace, check=False).returncode:
            raise Stop('blocked', 'The selected coding agent is not signed in inside the container. Complete container sign-in first.')
        self.jobs.store.save(self.run)
        self.emit('phase', phase='worktree', state='completed')

    def resolve(self, name):
        result = self.command(['/usr/bin/python3', '-I', '-S', '-c',
            'import os,shutil,sys;p=shutil.which(sys.argv[1]);sys.exit(1) if p is None else print(os.path.abspath(p))', name],
            cwd=self.workspace, check=False)
        path = result.stdout.strip()
        if result.returncode or not path.startswith('/') or '\n' in path:
            raise Stop('blocked', name + ' is not installed inside the container. Prepare its tooling; no host executable is used.')
        return path

    def verify_argv(self):
        argv = list(self.entry['verify']['argv'])
        argv[0] = self.resolve(argv[0])
        return argv

    def supervise(self, argv, cwd, stdin, env, timeout, out_name, err_name, on_line=None):
        pending = bytearray()
        def output(channel, data):
            self.capture.write(out_name if channel == 'stdout' or not err_name else err_name, data)
            if on_line and (channel == 'stdout' or not err_name):
                pending.extend(data)
                while b'\n' in pending:
                    line, _, rest = pending.partition(b'\n');pending[:] = rest
                    on_line((line + b'\n').decode('utf-8', 'replace'))
                if len(pending) > MAX_LINE:
                    pending.clear()
        def started(pid):
            self.run['process'] = {'group': pid, 'started': process_started(pid), 'host': self.jobs.host}
            self.jobs.store.save(self.run)
        def finished(pid):
            self.run['process'] = None
            self.jobs.store.save(self.run)
        try:
            result = self.command(argv, cwd=str(cwd), timeout=timeout, check=False,
                stdin=None if stdin == subprocess.DEVNULL else stdin, output=output, started=started, finished=finished,
                limit=64 * 1024**2, capture_limit=0)
            self.check_cancel()
            if pending and on_line:
                on_line(pending.decode('utf-8', 'replace'))
            return None, result.returncode, None
        except ProcessError as exc:
            self.runtime.stop()
            return 'cancelled' if self.cancelled() else 'failed', None, getattr(self.runtime, 'error', None) or str(exc)

    def agent(self):
        self.phase('agent', coding_agents.LABELS[self.run['agent']])
        brief = coding_agents.brief({'repo': self.repo, 'branch': self.run['git']['branch'], 'base': self.entry['base'],
            'base_sha': self.run['git']['base_sha'], 'issue': (self.run.get('issue') or {}).get('number'), 'lock_store': None})
        brief += '\nThis job runs inside a managed devcontainer. Reader owns its host resource lease and guards. Host source, host credentials and the Docker socket are unavailable. If the project requires capabilities that are not available here, report blocked instead of using a host fallback.\n'
        self.capture.write('system.txt', brief)
        prompt = self.jobs.scratch(self.run['id']) / 'stdin.txt'
        prompt.write_text(brief + self.jobs.prompt_text(self.run))
        last = self.scratch + '/last-message.md'
        argv = coding_agents.argv(self.run['agent'], self.agent_path, self.entry['agent_modes'][self.run['agent']],
            PurePosixPath(self.workspace), [self.workspace + '/.git', self.scratch], PurePosixPath(last))
        self.run['argv'] = self.private(' '.join(argv))
        final = {'text': None}
        def line(text):
            try:event = json.loads(text)
            except ValueError:return
            if not isinstance(event, dict):return
            if self.run['agent'] == 'claude' and event.get('type') == 'result' and isinstance(event.get('result'), str):
                final['text'] = event['result']
            self.emit('agent', stream=coding_agents.STREAMS[self.run['agent']], event=event)
        with prompt.open('rb') as handle:
            state, code, error = self.supervise(argv, self.workspace, handle, {}, self.entry['agent_timeout_seconds'],
                                                'stdout.jsonl', 'stderr.log', line)
        if state:raise Stop(state, error)
        if code:raise Stop('failed', 'The container agent exited with status ' + str(code))
        if self.run['agent'] == 'codex':
            result = self.command(['/usr/bin/python3', '-I', '-S', '-c',
                'import sys;from pathlib import Path;p=Path(sys.argv[1]);assert not p.is_symlink();print(p.open("rb").read(131072).decode("utf-8","replace") if p.is_file() else "",end="")', last])
            message = result.stdout
        else:message = final['text']
        if message:self.capture.write('last-message.md', message)
        result, problem = coding_agents.report(message)
        if problem:raise Stop('failed', problem)
        self.emit('phase', phase='agent', state='completed', detail=result['outcome'])
        return result

    def publish(self, result, head):
        url = self.git(['config', '--get', 'remote.origin.url']).stdout.strip()
        push = self.git(['config', '--get-all', 'remote.origin.pushurl'], check=False).stdout.strip() or url
        expected = 'https://github.com/' + self.repo + '.git'
        if url != expected or push != expected:
            raise Stop('failed', 'The agent changed the publication remote; nothing was pushed.')
        return super().publish(result, head)
