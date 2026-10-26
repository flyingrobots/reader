"""Read-only inbox listing and the web launcher for the existing librarian inbox runner.

The web server never edits the runner's state, locks or Upkeep claims. It reads
`inbox/` through `inbox_runner.inventory`, joins delivery receipts, reads
`.reader/inbox-runner/state.json` and its report, and starts or stops the same
supervisor the Obsidian plugin starts: `python -m reader_mcp.inbox_runner` with
explicit argv, no shell, as a detached process group. The supervisor's own lock
and claim check decide admission."""
from datetime import datetime, timezone
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
from uuid import uuid4

from .display import shown
from .inbox_runner import chat_turn_running, inventory

MAX_RECEIPT = 256 * 1024
MAX_STATE = 256 * 1024
MAX_REPORT = 256 * 1024
MAX_CLAIMS = 1024 * 1024
MAX_TITLE_PROBE = 64 * 1024
MAX_HASHED = 64 * 1024**2
MAX_EVENTS_READ = 256 * 1024
MAX_EVENT_STREAM = 8 * 1024**2  # The supervisor's stdout cap.
MAX_EVENT_FIELD = 64 * 1024
# Codex item fields whose long text is kept head and tail; other oversized fields are dropped.
EVENT_TEXT_FIELDS = ('aggregated_output', 'text', 'message')
SANDBOX_MODES = ('workspace-write', 'danger-full-access')
ACTIVE = ('starting', 'running')
CANCEL_TEXT = 'Stop requested by the Reader web user.\n'
INTERRUPTED = ('The inbox runner stopped unexpectedly. Inspect its report and partial changes before retrying: '
               'confirm the recorded process group is gone, then remove only .reader/inbox-runner/state.json to allow another run.')


CODEX_MISSING = 'Codex was not found. Set READER_CODEX to its executable path, then run codex login in your terminal.'


class RunConflict(Exception):
    """An inbox run is already active: a state conflict (HTTP 409), not a rate limit."""


