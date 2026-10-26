"""Supervised voice turns for web chat: one active turn per vault, FIFO-queued.

Generalized from `inbox_runner.py`: singleton run lock, admission under
`.reader/upkeep.lock`, an atomically replaced `state.json`, a cancel file, process-group
kill, CPU/RSS/output/free-disk guards and TMPDIR under `.reader`. It adds per-voice argv
adapters, stream-JSON parsing into text deltas, and changed-path detection with Git.
Timeouts are the only cost bound, by decision."""
from collections import deque
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import queue
import random
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
from uuid import uuid4

from .display import shown
from .chats import Chats, MAX_BODY, chime_ins
from .resources import has_capacity, minimum_free_bytes
from . import llm_logs
from . import voices as voice_tools

MAX_OUTPUT = 16 * 1024**2
MAX_RSS = 4 * 1024**3
MAX_DATA = 4 * 1024**3
MAX_HOPS = 3
HAND_TTL = 600
MAX_LISTEN_LOG = 1024**2
TERMINAL = ('done', 'failed', 'timeout', 'cancelled')
# Stream lines Reader can interpret (Claude Code stream-json and Codex exec --json).
KNOWN_TYPES = {'system', 'stream_event', 'assistant', 'user', 'result', 'item.completed', 'item.updated', 'item.started',
               'thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'error', 'text', 'delta', 'content', 'message',
               'rate_limit_event'}
RAW_LIMIT = 4 * 1024**2  # Most stdout served per turn by /api/chat/raw; the archive keeps it all.
RAW_FRAME = 2048  # Longest raw line sent over SSE; the full line is in the archived log.
# Sets the CPU limit, then becomes the voice CLI. A shim avoids preexec_fn in a threaded server.
SUPERVISOR_BEAT = 10  # seconds between the chat owner's heartbeats in supervisor.lock
SUPERVISOR_STALE = 30  # a record from another host older than this no longer counts as held
OWNED = 'Another Reader server owns chat for this vault'
SHIM = 'import os,resource,sys;c=int(sys.argv[1]);resource.setrlimit(resource.RLIMIT_CPU,(c,c));os.execv(sys.argv[2],sys.argv[2:])'


def stamp():
    return datetime.now(timezone.utc).isoformat()


class StreamParser:
    """Turn a CLI's stdout lines into text deltas and a final reply.

    Understands Claude Code stream-json (`stream_event` text deltas, `assistant`
    messages, `result`), Codex `exec --json` events (`item.completed` agent messages
    and the older `msg` envelope), agy stream-json (`init`, `step_update` with
    `agent_response` text deltas and `tool` steps, and a final `result` whose
    `response` is the authoritative reply), and plain text. Anything unrecognized is
    kept only as raw output. `replace` holds a final reply that should replace the
    streamed text; `lines` and `understood` count JSON lines read and recognized."""

    def __init__(self, kind):
        self.kind = kind
        self.result = None
        self.messages = []
        self.model = None
        self.session = None
        self.error = None
        self.status = None
        self.status_detail = None
        self.streamed = False
        self.text = []
        self.replace = None
        self.lines = 0
        self.understood = 0
        self.step = None
        self.has_text = False
        self.tools = 0

    def feed(self, line):
        delta = self.read(line)
        if delta and delta.strip():
            self.has_text = True
        return delta

    def read(self, line):
        line = line.rstrip('\r\n')
        if not line.strip():
            return '\n' if self.kind == 'text' else ''
        self.lines += 1
        try:
            event = json.loads(line)
        except ValueError:
            event = None
        if not isinstance(event, dict):
            self.text.append(line)
            if self.kind == 'text':
                self.understood += 1
            return line + '\n' if self.kind in ('text', 'agy') else ''
        if isinstance(event.get('event'), str) and 'type' not in event:
            return self.agy(event)
        if event.get('type') in KNOWN_TYPES or isinstance(event.get('msg'), dict):
            self.understood += 1
        if isinstance(event.get('model'), str) and not self.model:
            self.model = event['model']
        kind = event.get('type')
        if kind == 'system' and event.get('subtype') == 'init':
            self.session = event.get('session_id') or self.session
            return ''
        if kind == 'stream_event':
            inner = event.get('event') or {}
            if inner.get('type') == 'message_start' and isinstance((inner.get('message') or {}).get('model'), str):
                self.model = self.model or inner['message']['model']
            delta = inner.get('delta') or {}
            if inner.get('type') == 'content_block_delta' and delta.get('type') == 'text_delta' and isinstance(delta.get('text'), str):
                self.streamed = True
                return delta['text']
            if inner.get('type') == 'message_stop' and self.streamed:
                return '\n\n'
            return ''
        if kind == 'assistant':
            message = event.get('message') or {}
            if isinstance(message.get('model'), str):
                self.model = self.model or message['model']
            content = message.get('content')
            text = content if isinstance(content, str) else ''.join(
                block.get('text', '') for block in content or [] if isinstance(block, dict) and block.get('type') == 'text')
            if text:
                self.messages.append(text)
                if not self.streamed:
                    return text + '\n\n'
            return ''
        if kind == 'result':
            if isinstance(event.get('result'), str):
                self.result = event['result']
                if self.result.strip():
                    self.replace = self.result.strip()
            if event.get('is_error'):
                self.error = str(event.get('result') or event.get('subtype') or 'error')[:600]
            self.session = event.get('session_id') or self.session
            return ''
        if kind in ('item.completed', 'item.updated', 'item.started'):
            item = event.get('item') or {}
            if item.get('type') in ('agent_message', 'assistant_message') and isinstance(item.get('text'), str) and kind == 'item.completed':
                self.messages.append(item['text'])
                return item['text'] + '\n\n'
            return ''
        if kind == 'thread.started':
            self.session = event.get('thread_id') or self.session
            return ''
        if kind in ('error', 'turn.failed'):
            error = event.get('error')
            detail = event.get('message') or (error.get('message') if isinstance(error, dict) else error)
            self.error = str(detail or kind)[:600]
            return ''
        message = event.get('msg') if isinstance(event.get('msg'), dict) else None
        if message:
            if message.get('type') == 'agent_message_delta' and isinstance(message.get('delta'), str):
                self.streamed = True
                return message['delta']
            if message.get('type') == 'agent_message' and isinstance(message.get('message'), str):
                self.messages.append(message['message'])
                return '' if self.streamed else message['message'] + '\n\n'
            return ''
        for key in ('delta', 'text'):
            if kind in ('text', 'delta', 'content', 'message') and isinstance(event.get(key), str):
                self.streamed = True
                return event[key]
        return ''

    def agy(self, event):
        """agy `--output-format stream-json`: one `event` object per line."""
        kind = event['event']
        if kind not in ('init', 'step_update', 'result', 'error'):
            return ''
        self.understood += 1
        self.session = event.get('conversation_id') or self.session
        if kind == 'init':
            return ''
        if kind == 'error':
            error = event.get('error')
            self.error = str((error.get('message') if isinstance(error, dict) else error) or event.get('message') or 'agy reported an error')[:600]
            return ''
        if kind == 'result':
            result = event.get('result') if isinstance(event.get('result'), dict) else {}
            self.session = result.get('conversation_id') or self.session
            self.status = result.get('status') if isinstance(result.get('status'), str) else 'UNKNOWN'
            if isinstance(result.get('response'), str):
                self.result = result['response']
                if self.result.strip():
                    self.replace = self.result.strip()
            if self.status != 'SUCCESS':
                detail = result.get('error') or result.get('message')
                if isinstance(detail, dict):
                    detail = detail.get('message')
                self.status_detail = str(detail)[:500] if detail else None
                self.error = (f'agy finished with status {self.status}' + (f': {detail}' if detail else '.'))[:600]
            return ''
        step = event.get('step_update') if isinstance(event.get('step_update'), dict) else {}
        if isinstance(step.get('model'), str) and not self.model:
            self.model = step['model']
        if step.get('step_type') == 'tool':
            if step.get('state') == 'ACTIVE' and step.get('step_index') != self.step:
                self.tools += 1
            return ''
        if step.get('step_type') != 'agent_response':
            return ''
        delta = step.get('text_delta')
        if not isinstance(delta, str) or not delta:
            return ''
        index = step.get('step_index')
        prefix = '\n\n' if self.has_text and index != self.step else ''
        self.step = index
        self.streamed = True
        return prefix + delta

    def final(self, streamed_text, last_message=None):
        if self.result and self.result.strip():
            return self.result.strip()
        if last_message and last_message.strip():
            return last_message.strip()
        if self.messages:
            return self.messages[-1].strip()
        if self.streamed and streamed_text.strip():
            return streamed_text.strip()
        if self.kind in ('text', 'agy') and self.text:
            return '\n'.join(self.text).strip()
        return streamed_text.strip()


