"""Reader's GitHub adapter for coding jobs (RW-44), through the GitHub CLI's authenticated `gh api`.

`GitHub` is the port the job workflow uses; `GhCli` implements it without a shell, with fixed REST
routes and JSON bodies on stdin. Tests use a fake with the same methods and never reach GitHub.

Creation is not assumed to be exactly-once. A request that may have reached GitHub without a readable
answer (a timeout, a dropped connection, a server error) raises `Uncertain`, never `GitHubError`, so the
workflow reconciles by marker or branch instead of creating another issue or pull request."""
import json
import re
import subprocess

from .voices import resolve_cli

TIMEOUT = 60
MAX_RESPONSE = 4 * 1024**2
STATUS = re.compile(r'\(HTTP (\d{3})\)')


class GitHubError(Exception):
    """GitHub answered and refused, or the request never left this machine."""


class Uncertain(GitHubError):
    """A write may or may not have taken effect; reconcile before doing anything else."""


def issue_view(data, repo):
    """The fields Reader keeps from a REST issue, with the repository it really belongs to."""
    url = str(data.get('html_url') or '')
    match = re.fullmatch(r'https://github\.com/([^/]+/[^/]+)/(?:issues|pull)/(\d+)', url)
    return {'number': data.get('number'), 'url': url, 'state': data.get('state'), 'title': str(data.get('title') or '')[:300],
            'repository': match.group(1) if match else None, 'is_pull_request': 'pull_request' in data or '/pull/' in url,
            'body': str(data.get('body') or '')[:65536]}


def pull_view(data):
    base, head = data.get('base') or {}, data.get('head') or {}
    return {'number': data.get('number'), 'url': data.get('html_url'), 'state': data.get('state'), 'title': str(data.get('title') or '')[:300],
            'repository': (base.get('repo') or {}).get('full_name'), 'base': base.get('ref'), 'head': head.get('ref'),
            'head_sha': head.get('sha'), 'head_repository': (head.get('repo') or {}).get('full_name'),
            'body': str(data.get('body') or '')[:65536], 'merged': bool(data.get('merged_at'))}


class GitHub:
    """The port. Every method raises GitHubError (or Uncertain for writes) instead of returning partial data."""

    def version(self): raise NotImplementedError
    def viewer(self): raise NotImplementedError
    def repository(self, repo): raise NotImplementedError
    def issue(self, repo, number): raise NotImplementedError
    def create_issue(self, repo, title, body): raise NotImplementedError
    def find_issues(self, repo, marker): raise NotImplementedError
    def pull_requests(self, repo, branch): raise NotImplementedError
    def pull_request(self, repo, number): raise NotImplementedError
    def create_pull_request(self, repo, base, branch, title, body): raise NotImplementedError


class GhCli(GitHub):
    def __init__(self, executable=None, environ=None, runner=subprocess.run):
        self.environ = environ
        self.executable = executable or resolve_cli('gh', environ)
        self.runner = runner

    def call(self, method, route, body=None, write=False):
        if not self.executable:
            raise GitHubError('The GitHub CLI (gh) is not installed')
        argv = [self.executable, 'api', '--method', method, '-H', 'Accept: application/vnd.github+json', route]
        if body is not None:
            argv += ['--input', '-']
        try:
            result = self.runner(argv, input=json.dumps(body) if body is not None else None, capture_output=True, text=True,
                                 timeout=TIMEOUT, env=self.environ)
        except subprocess.TimeoutExpired:
            if write:
                raise Uncertain(f'GitHub did not answer {method} {route} within {TIMEOUT} s; it may have taken effect')
            raise GitHubError(f'GitHub did not answer {method} {route} within {TIMEOUT} s')
        except OSError as exc:
            raise GitHubError(f'Could not run gh: {exc}')
        if result.returncode:
            message = (result.stderr or result.stdout or '').strip()[-600:]
            status = STATUS.search(message)
            code = int(status.group(1)) if status else None
            if write and (code is None or code >= 500):
                raise Uncertain(f'GitHub gave no clear answer to {method} {route}: {message or "no output"}')
            raise GitHubError(f'GitHub refused {method} {route}: {message or "no output"}')
        if len(result.stdout) > MAX_RESPONSE:
            if write:  # The write succeeded or may have; its answer is unreadable, so reconcile.
                raise Uncertain(f'GitHub answered {method} {route} with more than 4 MiB; it may have taken effect')
            raise GitHubError('GitHub response exceeds 4 MiB')
        try:
            return json.loads(result.stdout or 'null')
        except ValueError:
            if write:
                raise Uncertain(f'GitHub answered {method} {route} with unreadable output')
            raise GitHubError(f'GitHub answered {method} {route} with unreadable output')

    def version(self):
        if not self.executable:
            return None
        try:
            result = self.runner([self.executable, '--version'], capture_output=True, text=True, timeout=10, env=self.environ)
            return (result.stdout.splitlines() or [''])[0][:100] or None
        except (OSError, subprocess.TimeoutExpired):
            return None

    def viewer(self):
        data = self.call('GET', 'user')
        return {'login': (data or {}).get('login')}

    def repository(self, repo):
        data = self.call('GET', f'repos/{repo}') or {}
        return {'full_name': data.get('full_name'), 'default_branch': data.get('default_branch'),
                'can_push': bool((data.get('permissions') or {}).get('push')), 'archived': bool(data.get('archived'))}

    def issue(self, repo, number):
        return issue_view(self.call('GET', f'repos/{repo}/issues/{int(number)}') or {}, repo)

    def create_issue(self, repo, title, body):
        return issue_view(self.call('POST', f'repos/{repo}/issues', {'title': title, 'body': body}, write=True) or {}, repo)

    def find_issues(self, repo, marker):
        query = f'repo:{repo} in:body "{marker}"'
        data = self.call('GET', 'search/issues?per_page=10&q=' + _quote(query)) or {}
        return [issue_view(item, repo) for item in data.get('items') or [] if marker in str(item.get('body') or '')]

    def pull_requests(self, repo, branch):
        owner = repo.split('/')[0]
        data = self.call('GET', f'repos/{repo}/pulls?state=all&per_page=10&head={_quote(owner + ":" + branch)}') or []
        return [pull_view(item) for item in data]

    def pull_request(self, repo, number):
        return pull_view(self.call('GET', f'repos/{repo}/pulls/{int(number)}') or {})

    def create_pull_request(self, repo, base, branch, title, body):
        return pull_view(self.call('POST', f'repos/{repo}/pulls', {'title': title, 'body': body, 'base': base, 'head': branch,
                                                                    'maintainer_can_modify': False}, write=True) or {})


def _quote(text):
    from urllib.parse import quote
    return quote(text, safe='')
