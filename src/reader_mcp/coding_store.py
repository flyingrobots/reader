"""Durable coding-job records, request idempotency and the run's event stream (RW-44).

Runtime state lives in `<vault>/.reader/coding-jobs/`: one atomically replaced `runs/<run-id>.json` per run
and `requests/<request-id>.json` naming the run a request UUID admitted. Evidence lives in the permanent
LLM archive (`logs/llm/coding-job/…`): the exact request and prompts, captured CLI output, verification
output and `events.jsonl`, the normalized event stream. Every event has the run ID, a sequence number
that increases by one, and a timestamp. Live viewers read recent events from memory; anyone who missed
some (a reload, a gap, another server) reads them back from the archive.

`Capture` is the single writer for a run's archive artifacts. It counts every byte against the job's
output budget; a full budget or a failed write raises `CaptureFailed`, and the job then stops its process
group and records the failure instead of continuing without evidence."""
from collections import deque
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import re
import threading

from . import llm_logs

RUNTIME = '.reader/coding-jobs'
RUN_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
MAX_RECORD = 1024**2
MAX_RUNS = 10000
LIVE_EVENTS = 4096
MAX_EVENT = 256 * 1024
MAX_PAGE_BYTES = 512 * 1024
MAX_SCAN = 64 * 1024**2
OUTPUT_BUDGET = 64 * 1024**2


def stamp():
    return datetime.now(timezone.utc).isoformat()


class CaptureFailed(Exception):
    """An archive write failed or the output budget is full: stop the job, keep what was captured."""