def process_group_rss(pgid):
    rows = subprocess.check_output(['ps', '-axo', 'pgid=,rss='], text=True, timeout=5)
    return sum(int(parts[1]) * 1024 for line in rows.splitlines() if len(parts := line.split()) == 2 and int(parts[0]) == pgid)


def data_size(folder):
    total = 0
    for base, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if not (Path(base) / d).is_symlink()]
        for name in files:
            p = Path(base) / name
            try:
                if not p.is_symlink():
                    total += p.stat().st_size
            except FileNotFoundError:
                pass
    return total


def kill_group(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def supervise(argv, cwd, stdin, env, timeout, cancelled, on_line, on_start, outputs, cpu_seconds, limits=True, on_raw=None):
    """Run one CLI turn in its own process group, copying stdout and stderr to `outputs`
    (two binary files) and every line to `on_raw(stream, text)`.
    Returns (state, exit_code, error, stderr_tail)."""
    out_bytes = [0]
    tail = deque(maxlen=64)
    stop = threading.Event()
    stdout_log, stderr_log = outputs
    with stdout_log, stderr_log:
        command = [sys.executable, '-I', '-c', SHIM, str(cpu_seconds), *argv]
        worker = subprocess.Popen(command, cwd=cwd, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  env=env, start_new_session=True)
        on_start(worker.pid)

        def pump(pipe, log, lines):
            try:
                for raw in iter(pipe.readline, b''):
                    if out_bytes[0] + len(raw) > MAX_OUTPUT:
                        stop.set(); kill_group(worker.pid); break
                    out_bytes[0] += len(raw)
                    log.write(raw); log.flush()
                    text = raw.decode('utf-8', errors='replace')
                    if on_raw:
                        on_raw('stdout' if lines else 'stderr', text)
                    if lines:
                        on_line(text)
                    else:
                        tail.append(text.rstrip('\n')[-400:])
            except (OSError, ValueError):
                kill_group(worker.pid)
        readers = [threading.Thread(target=pump, args=(worker.stdout, stdout_log, True), daemon=True),
                   threading.Thread(target=pump, args=(worker.stderr, stderr_log, False), daemon=True)]
        for reader in readers:
            reader.start()
        deadline = time.monotonic() + timeout
        next_check = 0
        state, error = None, None
        try:
            while worker.poll() is None:
                if cancelled():
                    state, error = 'cancelled', 'Cancelled by you.'
                    break
                if time.monotonic() > deadline:
                    state, error = 'timeout', f'Timed out after {timeout} seconds.'
                    break
                if stop.is_set():
                    state, error = 'failed', 'The turn exceeded its 16 MiB output budget.'
                    break
                if limits and time.monotonic() >= next_check:
                    next_check = time.monotonic() + 5
                    if not has_capacity(cwd):
                        state, error = 'failed', 'Free disk space fell below Reader’s reserve.'
                        break
                    if process_group_rss(worker.pid) > MAX_RSS:
                        state, error = 'failed', 'The turn exceeded its 4 GiB process-group memory limit.'
                        break
                    if data_size(cwd / '.reader') > MAX_DATA:
                        state, error = 'failed', 'Reader’s 4 GiB .reader data budget is full.'
                        break
                time.sleep(.1)
        except Exception as exc:  # A failed measurement stops the owned workload.
            state, error = 'failed', 'Resource check failed: ' + str(exc)[:300]
        finally:
            kill_group(worker.pid)
            worker.wait()
            for reader in readers:
                reader.join(timeout=3)
        if stop.is_set() and state is None:
            state, error = 'failed', 'The turn exceeded its 16 MiB output budget.'
        return state, worker.returncode, error, '\n'.join(tail)[-4000:]


def classify(state, code, error, parser, body, name, voice, timeout):
    """(state, failure, error, warning) for a finished CLI turn, with a reason a person can act on.

    `failure` is one of exit, status, empty, unreadable, no-reply, timeout, cancelled or resource."""
    who = f'{name}’s CLI ({os.path.basename(voice["cli"])})'
    if state == 'timeout':
        return state, 'timeout', f'Timed out after {timeout} s, the limit set by timeout_seconds in voices.json.', None
    if state == 'cancelled':
        return state, 'cancelled', error, None
    if state is not None:
        return state, 'resource', error, None
    if code:
        reason = f'{who} was killed by signal {-code}.' if code < 0 else f'{who} exited with status {code}.'
        return 'failed', 'exit', reason + (f' It reported: {parser.error}' if parser.error else ''), None
    if parser.status and parser.status != 'SUCCESS':
        detail = f': {parser.status_detail}' if parser.status_detail else '.'
        return 'failed', 'status', f'{who} finished with status {parser.status}{detail}', None
    if body:
        warning = None
        if voice['stream'] == 'agy' and parser.result is None:
            warning = f'{who} ended without its final result event; this reply is the streamed text.'
        return 'done', None, None, warning
    if not parser.lines:
        return 'failed', 'empty', f'{who} exited 0 without printing anything.', None
    if not parser.understood:
        return 'failed', 'unreadable', (f'{who} exited 0 but Reader couldn’t read its output: none of its {parser.lines} '
                                        f'lines were {voice["stream"]} stream events. Open “Show raw output” to inspect them.'), None
    return 'failed', 'no-reply', parser.error or f'{who} exited 0, but its output held no reply.', None


class ChatOwned(Exception):
    """Another Reader server owns chat for this vault; the API answers 409."""


class Supervisor:
    """`.reader/voice-runner/supervisor.lock`: the one Reader server per vault that owns chat holds it for its life (#20, #72).

    flock decides between processes on one kernel, and the kernel releases it when the holder exits or crashes.
    A host and a container may not share flock through a bind mount, so the holder also keeps a small heartbeat
    record in the file: a record from another host fresher than SUPERVISOR_STALE seconds counts as held."""
    SIZE = 512

    def __init__(self, runtime, clock=time.time, host=None):
        self.file = Path(runtime) / 'supervisor.lock'
        self.clock = clock
        self.host = host or socket.gethostname()
        self.fd = None
        self.started = None
        self.stop = threading.Event()
        self.mutex = threading.Lock()  # The heartbeat never writes to a descriptor that release() closed.

    def read(self):
        try:
            fd = os.open(self.file, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                data = json.loads(os.read(fd, self.SIZE).decode().strip() or 'null')
            finally:
                os.close(fd)
            return data if isinstance(data, dict) else None
        except (OSError, ValueError):
            return None

    def write(self, heartbeat):
        record = json.dumps({'pid': os.getpid(), 'host': self.host, 'started_at': self.started, 'heartbeat': heartbeat})
        # One fixed-size write at offset 0, so a reader never sees a half-truncated record.
        os.pwrite(self.fd, record.encode().ljust(self.SIZE), 0)

    def acquire(self):
        """True when this process owns chat for the vault (now or already)."""
        if self.fd is not None:
            return True
        try:
            self.file.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self.file, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o644)
        except OSError:
            return False  # Fail closed: an unusable lock file (a symlink, say) never grants ownership.
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(fd)
            return False
        if self.foreign():
            os.close(fd)  # Another kernel's live owner: its flock is invisible here, its heartbeat is not.
            return False
        self.fd, self.started = fd, stamp()
        self.write(self.clock())
        self.stop = threading.Event()  # A fresh event per hold, so an old heartbeat thread never resumes.
        threading.Thread(target=self.beat, args=(self.stop,), name='reader-chat-supervisor', daemon=True).start()
        return True

    def beat(self, stop):
        while not stop.wait(SUPERVISOR_BEAT):
            with self.mutex:
                if self.fd is None:
                    return
                try:
                    self.write(self.clock())
                except OSError:
                    return

    def held(self):
        """Whether another server holds the lock, checked without taking it or writing anything."""
        if self.fd is not None:
            return False
        try:
            fd = os.open(self.file, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            return False
        except OSError:
            return True  # Fail closed, as acquire() does.
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return True
        finally:
            os.close(fd)
        return self.foreign()

    def foreign(self):
        """A live owner on another host: its record is fresher than SUPERVISOR_STALE seconds."""
        other = self.read()
        return bool(other and other.get('host') != self.host and isinstance(other.get('heartbeat'), (int, float))
                    and self.clock() - other['heartbeat'] < SUPERVISOR_STALE)

    def release(self):
        self.stop.set()
        with self.mutex:
            if self.fd is None:
                return
            try:
                self.write(0)  # Released: another host may take over at once.
            except OSError:
                pass
            os.close(self.fd)
            self.fd = None


class VoiceRunner:
    def __init__(self, root, documents, rng=None, git_locks=None, limits=True, listen_filter=None, capacity=None):
        self.root = Path(root).resolve(strict=True)
        # Optional pre-filter (RW-22 hook, off by default): listen_filter(voice, exchange) -> bool.
        self.listen_filter = listen_filter
        self.chain_voices = {}
        self.listened = set()
        self.pending_logs = {}
        self.capacity = capacity or has_capacity
        self.chats = Chats(self.root)
        self.registry = voice_tools.Registry(self.root)
        self.documents = documents
        self.rng = rng or random.Random()
        self.git_locks = git_locks
        self.limits = limits
        self.runtime = self.root / '.reader' / 'voice-runner'
        self.lock = threading.RLock()
        self.changed = threading.Condition(self.lock)
        self.turns = {}
        self.queue = deque()
        self.active = None
        self.events = deque(maxlen=12000)  # Raw frames share it with deltas; a gap resynchronizes clients.
        self.seq = 0
        self.chains = {}
        self.commit_results = {}
        self.versions = {}
        self.closed = False
        self.saved_at = 0
        self.commits = queue.Queue()
        # Chat commits never run while a voice works, so they cannot collide with its Git operations.
        self.quiet = threading.Lock()
        # Only the server that holds the supervisor lock recovers turns, runs them or writes state.json;
        # any other server on the vault serves chat read-only and takes over once the owner stops.
        # A server takes the lock at start only when there is state to recover, and otherwise on its first chat
        # action, so a server that only reads writes nothing to the vault.
        self.supervisor = Supervisor(self.runtime)
        self.owner = (self.runtime / 'state.json').is_file() and self.supervisor.acquire()
        if self.owner:
            self.recover()
        threading.Thread(target=self.work, name='reader-voice-runner', daemon=True).start()
        threading.Thread(target=self.commit_worker, name='reader-chat-commits', daemon=True).start()

    # State ----------------------------------------------------------------

    def view(self, turn):
        result = {k: turn.get(k) for k in ('id', 'chat_id', 'voice', 'reply_to', 'chain', 'hop', 'chosen_by', 'retry_of', 'state',
                                           'message', 'queued_at', 'started_at', 'finished_at', 'text', 'error', 'stderr_tail',
                                           'process_group', 'rev', 'kind', 'root', 'reason', 'hand_id', 'log', 'timeout_seconds')}
        if turn.get('kind') == 'listen':
            result['text'] = ''  # A listening check's answer is routing, never shown as a reply.
        if turn['state'] == 'queued':
            result['ahead'] = list(self.queue).index(turn['id']) + (1 if self.active else 0) if turn['id'] in self.queue else 0
        if turn.get('monotonic'):
            result['elapsed'] = round(time.monotonic() - turn['monotonic'], 1)
        return result

    def own(self):
        """Refuse a chat change unless this server owns chat; take ownership when the previous owner has stopped."""
        with self.lock:
            if self.owner:
                return
            if self.closed or not self.supervisor.acquire():
                raise ChatOwned(OWNED + '; chat is read-only here. Use the server that owns it, or stop that server first.')
            self.owner = True
            self.recover()

    def ownership(self):
        """`writable`: this server owns chat, or will on its first chat action because no other server holds it."""
        writable = bool(self.owner) or not self.closed and not self.supervisor.held()
        return {'owner': bool(self.owner), 'writable': writable, 'message': None if writable else OWNED + '; chat is read-only here.'}

    def save(self, force=False):
        if not self.owner:
            return
        if not force and time.monotonic() - self.saved_at < 1:
            return
        self.saved_at = time.monotonic()
        self.runtime.mkdir(parents=True, exist_ok=True)
        state = {'updated_at': stamp(), 'supervisor_pid': os.getpid(), 'active': self.active, 'queue': list(self.queue),
                 'turns': {tid: self.view(t) for tid, t in self.turns.items()}}
        temporary = self.runtime / 'state.next.json'
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(self.runtime / 'state.json')

    def emit(self, chat_id, kind, data):
        with self.lock:
            self.seq += 1
            self.events.append((self.seq, chat_id, kind, data))
            self.changed.notify_all()

    def publish(self, turn, force=True):
        with self.lock:
            turn['rev'] = turn.get('rev', 0) + 1
            self.emit(turn['chat_id'], 'state', self.view(turn))
            self.save(force)

    def positions(self):
        for tid in self.queue:
            self.turns[tid]['rev'] = self.turns[tid].get('rev', 0) + 1
            self.emit(self.turns[tid]['chat_id'], 'state', self.view(self.turns[tid]))

    def pending(self, chat_id):
        with self.lock:
            return [self.view(t) for t in self.turns.values() if t['chat_id'] == chat_id and t['state'] not in TERMINAL]

    def wait(self, chat_id, after, timeout):
        """Events for one chat after sequence `after`: (events, last_seq, gap)."""
        with self.lock:
            def ready():
                return self.closed or any(seq > after and cid == chat_id for seq, cid, _, _ in self.events)
            self.changed.wait_for(ready, timeout)
            gap = bool(self.events) and self.events[0][0] > after + 1 and after > 0
            rows = [(seq, kind, data) for seq, cid, kind, data in self.events if seq > after and cid == chat_id]
            return rows, self.seq, gap

    def recover(self):
        """Mark turns a previous server left behind as failed, so Retry can run them again."""
        state_file = self.runtime / 'state.json'
        if not state_file.is_file() or state_file.is_symlink() or state_file.stat().st_size > 32 * 1024**2:
            return
        lock = self.runtime / 'run.lock'
        if lock.exists():
            with lock.open('a') as handle:
                try:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return  # Another live Reader process owns those turns.
                fcntl.flock(handle, fcntl.LOCK_UN)
        try:
            previous = json.loads(state_file.read_text())
        except ValueError:
            return
        changed = False  # Rewrite state.json only when a turn was actually recovered (#72).
        for turn in (previous.get('turns') or {}).values():
            if not isinstance(turn, dict) or turn.get('state') in TERMINAL:
                continue
            if turn.get('kind') == 'listen':
                changed = True
                # An interrupted listening check simply did not happen, but its log is sealed and kept.
                try:
                    if turn.get('log'):
                        llm_logs.seal(self.root, turn['log'], 'interrupted', 'Reader stopped before this run finished.')
                        self.commit_later(turn['chat_id'], 'Chat log: listening check interrupted', turn['voice'], [turn['log']])
                except (ValueError, OSError, KeyError):
                    pass
                continue
            group = turn.get('process_group')
            note = f' Its process group {group} may still be running; inspect it before retrying.' if group else ''
            log = turn.get('log')
            try:
                if log:
                    llm_logs.seal(self.root, log, 'interrupted', 'Reader stopped before this run finished.')
            except (ValueError, OSError):
                log = None
            try:
                chat = self.chats.read(turn['chat_id'])
                self.chats.append(chat['id'], {
                    'id': turn['id'], 'author': turn['voice'], 'body': turn.get('text') or '', 'mentions': [],
                    'reply_to': turn.get('reply_to'), 'chosen_by': turn.get('chosen_by'), 'runtime': None,
                    'turn': {'id': turn['id'], 'state': 'failed', 'seconds': None, 'changed_paths': [], 'commits': [],
                             'commit': None, 'failure': 'interrupted', 'log': log, 'timeout_seconds': turn.get('timeout_seconds'),
                             'error': 'Reader stopped before this turn finished.' + note}})
                self.commit_later(chat['id'], f'Chat: {chat["title"]} — {turn["voice"]} turn interrupted', turn['voice'],
                                  [log] if log else ())
            except (ValueError, KeyError, OSError):
                continue
            changed = True
        if changed:
            self.save(True)

    def close(self):
        with self.lock:
            self.closed = True
            self.supervisor.release()
            for turn in self.turns.values():
                if turn['state'] not in TERMINAL:
                    turn['cancel'] = True
            self.changed.notify_all()
        self.commits.put(None)

    # Queue ----------------------------------------------------------------

    def enqueue(self, chat_id, voice, reply_to, chain, hop=0, chosen_by='mention', retry_of=None, kind='turn', root=None,
                listen=False, **extra):
        """Queue a turn. `kind` is `turn`, `chime_in` or `listen`; `root` is the user message that began the exchange,
        and `listen` marks an addressed exchange whose end may start listening checks."""
        with self.lock:
            if self.closed:
                raise ValueError('Reader is shutting down')
            if kind != 'listen':
                if self.chains.get(chain, 0) >= MAX_HOPS:
                    return None
                self.chains[chain] = self.chains.get(chain, 0) + 1
                self.chain_voices.setdefault(chain, set()).add(voice)
                for table in (self.chains, self.chain_voices):
                    if len(table) > 5000:
                        table.pop(next(iter(table)))
            turn = {'id': str(uuid4()), 'chat_id': chat_id, 'voice': voice, 'reply_to': reply_to, 'chain': chain, 'hop': hop,
                    'chosen_by': chosen_by, 'retry_of': retry_of, 'state': 'queued', 'message': 'Queued', 'queued_at': stamp(),
                    'text': '', 'cancel': False, 'kind': kind, 'root': root, 'listen': listen} | extra
            self.turns[turn['id']] = turn
            self.queue.append(turn['id'])
            self.publish(turn)
            return self.view(turn)

    def cancel(self, turn_id):
        with self.lock:
            turn = self.turns.get(str(turn_id))
            if not turn or turn['state'] in TERMINAL:
                raise ValueError('That turn is not running or queued')
            turn['cancel'] = True
            if turn['id'] in self.queue:
                self.queue.remove(turn['id'])
                self.finish_unrun(turn, 'Cancelled before it started.')
                self.positions()
            else:
                (self.runtime / 'cancel').touch()
            self.changed.notify_all()
            return self.view(turn)

    def finish_unrun(self, turn, message):
        """End a turn that never started with a cancelled reply in the chat, so its message can be retried.
        A listening check that never ran simply did not happen: it leaves no reply."""
        if turn.get('kind') == 'listen':
            turn.update(state='cancelled', message=message, finished_at=stamp())
            self.publish(turn)
            self.emit(turn['chat_id'], 'done', {'turn_id': turn['id'], 'state': 'cancelled', 'message': None})
        else:
            self.complete(turn, 'cancelled', error=message)
        self.turns.pop(turn['id'], None)

    def work(self):
        while True:
            with self.lock:
                self.changed.wait_for(lambda: self.closed or self.queue)
                if self.closed:
                    return
                # Listening checks never run while an ordinary turn is queued.
                tid = next((t for t in self.queue if self.turns[t].get('kind') != 'listen'), self.queue[0])
                self.queue.remove(tid)
                turn = self.turns[tid]
                self.active = turn['id']
                self.positions()
            try:
                self.run(turn)
            except Exception as exc:  # A turn failure is reported, never raised into the server.
                if os.environ.get('READER_DEBUG'):
                    traceback.print_exc()
                try:
                    if turn.get('kind') == 'listen':
                        self.heard(turn, 'failed', '', str(exc)[:600] or type(exc).__name__, [], [])
                    else:
                        self.complete(turn, 'failed', error=str(exc)[:600] or type(exc).__name__)
                except Exception:
                    pass
            finally:
                with self.lock:
                    self.active = None
                    self.turns.pop(turn['id'], None)
                    self.positions()
                    self.save(True)

    # One turn -------------------------------------------------------------

    def admitted(self, turn):
        """Wait for the inbox runner and other chat turns; return the held run lock or None if cancelled."""
        self.runtime.mkdir(parents=True, exist_ok=True)
        inbox = self.root / '.reader' / 'inbox-runner' / 'run.lock'
        while not turn['cancel'] and not self.closed:
            with (self.root / '.reader' / 'upkeep.lock').open('a') as coordination:
                fcntl.flock(coordination, fcntl.LOCK_EX)
                waiting = None
                if inbox.exists():
                    with inbox.open('a') as other:
                        try:
                            fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            fcntl.flock(other, fcntl.LOCK_UN)
                        except BlockingIOError:
                            waiting = 'Waiting for the inbox run to finish'
                if not waiting:
                    own = (self.runtime / 'run.lock').open('a')
                    try:
                        fcntl.flock(own, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        return own
                    except BlockingIOError:
                        own.close()
                        waiting = 'Waiting for another chat turn in this vault'
            if turn['message'] != waiting:
                turn.update(state='waiting', message=waiting)
                self.publish(turn)
            with self.lock:
                self.changed.wait_for(lambda: turn['cancel'] or self.closed, 1)
        return None

    def git(self, *args):
        git = shutil.which('git')
        if not git:
            return None
        result = subprocess.run([git, '--no-optional-locks', *args], cwd=self.root, capture_output=True, timeout=30)
        return result.stdout if result.returncode == 0 else None

    def snapshot(self):
        head = self.git('rev-parse', 'HEAD')
        status = self.git('status', '--porcelain=v1', '-z', '--untracked-files=all')
        if status is None:
            return None
        entries = {}
        parts = status.decode('utf-8', 'replace').split('\0')
        index = 0
        while index < len(parts):
            row = parts[index]; index += 1
            if len(row) < 4:
                continue
            code, path = row[:2], row[3:]
            if code[0] in 'RC':
                index += 1  # The rename source follows.
            if len(entries) >= 20000:
                break
            try:
                info = (self.root / path).lstat()
                signature = (info.st_size, info.st_mtime_ns)
            except OSError:
                signature = None
            entries[path] = (code, signature)
        return {'head': head.decode().strip() if head else None, 'entries': entries}

    def changes(self, before):
        if before is None:
            return None, []
        after = self.snapshot()
        if after is None:
            return None, []
        paths = {p for p, entry in after['entries'].items() if before['entries'].get(p) != entry}
        paths |= {p for p in before['entries'] if p not in after['entries']}
        commits = []
        if after['head'] and after['head'] != before['head']:
            span = f'{before["head"]}..{after["head"]}' if before['head'] else after['head']
            listed = self.git('rev-list', '--reverse', '--max-count=50', span)
            commits = [c for c in (listed.decode().split() if listed else []) if not self.chat_commit(c)]
            names = self.git('diff', '--name-only', '-z', before['head'], after['head']) if before['head'] else None
            if names:
                paths |= {p for p in names.decode('utf-8', 'replace').split('\0') if p}
        visible = sorted(p for p in paths if not p.startswith(('chats/', '.reader/', llm_logs.ROOT + '/')))
        return visible[:200], commits

    def chat_commit(self, commit):
        """Reader's own chat and LLM-log commits are not the voice's: a `Reader-Chat` commit of chats and
        logs, or a `Reader-Log` commit of LLM logs only (the local-model worker's)."""
        shown = self.git('show', '--name-only', '--format=%B%x00', commit)
        if not shown:
            return False
        body, _, names = shown.decode('utf-8', 'replace').partition('\0')
        files = [n for n in names.split('\n') if n.strip()]
        if not files:
            return False
        if '\nReader-Chat: ' in body and all(n.startswith(('chats/', llm_logs.ROOT + '/')) for n in files):
            return True
        return '\nReader-Log: ' in body and all(n.startswith(llm_logs.ROOT + '/') for n in files)

    def version(self, voice):
        if not voice.get('version_argv') or not voice.get('executable'):
            return None
        executable = voice['executable']
        try:
            key = (executable, os.stat(executable).st_mtime_ns)
        except OSError:
            return None
        if key not in self.versions:
            try:
                result = subprocess.run([executable, *voice['version_argv']], capture_output=True, text=True, timeout=10,
                                        stdin=subprocess.DEVNULL, start_new_session=True)
                text = (result.stdout or result.stderr).strip().splitlines()
                self.versions[key] = text[0][:100] if result.returncode == 0 and text else None
            except (OSError, subprocess.TimeoutExpired):
                self.versions[key] = None
        return self.versions[key]

    def expand(self, voice, system, prompt, workspace, registry):
        values = {'{vault}': str(self.root), '{persona}': system, '{prompt}': prompt, '{last_message}': str(workspace / 'last-message.md')}
        argv = [voice['executable']]
        for item in voice['argv']:
            if item == '{sandbox_add_dirs}':
                from .inbox_runner import sandbox_writable_paths
                for path in sandbox_writable_paths(self.root, registry.get('workstation_lock_store')):
                    argv.extend(['--add-dir', path])
                continue
            for key, value in values.items():
                if key in item:
                    item = value if item == key else item.replace(key, value)
            argv.append(item)
        return argv

    def run(self, turn):
        registry = self.registry.load()
        voice = next((v for v in registry['voices'] if v['name'] == turn['voice']), None)
        if not voice or not voice_tools.runnable(voice):
            raise ValueError(f'{turn["voice"]} is not an enabled voice with an installed CLI')
        listening = turn.get('kind') == 'listen'
        turn['timeout_seconds'] = min(voice_tools.LISTEN_TIMEOUT, voice['timeout_seconds']) if listening else voice['timeout_seconds']
        if not self.capacity(self.root):
            # LLM logs are never dropped, so a run that could not be logged does not start.
            reserve = minimum_free_bytes(self.root) / 1024**3
            error = (f'Reader refuses to start LLM runs while free disk space is below {reserve:g} GiB, '
                     'so their logs are never dropped. Free some space, then Retry.')
            if listening:
                self.heard(turn, 'failed', '', error, [], [], 'capacity')
            else:
                self.complete(turn, 'failed', failure='capacity', error=error)
            return
        held = self.admitted(turn)
        holding = [False]
        log = None
        if held is None:
            with self.lock:
                self.finish_unrun(turn, 'Cancelled before it started.')
            return
        try:
            (self.runtime / 'cancel').unlink(missing_ok=True)
            chat = self.chats.read(turn['chat_id'])
            document = self.documents(chat['document_path'], voice.get('inline_document') and not listening)
            if listening:
                system, prompt = voice_tools.listen(self.root, voice, chat, document, turn['root'], turn.get('reply_ids') or [])
            else:
                system, prompt = voice_tools.build(self.root, voice, chat, document, turn['reply_to'], registry,
                                                   document.get('text') if voice.get('inline_document') else None,
                                                   chime=turn.get('reason') if turn.get('kind') == 'chime_in' else None)
            log = llm_logs.RunLog(self.root, 'listen' if listening else 'chat', turn['id'], {
                'runner': 'voice-chat', 'turn_kind': turn.get('kind') or 'turn', 'root': turn.get('root'), 'voice': turn['voice'], 'chat_id': turn['chat_id'], 'turn_id': turn['id'],
                'reply_to': turn['reply_to'], 'document_path': chat['document_path'], 'cli': os.path.basename(voice['cli']),
                'stream': voice['stream'], 'timeout_seconds': turn['timeout_seconds'], 'cwd': str(self.root)})
            llm_logs.forget_usage(self.root)
            turn['log'] = log.relative
            log.write('prompt.txt', prompt)
            log.write('system.txt', system)
            temp = self.runtime / 'tmp'
            temp.mkdir(parents=True, exist_ok=True)
            deadline = time.monotonic() + 300
            while self.commits.unfinished_tasks and time.monotonic() < deadline and not turn['cancel']:
                time.sleep(.05)  # Earlier chat commits land first.
            self.quiet.acquire()
            holding[0] = True
            argv = self.expand(voice, system, prompt, log.dir, registry)
            runtime = {'cli': os.path.basename(voice['cli']), 'version': self.version(voice), 'model': voice.get('model')}
            log.update(argv=llm_logs.redact_argv(argv, {system: '<system.txt>', prompt: '<prompt.txt>'}), cli_version=runtime['version'])
            parser = StreamParser(voice['stream'])
            turn.update(state='running', message='Listening…' if listening else 'Thinking…', started_at=stamp(),
                        monotonic=time.monotonic(), runtime=runtime)
            self.publish(turn)
            if not listening:
                self.emit(turn['chat_id'], 'started', {'turn_id': turn['id'], 'voice': turn['voice']})
            before = self.snapshot()

            def show(text, offset):
                turn['text'] = turn['text'][:offset] + text
                if not listening:  # A listening check's answer is routing, never streamed as a reply.
                    self.emit(turn['chat_id'], 'delta', {'turn_id': turn['id'], 'offset': offset, 'text': text})
                self.save()

            def on_line(line):
                delta = parser.feed(line)
                with self.lock:
                    if delta and len(turn['text']) + len(delta) <= MAX_BODY * 4:
                        show(delta, len(turn['text']))
                    if parser.replace is not None:
                        # The CLI's final reply is authoritative: it replaces the streamed text.
                        final, parser.replace = parser.replace[:MAX_BODY * 4], None
                        if final != turn['text'].strip():
                            show(final, 0)

            counts = {'stdout': 0, 'stderr': 0}

            def on_raw(stream, text):
                if listening:
                    return  # Read from its archive on demand (Show raw output under the reply it followed).
                with self.lock:
                    line = text.rstrip('\r\n')
                    self.emit(turn['chat_id'], 'raw', {'turn_id': turn['id'], 'stream': stream, 'n': counts[stream],
                                                       'text': line[:RAW_FRAME], 'cut': len(line) > RAW_FRAME})
                    counts[stream] += 1

            def on_start(pid):
                with self.lock:
                    turn['process_group'] = pid
                    self.save(True)
            stdin = subprocess.DEVNULL if any('{prompt}' in a for a in voice['argv']) else (log.dir / 'prompt.txt.partial').open('rb')
            timeout = turn['timeout_seconds']
            try:
                state, code, error, tail = supervise(
                    argv, self.root, stdin, dict(os.environ, TMPDIR=str(temp)), timeout,
                    lambda: turn['cancel'] or self.closed or (self.runtime / 'cancel').exists(), on_line, on_start,
                    (log.open('stdout.jsonl'), log.open('stderr.log')), max(3600, timeout + 60), self.limits, on_raw)
            finally:
                if stdin is not subprocess.DEVNULL:
                    stdin.close()
            last_file = log.dir / 'last-message.md'
            last = last_file.read_text(errors='replace')[:MAX_BODY * 2] if last_file.is_file() and not last_file.is_symlink() else ''
            body = parser.final(turn['text'], last)
            runtime['model'] = parser.model or runtime['model']
            state, failure, error, warning = classify(state, code, error, parser, body, turn['voice'], voice, timeout)
            if state != 'done' and not body:
                body = turn['text'].strip()
            changed, commits = self.changes(before)
            holding[0] = False
            self.quiet.release()
            log.finish(state, exit_code=code, failure=failure, error=error, warning=warning, model=runtime['model'],
                       session_id=parser.session, stdout_lines=parser.lines, understood_lines=parser.understood,
                       changed_paths=changed, commits=commits)
            log = None
            llm_logs.forget_usage(self.root)
            if listening:
                self.heard(turn, state, body, error, changed, commits, failure)
            else:
                self.complete(turn, state, body=body, error=error, tail=tail if state != 'done' else None, exit_code=code,
                              changed=changed, commits=commits, runtime=runtime, session=parser.session, failure=failure, warning=warning)
        finally:
            if log is not None:
                try:
                    log.finish('failed', error='Reader stopped this run before it finished.')
                except OSError:
                    pass
            if holding[0]:
                self.quiet.release()
            fcntl.flock(held, fcntl.LOCK_UN)
            held.close()

    def complete(self, turn, state, body='', error=None, tail=None, exit_code=None, changed=None, commits=(), runtime=None, session=None,
                 failure=None, warning=None):
        if len(body) > MAX_BODY:
            body = body[:MAX_BODY - 40] + '\n\n…[reply truncated at 64 KiB]'
        seconds = round(time.monotonic() - turn['monotonic'], 1) if turn.get('monotonic') else None
        message = {'id': turn['id'], 'author': turn['voice'], 'body': body, 'mentions': [], 'reply_to': turn['reply_to'],
                   'chosen_by': turn['chosen_by'], 'runtime': runtime or turn.get('runtime'),
                   'turn': {'id': turn['id'], 'state': state, 'seconds': seconds, 'changed_paths': changed or [],
                            'changes_tracked': changed is not None, 'commits': list(commits),
                            'commit': commits[-1] if commits else None, 'exit_code': exit_code,
                            'timeout_seconds': turn.get('timeout_seconds'), 'log': turn.get('log')}}
        if turn.get('retry_of'):
            message['retry_of'] = turn['retry_of']
        if turn.get('root'):
            message['root'] = turn['root']
        if turn.get('kind') == 'chime_in':
            message.update(kind='chime_in', reason=turn.get('reason'), hand_id=turn.get('hand_id'))
        if session:
            message['runtime'] = dict(message['runtime'] or {}, session_id=session)
        if error:
            message['turn']['error'] = error
        if failure or (state != 'done' and state in ('timeout', 'cancelled')):
            message['turn']['failure'] = failure or state
        if warning:
            message['turn']['warning'] = warning
        if tail:
            message['turn']['stderr_tail'] = tail
        registry = None
        try:
            registry = self.registry.load()
            message['mentions'] = voice_tools.mentions(body, registry['voices']) if state == 'done' else []
        except ValueError:
            pass
        try:
            chat, _ = self.chats.append(turn['chat_id'], message)
        except ValueError as exc:
            turn.update(state='failed', message='Could not save the reply: ' + str(exc), finished_at=stamp())
            self.publish(turn)
            if turn.get('log'):
                self.commit_later(turn['chat_id'], f'Chat log: {turn["voice"]} turn could not be saved', turn['voice'], [turn['log']])
            self.emit(turn['chat_id'], 'done', {'turn_id': turn['id'], 'state': 'failed', 'message': None, 'error': str(exc)})
            return
        # Follow-up turns and listening checks are queued before this turn is published as finished, so no
        # observer ever sees the chat idle between a reply and the work it starts.
        if state == 'done' and registry:
            for name in message['mentions']:
                voice = next((v for v in registry['voices'] if v['name'] == name), None)
                if name != turn['voice'] and voice and voice_tools.runnable(voice):
                    self.enqueue(turn['chat_id'], name, turn['id'], turn['chain'], turn['hop'] + 1, 'mention',
                                 root=turn.get('root'), listen=turn.get('listen', False))
        if turn.get('listen') and registry:
            self.exchange_ended(turn, chat, registry)
        turn.update(state=state, message={'done': 'Done', 'failed': 'Failed', 'timeout': 'Timed out', 'cancelled': 'Cancelled'}[state],
                    finished_at=stamp(), error=error, stderr_tail=tail)
        self.publish(turn)
        self.emit(turn['chat_id'], 'done', {'turn_id': turn['id'], 'state': state, 'message': message, 'revision': chat['revision'],
                                            'llm_logs': llm_logs.usage(self.root, ttl=0)})
        verb = {'done': 'replied', 'failed': 'turn failed', 'timeout': 'turn timed out', 'cancelled': 'turn cancelled'}[state]
        self.commit_later(turn['chat_id'], f'Chat: {chat["title"]} — {turn["voice"]} {verb}', turn['voice'],
                          [turn['log']] if turn.get('log') else ())

    # Listening checks and chime-ins ------------------------------------------

    def exchange_ended(self, turn, chat, registry):
        """Queue listening checks once an addressed exchange has no ordinary turns left."""
        root = turn.get('root')
        with self.lock:
            if not root or root in self.listened or self.closed:
                return
            if any(t['id'] != turn['id'] and t.get('chain') == turn['chain'] and t.get('kind') != 'listen' and t['state'] not in TERMINAL
                   for t in self.turns.values()):
                return
            if chime_ins(chat) == 'off' or latest_user(chat) != root:
                return
            replies = [m['id'] for m in chat['messages'] if m.get('root') == root and m.get('kind', 'message') == 'message'
                       and (m.get('turn') or {}).get('state') == 'done']
            if not replies:
                return
            self.listened.add(root)
            if len(self.listened) > 5000:
                self.listened.pop()
            asked = next((m for m in chat['messages'] if m['id'] == root), {})
            involved = self.chain_voices.get(turn['chain'], set()) | set(asked.get('mentions') or [])
            listeners = [v for v in registry['voices'] if voice_tools.runnable(v) and v['name'] not in involved]
            if self.listen_filter:
                exchange = {'chat_id': chat['id'], 'root': asked, 'replies': [m for m in chat['messages'] if m['id'] in replies]}
                listeners = [v for v in listeners if self.listen_filter(v, exchange)]
            for index, voice in enumerate(listeners):
                self.enqueue(chat['id'], voice['name'], replies[-1], 'listen:' + root, 0, 'listen', kind='listen', root=root,
                             reply_ids=replies, last=index == len(listeners) - 1)

    def note_listened(self, turn, entry):
        """Record one listening outcome on the reply the checks followed; returns the updated message."""
        def change(message):
            record = message.setdefault('listening', {'voices': [], 'warnings': []})
            if entry.get('listened', True) and entry['voice'] not in record['voices']:
                record['voices'].append(entry['voice'])
            if entry.get('warning'):
                record['warnings'].append(entry['warning'])
            if entry.get('run'):
                # Each check's archived log, so Show raw output can open it under this reply.
                runs = record.setdefault('runs', [])
                if len(runs) < 50:
                    runs.append(entry['run'])
            return True
        chat, message = self.chats.amend(turn['chat_id'], turn['reply_to'], change)
        self.emit(turn['chat_id'], 'message', {'message': message, 'revision': chat['revision']})
        return chat

    def log_listening(self, row):
        self.runtime.mkdir(parents=True, exist_ok=True)
        log = self.runtime / 'listening.jsonl'
        if log.exists() and log.stat().st_size > MAX_LISTEN_LOG:
            log.replace(self.runtime / 'listening.1.jsonl')
        with log.open('a') as out:
            out.write(json.dumps(row, ensure_ascii=False) + '\n')

    def heard(self, turn, state, body, error, changed, commits, failure=None):
        """Finish a listening check: PASS (or anything malformed) is recorded quietly, HAND raises a hand,
        and a check that changed or committed anything is discarded with a warning. Its archived log
        (`logs/llm/listen/…`) rides along with this chat's next commit."""
        outcome, reason = voice_tools.listened(body) if state == 'done' else ('pass', None)
        warning = None
        if changed or commits:
            warning = {'voice': turn['voice'], 'at': stamp(), 'changed_paths': list(changed or [])[:50], 'commits': list(commits)[:50],
                       'message': f'{turn["voice"]} changed files during a listening check; its answer was discarded.'}
            outcome, reason = 'discarded', None
        self.log_listening({'at': stamp(), 'chat_id': turn['chat_id'], 'root': turn.get('root'), 'voice': turn['voice'], 'state': state,
                            'outcome': outcome, 'reason': reason, 'error': error, 'warning': warning, 'failure': failure,
                            'log': turn.get('log')})
        if turn.get('log'):
            with self.lock:
                self.pending_logs.setdefault(turn['chat_id'], []).append(turn['log'])
        try:
            if state != 'cancelled':
                self.attend(turn, state, outcome, reason, warning, failure)
        finally:
            # The check is published as finished only after its outcome is on the reply (and any hand or
            # chime-in it started is stored or queued), so the chat never looks idle without it.
            turn.update(state=state if state in TERMINAL else 'failed', message='Listened', finished_at=stamp(), error=error)
            self.publish(turn)
            self.emit(turn['chat_id'], 'done', {'turn_id': turn['id'], 'state': turn['state'], 'message': None})

    def attend(self, turn, state, outcome, reason, warning, failure):
        """Record a finished listening check's outcome: its note or warning on the reply, and any hand it raised."""
        try:
            run = {'turn_id': turn['id'], 'voice': turn['voice'], 'state': state, 'outcome': outcome, 'failure': failure,
                   'log': turn.get('log')} if turn.get('log') else None
            if state == 'done' or warning or run:
                # A failed or timed-out check is not listed as listened; only its log is recorded.
                chat = self.note_listened(turn, {'voice': turn['voice'], 'warning': warning, 'run': run,
                                                 'listened': state == 'done' or bool(warning)})
            else:
                chat = self.chats.read(turn['chat_id'])
        except ValueError:
            return
        if warning:
            self.emit(turn['chat_id'], 'warning', warning)
        raised = None
        if outcome == 'hand' and latest_user(chat) == turn.get('root'):
            free = chime_ins(chat) == 'free' and not self.chimed(chat, turn['root'])
            hand = {'author': turn['voice'], 'body': reason, 'kind': 'hand', 'reason': reason, 'state': 'accepted' if free else 'raised',
                    'reply_to': turn['reply_to'], 'root': turn['root'], 'mentions': []}
            try:
                chat, _ = self.chats.append(turn['chat_id'], hand)
            except ValueError:
                return
            raised = chat['messages'][-1]
            self.emit(turn['chat_id'], 'message', {'message': raised, 'revision': chat['revision'], 'hand': True})
            if free:
                self.drop_listening(turn['chat_id'], keep=turn['id'])
                self.chime(chat, raised)
        if raised or warning or turn.get('last'):
            self.commit_later(turn['chat_id'], f'Chat: {chat["title"]} — ' + (f'{turn["voice"]} raised a hand' if raised else 'voices listened'))

    def chimed(self, chat, root):
        return any(m.get('kind') == 'chime_in' and m.get('root') == root for m in chat['messages']) or any(
            t.get('kind') == 'chime_in' and t.get('root') == root and t['state'] not in TERMINAL for t in self.turns.values())

    def chime(self, chat, hand):
        return self.enqueue(chat['id'], hand['author'], hand['reply_to'], 'chime:' + hand['root'], 0, 'hand', kind='chime_in',
                            root=hand['root'], reason=hand['reason'], hand_id=hand['id'])

    def hush(self, chat):
        """Stop the current exchange's listening checks: those queued or running, and those its end has not
        queued yet (the exchange counts as listened), so a check being scheduled cannot slip past."""
        with self.lock:
            root = latest_user(chat)
            if root:
                self.listened.add(root)
            self.drop_listening(chat['id'])

    def drop_listening(self, chat_id, keep=None):
        """Cancel this chat's queued and running listening checks (except `keep`, a check that is finishing)."""
        with self.lock:
            for turn in list(self.turns.values()):
                if turn['chat_id'] != chat_id or turn.get('kind') != 'listen' or turn['state'] in TERMINAL or turn['id'] == keep:
                    continue
                turn['cancel'] = True
                if turn['id'] in self.queue:
                    self.queue.remove(turn['id'])
                    self.finish_unrun(turn, 'Listening stopped.')
                elif self.active == turn['id']:
                    (self.runtime / 'cancel').touch()
            self.positions()
            self.changed.notify_all()

    # Commits --------------------------------------------------------------

    def commit_later(self, chat_id, subject, voice=None, logs=()):
        with self.lock:
            # Listening logs wait for the chat's next commit rather than adding commits of their own.
            logs = tuple(logs) + tuple(self.pending_logs.pop(chat_id, ()))
        self.commits.put((chat_id, subject, voice, tuple(dict.fromkeys(logs))))

    def commit_worker(self):
        while (item := self.commits.get()) is not None:
            chat_id, subject, voice, logs = item
            try:
                with self.quiet:
                    result = self.chats.commit(chat_id, subject, voice, git_locks=self.git_locks, logs=logs)
            except Exception as exc:
                result = {'commit': None, 'status': 'failed', 'error': str(exc)[:600]}
            with self.lock:
                self.commit_results[chat_id] = result | {'subject': subject, 'at': stamp()}
                self.emit(chat_id, 'commit', self.commit_results[chat_id])
            self.commits.task_done()


def latest_user(chat):
    """The id of the newest message you wrote (not a voice turn, a pasted reply or a hand)."""
    return next((m['id'] for m in reversed(chat['messages']) if not m.get('turn') and m.get('kind', 'message') == 'message'
                 and not (m.get('runtime') or {}).get('manual')), None)


def stale(hand, at=None):
    try:
        created = datetime.fromisoformat(hand['created_at'])
    except (KeyError, ValueError):
        return True
    return ((at or datetime.now(timezone.utc)) - created).total_seconds() > HAND_TTL


class Conversations:
    """Chat routes over the store and the runner: create, send, paste, cancel and retry.
    Every action that writes first calls `runner.own()`: a server that does not own chat for the vault refuses it."""

    def __init__(self, root, documents, rng=None, git_locks=None, limits=True, listen_filter=None, capacity=None):
        self.runner = VoiceRunner(root, documents, rng, git_locks, limits, listen_filter, capacity)
        self.chats = self.runner.chats
        self.registry = self.runner.registry
        self.documents = documents

    def voices(self):
        registry = self.registry.load()
        return {'configured': registry['configured'], 'voices': [voice_tools.public(v) for v in registry['voices']],
                'timeout_seconds': registry['timeout_seconds'], 'llm_logs': llm_logs.usage(self.runner.root), 'owner': self.runner.ownership()}

    def raw(self, chat_id, turn_id):
        """One turn's archived CLI output: stdout events, stderr, the prompt and meta, decompressed and bounded."""
        chat = self.chats.read(chat_id)
        turn_id = Chats.identity(turn_id)
        with self.runner.lock:
            live = self.runner.turns.get(turn_id)
            log = live.get('log') if live and live['chat_id'] == chat['id'] else None
            running = bool(live) and live['state'] not in TERMINAL
        if not live:
            message = next((m for m in chat['messages'] if m['id'] == turn_id), None)
            log = (message.get('turn') or {}).get('log') if message else None
            if not message:
                # A listening check has no message of its own: its log is recorded on the reply it followed.
                run = next((r for m in chat['messages'] for r in ((m.get('listening') or {}).get('runs') or []) if r.get('turn_id') == turn_id), None)
                if not run:
                    raise ValueError('No such turn in this chat')
                log = run.get('log')
        result = {'turn_id': turn_id, 'log': log, 'running': running, 'limit': RAW_LIMIT}
        if not log:
            return result | {'stdout': None, 'stderr': None, 'prompt': None, 'system': None, 'meta': None}
        for name, key, limit in (('stdout.jsonl', 'stdout', RAW_LIMIT), ('stderr.log', 'stderr', RAW_LIMIT // 4),
                                 ('prompt.txt', 'prompt', RAW_LIMIT // 4), ('system.txt', 'system', RAW_LIMIT // 16)):
            text, total, truncated = llm_logs.read(self.runner.root, log, name, limit)
            result[key] = text
            result[key + '_truncated'] = truncated
        meta, _, _ = llm_logs.read(self.runner.root, log, 'meta.json', 256 * 1024)
        try:
            result['meta'] = json.loads(meta) if meta else None
        except ValueError:
            result['meta'] = None
        # The archive keeps the real cwd, argv and prompt; a browser (a tailnet one too) sees <vault> and ~ (#105).
        return shown(result, self.runner.root)

    def list(self, path):
        self.documents(path, False)
        return {'path': path, 'chats': self.chats.list(path)} | self.voices()

    def get(self, chat_id):
        chat = self.chats.read(chat_id)
        if self.runner.owner and any(m.get('kind') == 'hand' and m.get('state') == 'raised' and stale(m) for m in chat['messages']):
            chat = self.expire(chat['id'], lambda m: stale(m))
        return {'chat': chat, 'pending': self.runner.pending(chat['id']), 'commit': self.runner.commit_results.get(chat['id']),
                'last_event': self.runner.seq} | self.voices()

    def dispatch(self, request, participant):
        action = request.pop('action', None)
        handlers = {'create': self.create, 'send': self.send, 'paste': self.paste, 'cancel': self.cancel, 'retry': self.retry,
                    'hand': self.hand, 'settings': self.settings, 'hush': self.hush}
        if action not in handlers:
            raise ValueError('Unknown chat action')
        return handlers[action](participant=participant, **request)

    def create(self, path, participant, request_id=None, author=None, reuse=False):
        self.runner.own()
        document = self.documents(path, False)
        chat = self.chats.create(path, document['sha256'], document['title'], author or participant, request_id, bool(reuse))
        return self.get(chat['id'])

    def route(self, chat, message, registry, random_fallback):
        named = voice_tools.mentions(message['body'], registry['voices'])
        table = {v['name']: v for v in registry['voices']}
        chosen = [n for n in named if voice_tools.runnable(table[n])]
        how = 'mention'
        target = next((m for m in chat['messages'] if m['id'] == message.get('reply_to')), None)
        if not named and target and target['author'] in table:
            # A reply without a mention goes to the voice you are answering.
            named = [target['author']]
            chosen, how = [target['author']] if voice_tools.runnable(table[target['author']]) else [], 'reply'
        elif not named and random_fallback:
            candidates = [v['name'] for v in registry['voices'] if voice_tools.runnable(v)]
            if candidates:
                chosen, how = [self.runner.rng.choice(candidates)], 'random'
        return named, chosen, how

    def post(self, chat_id, author, body, request_id, runtime, random_fallback, participant, reply_to=None):
        self.runner.own()
        Chats.text(body, 'Message', MAX_BODY)
        registry = self.registry.load()
        chat = self.chats.read(chat_id)
        if reply_to is not None:
            reply_to = Chats.identity(reply_to)
            target = next((m for m in chat['messages'] if m['id'] == reply_to), None)
            if not target or target.get('kind') == 'hand':
                raise ValueError('Reply target is not a message in this chat')
        named = voice_tools.mentions(body, registry['voices'])
        message = {'id': request_id, 'author': author, 'body': body, 'mentions': named, 'reply_to': reply_to, 'runtime': runtime}
        named, chosen, how = self.route(chat, message, registry, random_fallback)
        message['mentions'] = named
        message['routing'] = {'voices': chosen[:MAX_HOPS], 'chosen_by': how if chosen else None}
        chat, fresh = self.chats.append(chat_id, message)
        stored = next(m for m in chat['messages'] if m['id'] == Chats.identity(message['id'])) if message['id'] else chat['messages'][-1]
        turns = []
        if fresh:
            # Other open panels on this chat show the new message without waiting for a reply.
            self.runner.emit(chat['id'], 'posted', {'message': stored, 'revision': chat['revision']})
            # A new message drops pending listening checks and expires raised hands.
            self.runner.drop_listening(chat['id'])
            self.expire(chat['id'], lambda m: m['id'] != stored['id'])
            for name in chosen:
                # Addressed exchanges (mention or reply, not random) may be followed by listening checks.
                turn = self.runner.enqueue(chat['id'], name, stored['id'], stored['id'], 0, how, root=stored['id'],
                                           listen=how in ('mention', 'reply') and not runtime)
                if turn:
                    turns.append(turn)
            verb = 'you wrote' if not runtime else f'{author} reply pasted'
            self.runner.commit_later(chat['id'], f'Chat: {chat["title"]} — {verb}')
        return self.get(chat['id']) | {'message': stored, 'turns': turns}

    def send(self, id, body, participant, request_id=None, author=None, reply_to=None):
        return self.post(id, author or participant, body, request_id, None, True, participant, reply_to)

    def paste(self, id, body, participant, request_id=None, voice=None):
        """Post a reply you pasted for a manual voice (`"cli": null` in voices.json); default: the first one."""
        manual = [v['name'] for v in self.registry.load()['voices'] if v['manual']]
        voice = manual[0] if voice is None and manual else voice
        if voice not in manual:
            raise ValueError('Paste a reply only for a voice marked manual in voices.json')
        return self.post(id, voice, body, request_id, {'manual': True, 'pasted_by': participant}, False, participant)

    def cancel(self, turn_id, participant, id=None):
        self.runner.own()
        return {'turn': self.runner.cancel(turn_id)}

    def retry(self, id, message_id, participant):
        self.runner.own()
        chat = self.chats.read(id)
        message = next((m for m in chat['messages'] if m['id'] == message_id), None)
        if not message or (message.get('turn') or {}).get('state') in (None, 'done'):
            raise ValueError('Only a failed, timed-out or cancelled voice reply can be retried')
        if any(m.get('retry_of') == message_id for m in chat['messages']) or any(t.get('retry_of') == message_id for t in self.runner.pending(chat['id'])):
            return self.get(chat['id']) | {'turns': []}
        turn = self.runner.enqueue(chat['id'], message['author'], message['reply_to'], str(uuid4()), 0,
                                   message.get('chosen_by') or 'mention', message_id)
        return self.get(chat['id']) | {'turns': [turn] if turn else []}

    def expire(self, chat_id, which):
        """Mark raised hands matching `which` as expired; return the chat."""
        def change(message):
            if message.get('kind') == 'hand' and message.get('state') == 'raised' and which(message):
                message.update(state='expired', decided_at=stamp())
                return True
            return False
        chat, changed = self.chats.amend_all(chat_id, change)
        for message in changed:
            self.runner.emit(chat_id, 'message', {'message': message, 'revision': chat['revision']})
        if changed:
            self.runner.commit_later(chat_id, f'Chat: {chat["title"]} — hands expired')
        return chat

    def hand(self, id, message_id, decision, participant):
        """Let a raised hand speak (one chime-in per message) or decline it."""
        self.runner.own()
        if decision not in ('accept', 'decline'):
            raise ValueError('decision must be accept or decline')
        chat = self.chats.read(id)
        hand = next((m for m in chat['messages'] if m['id'] == message_id and m.get('kind') == 'hand'), None)
        if not hand:
            raise ValueError('Unknown raised hand')
        if hand['state'] == 'raised' and stale(hand):
            self.expire(chat['id'], lambda m: m['id'] == hand['id'])
            raise ValueError('That hand expired after 10 minutes')
        if hand['state'] != 'raised':
            raise ValueError(f'That hand is already {hand["state"]}')
        turns = []
        if decision == 'accept':
            if self.runner.chimed(chat, hand.get('root')):
                raise ValueError('Only one voice may chime in per message')
            voice = next((v for v in self.registry.load()['voices'] if v['name'] == hand['author']), None)
            if not voice or not voice_tools.runnable(voice):
                raise ValueError(f'{hand["author"]} is not an enabled voice with an installed CLI')
        def change(message):
            if message['id'] == hand['id']:
                message.update(state='accepted' if decision == 'accept' else 'declined', decided_at=stamp(), decided_by=participant)
                return True
            if decision == 'accept' and message.get('kind') == 'hand' and message.get('state') == 'raised' and message.get('root') == hand.get('root'):
                message.update(state='expired', decided_at=stamp())
                return True
            return False
        chat, changed = self.chats.amend_all(chat['id'], change)
        for message in changed:
            self.runner.emit(chat['id'], 'message', {'message': message, 'revision': chat['revision']})
        stored = next(m for m in chat['messages'] if m['id'] == hand['id'])
        if decision == 'accept':
            self.runner.drop_listening(chat['id'])
            turn = self.runner.chime(chat, stored)
            if turn:
                turns.append(turn)
        verb = 'let ' + hand['author'] + ' speak' if decision == 'accept' else 'not now for ' + hand['author']
        self.runner.commit_later(chat['id'], f'Chat: {chat["title"]} — {verb}')
        return self.get(chat['id']) | {'turns': turns}

    def settings(self, id, chime_ins, participant):
        self.runner.own()
        chat, changed = self.chats.configure(id, chime_ins)
        if changed:
            if chime_ins == 'off':
                self.runner.drop_listening(chat['id'])
            self.runner.commit_later(chat['id'], f'Chat: {chat["title"]} — chime-ins {chime_ins}')
        return self.get(chat['id'])

    def hush(self, id, participant):
        self.runner.own()
        """You started typing: stop this chat's listening checks (raised hands stay)."""
        chat = self.chats.read(id)
        self.runner.hush(chat)
        self.runner.commit_later(chat['id'], f'Chat: {chat["title"]} — voices listened')
        return {'ok': True}

    def close(self):
        self.runner.close()
