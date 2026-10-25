"""A fake LM Studio for tests: an OpenAI-compatible loopback server and a fake `lms` CLI.

Never touches the real LM Studio. State lives in a directory named by FAKE_LMS_STATE:
`loaded.json` (loaded model keys), `server.pid`, `calls.jsonl` (every lms argv) and
optional `config.json` ({"delay": seconds per streamed token}).

    python fake_lmstudio.py serve --port N    # the HTTP server (spawned by `lms server start`)
    python fake_lmstudio.py lms <args...>     # the CLI; install() writes an executable wrapper
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time

MODELS = [
    {'modelKey': 'google/gemma-4-e4b', 'type': 'llm', 'displayName': 'Gemma 4 E4B', 'sizeBytes': 4_100_000_000, 'paramsString': '4B', 'format': 'mlx'},
    {'modelKey': 'qwen3.6-27b-mtp', 'type': 'llm', 'displayName': 'Qwen3.6 27B MTP', 'sizeBytes': 16_800_000_000, 'paramsString': '27B', 'format': 'gguf'},
    {'modelKey': 'text-embedding-nomic-embed-text-v1.5', 'type': 'embedding', 'displayName': 'Nomic Embed Text v1.5', 'sizeBytes': 84_000_000, 'format': 'gguf'},
]


def state_dir():
    folder = Path(os.environ['FAKE_LMS_STATE'])
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def read(name, default):
    file = state_dir() / name
    try:
        return json.loads(file.read_text())
    except (OSError, ValueError):
        return default


def write(name, value):
    file = state_dir() / name
    temp = file.with_suffix('.tmp')
    temp.write_text(json.dumps(value))
    os.replace(temp, file)


def same(a, b):
    return a == b or a.rsplit('/', 1)[-1] == b.rsplit('/', 1)[-1]


def words_of(text):
    return re.findall(r"[A-Za-z][A-Za-z'-]+", text)


def answer(messages):
    """A deterministic answer built from the document's own words (or a planted failure)."""
    system = messages[0]['content']
    user = messages[-1]['content']
    body = user.split('<document>', 1)[-1].split('</document>', 1)[0]
    lines = [l for l in body.splitlines() if l.strip() and not l.startswith('#')]
    if 'key terms' in system:
        seen = []
        for word in words_of(body):
            if len(word) > 6 and word.lower() not in [w.lower() for w in seen]:
                seen.append(word)
        return json.dumps(seen[:5])
    if 'PLANTED-INVENTION' in body:
        return 'Zanzibar reports 1999 results that this note never mentions.'
    if 'PLANTED-SLOW' in body:
        return ' '.join(['slowly'] * 40) + '.'
    first = re.split(r'(?<=[.!?])\s', re.sub(r'[*_`]', '', ' '.join(lines)))[0] if lines else 'A note.'
    return ' '.join(first.split()[:30]).rstrip('.') + '.'


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def send(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        loaded = read('loaded.json', [])
        if self.path == '/v1/models':
            self.send({'object': 'list', 'data': [{'id': key, 'object': 'model'} for key in loaded]})
        elif self.path == '/api/v0/models':
            self.send({'object': 'list', 'data': [{'id': m['modelKey'], 'type': m['type'], 'state': 'loaded' if any(same(k, m['modelKey']) for k in loaded) else 'not-loaded',
                                                   'max_context_length': 32768} for m in MODELS]})
        else:
            self.send({'error': 'not found'}, 404)

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with (state_dir() / 'requests.jsonl').open('a') as log:
            log.write(json.dumps({'path': self.path, 'model': request.get('model'), 'max_tokens': request.get('max_tokens')}) + '\n')
        if self.path == '/v1/embeddings':
            vectors = []
            for text in request['input']:
                seed = sum(ord(c) for c in text)
                vectors.append([((seed * (i + 3)) % 97) / 97 for i in range(8)])
            self.send({'data': [{'index': i, 'embedding': v} for i, v in enumerate(vectors)], 'model': request['model']})
            return
        if self.path != '/v1/chat/completions':
            self.send({'error': 'not found'}, 404)
            return
        delay = read('config.json', {}).get('delay', 0)
        text = answer(request['messages'])
        if 'PLANTED-SLOW' in request['messages'][-1]['content']:
            delay = max(delay, .25)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()

        def event(data):
            payload = b'data: ' + json.dumps(data).encode() + b'\n\n'
            self.wfile.write(f'{len(payload):x}\r\n'.encode() + payload + b'\r\n')
            self.wfile.flush()
        try:
            for thought in ['Reading ', 'the ', 'document. ']:
                event({'choices': [{'index': 0, 'delta': {'reasoning_content': thought}}]})
                time.sleep(delay)
            for i, piece in enumerate(re.findall(r'\S+\s*', text)):
                event({'choices': [{'index': 0, 'delta': {'content': piece}}]})
                time.sleep(delay)
            event({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})
            event({'choices': [], 'usage': {'completion_tokens': len(text.split()) + 3}, 'stats': {'tokens_per_second': 42.5}})
            payload = b'data: [DONE]\n\n'
            self.wfile.write(f'{len(payload):x}\r\n'.encode() + payload + b'\r\n0\r\n\r\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


def serve(port):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    signal.signal(signal.SIGTERM, lambda *_: os._exit(0))
    folder = state_dir()

    def watchdog():  # never outlive the test that started it
        while folder.exists():
            time.sleep(1)
        os._exit(0)
    import threading
    threading.Thread(target=watchdog, daemon=True).start()
    server.serve_forever()


def port_open(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=.2):
            return True
    except OSError:
        return False


def lms(args):
    with (state_dir() / 'calls.jsonl').open('a') as log:
        log.write(json.dumps(args) + '\n')
    pid = read('server.pid', None)
    port = read('port.json', None)
    running = bool(port and port_open(port))
    if args[:2] == ['server', 'status']:
        print(json.dumps({'running': running, 'port': port}))
    elif args[:2] == ['server', 'start']:
        port = int(args[args.index('--port') + 1])
        if read('config.json', {}).get('fail_start'):
            print('Error: synthetic start failure', file=sys.stderr)
            return 1
        if not running:
            child = subprocess.Popen([sys.executable, __file__, 'serve', '--port', str(port)], stdin=subprocess.DEVNULL,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, env=os.environ.copy())
            write('server.pid', child.pid)
            write('port.json', port)
            for _ in range(100):
                if port_open(port):
                    break
                time.sleep(.05)
        print(f'Success! Server is now running on port {port}')
    elif args[:2] == ['server', 'stop']:
        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            for _ in range(100):
                if not port_open(port):
                    break
                time.sleep(.05)
        write('server.pid', None)
        print('Stopped the server')
    elif args[:1] == ['ls']:
        print(json.dumps(MODELS) if '--json' in args else '\n'.join(m['modelKey'] for m in MODELS))
    elif args[:1] == ['ps']:
        loaded = read('loaded.json', [])
        print(json.dumps([{'identifier': key, 'modelKey': key, 'sizeBytes': next((m['sizeBytes'] for m in MODELS if same(m['modelKey'], key)), 0),
                           'contextLength': 32768} for key in loaded]))
    elif args[:1] == ['load']:
        key = args[1]
        if not any(same(m['modelKey'], key) for m in MODELS):
            print(f'Error: no model matches {key}', file=sys.stderr)
            return 1
        loaded = read('loaded.json', [])
        if key not in loaded:
            write('loaded.json', loaded + [key])
        print(f'Model loaded: {key}')
    elif args[:1] == ['unload']:
        write('loaded.json', [k for k in read('loaded.json', []) if not same(k, args[1])])
        print(f'Model unloaded: {args[1]}')
    else:
        print('unknown command', file=sys.stderr)
        return 2
    return 0


def install(folder):
    """Write an executable fake `lms` into folder and return its path."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    exe = folder / 'lms'
    exe.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{Path(__file__).resolve()}" lms "$@"\n')
    exe.chmod(0o755)
    return exe


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def stop(state):
    """Kill a fake server left running by a test."""
    try:
        pid = json.loads((Path(state) / 'server.pid').read_text())
        if pid:
            os.kill(pid, signal.SIGTERM)
    except (OSError, ValueError, TypeError):
        pass


if __name__ == '__main__':
    if sys.argv[1] == 'serve':
        serve(int(sys.argv[sys.argv.index('--port') + 1]))
    else:
        sys.exit(lms(sys.argv[2:]))