def codex_candidates(environ=None):
    """The Obsidian plugin's lookup order, with READER_CODEX as the explicit override."""
    environ = os.environ if environ is None else environ
    configured = (environ.get('READER_CODEX') or '').strip()
    if configured:
        return [configured]
    home = Path.home()
    return [str(Path(p) / 'codex') for p in (environ.get('PATH') or '').split(':') if p] + [
        str(home / '.local/bin/codex'), str(home / '.cargo/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex']


def find_codex(environ=None):
    for path in codex_candidates(environ):
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def read_bounded(path, limit, *, tail=False):
    """Read a regular, non-symlink file up to `limit` bytes. Returns (bytes, truncated) or None if absent."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return None
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise ValueError(f'{Path(path).name} must not be a symlink') from exc
        raise
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not (info.st_mode & 0o170000 == 0o100000):
            raise ValueError(f'{Path(path).name} must be a regular file')
        if info.st_size > limit:
            if tail:
                stream.seek(info.st_size - limit)
            return stream.read(limit), True
        return stream.read(limit + 1)[:limit], False


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class InboxView:
    def __init__(self, root, python=None, environ=None, spawn=None):
        self.root = Path(root)
        self.python = python or sys.executable
        self.environ = os.environ if environ is None else environ
        self.spawn = spawn or subprocess.Popen
        self.hashes = {}
        self.lock = threading.Lock()

    # Paths --------------------------------------------------------------

    @property
    def runtime(self):
        return self.root / '.reader/inbox-runner'

    def safe_runtime(self):
        for path in (self.root / '.reader', self.runtime):
            if path.is_symlink():
                raise ValueError(f'{path.relative_to(self.root)} must not be a symlink')
        return self.runtime

    # Arrivals -----------------------------------------------------------

    def file_digest(self, file):
        info = file.stat()
        identity = (info.st_ino, info.st_mtime_ns, info.st_ctime_ns, info.st_size)
        cached = self.hashes.get(str(file))
        if cached and cached[0] == identity:
            return cached[1]
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if len(self.hashes) >= 20000:
            self.hashes.clear()
        self.hashes[str(file)] = (identity, digest)
        return digest

    def receipt(self, folder):
        """A valid delivery receipt, or (None, reason). Receipts are data; nothing in them is executed."""
        try:
            read = read_bounded(folder / 'receipt.json', MAX_RECEIPT)
        except (ValueError, OSError) as exc:
            return None, str(exc)
        if read is None:
            return None, None
        data, truncated = read
        if truncated:
            return None, 'receipt.json exceeds 256 KiB'
        try:
            receipt = json.loads(data)
        except (ValueError, UnicodeError):
            return None, 'receipt.json is not valid JSON'
        if not isinstance(receipt, dict) or receipt.get('reader_receipt') != 1 or not isinstance(receipt.get('files'), list):
            return None, 'receipt.json is not a Reader delivery receipt'
        return receipt, None

    def integrity(self, folder, receipt):
        for item in receipt['files'][:2000]:
            name = item.get('path') if isinstance(item, dict) else None
            if not isinstance(name, str) or not name or name.startswith('/') or '\\' in name or any(p in ('', '.', '..') for p in name.split('/')):
                return 'changed'
            file = folder / name
            if any(p.is_symlink() for p in (file, *file.parents) if folder in p.parents):
                return 'changed'
            try:
                if not file.is_file() or file.stat().st_size != item.get('bytes') or file.stat().st_size > MAX_HASHED:
                    return 'changed'
                if self.file_digest(file) != item.get('sha256'):
                    return 'changed'
            except OSError:
                return 'changed'
        return 'intact' if len(receipt['files']) <= 2000 else 'changed'

    def first_heading(self, file):
        if file.suffix.lower() not in ('.md', '.markdown', '.txt'):
            return None
        try:
            read = read_bounded(file, MAX_TITLE_PROBE)
        except (ValueError, OSError):
            return None
        if not read:
            return None
        text = read[0].decode('utf-8', 'replace')
        if text.startswith('---\n'):
            end = text.find('\n---', 4)
            if end > 0:
                title = re.search(r'^title:\s*["\']?(.+?)["\']?\s*$', text[4:end], re.M)
                if title:
                    return title.group(1)[:300]
        match = re.search(r'^#\s+(.+?)\s*#*\s*$', text, re.M)
        return match.group(1)[:300] if match else None

    def arrivals(self):
        paths = inventory(self.root)
        groups = {}
        for path in paths:
            groups.setdefault(path.split('/')[1], []).append(path)
        rows = []
        for name, members in sorted(groups.items()):
            top = self.root / 'inbox' / name
            bundle = top.is_dir()
            receipt, receipt_error = self.receipt(top) if bundle else (None, None)
            # Same choice as the Obsidian plugin: the first readable document, else any non-receipt file.
            document = next((p for p in members if re.search(r'\.(md|txt|pdf)$', p, re.I)), None) \
                or next((p for p in members if not p.endswith('/receipt.json')), None) or members[0]
            if receipt and isinstance(receipt.get('document'), str):
                named = f'inbox/{name}/{receipt["document"]}'
                if named in members:
                    document = named
            sizes, mtimes = 0, []
            for path in members:
                try:
                    info = (self.root / path).stat()
                    sizes += info.st_size
                    mtimes.append(info.st_mtime)
                except OSError:
                    pass
            provenance = receipt.get('provenance') if receipt and isinstance(receipt.get('provenance'), dict) else {}
            title = receipt.get('title') if receipt and isinstance(receipt.get('title'), str) and receipt['title'].strip() else None
            title = title or self.first_heading(self.root / document) or Path(document).name
            received = receipt.get('received_at') if receipt and isinstance(receipt.get('received_at'), str) else None
            if not received and mtimes:
                received = datetime.fromtimestamp(max(mtimes), timezone.utc).isoformat(timespec='seconds')
            rows.append({
                'id': name, 'path': f'inbox/{name}', 'bundle': bundle, 'document': document, 'title': title[:300],
                'source': str(provenance.get('source'))[:300] if provenance.get('source') else None,
                'project': str(provenance.get('project'))[:200] if provenance.get('project') else None,
                'author': str(provenance.get('author'))[:200] if provenance.get('author') else None,
                'report_date': str(provenance.get('report_date'))[:40] if provenance.get('report_date') else None,
                'request_id': receipt.get('id') if receipt else None,
                'integrity': self.integrity(top, receipt) if receipt else None,
                'receipt_error': receipt_error,
                'files': len(members), 'bytes': sizes, 'received_at': received})
        return rows

    # Coordination -------------------------------------------------------

    def claims(self):
        read = read_bounded(self.root / '.reader/upkeep-claims.json', MAX_CLAIMS)
        if read is None:
            return []
        data, truncated = read
        if truncated:
            raise ValueError('Upkeep claims exceed 1 MiB')
        value = json.loads(data)
        if not isinstance(value, dict) or any(not k.startswith('inbox/') or not isinstance(v, str) or not v for k, v in value.items()):
            raise ValueError('Invalid inbox filing reservations')
        return sorted(value)

    def state(self):
        """Runner state as the supervisor wrote it, plus the plugin's liveness check (never written back)."""
        read = read_bounded(self.safe_runtime() / 'state.json', MAX_STATE)
        if read is None:
            return None
        data, truncated = read
        if truncated:
            raise ValueError('Inbox runner state exceeds 256 KiB')
        state = json.loads(data)
        if not isinstance(state, dict) or not isinstance(state.get('status'), str) or not isinstance(state.get('message'), str):
            raise ValueError('Invalid inbox run status')
        if state['status'] in ACTIVE and isinstance(state.get('supervisor_pid'), int) and not pid_alive(state['supervisor_pid']):
            state = dict(state, status='interrupted', message=INTERRUPTED)
        return state

    def report(self):
        read = read_bounded(self.safe_runtime() / 'last-message.md', MAX_REPORT, tail=True)
        if read is None or not read[0].strip():
            return None, False
        return read[0].decode('utf-8', 'replace'), read[1]

    def latest_event(self):
        """A short line from the newest agent message or command in events.jsonl, for progress."""
        try:
            read = read_bounded(self.safe_runtime() / 'events.jsonl', 64 * 1024, tail=True)
        except (ValueError, OSError):
            return None
        if not read:
            return None
        for line in reversed(read[0].decode('utf-8', 'replace').splitlines()):
            try:
                event = json.loads(line)
            except ValueError:
                continue
            item = event.get('item') if isinstance(event, dict) else None
            if isinstance(item, dict):
                text = item.get('text') if item.get('type') in ('agent_message', 'reasoning') else \
                    '$ ' + item['command'] if item.get('type') == 'command_execution' and isinstance(item.get('command'), str) else None
                if isinstance(text, str) and text.strip():
                    text = ' '.join(text.split())
                    return text if len(text) <= 160 else text[:159] + '…'
        return None

    def events(self, after=0):
        """Whole events.jsonl lines from byte `after`, at most 256 KiB per call, for the activity transcript.

        Lines are parsed JSON; unparseable lines and lines longer than one read become `reader.skipped`
        markers. The offset is a line start the server returned; a mid-line offset resynchronizes at the next
        newline. Nothing is read while a run is starting, since the supervisor has not yet cleared the
        previous run's stream."""
        if isinstance(after, bool) or not isinstance(after, int) or not 0 <= after <= MAX_EVENT_STREAM:
            raise ValueError('Expected an event offset between 0 and 8 MiB')
        state = self.state()
        status = state['status'] if state else None
        names = lambda value: [str(v)[:300] for v in value[:2000]] if isinstance(value, list) else None
        remaining = state.get('remaining') if state else None
        result = {'run_id': state.get('run_id') if state else None, 'status': status,
                  'started_at': state.get('started_at') if state else None, 'finished_at': state.get('finished_at') if state else None,
                  'arrivals': names(state.get('arrivals')) if state else None,
                  'remaining': sorted({p.split('/')[1] for p in remaining if isinstance(p, str) and p.count('/') >= 1})[:2000]
                  if isinstance(remaining, list) else None,
                  'events': [], 'next_offset': after, 'size': 0, 'reset': False, 'done': status not in ACTIVE}
        if not state or status == 'starting':
            result['next_offset'] = 0
            return result
        try:
            fd = os.open(self.safe_runtime() / 'events.jsonl', os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            result['next_offset'] = 0
            return result
        except OSError as exc:
            if exc.errno == errno.ELOOP:
                raise ValueError('events.jsonl must not be a symlink') from exc
            raise
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not (info.st_mode & 0o170000 == 0o100000):
                raise ValueError('events.jsonl must be a regular file')
            size = min(info.st_size, MAX_EVENT_STREAM)
            result['size'] = size
            if after > size:  # A newer run cleared the stream.
                after, result['reset'] = 0, True
            events, start = [], after
            if after:
                stream.seek(after - 1)
                aligned = stream.read(1) == b'\n'
            else:
                aligned = True
            stream.seek(after)
            chunk = stream.read(min(MAX_EVENTS_READ, size - after))
            if not aligned and chunk:  # Discard the rest of a line that was too long for one read.
                cut = chunk.find(b'\n')
                skipped = len(chunk) if cut < 0 else cut + 1
                events.append({'type': 'reader.skipped', 'bytes': skipped, 'reason': 'line exceeds 256 KiB'})
                chunk, start = (b'' if cut < 0 else chunk[cut + 1:]), after + skipped
            cut = chunk.rfind(b'\n')
            if result['done'] and start + len(chunk) >= size:
                body, end = chunk, start + len(chunk)  # The run is over: a final unterminated line is complete.
            elif cut >= 0:
                body, end = chunk[:cut + 1], start + cut + 1  # Hold back a line still being written.
            elif len(chunk) == MAX_EVENTS_READ:  # The next call resynchronizes at the following newline.
                events.append({'type': 'reader.skipped', 'bytes': len(chunk), 'reason': 'line exceeds 256 KiB'})
                body, end = b'', start + len(chunk)
            else:
                body, end = b'', start
            for line in body.split(b'\n'):
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                except (ValueError, UnicodeError):
                    events.append({'type': 'reader.skipped', 'bytes': len(line), 'reason': 'not JSON'})
                    continue
                if isinstance(event, dict) and isinstance(event.get('type'), str):
                    events.append(self.relative(self.bounded_event(event)))
            result['events'], result['next_offset'] = events, end
            result['done'] = result['done'] and end >= size
        if result['done'] and status in ('failed', 'interrupted', 'stopped'):
            result['message'] = shown(state.get('message'), self.root)
            result['stderr_tail'] = self.stderr_tail()
        return result

    def relative(self, event):
        """Show vault files vault-relative in messages and file changes, as the report does."""
        item, prefix = event.get('item'), str(self.root) + '/'
        if isinstance(item, dict):
            if item.get('type') == 'agent_message' and isinstance(item.get('text'), str):
                item['text'] = item['text'].replace('](' + prefix, '](').replace(prefix, '')
            if item.get('type') == 'file_change' and isinstance(item.get('changes'), list):
                for change in item['changes']:
                    if isinstance(change, dict) and isinstance(change.get('path'), str) and change['path'].startswith(prefix):
                        change['path'] = change['path'][len(prefix):]
        return shown(event, self.root)  # Commands and their output may name the vault or home folder anywhere.

    def stderr_tail(self):
        try:
            read = read_bounded(self.safe_runtime() / 'stderr.log', 8 * 1024, tail=True)
        except (ValueError, OSError):
            return None
        return shown(read[0].decode('utf-8', 'replace'), self.root) if read and read[0].strip() else None

    @staticmethod
    def bounded_event(event):
        """Pass an event through, keeping long known text as head and tail and dropping other fields over 64 KiB."""
        def bound(value, dropped, truncated, prefix):
            out = {}
            for key, field in value.items():
                if isinstance(field, str) and key in EVENT_TEXT_FIELDS and len(field) > MAX_EVENT_FIELD:
                    out[key] = field[:MAX_EVENT_FIELD // 4] + f'\n… {len(field) - MAX_EVENT_FIELD:,} characters omitted …\n' + field[-(MAX_EVENT_FIELD * 3 // 4):]
                    truncated[prefix + key] = len(field)
                elif isinstance(field, (dict, list)) or isinstance(field, str):
                    if len(json.dumps(field, ensure_ascii=False)) > MAX_EVENT_FIELD:
                        if isinstance(field, dict) and key in ('item', 'error'):
                            out[key] = bound(field, dropped, truncated, prefix + key + '.')
                        else:
                            dropped.append(prefix + key)
                    else:
                        out[key] = field
                else:
                    out[key] = field
            return out
        dropped, truncated = [], {}
        out = bound(event, dropped, truncated, '')
        if dropped:
            out['reader_dropped'] = dropped
        if truncated:
            out['reader_truncated'] = truncated
        return out

    def commit(self, report):
        """A commit the report names, verified to exist in the vault's Git history."""
        if not report:
            return None
        git = shutil.which('git')
        if not git:
            return None
        for match in re.finditer(r'commit\w*[^\n]{0,80}?\b([0-9a-f]{7,40})\b', report, re.I):
            try:
                result = subprocess.run([git, 'log', '-1', '--format=%H%x00%s', match.group(1) + '^{commit}', '--'],
                                        cwd=self.root, capture_output=True, text=True, timeout=5)
            except (OSError, subprocess.SubprocessError):
                return None
            if result.returncode == 0 and '\x00' in result.stdout:
                full, subject = result.stdout.strip().split('\x00', 1)
                return {'hash': full, 'short': full[:12], 'subject': subject[:300]}
        return None

    def status(self):
        # Whether Codex is installed, never where: tailnet browsers see this answer too (#105).
        result = {'arrivals': [], 'runner': None, 'claims_held': [], 'codex': {'name': 'codex', 'installed': bool(find_codex(self.environ))},
                  'sandbox_modes': list(SANDBOX_MODES), 'errors': []}
        try:
            result['arrivals'] = self.arrivals()
        except (ValueError, OSError) as exc:
            result['errors'].append(str(exc))
        try:
            result['claims_held'] = self.claims()
        except (ValueError, OSError) as exc:
            result['errors'].append(f'Cannot read inbox coordination (upkeep-claims.json): {exc}')
        try:
            state = self.state()
        except (ValueError, OSError) as exc:
            state = None
            result['errors'].append(f'Cannot read inbox coordination (inbox-runner/state.json): {exc}')
        if state:
            runner = {k: state.get(k) for k in ('status', 'run_id', 'started_at', 'updated_at', 'finished_at', 'message',
                                                 'arrivals', 'remaining', 'exit_code', 'sandbox_mode')}
            runner['arrivals'] = len(state['arrivals']) if isinstance(state.get('arrivals'), list) else None
            runner['remaining'] = len(state['remaining']) if isinstance(state.get('remaining'), list) else None
            if state['status'] in ACTIVE:
                runner['event'] = self.latest_event()
            else:
                try:
                    report, truncated = self.report()
                except (ValueError, OSError) as exc:
                    report, truncated = None, False
                    result['errors'].append(f'Cannot read the librarian report: {exc}')
                # Librarian reports link vault files by absolute path; show them vault-relative.
                runner['report_md'] = report.replace('](' + str(self.root) + '/', '](').replace(str(self.root) + '/', '') if report else report
                runner['report_truncated'] = truncated
                runner['commit'] = self.commit(report) if state['status'] == 'finished' else None
            result['runner'] = shown(runner, self.root)
        try:
            result['chat_turn'] = chat_turn_running(self.root)
        except OSError as exc:
            result['chat_turn'] = False
            result['errors'].append(f'Cannot check the voice chat lock: {exc}')
        result['blocked'] = self.blocked(result)
        return result

    @staticmethod
    def blocked(status):
        """Why You got mail is unavailable, or None. Mirrors the plugin's admission checks."""
        run = status['runner'] or {}
        if status['errors']:
            return {'reason': 'error', 'message': ' '.join(status['errors'])}
        if run.get('status') in ACTIVE:
            return {'reason': 'active', 'message': 'The librarian is already reading the mail.'}
        if run.get('status') == 'interrupted':
            return {'reason': 'interrupted', 'message': INTERRUPTED}
        if status['claims_held']:
            return {'reason': 'claims', 'message': 'Filing already assigned: an agent holds Upkeep intake claims for '
                    f'{len(status["claims_held"])} arrival{"s" if len(status["claims_held"]) != 1 else ""}. '
                    'You can open the arrivals; another run can start after that assignment is released.'}
        if status.get('chat_turn'):
            # The supervisor refuses too (inbox_runner.chat_turn_running); say so before spawning it.
            return {'reason': 'chat', 'message': 'A voice chat turn is running in this vault. You got mail can start when it finishes.'}
        if not status['arrivals']:
            return {'reason': 'empty', 'message': 'The inbox is empty.'}
        if not (status.get('codex') or {}).get('installed'):
            return {'reason': 'codex', 'message': CODEX_MISSING}
        return None

    # Actions ------------------------------------------------------------

    def command(self, codex, run_id, sandbox_mode):
        argv = [self.python, '-m', 'reader_mcp.inbox_runner', '--root', str(self.root), '--codex', codex,
                '--run-id', run_id, '--sandbox-mode', sandbox_mode]
        store = (self.environ.get('READER_WORKSTATION_LOCK_STORE') or '').strip()
        if store:
            argv += ['--workstation-lock-store', store]
        return argv

    def start(self, sandbox_mode='workspace-write', wait=3.0):
        if sandbox_mode not in SANDBOX_MODES:
            raise ValueError('Expected sandbox_mode workspace-write or danger-full-access')
        if sys.platform == 'win32':
            raise ValueError('The inbox runner currently requires macOS or Linux.')
        with self.lock:
            status = self.status()
            if status['blocked']:
                error = RunConflict if status['blocked']['reason'] == 'active' else ValueError
                raise error(status['blocked']['message'])
            codex = find_codex(self.environ)
            if not codex:
                raise ValueError(CODEX_MISSING)
            run_id = str(uuid4())
            argv = self.command(codex, run_id, sandbox_mode)
            # The supervisor imports the same reader_mcp package as this server, whatever its working directory.
            package_root = str(Path(__file__).resolve().parents[1])
            env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in (package_root, os.environ.get('PYTHONPATH', '')) if p))
            process = self.spawn(argv, cwd=str(self.root), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True, shell=False)
            # Reap the detached supervisor so it never lingers as a zombie that looks alive.
            threading.Thread(target=process.wait, name='reader-inbox-reaper', daemon=True).start()
            deadline = time.monotonic() + wait
            while True:
                try:
                    state = self.state()
                except (ValueError, OSError):
                    state = None
                ours = bool(state and state.get('run_id') == run_id)
                if ours and state['status'] != 'starting':
                    break
                code = process.poll()
                if code is not None and not ours:
                    if code == 2:
                        raise RunConflict('Another inbox run holds the runner lock.')
                    raise ValueError(f'The inbox runner exited with status {code} before reporting startup. Check the Reader Python installation.')
                if time.monotonic() >= deadline:
                    break
                time.sleep(0.05)
            return {'run_id': run_id, 'argv': argv, 'state': state if state and state.get('run_id') == run_id else None}

    def stop(self):
        state = self.state()
        if not state or state['status'] not in ACTIVE:
            raise ValueError('No inbox run is active.')
        runtime = self.safe_runtime()
        fd = os.open(runtime / 'cancel', os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(CANCEL_TEXT)
        return {'run_id': state.get('run_id'), 'requested': True}
