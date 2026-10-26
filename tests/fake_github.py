"""An in-memory GitHub for coding-job tests (RW-44). It never touches the network.

Pull requests read their head SHA from the fixture's local bare repository, standing in for the remote.
`fail` injects failures per method: an exception instance to raise before anything happens, or one of
the strings 'lost-ack' (the write takes effect, then the answer is lost: `Uncertain`) and 'no-effect'
(`Uncertain` without an effect). `lag` makes issue search miss everything, like a stale search index."""
import subprocess

from reader_mcp.github import GitHub, GitHubError, Uncertain


class FakeGitHub(GitHub):
    def __init__(self, repo='acme/widget', bare=None, login='reader-bot', can_push=True):
        self.repo, self.bare, self.login, self.can_push = repo, bare, login, can_push
        self.issues = {1: {'number': 1, 'title': 'Existing', 'body': 'An existing issue', 'state': 'open', 'repo': repo, 'pull': False},
                       277: {'number': 277, 'title': 'Parser depth', 'body': 'Synthetic finding', 'state': 'open', 'repo': repo, 'pull': False},
                       5: {'number': 5, 'title': 'A pull request', 'body': '', 'state': 'open', 'repo': repo, 'pull': True}}
        self.pulls = {}
        self.calls = []
        self.fail = {}
        self.lag = False
        self.wrong_head = False
        self.next = 300

    def _check(self, name):
        self.calls.append(name)
        failure = self.fail.get(name)
        if isinstance(failure, Exception):
            raise failure
        if failure == 'no-effect':
            raise Uncertain(f'{name}: the connection dropped before GitHub answered')
        return failure

    def _url(self, kind, number):
        return f'https://github.com/{self.repo}/{kind}/{number}'

    def _issue(self, item):
        return {'number': item['number'], 'url': self._url('pull' if item['pull'] else 'issues', item['number']), 'state': item['state'],
                'title': item['title'], 'repository': item['repo'], 'is_pull_request': item['pull'], 'body': item['body']}

    def _pull(self, item):
        head = item['head_sha'] if not self.wrong_head else '0' * 40
        return {'number': item['number'], 'url': self._url('pull', item['number']), 'state': 'open', 'title': item['title'],
                'repository': self.repo, 'base': item['base'], 'head': item['head'], 'head_sha': head,
                'head_repository': self.repo, 'body': item['body'], 'merged': False}

    def version(self):
        return 'gh version 0.0.0-fake'

    def viewer(self):
        self._check('viewer')
        return {'login': self.login}

    def repository(self, repo):
        self._check('repository')
        if repo.casefold() != self.repo.casefold():
            raise GitHubError('GitHub refused GET repos: Not Found (HTTP 404)')
        return {'full_name': self.repo, 'default_branch': 'main', 'can_push': self.can_push, 'archived': False}

    def issue(self, repo, number):
        self._check('issue')
        item = self.issues.get(number)
        if not item or repo.casefold() != self.repo.casefold():
            raise GitHubError('Not Found (HTTP 404)')
        return self._issue(item)

    def create_issue(self, repo, title, body):
        mode = self._check('create_issue')
        number = self.next
        self.next += 1
        self.issues[number] = {'number': number, 'title': title, 'body': body, 'state': 'open', 'repo': self.repo, 'pull': False}
        if mode == 'lost-ack':
            raise Uncertain('create_issue: the answer was lost')
        return self._issue(self.issues[number])

    def find_issues(self, repo, marker):
        self._check('find_issues')
        if self.lag:
            return []
        return [self._issue(i) for i in self.issues.values() if marker in i['body'] and not i['pull']]

    def head(self, branch):
        if not self.bare:
            return None
        result = subprocess.run(['git', 'rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], cwd=self.bare, capture_output=True, text=True)
        return result.stdout.strip() or None

    def pull_requests(self, repo, branch):
        self._check('pull_requests')
        return [self._pull(p) for p in self.pulls.values() if p['head'] == branch]

    def pull_request(self, repo, number):
        self._check('pull_request')
        if number not in self.pulls:
            raise GitHubError('Not Found (HTTP 404)')
        return self._pull(self.pulls[number])

    def create_pull_request(self, repo, base, branch, title, body):
        mode = self._check('create_pull_request')
        head = self.head(branch)
        if not head:
            raise GitHubError('Validation Failed: head branch does not exist (HTTP 422)')
        number = self.next
        self.next += 1
        self.pulls[number] = {'number': number, 'title': title, 'body': body, 'base': base, 'head': branch, 'head_sha': head}
        if mode == 'lost-ack':
            raise Uncertain('create_pull_request: the answer was lost')
        return self._pull(self.pulls[number])