def valid_id(value):
    return isinstance(value, str) and bool(RUN_ID.fullmatch(value))


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.runtime = self.root / RUNTIME
        self.lock = threading.RLock()

    def folder(self, name):
        path = self.runtime / name
        path.mkdir(parents=True, exist_ok=True)
        if path.is_symlink():
            raise ValueError('Coding-job runtime folders must not be symlinks')
        return path

    def _write(self, path, data):
        temporary = path.with_name('.' + path.name + '.next')
        with temporary.open('w') as out:
            out.write(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
            out.flush()
            os.fsync(out.fileno())
        temporary.replace(path)

    def _read(self, path):
        if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_RECORD:
            return None
        try:
            data = json.loads(path.read_text())
        except ValueError:
            return None
        return data if isinstance(data, dict) else None

    def save(self, run):
        with self.lock:
            run['updated_at'] = stamp()
            self._write(self.folder('runs') / (run['id'] + '.json'), run)

    def load(self, run_id):
        if not valid_id(run_id):
            raise ValueError('Expected a coding-job run ID')
        return self._read(self.runtime / 'runs' / (run_id + '.json'))

    def runs(self):
        """Every run record, newest first."""
        folder = self.runtime / 'runs'
        if not folder.is_dir() or folder.is_symlink():
            return []
        rows = []
        for path in sorted(folder.glob('*.json'))[:MAX_RUNS]:
            if valid_id(path.stem) and (run := self._read(path)):
                rows.append(run)
        return sorted(rows, key=lambda run: run.get('created_at') or '', reverse=True)

    def request(self, request_id):
        if not valid_id(request_id):
            raise ValueError('Expected a request UUID')
        return self._read(self.runtime / 'requests' / (request_id + '.json'))

    def remember(self, request_id, run_id, fingerprint):
        self._write(self.folder('requests') / (request_id + '.json'), {'run_id': run_id, 'fingerprint': fingerprint, 'at': stamp()})


class Capture:
    """A run's archive writer: streamed artifacts and the event log, under one output budget."""

    def __init__(self, log, budget=None, on_event=None):
        self.log = log
        self.budget = budget or OUTPUT_BUDGET
        self.used = 0
        self.lock = threading.Lock()
        self.handles = {}
        self.failed = None
        self.on_event = on_event
        self.seq = 0
        self.ordering = threading.Lock()

    def _handle(self, name):
        if name not in self.handles:
            self.handles[name] = self.log.open(name)
        return self.handles[name]

    def write(self, name, data):
        data = data.encode() if isinstance(data, str) else data
        with self.lock:
            if self.failed:
                raise CaptureFailed(self.failed)
            if self.used + len(data) > self.budget:
                self.failed = f'The job’s {self.budget // 1024**2} MiB output budget is full; Reader stopped it rather than drop evidence.'
                raise CaptureFailed(self.failed)
            try:
                handle = self._handle(name)
                handle.write(data)
                handle.flush()
            except (OSError, ValueError) as exc:
                self.failed = f'Writing the run archive failed ({exc.__class__.__name__}: {exc}); Reader stopped the job rather than drop evidence.'
                raise CaptureFailed(self.failed)
            self.used += len(data)

    def event(self, run_id, kind, **data):
        """Append one event (seq, at, run_id, type, …) to events.jsonl and hand it to live viewers.
        Sequence numbers are assigned and written under one lock, so the log is in order without gaps."""
        with self.ordering:
            seq = self.seq + 1
            event = {'run_id': run_id, 'seq': seq, 'at': stamp(), 'type': kind, **data}
            line = json.dumps(event, ensure_ascii=False)
            if len(line) > MAX_EVENT:
                event = {'run_id': run_id, 'seq': seq, 'at': event['at'], 'type': kind, 'truncated': True,
                         **{k: v for k, v in data.items() if isinstance(v, (int, float, bool)) or v is None or (isinstance(v, str) and len(v) < 2048)}}
                line = json.dumps(event, ensure_ascii=False)
            self.write('events.jsonl', line + '\n')
            self.seq = seq
            if self.on_event:
                self.on_event(event)
            return event

    def close(self):
        with self.lock:
            for handle in self.handles.values():
                try:
                    handle.close()
                except OSError:
                    pass
            self.handles.clear()


class Live:
    """Recent events per run for live viewers, with a condition to wait on."""

    def __init__(self):
        self.lock = threading.Condition()
        self.events = {}
        self.closed = False

    def push(self, event):
        with self.lock:
            self.events.setdefault(event['run_id'], deque(maxlen=LIVE_EVENTS)).append(event)
            self.lock.notify_all()

    def poke(self):
        with self.lock:
            self.lock.notify_all()

    def after(self, run_id, seq):
        """(events after `seq`, contiguous) from memory; not contiguous means read the archive."""
        with self.lock:
            rows = list(self.events.get(run_id) or ())
        newer = [e for e in rows if e['seq'] > seq]
        contiguous = not newer or newer[0]['seq'] == seq + 1
        return newer, contiguous

    def wait(self, run_id, seq, timeout):
        with self.lock:
            self.lock.wait_for(lambda: self.closed or any(e['seq'] > seq for e in self.events.get(run_id) or ()), timeout)

    def close(self):
        with self.lock:
            self.closed = True
            self.lock.notify_all()


def archived_events(root, relative, after, limit=500, max_bytes=MAX_PAGE_BYTES):
    """(events with seq > after, more) read back from the run archive's events.jsonl, bounded."""
    folder = llm_logs.safe_dir(root, relative)
    candidates = ((folder / 'events.jsonl.partial', open), (folder / 'events.jsonl.gz', gzip.open))
    for path, opener in candidates:
        if not path.is_file() or path.is_symlink():
            continue
        rows, size, scanned, more = [], 0, 0, False
        try:
            handle = opener(path, 'rb')
        except FileNotFoundError:
            continue  # Sealed between the check and the open: read the compressed copy.
        with handle:
            for raw in handle:
                scanned += len(raw)
                if scanned > MAX_SCAN:
                    more = True
                    break
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue  # A torn final line from a crash; the rest of the log is intact.
                if not isinstance(event, dict) or not isinstance(event.get('seq'), int) or event['seq'] <= after:
                    continue
                if len(rows) >= limit or size + len(raw) > max_bytes:
                    more = True
                    break
                rows.append(event)
                size += len(raw)
        return rows, more
    return [], False
