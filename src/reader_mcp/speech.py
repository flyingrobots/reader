"""Hand reading text to the local AI-TTS daemon, which owns playback and its queue.

Reader never plays audio. It writes one JSON line to the daemon's Unix socket and
reads one JSON line back (the protocol of AI-TTS ``aitts.client.Client``). Control
operations are limited to utterances this process submitted.
"""
from collections import OrderedDict
import json
import os
from pathlib import Path
import re
import socket
import stat
import threading

MAX_TEXT = 512 * 1024          # UTF-8 bytes of text per submission, as AI-TTS's Zed client.
MAX_REQUEST = 1024 * 1024      # The daemon's MAX_JSONL_LINE_BYTES.
MAX_RESPONSE = 4 * 1024 * 1024 # A get/status reply carries the utterance text, JSON-escaped.
TIMEOUT = 5.0
TRACKED = 50
TERMINAL = frozenset({'Played', 'Skipped', 'Cancelled', 'Failed'})
CONTROLS = ('pause', 'resume', 'skip', 'next_segment', 'previous_segment', 'cancel')
UTTERANCE_ID = re.compile(r'utt_[0-9a-f]{32}')


class SpeechUnavailable(ConnectionError):
    """The daemon is not running, not listening, or not answering."""


def default_socket():
    override = os.environ.get('AI_TTS_SOCKET')
    if override:
        return Path(override).expanduser()
    home = os.environ.get('AI_TTS_HOME')
    return (Path(home).expanduser() if home else Path('~/Library/Application Support/ai-tts').expanduser()) / 'ai-tts.sock'


class Speech:
    def __init__(self, socket_path=None):
        self.socket_path = Path(socket_path).expanduser() if socket_path else None
        self.submitted = OrderedDict()
        self.lock = threading.Lock()

    def path(self):
        path = self.socket_path or default_socket()
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            raise SpeechUnavailable('AI-TTS isn’t running: its socket is missing. Start AI-TTS, then try again.') from None
        if stat.S_ISLNK(info.st_mode):
            raise SpeechUnavailable('Refusing a symlinked AI-TTS socket path.')
        if not stat.S_ISSOCK(info.st_mode):
            raise SpeechUnavailable('The AI-TTS socket path is not a socket.')
        return path

    def request(self, payload):
        """One request line, one response line. Daemon refusals raise ValueError."""
        line = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode() + b'\n'
        if len(line) > MAX_REQUEST:
            raise ValueError('The encoded text exceeds the AI-TTS 1 MiB request limit. Use From here or a selection.')
        path = self.path()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(TIMEOUT)
            try:
                sock.connect(str(path))
                sock.sendall(line)
                buffer = b''
                while b'\n' not in buffer:
                    chunk = sock.recv(65536)
                    if not chunk:
                        raise SpeechUnavailable('AI-TTS closed the connection without answering.')
                    buffer += chunk
                    if len(buffer) > MAX_RESPONSE:
                        raise SpeechUnavailable('AI-TTS answered with an oversized response.')
            except TimeoutError:
                raise SpeechUnavailable('AI-TTS did not answer within 5 seconds.') from None
            except SpeechUnavailable:
                raise
            except OSError as exc:
                raise SpeechUnavailable(f'AI-TTS isn’t running ({exc.strerror or exc}). Start AI-TTS, then try again.') from None
        try:
            response = json.loads(buffer.split(b'\n', 1)[0])
        except ValueError:
            raise SpeechUnavailable('AI-TTS returned an unreadable response.') from None
        if not isinstance(response, dict):
            raise SpeechUnavailable('AI-TTS returned an unreadable response.')
        if not response.get('ok', False):
            error = response.get('error') if isinstance(response.get('error'), dict) else {}
            raise ValueError('AI-TTS refused: ' + str(error.get('message') or error.get('type') or 'unknown error'))
        return response

    def submit(self, text, fmt, scope):
        if fmt not in ('markdown', 'plain_text') or scope not in ('article', 'from', 'selection'):
            raise ValueError('Expected markdown or plain_text text and an article, from or selection scope')
        if not isinstance(text, str) or not text.strip():
            raise ValueError('There is no text to speak here.')
        if '\x00' in text:
            raise ValueError('Binary text cannot be spoken.')
        if len(text.encode('utf-8', 'surrogatepass')) > MAX_TEXT:
            raise ValueError('This text exceeds the 512 KiB AI-TTS limit. Use From here or select a passage.')
        response = self.request({'op': 'submit', 'origin': 'Reader', 'text': text, 'content_format': fmt,
                                 'source': 'Reader', 'sensitivity': 'confidential', 'priority': 'normal'})
        utterance = response.get('id')
        if not isinstance(utterance, str) or not UTTERANCE_ID.fullmatch(utterance):
            raise SpeechUnavailable('AI-TTS accepted the text without a usable utterance id.')
        with self.lock:
            self.submitted[utterance] = scope
            while len(self.submitted) > TRACKED:
                self.submitted.popitem(last=False)
        return {'id': utterance, 'state': response.get('state'), 'held': bool(response.get('playback_held')),
                'segment_count': response.get('segment_count'), 'voice': response.get('voice')}

    def owned(self, utterance):
        with self.lock:
            if not isinstance(utterance, str) or utterance not in self.submitted:
                raise PermissionError('Reader controls only speech it submitted.')
        return utterance

    def status(self):
        """Read-only and unscoped; text fields are not returned."""
        status = self.request({'op': 'status'})
        current = status.get('current') if isinstance(status.get('current'), dict) else None
        active = current.get('active_segment') if current and isinstance(current.get('active_segment'), dict) else None
        return {'held': bool(status.get('playback_held')), 'playback_state': status.get('playback_state'),
                'current': current.get('id') if current else None,
                'segment': {'number': active.get('number'), 'count': active.get('count')} if active else None}

    def get(self, utterance):
        """Progress for one Reader utterance: the daemon's get, plus status while it is current."""
        item = self.request({'op': 'get', 'id': self.owned(utterance)}).get('item') or {}
        status = self.status()
        current = status['current'] == utterance
        return {'id': utterance, 'state': item.get('state'), 'error': item.get('error'),
                'segment_count': item.get('segment_count'), 'completed_segments': item.get('completed_segments'),
                'terminal': item.get('state') in TERMINAL, 'held': status['held'], 'current': current,
                'segment': status['segment'] if current else None}

    def control(self, utterance, action):
        """pause/resume/skip/segment steps act on the daemon's current playback, so they
        are forwarded only while this utterance is the current one; cancel is id-scoped."""
        utterance = self.owned(utterance)
        if action not in CONTROLS:
            raise ValueError('Expected one of: ' + ', '.join(CONTROLS))
        if action == 'cancel':
            reply = self.request({'op': 'cancel', 'id': utterance})
            return {'id': utterance, 'state': reply.get('state'), 'current': False}
        if self.status()['current'] != utterance:
            raise ValueError('Playback controls apply while this passage is the one AI-TTS is playing.')
        reply = self.request({'op': action})
        return {'id': utterance, 'state': reply.get('state'), 'held': bool(reply.get('held')), 'current': reply.get('current') == utterance}
