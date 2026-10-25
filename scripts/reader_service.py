#!/usr/bin/env python3
"""Run Reader web as an always-on macOS LaunchAgent, kept current by a smoke-gated updater,
and optionally published to your own tailnet with `tailscale serve` (never Funnel).

Subcommands: install, uninstall, status, update [--now], request-update, restart, pause,
resume, smoke COMMIT, tailscale on|off|status. Every command prints one JSON object.

State lives in ~/Library/Application Support/Reader/service.json; logs and the update
history (updates.jsonl) in ~/Library/Logs/Reader/. External programs are run with explicit
argv and timeouts; their paths are recorded at install and can be overridden with
READER_SERVICE_{LAUNCHCTL,TAILSCALE,GIT,GIT_LOCKS} (tests use fakes)."""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import plistlib
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

WEB_LABEL = 'com.flyingrobots.reader.web'
UPDATER_LABEL = 'com.flyingrobots.reader.updater'
LABELS = (WEB_LABEL, UPDATER_LABEL)
DEFAULT_SOURCE = 'preview/integration'
DEFAULT_PORT = 8766
INTERVAL = 600
LOG_LIMIT = 16 * 1024**2
LOG_KEEP = 3
PASS_ENV = ('GIT_LOCKS_STORE',)
DEFAULT_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
EXECUTABLES = {
    'launchctl': ('READER_SERVICE_LAUNCHCTL', ['/bin/launchctl']),
    'tailscale': ('READER_SERVICE_TAILSCALE', ['/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale',
                                               '/Applications/Tailscale.app/Contents/MacOS/Tailscale']),
    'git': ('READER_SERVICE_GIT', ['/opt/homebrew/bin/git', '/usr/bin/git']),
    'git_locks': ('READER_SERVICE_GIT_LOCKS', ['/opt/homebrew/bin/git-locks', str(Path.home() / '.local/bin/git-locks')]),
}


class ServiceError(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


# Paths and state ---------------------------------------------------------------

def home():
    return Path.home()


def support():
    return home() / 'Library/Application Support/Reader'


def default_live():
    """The live worktree lives in Reader's app data, never beside or inside a developer checkout."""
    return support() / 'live'


def launch_path():
    """PATH for the agents: the installer's absolute PATH entries first, then the usual tool locations."""
    entries = [p for p in os.environ.get('PATH', '').split(os.pathsep) if os.path.isabs(p)]
    entries += DEFAULT_PATH.split(':') + [str(home() / '.local/bin')]
    return ':'.join(dict.fromkeys(entries))


def logs():
    return home() / 'Library/Logs/Reader'


def agents():
    return home() / 'Library/LaunchAgents'


def state_file():
    return support() / 'service.json'


def load_state():
    file = state_file()
    if not file.is_file():
        return None
    if file.is_symlink() or file.stat().st_size > 1024**2:
        raise ServiceError('Unsafe or oversized service state')
    return json.loads(file.read_text())


def need_state():
    state = load_state()
    if not state:
        raise ServiceError('Reader service is not installed; run reader_service.py install')
    return state


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ServiceError(f'Refusing to write through a symlink: {path}')
    handle, temp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name + '.')
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(data if isinstance(data, bytes) else data.encode())
        os.replace(temp, path)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


def save_state(state):
    atomic_write(state_file(), json.dumps(state, indent=2, sort_keys=True) + '\n')


def executable(name, state=None):
    variable, defaults = EXECUTABLES[name]
    if os.environ.get(variable):
        return os.environ[variable]
    recorded = (state or {}).get('executables', {}).get(name)
    if recorded and Path(recorded).is_file():
        return recorded
    found = shutil.which(name.replace('_', '-'))
    for candidate in ([found] if found else []) + defaults:
        if candidate and Path(candidate).is_file():
            return candidate
    raise ServiceError(f'{name.replace("_", "-")} is not installed')


