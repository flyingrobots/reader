"""The Server card's bridge to `scripts/reader_service.py`, and the health facts.

The web server never manages launchd or Tailscale itself: it runs the service
script with explicit argv, a timeout and a bounded output. Actions that restart
the server are handed to launchd (the updater agent, or a detached `restart`) so
they outlive the request that asked for them."""
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys

CODE = Path(__file__).resolve().parents[2]
SCRIPT = CODE / 'scripts' / 'reader_service.py'
ACTIONS = {'update': ['request-update'], 'restart': ['restart', '--detach'], 'pause': ['pause'], 'resume': ['resume']}
MAX_OUTPUT = 256 * 1024


def code_commit(code=CODE):
    """The checked-out commit of this code, read from Git metadata without running git."""
    try:
        dot = code / '.git'
        if dot.is_file():
            text = dot.read_text()[:4096].strip()
            if not text.startswith('gitdir:'):
                return None
            gitdir = (code / text[7:].strip()).resolve()
            common = gitdir
            if (gitdir / 'commondir').is_file():
                common = (gitdir / (gitdir / 'commondir').read_text()[:4096].strip()).resolve()
        elif dot.is_dir():
            gitdir = common = dot
        else:
            return None
        head = (gitdir / 'HEAD').read_text()[:4096].strip()
        if not head.startswith('ref:'):
            return head if len(head) in (40, 64) and all(c in '0123456789abcdef' for c in head) else None
        ref = head[4:].strip()
        if '..' in ref or not ref.startswith('refs/'):
            return None
        for base in (gitdir, common):
            if (base / ref).is_file():
                return (base / ref).read_text()[:100].strip()
        packed = common / 'packed-refs'
        if packed.is_file() and packed.stat().st_size <= 16 * 1024**2:
            for line in packed.read_text().splitlines():
                parts = line.split(' ')
                if len(parts) == 2 and parts[1] == ref:
                    return parts[0]
    except (OSError, ValueError):
        return None
    return None


def inbox_running(root):
    """True while an inbox run holds its run lock; probing never creates the file."""
    lock = Path(root) / '.reader/inbox-runner/run.lock'
    if not lock.is_file() or lock.is_symlink():
        return False
    try:
        with lock.open('r') as stream:
            fcntl.flock(stream, fcntl.LOCK_SH | fcntl.LOCK_NB)
            fcntl.flock(stream, fcntl.LOCK_UN)
    except BlockingIOError:
        return True
    except OSError:
        return False
    return False


class Service:
    def __init__(self, runner=None, script=SCRIPT, python=sys.executable):
        self.script, self.python = Path(script), python
        self.runner = runner or self.run

    def run(self, argv, timeout=20):
        if not self.script.is_file():
            raise FileNotFoundError('The service script is not part of this installation')
        try:
            result = subprocess.run([self.python, str(self.script), *argv], capture_output=True, text=True,
                                    timeout=timeout, stdin=subprocess.DEVNULL, start_new_session=True)
        except subprocess.TimeoutExpired:
            raise TimeoutError('The service script timed out')
        if len(result.stdout) > MAX_OUTPUT:
            raise ValueError('Service script output exceeds 256 KiB')
        try:
            data = json.loads(result.stdout or '{}')
        except ValueError:
            data = {}
        if result.returncode:
            raise ValueError(data.get('error') or (result.stderr or 'The service script failed').strip()[-600:])
        return data

    def status(self):
        try:
            return self.runner(['status', '--json'])
        except (OSError, ValueError, TimeoutError) as exc:
            return {'installed': False, 'error': str(exc)}

    def act(self, action):
        if action not in ACTIONS:
            raise ValueError('Expected update, restart, pause or resume')
        return self.runner(ACTIONS[action])


def health(library, started_at):
    busy = []
    running = library.maintenance.status()['running']
    if running:
        busy.append({'kind': 'maintenance', 'label': running['label']})
    if inbox_running(library.root):
        busy.append({'kind': 'inbox', 'label': 'Inbox run'})
    try:
        import tomllib
        reader_version = tomllib.loads((CODE / 'pyproject.toml').read_text())['project']['version']
    except (OSError, ValueError, KeyError):
        reader_version = None
    return {'status': 'ok', 'version': reader_version, 'commit': code_commit(), 'pid': os.getpid(),
            'started_at': started_at, 'now': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'busy': busy}
