"""A per-participant reading queue and reading history, like a music player's play queue.

The queue is a small vault file per participant (`queues/<sha256>.json`) holding the
documents you lined up, in your order, plus suggestions voices left with a reason.
History is derived: it joins an append-only log of opens (`history/<sha256>.jsonl`)
with read receipts and bookmarks. Nothing here stores document text, and removing a
history row appends a `hidden` entry; receipts and bookmarks are never touched."""
import json
import os
from pathlib import Path
import tempfile
from uuid import UUID

from .annotations import Annotations, now, sha

QUEUE_ITEMS = 500
QUEUE_BYTES = 64 * 1024
REQUESTS = 64          # remembered request ids, for idempotent retries
DISMISSED = 200        # generated suggestions you removed
HISTORY_LINES = 5000
HISTORY_KEEP = 4000    # after compaction, if one line per document is still too many
HISTORY_BYTES = 4 * 1024**2
REASON = 300
ACTIONS = ('add', 'remove', 'move', 'pin', 'clear')


class ReadingQueue:
    def __init__(self, root, validate):
        """`validate(path)` raises ValueError unless `path` is a current library document."""
        self.annotations = Annotations(root)
        self.root = self.annotations.root
        self.validate = validate
        self.queues = self.root / 'queues'
        self.logs = self.root / 'history'

    def participant(self, value):
        return self.annotations.body(value, 'Participant', 100).strip()

    def file(self, folder, participant, suffix):
        if folder.is_symlink():
            raise ValueError(f'{folder.name}/ must not be a symlink')
        path = folder / (sha(participant.encode()) + suffix)
        if path.is_symlink():
            raise ValueError('Queue and history files must not be symlinks')
        return path

    # The queue ---------------------------------------------------------------
    def load(self, participant):
        participant = self.participant(participant)
        path = self.file(self.queues, participant, '.json')
        if not path.exists():
            return {'schema_version': 1, 'participant': participant, 'items': [], 'dismissed': [], 'requests': [], 'updated_at': None}
        if path.stat().st_size > QUEUE_BYTES:
            raise ValueError('Reading queue exceeds 64 KiB')
        data = json.loads(path.read_text())
        if data.get('schema_version') != 1 or data.get('participant') != participant or not isinstance(data.get('items'), list):
            raise ValueError('Invalid reading queue identity/schema')
        data.setdefault('dismissed', [])
        data.setdefault('requests', [])
        return data

    def save(self, record):
        record['updated_at'] = now()
        data = (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode()
        if len(data) > QUEUE_BYTES:
            raise ValueError('Reading queue would exceed 64 KiB; remove some items first')
        self.queues.mkdir(exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.queues, prefix='.queue-', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.file(self.queues, record['participant'], '.json'))
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

    @staticmethod
    def mine(item, participant):
        return item.get('added_by') == participant or bool(item.get('pinned_at'))

    def change(self, participant, action, path=None, index=None, request_id=None, added_by=None, reason=None):
        """Apply one queue action. A repeated `request_id` returns the queue unchanged."""
        participant = self.participant(participant)
        if action not in ACTIONS:
            raise ValueError('Expected action add, remove, move, pin or clear')
        request_id = str(UUID(str(request_id)))
        added_by = participant if added_by is None else self.participant(added_by)
        if reason is not None and (not isinstance(reason, str) or not reason.strip() or len(reason) > REASON):
            raise ValueError(f'A reason must contain 1–{REASON} characters')
        if added_by != participant and not reason:
            raise ValueError('A voice suggestion needs a reason the reader can see')
        if action != 'clear':
            self.validate(path)
        if index is not None and (type(index) is not int or not 0 <= index < QUEUE_ITEMS):
            raise ValueError('Expected a queue position from 0 to 499')
        with self.annotations.locked():
            record = self.load(participant)
            if request_id in record['requests']:
                return record | {'repeated': True}
            items = record['items']
            found = next((item for item in items if item['path'] == path), None)
            queued = [item for item in items if self.mine(item, participant)]
            if action == 'add':
                if found and (self.mine(found, participant) or added_by != participant):
                    pass  # Already lined up; a voice never demotes or duplicates it.
                elif found:
                    found['pinned_at'] = now()  # You chose a voice's suggestion.
                    items.remove(found)
                    items.insert(items.index(queued[-1]) + 1 if queued else 0, found)
                else:
                    if len(items) >= QUEUE_ITEMS:
                        raise ValueError('The reading queue holds at most 500 items')
                    item = {'path': path, 'added_at': now(), 'added_by': added_by} | ({'reason': reason.strip()} if reason else {})
                    if added_by == participant:
                        items.insert(items.index(queued[-1]) + 1 if queued else 0, item)
                    else:
                        items.append(item)
                record['dismissed'] = [p for p in record['dismissed'] if p != path]
            elif action == 'pin':
                if found and self.mine(found, participant):
                    pass
                else:
                    if found:
                        items.remove(found)
                        found['pinned_at'] = now()
                        item = found
                    else:
                        if len(items) >= QUEUE_ITEMS:
                            raise ValueError('The reading queue holds at most 500 items')
                        item = {'path': path, 'added_at': now(), 'added_by': participant, 'pinned_at': now()} | ({'reason': reason.strip()} if reason else {})
                    items.insert(items.index(queued[-1]) + 1 if queued else 0, item)
            elif action == 'remove':
                if found:
                    items.remove(found)
                if not found or not self.mine(found, participant):
                    record['dismissed'] = [p for p in record['dismissed'] if p != path][-(DISMISSED - 1):] + [path]
            elif action == 'move':
                if not found or not self.mine(found, participant):
                    raise ValueError('Only documents in your queue can be moved')
                if index is None:
                    raise ValueError('Expected a queue position')
                queued.remove(found)
                queued.insert(min(index, len(queued)), found)
                others = [item for item in items if not self.mine(item, participant)]
                record['items'] = items = queued + others
            elif action == 'clear':
                record['items'] = items = [item for item in items if not self.mine(item, participant)]
            record['requests'] = (record['requests'] + [request_id])[-REQUESTS:]
            self.save(record)
            return record

    def opened(self, participant, path, sha256):
        """Record an open in history, and take the document out of Up next: it is now reading."""
        participant = self.participant(participant)
        self.validate(path)
        if not isinstance(sha256, str) or len(sha256) != 64 or any(c not in '0123456789abcdef' for c in sha256):
            raise ValueError('Expected a source SHA-256')
        with self.annotations.locked():
            self.append(participant, {'path': path, 'sha256': sha256, 'at': now()})
            record = self.load(participant)
            if any(item['path'] == path for item in record['items']):
                record['items'] = [item for item in record['items'] if item['path'] != path]
                self.save(record)
        return {'path': path, 'opened': True}

    # History -----------------------------------------------------------------
    def hide(self, participant, path):
        participant = self.participant(participant)
        if not isinstance(path, str) or not path.startswith('library/') or len(path) > 2000:
            raise ValueError('Expected a library-relative path')
        with self.annotations.locked():
            self.append(participant, {'path': path, 'hidden': True, 'at': now()})
        return {'path': path, 'hidden': True}

    def events(self, participant):
        participant = self.participant(participant)
        path = self.file(self.logs, participant, '.jsonl')
        if not path.exists():
            return []
        if path.stat().st_size > HISTORY_BYTES:
            raise ValueError('Reading history exceeds 4 MiB')
        events = []
        for line in path.read_text().splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue  # A torn final line from a crash is skipped, not fatal.
            if isinstance(event, dict) and isinstance(event.get('path'), str) and isinstance(event.get('at'), str):
                events.append(event)
        return events

    def append(self, participant, event):
        """Append under the caller's lock; compact to one open and one hide per document past the cap."""
        self.logs.mkdir(exist_ok=True)
        path = self.file(self.logs, participant, '.jsonl')
        line = json.dumps(event, ensure_ascii=False) + '\n'
        count = 0
        if path.exists():
            with path.open('rb') as stream:
                count = sum(1 for _ in stream)
        if count + 1 <= HISTORY_LINES:
            with path.open('a') as stream:
                stream.write(line)
                stream.flush()
                os.fsync(stream.fileno())
            return
        latest = {}
        for item in [*self.events(participant), event]:
            latest[(item['path'], bool(item.get('hidden')))] = item
        kept = sorted(latest.values(), key=lambda item: item['at'])[-HISTORY_KEEP:]
        data = ''.join(json.dumps(item, ensure_ascii=False) + '\n' for item in kept).encode()
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.logs, prefix='.history-', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