def run(argv, timeout=60, cwd=None, env=None, check=True):
    if any(part == 'funnel' for part in argv[1:2]):
        raise ServiceError('Refusing tailscale funnel: Reader is never published to the public internet')
    try:
        result = subprocess.run([str(a) for a in argv], capture_output=True, text=True, timeout=timeout, cwd=cwd,
                                env=env, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        raise ServiceError(f'{Path(argv[0]).name} timed out after {timeout} s')
    if check and result.returncode:
        detail = (result.stderr or result.stdout).strip()[-800:]
        raise ServiceError(f'{Path(argv[0]).name} {" ".join(map(str, argv[1:3]))} failed: {detail}')
    return result


def rotate(path, limit=LOG_LIMIT, keep=LOG_KEEP):
    """Copy-and-truncate rotation, safe for launchd's open append-mode log descriptors."""
    path = Path(path)
    if not path.is_file() or path.is_symlink() or path.stat().st_size <= limit:
        return False
    for index in range(keep - 1, 0, -1):
        older = path.with_name(f'{path.name}.{index}')
        if older.exists():
            os.replace(older, path.with_name(f'{path.name}.{index + 1}'))
    shutil.copyfile(path, path.with_name(path.name + '.1'))
    with path.open('r+b') as stream:
        stream.truncate(0)
    return True


def record(entry):
    file = logs() / 'updates.jsonl'
    file.parent.mkdir(parents=True, exist_ok=True)
    rotate(file)
    with file.open('a') as stream:
        stream.write(json.dumps({'at': now()} | entry, sort_keys=True) + '\n')
    return entry


def last_updates(limit=10):
    file = logs() / 'updates.jsonl'
    if not file.is_file() or file.is_symlink():
        return []
    with file.open('rb') as stream:
        stream.seek(max(0, file.stat().st_size - 64 * 1024))
        lines = stream.read().decode('utf-8', 'replace').splitlines()
    rows = []
    for line in lines[-limit:]:
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows


# Git ---------------------------------------------------------------------------

def git(state, *args, cwd=None, timeout=60, check=True):
    return run([executable('git', state), *args], timeout=timeout, cwd=cwd, check=check)


def repo_lock_env():
    """The `.git/` key belongs to the repository's default store, never a host-resource store
    that GIT_LOCKS_STORE may name for other tools in the agents' environment."""
    return {k: v for k, v in os.environ.items() if k != 'GIT_LOCKS_STORE'}


def locked_git(state, note, *args, timeout=300):
    """Worktree and checkout changes touch shared Git metadata: take the repo `.git/` lock."""
    repo = state['repo']
    argv = [executable('git_locks', state), 'with', '--job', f'reader-service-{uuid.uuid4()}', '--holder', 'reader-service',
            '--ttl', str(timeout + 120), '--wait', '120', '--note', note, '.git/', '--', executable('git', state), '-C', repo, *args]
    result = run(argv, timeout=timeout + 150, cwd=repo, env=repo_lock_env(), check=False)
    if result.returncode:
        raise ServiceError(f'git {" ".join(args[:2])} failed (git-locks exit {result.returncode}): {(result.stderr or result.stdout).strip()[-800:]}')
    return result


def resolve(state, ref):
    return git(state, '-C', state['repo'], 'rev-parse', '--verify', '--end-of-options', ref + '^{commit}').stdout.strip()


def live_head(state):
    if not Path(state['live']).is_dir():
        return None
    result = git(state, '-C', state['live'], 'rev-parse', 'HEAD', check=False)
    if result.returncode:
        return None
    return result.stdout.strip() or None


def commit_facts(state, commit):
    if not commit:
        return {}
    result = git(state, '-C', state['repo'], 'show', '-s', '--format=%cI%x00%s', commit, check=False)
    if result.returncode or '\x00' not in result.stdout:
        return {}
    date, subject = result.stdout.strip().split('\x00', 1)
    return {'date': date, 'subject': subject[:200]}


def checkout_live(state, commit):
    dirty = git(state, '-C', state['live'], 'status', '--porcelain', '--untracked-files=no').stdout.strip()
    if dirty:
        raise ServiceError('The live worktree has local changes; refusing to switch commits')
    live = Path(state['live'])
    argv = [executable('git_locks', state), 'with', '--job', f'reader-service-{uuid.uuid4()}', '--holder', 'reader-service',
            '--ttl', '300', '--wait', '120', '--note', 'reader service checkout', '.git/', '--',
            executable('git', state), '-C', str(live), 'checkout', '--quiet', '--detach', commit]
    result = run(argv, timeout=330, cwd=state['repo'], env=repo_lock_env(), check=False)
    if result.returncode:
        raise ServiceError(f'Checkout of {commit[:12]} failed: {(result.stderr or result.stdout).strip()[-800:]}')


# launchd -----------------------------------------------------------------------

def domain():
    return f'gui/{os.getuid()}'


def launchctl(state, *args, check=True, timeout=30):
    return run([executable('launchctl', state), *args], timeout=timeout, check=check)


def agent_info(state, label):
    result = launchctl(state, 'print', f'{domain()}/{label}', check=False)
    if result.returncode:
        return {'loaded': False}
    info = {'loaded': True}
    for line in result.stdout.splitlines():
        key, _, value = line.strip().partition(' = ')
        if key == 'pid' and value.isdigit():
            info['pid'] = int(value)
        elif key == 'state' and 'state' not in info:
            info['state'] = value
        elif key == 'last exit code':
            info['last_exit'] = value
    return info


def plist_path(label):
    return agents() / f'{label}.plist'


def environment(state):
    env = {'PATH': state['env_path'], 'READER_ROOT': state['vault'], 'PYTHONPATH': str(Path(state['live']) / 'src'),
           'PYTHONUNBUFFERED': '1'}
    return env | state.get('env', {})


def plists(state):
    live, python, log = Path(state['live']), state['python'], logs()
    web = {'Label': WEB_LABEL, 'ProgramArguments': [python, str(live / 'scripts/start_web.py'), '--port', str(state['port'])],
           'WorkingDirectory': str(live), 'EnvironmentVariables': environment(state), 'RunAtLoad': True, 'KeepAlive': True,
           'ProcessType': 'Interactive', 'ThrottleInterval': 10,
           'StandardOutPath': str(log / 'web.log'), 'StandardErrorPath': str(log / 'web.log')}
    updater = {'Label': UPDATER_LABEL, 'ProgramArguments': [python, str(live / 'scripts/reader_service.py'), 'update'],
               'WorkingDirectory': str(live), 'EnvironmentVariables': environment(state), 'StartInterval': INTERVAL,
               'RunAtLoad': False, 'ProcessType': 'Background', 'LowPriorityIO': True,
               'StandardOutPath': str(log / 'updater.log'), 'StandardErrorPath': str(log / 'updater.log')}
    return {WEB_LABEL: web, UPDATER_LABEL: updater}


def kickstart(state, label=WEB_LABEL, kill=True):
    launchctl(state, 'kickstart', *(['-k'] if kill else []), f'{domain()}/{label}')


# Health and the smoke test -------------------------------------------------------

def get(port, path, timeout=3):
    connection = HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        connection.request('GET', path, headers={'Host': f'127.0.0.1:{port}'})
        response = connection.getresponse()
        return response.status, response.read(8 * 1024**2)
    finally:
        connection.close()


def probe(port):
    try:
        status, body = get(port, '/api/health', 2)
        data = json.loads(body)
        return data if status == 200 and data.get('status') == 'ok' else None
    except (OSError, ValueError):
        return None


def wait_healthy(port, commit=None, timeout=None):
    deadline = time.monotonic() + (timeout if timeout is not None else env_float('READER_SERVICE_HEALTH_TIMEOUT', 60))
    while True:
        data = probe(port)
        if data and (commit is None or data.get('commit') in (None, commit)):
            return data
        if time.monotonic() >= deadline:
            return None
        time.sleep(0.5)


def kill_group(process):
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


def smoke(state, commit):
    """Test COMMIT in a temporary detached worktree: tests/test_web.py, then a synthetic-vault server."""
    deadline = time.monotonic() + env_float('READER_SERVICE_SMOKE_TIMEOUT', 120)
    scratch = Path(tempfile.mkdtemp(prefix='reader-smoke-'))
    tree = scratch / 'tree'
    steps = []
    added = False
    try:
        locked_git(state, 'reader service smoke worktree', 'worktree', 'add', '--detach', '--quiet', str(tree), commit)
        added = True
        env = {k: v for k, v in os.environ.items() if not k.startswith('READER_')} | {
            'PYTHONPATH': str(tree / 'src'), 'TMPDIR': str(scratch), 'PYTHONDONTWRITEBYTECODE': '1'}
        remaining = lambda: max(1.0, deadline - time.monotonic())
        try:
            result = subprocess.run([state['python'], '-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'tests/test_web.py'],
                                    cwd=tree, env=env, capture_output=True, text=True, timeout=remaining(),
                                    stdin=subprocess.DEVNULL, start_new_session=True)
        except subprocess.TimeoutExpired:
            return False, steps + [{'step': 'pytest', 'ok': False, 'detail': 'timed out'}]
        tail = (result.stdout or result.stderr).strip().splitlines()[-1:] or ['']
        steps.append({'step': 'pytest', 'ok': result.returncode == 0, 'detail': tail[0][:300]})
        if result.returncode:
            return False, steps
        fixture = subprocess.Popen([state['python'], 'tests/web_fixture.py'], cwd=tree, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, start_new_session=True)
        try:
            selector = selectors.DefaultSelector()
            selector.register(fixture.stdout, selectors.EVENT_READ)
            if not selector.select(min(30, remaining())):
                return False, steps + [{'step': 'server', 'ok': False, 'detail': 'the fixture server did not start'}]
            line = fixture.stdout.readline(4096).decode()
            port = int(json.loads(line)['url'].rsplit(':', 1)[1])
            status, body = get(port, '/', 10)
            ok = status == 200 and b'<html' in body[:4096].lower()
            steps.append({'step': 'GET /', 'ok': ok, 'detail': status})
            if not ok:
                return False, steps
            status, body = get(port, '/api/library', 30)
            works = json.loads(body).get('works') if status == 200 else None
            ok = bool(works)
            steps.append({'step': 'GET /api/library', 'ok': ok, 'detail': status})
            if not ok:
                return False, steps
            status, body = get(port, '/api/document?path=' + works[0]['primary'].replace('/', '%2F'), 30)
            ok = status == 200 and isinstance(json.loads(body).get('text'), str)
            steps.append({'step': 'GET /api/document', 'ok': ok, 'detail': status})
            return ok, steps
        except (OSError, ValueError, KeyError, IndexError) as exc:
            return False, steps + [{'step': 'server', 'ok': False, 'detail': str(exc)[:300]}]
        finally:
            kill_group(fixture)
    except ServiceError as exc:
        return False, steps + [{'step': 'worktree', 'ok': False, 'detail': str(exc)[:300]}]
    finally:
        if added:
            try:
                locked_git(state, 'reader service smoke cleanup', 'worktree', 'remove', '--force', str(tree))
            except ServiceError:
                pass
        shutil.rmtree(scratch, ignore_errors=True)
        if added:
            git(state, '-C', state['repo'], 'worktree', 'prune', check=False)


# Commands ------------------------------------------------------------------------

def busy(state):
    data = probe(state['port'])
    return (data or {}).get('busy') or []


def update(args):
    state = need_state()
    support().mkdir(parents=True, exist_ok=True)
    with (support() / 'update.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'outcome': 'already-running'}
        for name in ('web.log', 'updater.log'):
            rotate(logs() / name)
        state = need_state()
        requested = bool(state.pop('update_requested_at', None))
        explicit = args.now or requested
        state['last_check_at'] = now()
        save_state(state)
        if state.get('paused') and not explicit:
            return {'outcome': 'paused'}
        current = live_head(state)
        try:
            target = resolve(state, state['source'])
        except ServiceError as exc:
            return record({'outcome': 'source-missing', 'source': state['source'], 'error': str(exc)[:300]})
        if target == current:
            result = {'outcome': 'current', 'commit': current}
            return record(result) if explicit else result
        if target == state.get('failed_commit') and not explicit:
            return {'outcome': 'skipped', 'commit': target, 'reason': 'this commit already failed its smoke test'}
        ok, steps = smoke(state, target)
        if not ok:
            state = need_state() | {'failed_commit': target}
            save_state(state)
            return record({'outcome': 'smoke-failed', 'from': current, 'to': target, 'steps': steps})
        wait = env_float('READER_SERVICE_BUSY_WAIT', 1800)
        interval = env_float('READER_SERVICE_BUSY_POLL', 15)
        started = time.monotonic()
        while (active := busy(state)):
            if time.monotonic() - started >= wait:
                return record({'outcome': 'deferred', 'from': current, 'to': target, 'busy': active})
            time.sleep(interval)
        try:
            checkout_live(state, target)
        except ServiceError as exc:
            return record({'outcome': 'checkout-failed', 'from': current, 'to': target, 'error': str(exc)[:300]})
        kickstart(state)
        if wait_healthy(state['port'], target):
            state = need_state() | {'previous': current, 'current': target}
            state.pop('failed_commit', None)
            save_state(state)
            return record({'outcome': 'updated', 'from': current, 'to': target, 'steps': steps})
        entry = {'from': current, 'to': target, 'steps': steps}
        if not current:
            return record(entry | {'outcome': 'unhealthy'})
        try:
            checkout_live(state, current)
            kickstart(state)
        except ServiceError as exc:
            return record(entry | {'outcome': 'rollback-failed', 'error': str(exc)[:300]})
        state = need_state() | {'failed_commit': target}
        save_state(state)
        healthy = wait_healthy(state['port'], current)
        return record(entry | {'outcome': 'rolled-back' if healthy else 'rollback-failed'})


def request_update(args):
    state = need_state() | {'update_requested_at': now()}
    save_state(state)
    kickstart(state, UPDATER_LABEL, kill=False)
    return {'requested': True, 'requested_at': state['update_requested_at']}


def restart(args):
    state = need_state()
    if args.detach:
        # Called by the web server itself: let the request finish, then restart from a separate session.
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'restart', '--delay', '1'], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, env=os.environ.copy())
        return {'restarting': True}
    if args.delay:
        time.sleep(min(args.delay, 10))
    kickstart(state)
    return {'restarted': True, 'healthy': bool(wait_healthy(state['port']))}


def set_paused(paused):
    state = need_state() | {'paused': paused}
    save_state(state)
    return {'paused': paused}


def install(args):
    previous = load_state() or {}
    for name in EXECUTABLES:
        if name != 'tailscale':
            executable(name)
    repo = Path(args.repo or previous.get('repo') or default_repo()).expanduser().resolve()
    python = Path(args.python or previous.get('python') or repo / '.venv/bin/python').expanduser()
    vault = Path(args.vault or os.environ.get('READER_ROOT') or previous.get('vault') or configured_vault(repo)).expanduser().resolve(strict=True)
    if not (vault / 'library').is_dir() or not (vault / 'inbox').is_dir():
        raise ServiceError('Expected a Reader vault with library/ and inbox/')
    if not python.is_file():
        raise ServiceError(f'Missing Python interpreter: {python}')
    state = {
        'version': 1, 'repo': str(repo), 'python': str(python), 'vault': str(vault),
        'live': str(Path(args.live or previous.get('live') or default_live()).expanduser()),
        'source': args.source or previous.get('source') or DEFAULT_SOURCE,
        'port': args.port or previous.get('port') or DEFAULT_PORT,
        'env_path': launch_path(),
        'env': {k: v for k, v in os.environ.items() if k in PASS_ENV or (k.startswith('READER_') and not k.startswith('READER_SERVICE_') and k != 'READER_ROOT')},
        'executables': {name: executable(name, previous) for name in EXECUTABLES if name != 'tailscale'},
        'paused': previous.get('paused', False), 'installed_at': now(),
        'backups': previous.get('backups', {}), 'was_loaded': previous.get('was_loaded', {}),
        'tailscale': previous.get('tailscale'),
    }
    try:
        state['executables']['tailscale'] = executable('tailscale', previous)
    except ServiceError:
        pass
    for key, value in getattr(args, 'env', None) or []:
        state['env'][key] = value
    web = agent_info(state, WEB_LABEL)
    if not web['loaded'] and probe(state['port']) is None and port_busy(state['port']):
        raise ServiceError(f'Port {state["port"]} is already in use by another process; stop it or pass --port')
    target = resolve(state, state['source'])
    report = {'source_commit': target}
    live = Path(state['live'])
    if not live.exists():
        if not args.skip_smoke:
            ok, steps = smoke(state, target)
            report['smoke'] = steps
            if not ok:
                raise ServiceError('The source commit failed its smoke test; nothing was installed: ' + json.dumps(steps))
        locked_git(state, 'reader service live worktree', 'worktree', 'add', '--detach', '--quiet', str(live), target)
        report['live_created'] = True
    state['current'] = live_head(state)
    state.setdefault('previous', previous.get('previous'))
    backups = support() / 'backups'
    written = []
    for label, data in plists(state).items():
        path = plist_path(label)
        body = plistlib.dumps(data, sort_keys=True)
        if path.exists() and label not in state['backups']:
            if path.read_bytes() != body:
                backups.mkdir(parents=True, exist_ok=True)
                backup = backups / f'{label}.plist.{datetime.now().strftime("%Y%m%dT%H%M%S")}'
                shutil.copy2(path, backup)
                state['backups'][label] = str(backup)
            state['was_loaded'][label] = agent_info(state, label)['loaded']
        state['backups'].setdefault(label, None)
        atomic_write(path, body)
        written.append(str(path))
    logs().mkdir(parents=True, exist_ok=True)
    save_state(state)
    for label in LABELS:
        if agent_info(state, label)['loaded']:
            launchctl(state, 'bootout', f'{domain()}/{label}', check=False)
            for _ in range(50):
                if not agent_info(state, label)['loaded']:
                    break
                time.sleep(0.1)
        launchctl(state, 'bootstrap', domain(), str(plist_path(label)))
    healthy = wait_healthy(state['port'])
    return report | {'installed': True, 'plists': written, 'live': state['live'], 'commit': state['current'], 'port': state['port'],
                     'healthy': bool(healthy), 'env': sorted(environment(state)), 'state': str(state_file())}


def uninstall(args):
    state = need_state()
    restored = []
    for label in LABELS:
        if agent_info(state, label)['loaded']:
            launchctl(state, 'bootout', f'{domain()}/{label}', check=False)
        path = plist_path(label)
        backup = state.get('backups', {}).get(label)
        if backup and Path(backup).is_file():
            atomic_write(path, Path(backup).read_bytes())
            restored.append(str(path))
            if state.get('was_loaded', {}).get(label):
                launchctl(state, 'bootstrap', domain(), str(path), check=False)
        else:
            path.unlink(missing_ok=True)
    removed_worktree = False
    if args.remove_worktree and Path(state['live']).exists():
        locked_git(state, 'reader service remove live worktree', 'worktree', 'remove', str(state['live']))
        removed_worktree = True
    archived = state_file().with_name(f'service.uninstalled.{datetime.now().strftime("%Y%m%dT%H%M%S")}.json')
    os.replace(state_file(), archived)
    return {'uninstalled': True, 'restored': restored, 'removed_worktree': removed_worktree, 'state_archive': str(archived),
            'tailscale_still_on': bool((state.get('tailscale') or {}).get('enabled'))}


def status(args):
    state = load_state()
    if not state:
        return {'installed': False}
    current = live_head(state)
    try:
        source_commit = resolve(state, state['source'])
    except ServiceError:
        source_commit = None
    updates = last_updates()
    last_check = state.get('last_check_at')
    next_check = None
    if last_check:
        next_check = (datetime.fromisoformat(last_check) + timedelta(seconds=INTERVAL)).isoformat(timespec='seconds')
    return {'installed': True, 'web': agent_info(state, WEB_LABEL) | {'label': WEB_LABEL},
            'updater': agent_info(state, UPDATER_LABEL) | {'label': UPDATER_LABEL},
            'paused': bool(state.get('paused')), 'source': state['source'], 'source_commit': source_commit,
            'commit': current, 'commit_facts': commit_facts(state, current), 'previous': state.get('previous'),
            'failed_commit': state.get('failed_commit'), 'live': state['live'], 'port': state['port'],
            'last_update': updates[-1] if updates else None, 'updates': updates[::-1],
            'last_check_at': last_check, 'next_check_at': next_check, 'interval_seconds': INTERVAL,
            'update_requested_at': state.get('update_requested_at'), 'tailscale': tailscale_state(state)}


def port_busy(port):
    import socket
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(('127.0.0.1', port)) == 0


def default_repo():
    here = Path(__file__).resolve().parents[1]
    try:
        common = subprocess.run([executable('git'), '-C', str(here), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                                capture_output=True, text=True, timeout=10, check=True).stdout.strip()
        return Path(common).parent
    except (subprocess.SubprocessError, OSError, ServiceError):
        return here


def configured_vault(repo):
    config = Path(repo) / '.reader/config.json'
    if config.is_file():
        value = json.loads(config.read_text()).get('vault')
        if value:
            return value
    raise ServiceError('No vault configured: pass --vault or set READER_ROOT')


# Tailscale -----------------------------------------------------------------------

def tailscale_json(state, *args):
    result = run([executable('tailscale', state), *args, '--json'], timeout=20)
    return json.loads(result.stdout or '{}') if result.stdout.strip() else {}


def tailnet_identity(state):
    data = tailscale_json(state, 'status')
    me = data.get('Self') or {}
    dns = (me.get('DNSName') or '').rstrip('.')
    if not dns:
        raise ServiceError('Tailscale has no DNS name for this machine; is it logged in with MagicDNS enabled?')
    user = (data.get('User') or {}).get(str(me.get('UserID'))) or {}
    return {'dns': dns, 'login': user.get('LoginName'), 'backend': data.get('BackendState')}


def handler_for(serve, dns):
    return ((serve.get('Web') or {}).get(f'{dns}:443') or {}).get('Handlers', {}).get('/', {})


def others(serve, dns):
    """Every serve entry other than Reader's HTTPS handler; these must survive on and off."""
    web = {k: v for k, v in (serve.get('Web') or {}).items() if k != f'{dns}:443'}
    tcp = {k: v for k, v in (serve.get('TCP') or {}).items() if k != '443'}
    return {'TCP': tcp, 'Web': web, 'Services': serve.get('Services') or {}}


def config_path(state):
    return Path(state['vault']) / '.reader/web-config.json'


def read_config(state):
    path = config_path(state)
    if path.is_symlink() or path.parent.is_symlink():
        raise ServiceError('Refusing a symlinked web config')
    return json.loads(path.read_text()) if path.is_file() else None


def tailscale_on(state):
    me = tailnet_identity(state)
    dns, target = me['dns'], f'http://127.0.0.1:{state["port"]}'
    before = tailscale_json(state, 'serve', 'status')
    if (before.get('AllowFunnel') or {}).get(f'{dns}:443'):
        raise ServiceError('Funnel is enabled on port 443; refusing to put Reader behind a public endpoint')
    if '443' in (before.get('TCP') or {}) and not (before['TCP']['443'] or {}).get('HTTPS'):
        raise ServiceError('Port 443 already has a TCP forward; refusing to replace it')
    existing = handler_for(before, dns).get('Proxy')
    if existing and existing.rstrip('/') != target:
        raise ServiceError(f'Port 443 already serves {existing}; refusing to replace it')
    backups = support() / 'backups'
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%dT%H%M%S')
    ts = dict(state.get('tailscale') or {})
    if not ts.get('enabled'):
        serve_backup = backups / f'tailscale-serve.{stamp}.json'
        atomic_write(serve_backup, json.dumps(before, indent=2) + '\n')
        original = read_config(state)
        config_backup = None
        if original is not None:
            config_backup = backups / f'web-config.{stamp}.json'
            shutil.copy2(config_path(state), config_backup)
        ts = {'serve_backup': str(serve_backup), 'config_backup': str(config_backup) if config_backup else None,
              'had_handler': bool(existing)}
    if not existing:
        run([executable('tailscale', state), 'serve', '--bg', '--https=443', target], timeout=60)
    after = tailscale_json(state, 'serve', 'status')
    if others(after, dns) != others(before, dns):
        raise ServiceError('Tailscale serve entries other than Reader changed; inspect `tailscale serve status` and the backup '
                           + ts['serve_backup'])
    if handler_for(after, dns).get('Proxy', '').rstrip('/') != target:
        raise ServiceError('tailscale serve did not register the Reader handler')
    config = read_config(state) or {}
    config['allowed_hosts'] = sorted(set(config.get('allowed_hosts') or []) | {dns})
    config['allowed_origins'] = sorted(set(config.get('allowed_origins') or []) | {f'https://{dns}'})
    config['trusted_proxy'] = 'tailscale'
    if not config.get('allowed_logins'):
        if not me['login']:
            raise ServiceError('Could not read the tailnet owner login; set allowed_logins in the web config')
        config['allowed_logins'] = [me['login']]
    config_path(state).parent.mkdir(parents=True, exist_ok=True)
    atomic_write(config_path(state), json.dumps(config, indent=2) + '\n')
    ts |= {'enabled': True, 'dns': dns, 'url': f'https://{dns}', 'enabled_at': now()}
    save_state(need_state() | {'tailscale': ts})
    return {'enabled': True, 'url': f'https://{dns}', 'allowed_logins': config['allowed_logins'], 'preserved': others(after, dns)}


def tailscale_off(state):
    ts = state.get('tailscale') or {}
    me = tailnet_identity(state)
    dns = me['dns']
    before = tailscale_json(state, 'serve', 'status')
    removed = False
    if handler_for(before, dns).get('Proxy', '').rstrip('/') == f'http://127.0.0.1:{state["port"]}' and not ts.get('had_handler'):
        run([executable('tailscale', state), 'serve', '--https=443', 'off'], timeout=60)
        removed = True
    after = tailscale_json(state, 'serve', 'status')
    if others(after, dns) != others(before, dns):
        raise ServiceError('Tailscale serve entries other than Reader changed; inspect `tailscale serve status`')
    if ts.get('enabled'):
        backup = ts.get('config_backup')
        if backup and Path(backup).is_file():
            atomic_write(config_path(state), Path(backup).read_bytes())
        elif config_path(state).is_file():
            config_path(state).unlink()
    save_state(need_state() | {'tailscale': {'enabled': False, 'disabled_at': now(), 'dns': dns}})
    return {'enabled': False, 'removed_handler': removed, 'preserved': others(after, dns)}


def tailscale_state(state):
    ts = state.get('tailscale') or {}
    try:
        me = tailnet_identity(state)
        serve = tailscale_json(state, 'serve', 'status')
    except (ServiceError, ValueError) as exc:
        return {'enabled': bool(ts.get('enabled')), 'state': 'unavailable', 'error': str(exc)[:300], 'url': ts.get('url')}
    serving = handler_for(serve, me['dns']).get('Proxy', '').rstrip('/') == f'http://127.0.0.1:{state["port"]}'
    return {'enabled': bool(ts.get('enabled')), 'serving': serving, 'url': f'https://{me["dns"]}', 'dns': me['dns'],
            'backend': me['backend'], 'state': 'on' if serving else 'off',
            'funnel': bool((serve.get('AllowFunnel') or {}).get(f'{me["dns"]}:443'))}


def tailscale(args):
    state = need_state()
    if args.action == 'on':
        return tailscale_on(state)
    if args.action == 'off':
        return tailscale_off(state)
    return tailscale_state(state)


def pair(value):
    if '=' not in value or not value.split('=', 1)[0]:
        raise argparse.ArgumentTypeError('Expected NAME=VALUE')
    return tuple(value.split('=', 1))


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='command', required=True)
    i = sub.add_parser('install', help='Write and load the LaunchAgents (creates the live worktree if needed)')
    i.add_argument('--repo', help='Main code checkout holding .git and .venv (default: this checkout\'s common Git repository)')
    i.add_argument('--live', help='Live worktree path (default: the recorded one, else ~/Library/Application Support/Reader/live)')
    i.add_argument('--python', help='Interpreter (default REPO/.venv/bin/python)')
    i.add_argument('--vault', help='Reader vault (default READER_ROOT or REPO/.reader/config.json)')
    i.add_argument('--source', help=f'Branch or ref to follow (default {DEFAULT_SOURCE})')
    i.add_argument('--port', type=int)
    i.add_argument('--env', action='append', type=pair,
                   help='Extra NAME=VALUE for both agents (repeatable)')
    i.add_argument('--skip-smoke', action='store_true', help='Create the live worktree without smoke-testing the source commit')
    u = sub.add_parser('uninstall', help='Unload the agents and restore any plists they replaced')
    u.add_argument('--remove-worktree', action='store_true')
    s = sub.add_parser('status')
    s.add_argument('--json', action='store_true', help='(the default output format)')
    up = sub.add_parser('update', help='Advance to the source commit if it passes the smoke test')
    up.add_argument('--now', action='store_true', help='Run even when paused, and retry a commit that failed before')
    sub.add_parser('request-update', help='Ask the updater agent to run now')
    r = sub.add_parser('restart')
    r.add_argument('--detach', action='store_true')
    r.add_argument('--delay', type=float, default=0)
    sub.add_parser('pause')
    sub.add_parser('resume')
    sm = sub.add_parser('smoke', help='Run the update gate for one commit without installing it')
    sm.add_argument('commit')
    sm.add_argument('--repo')
    sm.add_argument('--python')
    t = sub.add_parser('tailscale', help='Publish Reader to your tailnet with tailscale serve (never Funnel)')
    t.add_argument('action', choices=('on', 'off', 'status'))
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == 'install':
            result = install(args)
        elif args.command == 'uninstall':
            result = uninstall(args)
        elif args.command == 'status':
            result = status(args)
        elif args.command == 'update':
            result = update(args)
        elif args.command == 'request-update':
            result = request_update(args)
        elif args.command == 'restart':
            result = restart(args)
        elif args.command in ('pause', 'resume'):
            result = set_paused(args.command == 'pause')
        elif args.command == 'smoke':
            state = dict(load_state() or {})
            state['repo'] = str(Path(args.repo or state.get('repo') or default_repo()).resolve())
            state['python'] = args.python or state.get('python') or str(Path(state['repo']) / '.venv/bin/python')
            commit = resolve(state, args.commit)
            ok, steps = smoke(state, commit)
            result = {'commit': commit, 'ok': ok, 'steps': steps}
        else:
            result = tailscale(args)
    except (ServiceError, OSError, ValueError) as exc:
        print(json.dumps({'error': str(exc)}))
        return 1
    print(json.dumps(result, indent=2))
    failed = result.get('outcome') in ('smoke-failed', 'rollback-failed', 'unhealthy', 'checkout-failed', 'source-missing') or result.get('ok') is False
    return 1 if failed and args.command in ('smoke',) else 0


if __name__ == '__main__':
    sys.exit(main())
