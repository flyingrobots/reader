"""Server-local repository registry for coding jobs (RW-44): `<vault>/.reader/repositories.json`.

An article names only a GitHub `owner/repository`. Everything a job needs to act on it is local Reader
configuration, never article metadata: the validated checkout, the publication remote, the base branch,
the folder new worktrees go in, which coding agents may run, and the verification command that must pass
before Reader publishes. One entry per repository name, so a job never picks whichever folder happens to
share a basename. No credential is stored here; GitHub access comes from the `gh` login.

    {"schema_version": 1, "repositories": {"owner/name": {
        "checkout": "/abs/checkout", "remote": "origin", "base": "main", "worktree_root": "/abs/worktrees",
        "agents": ["codex", "claude"], "executables": {"codex": "/abs/codex"},
        "agent_modes": {"claude": "acceptEdits"}, "agent_timeout_seconds": 3600,
        "verify": {"argv": ["python3", "scripts/check_container.py", "python"], "timeout_seconds": 1800,
                   "lock": {"store": "/abs/git-locks/store.git", "keys": ["host/heavy-work"],
                            "ttl_seconds": 2700, "wait_seconds": 1800}}}}}

`verify` is required: Reader runs exactly that argv (no shell) in the job's worktree as the final check, so
it must be the project's guarded runner when the project requires one. With `lock`, the argv runs inside
`git locks with` for those keys; without git-locks installed the job is blocked rather than run unguarded."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading

from .display import shown
from .prompt_blocks import repository_name

FILE = '.reader/repositories.json'
MAX_FILE = 256 * 1024
MAX_REPOSITORIES = 64
AGENTS = ('codex', 'claude')
MODES = {'codex': ('workspace-write', 'danger-full-access'), 'claude': ('acceptEdits', 'bypassPermissions')}
REMOTE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
LOCK_KEY = re.compile(r'[A-Za-z0-9._][A-Za-z0-9._/-]{0,199}')
GITHUB_URL = re.compile(r'(?:https://(?:[^@/]+@)?github\.com/|(?:ssh://)?git@github\.com[:/])'
                        r'([A-Za-z0-9-]+)/([A-Za-z0-9._-]+?)(?:\.git)?/?', re.I)
ENTRY_FIELDS = {'checkout', 'remote', 'base', 'worktree_root', 'agents', 'executables', 'agent_modes',
                'agent_timeout_seconds', 'verify'}


class RegistryError(ValueError):
    """The registry file or an entry is invalid; the message says how."""


def github_identity(url):
    """`owner/name` for a github.com remote URL, else None."""
    match = GITHUB_URL.fullmatch(url.strip()) if isinstance(url, str) else None
    return f'{match.group(1)}/{match.group(2)}' if match else None


def git(args, cwd, timeout=20):
    return subprocess.run([shutil.which('git') or 'git', *args], cwd=cwd, capture_output=True, text=True,
                          timeout=timeout, stdin=subprocess.DEVNULL)


def _absolute_dir(value, label):
    if not isinstance(value, str) or not os.path.isabs(value) or '\x00' in value:
        raise RegistryError(f'{label} must be an absolute path')
    path = Path(value)
    if not path.is_dir():
        raise RegistryError(f'{label} must be an existing folder')
    return str(path.resolve(strict=True))


def _seconds(value, default, low, high, label):
    value = default if value is None else value
    if type(value) is not int or not low <= value <= high:
        raise RegistryError(f'{label} must be a whole number of seconds from {low} to {high}')
    return value


def validate(repo, raw, vault):
    """A normalized entry, or RegistryError. Checks shapes and local folders; `inspect` checks Git."""
    if not repository_name(repo):
        raise RegistryError('Repository names are GitHub owner/repository')
    if not isinstance(raw, dict) or set(raw) - ENTRY_FIELDS:
        raise RegistryError(f'{repo}: unknown registry fields: ' + ', '.join(sorted(set(raw) - ENTRY_FIELDS)) if isinstance(raw, dict) else f'{repo}: expected an object')
    vault = Path(vault).resolve()
    checkout = _absolute_dir(raw.get('checkout'), f'{repo}: checkout')
    worktrees = _absolute_dir(raw.get('worktree_root'), f'{repo}: worktree_root')
    for label, path in (('checkout', checkout), ('worktree_root', worktrees)):
        if Path(path) == vault or Path(path).is_relative_to(vault) or vault.is_relative_to(Path(path)):
            raise RegistryError(f'{repo}: {label} must be outside the Reader vault')
    if Path(worktrees).is_relative_to(Path(checkout)):
        raise RegistryError(f'{repo}: worktree_root must be outside the checkout, so worktrees never dirty it')
    remote = raw.get('remote', 'origin')
    if not isinstance(remote, str) or not REMOTE.fullmatch(remote):
        raise RegistryError(f'{repo}: remote must be a Git remote name')
    base = raw.get('base')
    if not isinstance(base, str) or not base or len(base) > 200 or git(['check-ref-format', '--branch', base], checkout).returncode:
        raise RegistryError(f'{repo}: base must be a branch name')
    agents = raw.get('agents')
    if not isinstance(agents, list) or not agents or len(set(agents)) != len(agents) or not set(agents) <= set(AGENTS):
        raise RegistryError(f'{repo}: agents must list one or more of ' + ', '.join(AGENTS))
    executables = raw.get('executables') or {}
    if not isinstance(executables, dict) or not set(executables) <= set(agents) or not all(
            isinstance(v, str) and os.path.isabs(v) for v in executables.values()):
        raise RegistryError(f'{repo}: executables maps a listed agent to an absolute path')
    modes = raw.get('agent_modes') or {}
    if not isinstance(modes, dict) or any(name not in agents or mode not in MODES[name] for name, mode in modes.items()):
        raise RegistryError(f'{repo}: agent_modes: codex is workspace-write or danger-full-access; claude is acceptEdits or bypassPermissions')
    verify = raw.get('verify')
    if not isinstance(verify, dict) or set(verify) - {'argv', 'timeout_seconds', 'lock'}:
        raise RegistryError(f'{repo}: verify needs argv (and optionally timeout_seconds and lock)')
    argv = verify.get('argv')
    if (not isinstance(argv, list) or not 0 < len(argv) <= 64 or not all(isinstance(a, str) and 0 < len(a) <= 4096 and '\x00' not in a for a in argv)):
        raise RegistryError(f'{repo}: verify.argv must be a non-empty list of arguments (no shell)')
    lock = verify.get('lock')
    if lock is not None:
        if not isinstance(lock, dict) or set(lock) - {'store', 'keys', 'ttl_seconds', 'wait_seconds'}:
            raise RegistryError(f'{repo}: verify.lock needs store and keys')
        store = _absolute_dir(lock.get('store'), f'{repo}: verify.lock.store')
        if not (Path(store) / 'HEAD').is_file() or not (Path(store) / 'objects').is_dir():
            raise RegistryError(f'{repo}: verify.lock.store must be an existing git-locks Git directory')
        keys = lock.get('keys')
        if not isinstance(keys, list) or not 0 < len(keys) <= 8 or not all(isinstance(k, str) and LOCK_KEY.fullmatch(k) for k in keys):
            raise RegistryError(f'{repo}: verify.lock.keys must list one to eight lock keys')
        lock = {'store': store, 'keys': keys, 'ttl_seconds': _seconds(lock.get('ttl_seconds'), 3600, 60, 86400, 'ttl_seconds'),
                'wait_seconds': _seconds(lock.get('wait_seconds'), 1800, 0, 86400, 'wait_seconds')}
    timeout = _seconds(verify.get('timeout_seconds'), 1800, 60, 86400, f'{repo}: verify.timeout_seconds')
    if lock and lock['ttl_seconds'] <= timeout:
        raise RegistryError(f'{repo}: verify.lock.ttl_seconds must exceed verify.timeout_seconds')
    return {'repo': repo, 'checkout': checkout, 'remote': remote, 'base': base, 'worktree_root': worktrees,
            'agents': list(agents), 'executables': dict(executables), 'agent_modes': {name: modes.get(name, MODES[name][0]) for name in agents},
            'agent_timeout_seconds': _seconds(raw.get('agent_timeout_seconds'), 3600, 60, 86400, f'{repo}: agent_timeout_seconds'),
            'verify': {'argv': list(argv), 'timeout_seconds': timeout, 'lock': lock}}


def inspect(entry):
    """Problems with an entry's Git identity, without network access. [] means it can be used."""
    problems = []
    checkout = entry['checkout']
    top = git(['rev-parse', '--path-format=absolute', '--show-toplevel'], checkout)
    if top.returncode or Path(top.stdout.strip()).resolve() != Path(checkout):
        return ['The checkout is not the top folder of a Git working tree.']
    url = git(['config', '--get', f'remote.{entry["remote"]}.url'], checkout)
    identity = github_identity(url.stdout) if url.returncode == 0 else None
    if url.returncode:
        problems.append(f'The checkout has no remote named {entry["remote"]}.')
    elif (identity or '').casefold() != entry['repo'].casefold():
        problems.append(f'Remote {entry["remote"]} is not github.com/{entry["repo"]}.')
    push = git(['config', '--get-all', f'remote.{entry["remote"]}.pushurl'], checkout)
    for line in push.stdout.splitlines() if push.returncode == 0 else []:
        if (github_identity(line) or '').casefold() != entry['repo'].casefold():
            problems.append(f'Remote {entry["remote"]} pushes somewhere other than github.com/{entry["repo"]}.')
    common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], checkout)
    if common.returncode:
        problems.append('Git could not resolve the repository metadata folder.')
    return problems


