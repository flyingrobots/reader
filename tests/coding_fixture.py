"""A real Git fixture for coding-job tests (RW-44): a bare "remote", a dirty user checkout, a worktree root,
a vault with an article prompt, a fake coding CLI, a fake verification command and a fake GitHub.

Everything lives under the test's tmp_path (inside the bounded Docker worker's tmpfs when run by
scripts/check_container.py). The checkout's remote is `https://github.com/acme/widget.git`, rewritten by a
repo-local `url.<bare>.insteadOf` rule, so identity checks see GitHub while every fetch and push stays on disk."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time

from fake_github import FakeGitHub
from reader_mcp.coding_api import CodingJobs

HERE = Path(__file__).resolve().parent
REPO = 'acme/widget'
URL = 'https://github.com/acme/widget.git'
IDENTITY = {'GIT_AUTHOR_NAME': 'Fixture', 'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
            'GIT_COMMITTER_NAME': 'Fixture', 'GIT_COMMITTER_EMAIL': 'fixture@example.invalid'}
PROMPT = ('Check issue #277 before changing anything. A synthetic audit reports that deeply nested input aborts the parser.\n'
          'If it is already fixed, report the evidence. Otherwise add a regression and bound the depth.\n')


def article(issue=277, block_id='bound-parser-depth', repo=REPO, prompt=PROMPT):
    meta = json.dumps({'v': 1, 'id': block_id, 'title': 'Bound parser depth', 'repo': repo, 'issue': issue}, separators=(',', ':'))
    return (f'---\ntitle: A synthetic audit\n---\n\n# A synthetic audit\n\nThe parser aborts on deep input.\n\n'
            f'<!-- reader:prompt {meta} -->\n\n```text\n{prompt}```\n\n<!-- /reader:prompt -->\n\n'
            '````markdown\n<!-- reader:prompt {"v":1,"id":"example","title":"Example","repo":"acme/widget","issue":null} -->\n'
            '```text\nAn example inside a fence never runs.\n```\n<!-- /reader:prompt -->\n````\n')


def git(*args, cwd, check=True):
    result = subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True, env=dict(os.environ, **IDENTITY))
    if check and result.returncode:
        raise AssertionError(f'git {args}: {result.stderr}')
    return result.stdout.strip()


def script(path, body):
    path.write_text(f'#!/bin/sh\nexec {sys.executable} {body} "$@"\n')
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def snapshot(folder):
    """Bytes of every working-tree file (not .git), plus status, HEAD, the staged index and local branches."""
    files = {}
    for path in sorted(Path(folder).rglob('*')):
        if '.git' in path.relative_to(folder).parts or not path.is_file():
            continue
        files[str(path.relative_to(folder))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {'files': files, 'status': git('status', '--porcelain', '--untracked-files=all', cwd=folder),
            'head': git('rev-parse', 'HEAD', cwd=folder), 'branch': git('symbolic-ref', '--short', 'HEAD', cwd=folder),
            'index': git('ls-files', '--stage', cwd=folder), 'staged': git('diff', '--cached', cwd=folder),
            'branches': git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', cwd=folder)}


class World:
    def __init__(self, tmp, issue=277, entry=None, scenario=None, verify_exit=0, git_locks=False, capacity=None, limits=False, vault=None):
        self.tmp = Path(tmp)
        self.bare = self.tmp / 'remote.git'
        git('init', '-q', '--bare', '-b', 'main', str(self.bare), cwd=self.tmp)
        seed = self.tmp / 'seed'
        git('clone', '-q', str(self.bare), str(seed), cwd=self.tmp)
        git('checkout', '-q', '-b', 'main', cwd=seed)
        (seed / 'README.md').write_text('# widget\n')
        (seed / 'src').mkdir()
        (seed / 'src/parser.txt').write_text('recursive descent\n')
        git('add', '.', cwd=seed)
        git('commit', '-q', '-m', 'Initial', cwd=seed)
        git('push', '-q', 'origin', 'main', cwd=seed)
        self.base_sha = git('rev-parse', 'HEAD', cwd=seed)
        self.checkout = self.tmp / 'checkout'
        git('clone', '-q', str(self.bare), str(self.checkout), cwd=self.tmp)
        git('remote', 'set-url', 'origin', URL, cwd=self.checkout)
        git('config', f'url.{self.bare}.insteadOf', URL, cwd=self.checkout)
        git('config', 'user.name', 'Fixture', cwd=self.checkout)
        git('config', 'user.email', 'fixture@example.invalid', cwd=self.checkout)
        # The user's own unfinished work: modified, staged and untracked files that must stay byte-identical.
        (self.checkout / 'README.md').write_text('# widget\n\nLocal notes, not committed.\n')
        (self.checkout / 'src/parser.txt').write_text('recursive descent, staged edit\n')
        git('add', 'src/parser.txt', cwd=self.checkout)
        (self.checkout / 'scratch.txt').write_text('untracked\n')
        self.worktrees = self.tmp / 'worktrees'
        self.worktrees.mkdir()
        self.vault = Path(vault) if vault else self.tmp / 'vault'
        (self.vault / 'library').mkdir(parents=True, exist_ok=True)
        (self.vault / 'inbox').mkdir(exist_ok=True)
        self.doc = 'library/audit.md'
        (self.vault / self.doc).write_text(article(issue))
        self.record = self.tmp / 'agent-calls.jsonl'
        self.scenario_file = self.tmp / 'scenario.json'
        self.scenario(**(scenario or {}))
        self.agent = script(self.tmp / 'fake-codex', str(HERE / 'fake_coding_cli.py'))
        self.verify_record = self.tmp / 'verify-calls.jsonl'
        (self.tmp / 'verify.py').write_text(
            'import json,os,subprocess,sys\n'
            f'open({str(self.verify_record)!r},"a").write(json.dumps({{"cwd":os.getcwd(),"argv":sys.argv[1:],"store":os.environ.get("GIT_LOCKS_STORE")}})+"\\n")\n'
            'print("collected 3 items"); print("3 passed in 0.10s" if not int(sys.argv[1]) else "1 failed, 2 passed in 0.10s")\n'
            'if len(sys.argv) > 2: subprocess.run(["git","commit","-q","--allow-empty","-m","verification moved head"])\n'
            'sys.exit(int(sys.argv[1]))\n')
        self.entry = {'checkout': str(self.checkout), 'remote': 'origin', 'base': 'main', 'worktree_root': str(self.worktrees),
                      'agents': ['codex', 'claude'], 'executables': {'codex': str(self.agent), 'claude': str(self.agent)},
                      'agent_timeout_seconds': 120, 'verify': {'argv': [sys.executable, str(self.tmp / 'verify.py'), str(verify_exit)], 'timeout_seconds': 120}}
        self.entry.update(entry or {})
        self.write_registry()
        self.before = snapshot(self.checkout)
        self.github = FakeGitHub(REPO, self.bare)
        self.environ = dict(os.environ, FAKE_CODING_SCENARIO=str(self.scenario_file), **IDENTITY)
        self.jobs = self.make(git_locks=git_locks, capacity=capacity, limits=limits) if not vault else None

    def make(self, **options):
        defaults = {'git_locks': False, 'capacity': None, 'limits': False}
        defaults.update(options)
        return CodingJobs(self.vault, self.articles, github=self.github, environ=self.environ, git_locks=defaults['git_locks'],
                          limits=defaults['limits'], capacity=defaults['capacity'] or (lambda path: True))

    def write_registry(self):
        (self.vault / '.reader').mkdir(exist_ok=True)
        (self.vault / '.reader/repositories.json').write_text(json.dumps({'schema_version': 1, 'repositories': {REPO: self.entry}}))

    def scenario(self, **values):
        self.scenario_file.write_text(json.dumps({'record': str(self.record), **values}))

    def articles(self, path):
        data = (self.vault / path).read_bytes()
        return data.decode(), hashlib.sha256(data).hexdigest()

    def sha(self):
        return self.articles(self.doc)[1]

    def request(self, **overrides):
        import uuid
        from reader_mcp import prompt_blocks
        block = prompt_blocks.find(self.articles(self.doc)[0], 'bound-parser-depth')
        request = {'action': 'submit', 'request_id': str(uuid.uuid4()), 'path': self.doc, 'sha256': self.sha(),
                   'block_id': 'bound-parser-depth', 'prompt': block['prompt'] if block else PROMPT, 'agent': 'codex'}
        request.update(overrides)
        return request

    def run(self, timeout=60, **overrides):
        """Submit and wait for the run to finish; returns (run record, view at admission)."""
        admitted = self.jobs.dispatch(self.request(**overrides))
        return self.wait(admitted['id'], timeout), admitted

    def wait(self, run_id, timeout=60, jobs=None):
        jobs = jobs or self.jobs
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            run = jobs.store.load(run_id)
            if run and run.get('status') == 'finished':
                return run
            time.sleep(0.05)
        raise AssertionError(f'Run {run_id} did not finish: {jobs.store.load(run_id)}')

    def calls(self):
        return [json.loads(line) for line in self.record.read_text().splitlines()] if self.record.exists() else []

    def remote_heads(self):
        out = git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', cwd=self.bare)
        return {ref: sha for ref, sha in (line.split(' ') for line in out.splitlines())} if out else {}

    def events(self, run_id):
        page, rows, after = None, [], 0
        while page is None or page['more']:
            page = self.jobs.events(run_id, after)
            rows += page['events']
            after = page['next']
        return rows

    def options(self):
        """WebLibrary(coding_options=…) for a server that runs this fixture's jobs."""
        return {'github': self.github, 'environ': self.environ, 'git_locks': False, 'limits': False, 'capacity': lambda path: True}

    def close(self):
        if self.jobs:
            self.jobs.close()
