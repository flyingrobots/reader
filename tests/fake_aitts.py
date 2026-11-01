"""A synthetic AI-TTS daemon on an AF_UNIX socket. It never plays audio.

It speaks the subset of the AI-TTS JSONL protocol Reader uses (submit, get, status,
pause, resume, skip, next_segment, previous_segment, cancel) with the daemon's
response shapes. Playback is simulated: the current utterance advances one segment
every ``step`` seconds unless paused. Flag files in ``folder`` steer it from another
process: ``held`` reports a playback hold, ``down`` drops connections unanswered.
Every request is appended to ``requests.jsonl``.
"""
import json
from pathlib import Path
import socket
import threading
import time
import uuid

TERMINAL = {'Played', 'Skipped', 'Cancelled', 'Failed'}


class FakeDaemon:
    def __init__(self, folder, step=0.8, segments=3):
        self.folder = Path(folder)
        self.path = self.folder / 'ai-tts.sock'
        self.log = self.folder / 'requests.jsonl'
        self.step, self.segments = step, segments
        self.items, self.order = {}, []
        self.paused, self.clock = False, time.monotonic()
        self.lock = threading.Lock()
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(str(self.path))
        self.sock.listen(16)
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def close(self):
        self.sock.close()
        self.path.unlink(missing_ok=True)

    def requests(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    @property
    def held(self):
        return self.paused or (self.folder / 'held').exists()

    def current(self):
        return next((self.items[i] for i in self.order if self.items[i]['state'] not in TERMINAL and self.items[i]['state'] != 'Cancelled'), None)

    def tick(self):
        now = time.monotonic()
        while now - self.clock >= self.step:
            self.clock += self.step
            item = self.current()
            if item is None or self.held:
                continue
            if item['state'] in ('Queued', 'Synthesizing', 'Ready'):
                item['state'] = 'Playing'
            elif item['state'] == 'Playing':
                item['completed'] += 1
                if item['completed'] >= item['count']:
                    item['state'] = 'Played'
        if self.current() is None:
            self.clock = now

    def serve(self):
        while True:
            try:
                connection, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self.client, args=(connection,), daemon=True).start()

    def client(self, connection):
        with connection:
            buffer = b''
            while b'\n' not in buffer:
                chunk = connection.recv(65536)
                if not chunk:
                    return
                buffer += chunk
            if (self.folder / 'down').exists():
                return
            payload = json.loads(buffer.split(b'\n', 1)[0])
            with self.lock:
                with self.log.open('a') as stream:
                    stream.write(json.dumps(payload) + '\n')
                self.tick()
                response = self.dispatch(payload)
            connection.sendall(json.dumps(response).encode() + b'\n')

    def item(self, entry):
        return {'id': entry['id'], 'text': entry['text'], 'state': entry['state'], 'source': 'Reader', 'error': None,
                'composite': entry['count'] > 1, 'segment_count': entry['count'], 'completed_segments': entry['completed']}

    def transport(self):
        current = self.current()
        return {'ok': True, 'state': current['state'] if current else None, 'current': current['id'] if current else None, 'held': self.held}

    def dispatch(self, payload):
        op = payload.get('op')
        if op == 'voices':
            return {'ok': True, 'voices': ['fake', 'voice-a', 'voice-b']}
        if op == 'submit':
            if not str(payload.get('text', '')).strip():
                return {'ok': False, 'error': {'type': 'bad_request', 'message': "submit requires non-empty 'text'"}}
            entry = {'id': 'utt_' + uuid.uuid4().hex, 'text': payload['text'], 'state': 'Queued', 'count': self.segments, 'completed': 0}
            self.items[entry['id']] = entry
            self.order.append(entry['id'])
            return {'ok': True, 'accepted': True, 'id': entry['id'], 'state': 'Queued', 'voice': payload.get('voice', 'fake'), 'sensitivity': payload.get('sensitivity'),
                    'segment_count': entry['count'], 'composite': True, 'accepting_speech': True, 'playback_held': self.held,
                    'submission_disposition': 'spooled_until_resume' if self.held else 'queued_for_playback'}
        if op == 'status':
            current = self.current()
            view = None
            if current:
                view = self.item(current)
                if current['state'] in ('Playing', 'Paused'):
                    view['active_segment'] = {'index': current['completed'], 'number': current['completed'] + 1, 'count': current['count'], 'text': 'segment', 'state': current['state']}
            return {'ok': True, 'state': 'accepting', 'playback_held': self.held, 'playback_state': 'paused' if self.held else 'playing' if current else 'idle', 'current': view}
        if op in ('get', 'cancel'):
            entry = self.items.get(payload.get('id'))
            if entry is None:
                return {'ok': False, 'error': {'type': 'not_found', 'message': f"no utterance {payload.get('id')!r}"}}
            if op == 'cancel':
                if entry['state'] in ('Playing', 'Paused'):
                    return {'ok': False, 'error': {'type': 'illegal_state', 'message': "cancel is not legal for a playing utterance; that is 'skip'"}}
                entry['state'] = 'Cancelled'
                return {'ok': True, 'id': entry['id'], 'state': 'Cancelled'}
            return {'ok': True, 'item': self.item(entry)}
        current = self.current()
        if op == 'pause':
            self.paused = True
            if current and current['state'] == 'Playing':
                current['state'] = 'Paused'
        elif op == 'resume':
            self.paused = False
            if current and current['state'] == 'Paused':
                current['state'] = 'Playing'
        elif op == 'skip':
            if current:
                current['state'] = 'Skipped'
        elif op in ('next_segment', 'previous_segment'):
            if not current or current['state'] not in ('Playing', 'Paused'):
                return {'ok': False, 'error': {'type': 'illegal_state', 'message': 'no further chunk in the current document; chunk steps need an unheld, chunked clip'}}
            current['completed'] = max(0, min(current['count'] - 1, current['completed'] + (1 if op == 'next_segment' else -1)))
        else:
            return {'ok': False, 'error': {'type': 'bad_request', 'message': f'unknown op {op!r}'}}
        return self.transport()
