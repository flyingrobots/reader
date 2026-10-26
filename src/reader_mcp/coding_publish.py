"""Issue linkage, final verification and publication for a coding job (RW-44); see coding_workflow.

Publication is reconciled, never assumed: before pushing, Reader reads the remote branch; before
opening a pull request, it lists pull requests for the branch. A create request with no readable answer
is reconciled by the run's marker (issues) or branch (pull requests); if that cannot settle it, the run
ends `needs_reconciliation` rather than creating a second one. `pr_opened` requires the remote branch at
the verified head and a pull request read back with this repository, base, branch, head SHA and issue."""
import re
import subprocess
import time

from .coding_workflow import PUSH_TIMEOUT, TAIL, Stop, Workflow
from .github import GitHubError, Uncertain

PULL = re.compile(r'https://github\.com/([^/]+/[^/]+)/pull/(\d+)')


class Job(Workflow):
    def execute(self):
        self.preflight()
        self.isolate()
        result = self.agent()
        if result['outcome'] == 'blocked':
            self.inspect_commits(expect_change=False)
            raise Stop('blocked', 'The agent could not proceed: ' + (result['summary'] or 'no reason given') [:1000])
        if result['outcome'] == 'already_fixed':
            self.inspect_commits(expect_change=False)
            return self.already_fixed(result)
        head = self.inspect_commits(expect_change=True)
        self.track(result)
        self.verify(head)
        self.publish(result, head)
        return 'pr_opened', f'Pull request #{self.run["pr"]["number"]} is open: {self.run["pr"]["url"]}'

    def marker(self):
        return f'reader-run:{self.run["id"]}'

    def already_fixed(self, result):
        note = ''
        match = PULL.fullmatch(result['existing_pr'] or '')
        if match and match.group(1).casefold() == self.repo.casefold():
            try:
                pr = self.github.pull_request(self.repo, int(match.group(2)))
                if (pr.get('repository') or '').casefold() == self.repo.casefold():
                    self.run['existing_pr'] = {'number': pr['number'], 'url': pr['url'], 'state': pr['state'], 'merged': pr['merged']}
                    self.emit('github', action='existing_pull_request', number=pr['number'], url=pr['url'], state=pr['state'])
            except GitHubError as exc:
                note = f' The reported pull request could not be read back: {exc}'
        elif result['existing_pr']:
            note = ' The reported pull request is not in this repository and was not linked.'
        self.run['evidence'] = self.private(result['evidence'])[:16000]
        return 'already_fixed', ('The agent found the finding already fixed. ' + self.private(result['summary'])[:1000] + note).strip()

    def track(self, result):
        """Link the verified supplied issue, or create one from the confirmed task and read it back."""
        self.phase('issue')
        if self.run.get('issue'):
            return
        marker = self.marker()
        title = (result['issue_title'] or self.run['source']['title'])[:200]
        body = (self.private(result['issue_body'] or result['summary'])[:16000] +
                f'\n\n---\nOpened by Reader for a coding job started from an article prompt.\n<!-- {marker} -->\n')
        self.run['issue_pending'] = {'marker': marker}
        self.jobs.store.save(self.run)
        step = self.step(f'Create an issue in {self.repo}')
        try:
            issue = self.github.create_issue(self.repo, title, body)
        except Uncertain as exc:
            found = self.reconcile_issue(marker)
            if not found:
                self.step(f'Create an issue in {self.repo}', 'failed', str(exc), 1, step)
                raise Stop('needs_reconciliation', f'Issue creation may have succeeded without an answer ({exc}). '
                                                   f'Search {self.repo} for “{marker}” before rerunning.')
            issue = found
        except GitHubError as exc:
            self.step(f'Create an issue in {self.repo}', 'failed', str(exc), 1, step)
            raise Stop('failed', f'GitHub refused to create the issue: {exc}')
        try:
            read = self.github.issue(self.repo, issue['number'])
        except GitHubError as exc:
            raise Stop('needs_reconciliation', f'Issue #{issue.get("number")} was created but could not be read back: {exc}')
        if (read.get('repository') or '').casefold() != self.repo.casefold() or read.get('is_pull_request') or marker not in read.get('body', ''):
            raise Stop('needs_reconciliation', f'Issue #{issue.get("number")} does not read back as this job’s issue in {self.repo}.')
        self.run['issue'] = {'number': read['number'], 'url': read['url'], 'state': read['state'], 'created': True}
        self.run['issue_pending'] = None
        self.jobs.store.save(self.run)
        self.step(f'Create an issue in {self.repo}', 'completed', read['url'], 0, step)
        self.emit('github', action='issue_created', number=read['number'], url=read['url'], state=read['state'])

    def reconcile_issue(self, marker):
        try:
            found = [i for i in self.github.find_issues(self.repo, marker) if not i.get('is_pull_request')]
        except GitHubError:
            return None
        return found[0] if len(found) == 1 else None

    def verify(self, head):
        """The repository's configured final check, in the worktree, under its lock when one is configured."""
        self.phase('verify')
        verify = self.entry['verify']
        argv, env = list(verify['argv']), dict(self.env)
        lock = verify['lock']
        if lock:
            argv = [self.jobs.git_locks(), 'with', '--job', f'reader-coding-{self.run["id"]}', '--holder', 'reader-coding-job',
                    '--ttl', str(lock['ttl_seconds']), '--wait', str(lock['wait_seconds']), '--note',
                    f'Reader coding job {self.run["id"][:8]} verification', *lock['keys'], '--', *argv]
            env['GIT_LOCKS_STORE'] = lock['store']
        title = 'Verify: ' + ' '.join(verify['argv'])[:200]
        step = self.step(title)
        tail = {'text': '', 'sent': 0.0}

        def on_line(text):
            tail['text'] = (tail['text'] + text)[-TAIL:]
            if time.monotonic() - tail['sent'] >= 1:
                tail['sent'] = time.monotonic()
                self.step(title, 'running', tail['text'], None, step)
        self.run['verification'] = {'argv': self.private(' '.join(verify['argv'])), 'locked': bool(lock), 'exit_code': None}
        started = time.monotonic()
        state, code, error = self.supervise(argv, self.run['git']['worktree'], subprocess.DEVNULL, env, verify['timeout_seconds'],
                                            'verify.log', None, on_line)
        self.run['verification'].update(exit_code=code, seconds=round(time.monotonic() - started, 1))
        self.step(title, 'completed' if not state and code == 0 else 'failed', tail['text'], code, step)
        if state == 'cancelled':
            raise Stop('cancelled', error)
        if state:
            raise Stop('failed', 'Verification stopped: ' + error)
        if code:
            raise Stop('failed', f'Verification failed with exit status {code}; nothing was published.')
        if self.inspect_commits(expect_change=True) != head:
            raise Stop('failed', 'The branch head changed during verification; nothing was published.')
        self.emit('phase', phase='verify', state='completed', detail='passed')

    def publish(self, result, head):
        self.phase('push')
        remote, branch = self.entry['remote'], self.run['git']['branch']
        existing = self.remote_sha('refs/heads/' + branch)
        if existing and existing != head:
            raise Stop('needs_reconciliation', f'{remote}/{branch} already exists at {existing[:12]}, not the verified head {head[:12]}.')
        if not existing:
            self.run['push'] = {'sha': head, 'sent': True, 'verified': False}
            self.jobs.store.save(self.run)
            self.git(['push', '--porcelain', '--', remote, f'refs/heads/{branch}:refs/heads/{branch}'], title=f'Push {branch}',
                     timeout=PUSH_TIMEOUT, check=False)
            existing = self.remote_sha('refs/heads/' + branch)
        if existing != head:
            if existing:
                raise Stop('needs_reconciliation', f'{remote}/{branch} is at {existing[:12]}, not the verified head {head[:12]}.')
            raise Stop('failed', f'The push of {branch} did not reach {remote}.')
        self.run['push'] = {'sha': head, 'sent': True, 'verified': True}
        self.jobs.store.save(self.run)
        self.emit('github', action='branch_pushed', branch=branch, sha=head)
        self.phase('pull_request')
        pr = self.open_pull_request(result, head)
        self.run['pr'] = pr
        self.run['pr_pending'] = None
        self.jobs.store.save(self.run)
        self.emit('github', action='pull_request_opened', number=pr['number'], url=pr['url'], head_sha=pr['head_sha'])

    def matching(self, pulls, head):
        branch, base = self.run['git']['branch'], self.entry['base']
        return [p for p in pulls if p.get('head') == branch and (p.get('repository') or '').casefold() == self.repo.casefold()
                and p.get('base') == base and p.get('head_sha') == head]

    def open_pull_request(self, result, head):
        branch, issue = self.run['git']['branch'], self.run['issue']['number']
        try:
            pulls = self.github.pull_requests(self.repo, branch)
        except GitHubError as exc:
            raise Stop('failed', f'Could not list pull requests for {branch}: {exc}')
        if pulls:
            ours = self.matching(pulls, head)
            if len(ours) != 1 or len(pulls) != 1:
                raise Stop('needs_reconciliation', f'{branch} already has pull requests that Reader did not open as expected.')
            created = ours[0]
        else:
            title = (result['pr_title'] or self.run['source']['title'])[:200]
            body = (self.private(result['pr_body'] or result['summary'])[:32000] +
                    f'\n\nCloses #{issue}\n\n---\nOpened by Reader for a coding job; verified with the repository’s configured check before publishing.\n<!-- {self.marker()} -->\n')
            self.run['pr_pending'] = {'branch': branch}
            self.jobs.store.save(self.run)
            step = self.step(f'Open a pull request for {branch}')
            try:
                created = self.github.create_pull_request(self.repo, self.entry['base'], branch, title, body)
            except Uncertain as exc:
                try:
                    ours = self.matching(self.github.pull_requests(self.repo, branch), head)
                except GitHubError:
                    ours = []
                if len(ours) != 1:
                    self.step(f'Open a pull request for {branch}', 'failed', str(exc), 1, step)
                    raise Stop('needs_reconciliation', f'Opening the pull request may have succeeded without an answer ({exc}). '
                                                       f'Check {self.repo} for a pull request from {branch} before rerunning.')
                created = ours[0]
            except GitHubError as exc:
                self.step(f'Open a pull request for {branch}', 'failed', str(exc), 1, step)
                raise Stop('failed', f'GitHub refused the pull request: {exc}')
            self.step(f'Open a pull request for {branch}', 'completed', created.get('url') or '', 0, step)
        try:
            pr = self.github.pull_request(self.repo, created['number'])
        except GitHubError as exc:
            raise Stop('needs_reconciliation', f'Pull request #{created.get("number")} could not be read back: {exc}')
        if not self.matching([pr], head) or f'#{issue}' not in (pr.get('body') or '') or self.marker() not in (pr.get('body') or ''):
            raise Stop('needs_reconciliation', f'Pull request #{pr.get("number")} does not read back with this repository, base, '
                                               f'branch, head {head[:12]} and issue #{issue}.')
        return {'number': pr['number'], 'url': pr['url'], 'state': pr['state'], 'head_sha': pr['head_sha'], 'base': pr['base']}