class Registry:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.file = self.root / FILE
        self.lock = threading.Lock()

    def raw(self):
        if self.file.is_symlink():
            raise RegistryError('repositories.json must not be a symlink')
        if not self.file.exists():
            return {}
        if self.file.stat().st_size > MAX_FILE:
            raise RegistryError('repositories.json exceeds 256 KiB')
        try:
            data = json.loads(self.file.read_text())
        except ValueError as exc:
            raise RegistryError(f'repositories.json is not valid JSON: {exc}')
        if not isinstance(data, dict) or data.get('schema_version') != 1 or not isinstance(data.get('repositories'), dict):
            raise RegistryError('repositories.json needs schema_version 1 and a repositories object')
        if len(data['repositories']) > MAX_REPOSITORIES:
            raise RegistryError(f'repositories.json lists more than {MAX_REPOSITORIES} repositories')
        return data['repositories']

    def configured(self):
        return self.file.is_file()

    def entries(self):
        """{repo: entry or {'error': message}} for every registered repository."""
        out = {}
        for repo, raw in self.raw().items():
            try:
                out[repo] = validate(repo, raw, self.root)
            except RegistryError as exc:
                out[repo] = {'repo': repo, 'error': str(exc)}
        return out

    def entry(self, repo):
        """The validated entry for `repo` (exact registered name, case-insensitive), or None."""
        for name, raw in self.raw().items():
            if isinstance(repo, str) and name.casefold() == repo.casefold():
                return validate(name, raw, self.root)
        return None

    def write(self, repositories):
        """Replace the file, refusing what raw() would refuse to read back."""
        if len(repositories) > MAX_REPOSITORIES:
            raise RegistryError(f'repositories.json lists more than {MAX_REPOSITORIES} repositories')
        self.file.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps({'schema_version': 1, 'repositories': repositories}, indent=2) + '\n'
        if len(text.encode('utf-8')) > MAX_FILE:
            raise RegistryError('repositories.json would exceed 256 KiB')
        temporary = self.file.with_name('.repositories.next')
        temporary.write_text(text)
        temporary.replace(self.file)

    def register(self, repo, raw):
        entry = validate(repo, raw, self.root)
        problems = inspect(entry)
        if problems:
            raise RegistryError(' '.join(problems))
        with self.lock:
            repositories = self.raw()
            repositories = {k: v for k, v in repositories.items() if k.casefold() != repo.casefold()}
            repositories[repo] = {k: v for k, v in raw.items() if v is not None}
            self.write(repositories)
        return entry

    def remove(self, repo):
        with self.lock:
            repositories = self.raw()
            kept = {k: v for k, v in repositories.items() if k.casefold() != str(repo).casefold()}
            if len(kept) == len(repositories):
                raise RegistryError('No registered repository by that name')
            self.write(kept)

    def view(self, check=False):
        """The registry as the browser sees it: host folders shown as `~/…`, never credentials."""
        rows = []
        try:
            entries = self.entries()
        except RegistryError as exc:
            return {'configured': self.configured(), 'error': str(exc), 'repositories': []}
        for repo, entry in sorted(entries.items(), key=lambda pair: pair[0].casefold()):
            if 'error' in entry:
                rows.append({'repo': repo, 'error': entry['error'], 'problems': [entry['error']]})
                continue
            problems = inspect(entry) if check else None
            rows.append(shown({'repo': repo, 'checkout': entry['checkout'], 'remote': entry['remote'], 'base': entry['base'],
                               'worktree_root': entry['worktree_root'], 'agents': entry['agents'], 'agent_modes': entry['agent_modes'],
                               'agent_timeout_seconds': entry['agent_timeout_seconds'],
                               'verify': {'argv': entry['verify']['argv'], 'timeout_seconds': entry['verify']['timeout_seconds'],
                                          'lock': {'keys': entry['verify']['lock']['keys']} if entry['verify']['lock'] else None},
                               'problems': problems}, self.root))
        return {'configured': self.configured(), 'error': None, 'repositories': rows}
