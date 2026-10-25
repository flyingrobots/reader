"""In-process fakes of Ollama's and llama.cpp's OpenAI-compatible APIs, for tests only.

Never touches a real model. Each fake answers `GET /v1/models`, `POST /v1/chat/completions`
(streamed or plain JSON) and `POST /v1/embeddings` in the shape that server sends,
including the fields it leaves out:

- `ollama`: `data[].id` with `owned_by: library`; stream deltas carry `role` and `content`,
  thinking models a `reasoning` field; usage arrives in a final chunk only when
  `stream_options.include_usage` is set; no rate statistics; unknown models are a 404
  with `{"error": {"message": ...}}`.
- `llamacpp`: `/v1/models` has both `models[]` (name/model) and `data[]`; the first
  stream chunk has `content: null`; reasoning comes as `reasoning_content`; the last
  chunk carries `timings.predicted_per_second`; with `stream=False` configured it
  ignores the request's `stream` and answers one JSON completion without
  `finish_reason`; embeddings rows have no `index`; `/v1/embeddings` is a 404 unless
  `embeddings=True` (llama-server's `--embeddings`).

Options: `api_key` (require `Authorization: Bearer <key>`, else 401), `thinking` (stream
reasoning first), `error_event` (an error event mid-stream), `cut` (close the stream
before finishing), `echo_auth` (put the Authorization header in error bodies).
`requests` records every request's method, path, model and whether it had a key.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import sys
import threading

sys.path.insert(0, str(Path(__file__).parent))
from fake_lmstudio import answer  # noqa: E402  (the same deterministic answers)

LIVE = set()  # ports of running fakes; guarded_connect reaches nothing else

MODELS = {'ollama': ['llama3.2:3b', 'nomic-embed-text:latest'],
          'llamacpp': ['models/tiny-q4_k_m.gguf']}


class FakeServer:
    def __init__(self, flavor, **options):
        if flavor not in MODELS:
            raise ValueError(flavor)
        self.flavor = flavor
        self.options = {'api_key': None, 'thinking': False, 'error_event': False, 'cut': False, 'stream': True,
                        'embeddings': flavor == 'ollama', 'echo_auth': False} | options
        self.requests = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *_):
                pass

            def send(self, data, status=200, content_type='application/json'):
                body = json.dumps(data).encode()
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def authorized(self, request=None):
                auth = self.headers.get('Authorization')
                fake.requests.append({'method': self.command, 'path': self.path, 'model': (request or {}).get('model'),
                                      'auth': bool(auth), 'stream': (request or {}).get('stream')})
                key = fake.options['api_key']
                if key and auth != 'Bearer ' + key:
                    message = 'invalid api key' + (f' (got {auth})' if fake.options['echo_auth'] else '')
                    self.send({'error': {'message': message, 'type': 'invalid_request_error'}}, 401)
                    return False
                return True

            def do_GET(self):
                if not self.authorized():
                    return
                if self.path != '/v1/models':
                    self.send({'error': 'not found'}, 404)
                    return
                ids = MODELS[fake.flavor]
                if fake.flavor == 'ollama':
                    self.send({'object': 'list', 'data': [{'id': i, 'object': 'model', 'created': 1760000000, 'owned_by': 'library'} for i in ids]})
                else:
                    self.send({'models': [{'name': i, 'model': i, 'type': 'model', 'capabilities': ['completion']} for i in ids],
                               'object': 'list', 'data': [{'id': i, 'object': 'model', 'owned_by': 'llamacpp', 'meta': {'n_ctx_train': 8192}} for i in ids]})

            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
                if not self.authorized(request):
                    return
                if self.path == '/v1/embeddings':
                    if not fake.options['embeddings']:
                        self.send({'error': {'code': 501, 'message': 'This server does not support embeddings. Start it with `--embeddings`', 'type': 'not_supported_error'}}, 404)
                        return
                    rows = []
                    for i, text in enumerate(request['input']):
                        seed = sum(ord(c) for c in text)
                        row = {'object': 'embedding', 'embedding': [((seed * (k + 5)) % 89) / 89 for k in range(8)]}
                        if fake.flavor == 'ollama':
                            row['index'] = i
                        rows.append(row)
                    self.send({'object': 'list', 'data': rows, 'model': request.get('model')})
                    return
                if self.path != '/v1/chat/completions':
                    self.send({'error': 'not found'}, 404)
                    return
                if fake.flavor == 'ollama' and request.get('model') not in MODELS['ollama']:
                    self.send({'error': {'message': f'model "{request.get("model")}" not found, try pulling it first', 'type': 'api_error'}}, 404)
                    return
                text = answer(request['messages'])
                if not fake.options['stream'] or not request.get('stream'):
                    message = {'role': 'assistant', 'content': text}
                    if fake.options['thinking']:
                        message['reasoning_content'] = 'Reading the document.'
                    choice = {'index': 0, 'message': message}  # llama.cpp-style: no finish_reason here
                    self.send({'id': 'chatcmpl-1', 'object': 'chat.completion', 'model': request.get('model'), 'choices': [choice],
                               'usage': {'prompt_tokens': 50, 'completion_tokens': len(text.split())}})
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Transfer-Encoding', 'chunked')
                self.end_headers()

                def raw(payload):
                    self.wfile.write(f'{len(payload):x}\r\n'.encode() + payload + b'\r\n')
                    self.wfile.flush()

                def event(data):
                    raw(b'data: ' + json.dumps(data).encode() + b'\n\n')

                def chunk(delta, finish=None, **extra):
                    return {'id': 'chatcmpl-1', 'object': 'chat.completion.chunk', 'created': 1760000000, 'model': request.get('model'),
                            'system_fingerprint': 'fp_' + fake.flavor, 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}], **extra}
                try:
                    raw(b': keep-alive\n\n')
                    if fake.flavor == 'llamacpp':
                        event(chunk({'role': 'assistant', 'content': None}))
                    if fake.options['thinking']:
                        field = 'reasoning' if fake.flavor == 'ollama' else 'reasoning_content'
                        for thought in ('Reading ', 'the ', 'note. '):
                            event(chunk({'role': 'assistant', field: thought} if fake.flavor == 'ollama' else {field: thought}))
                    pieces = re.findall(r'\S+\s*', text)
                    for i, piece in enumerate(pieces):
                        if fake.options['error_event'] and i == 2:
                            event({'error': {'message': 'synthetic backend failure', 'type': 'server_error'}})
                            raw(b'')
                            return
                        if fake.options['cut'] and i == 2:
                            self.wfile.write(b'0\r\n\r\n')
                            self.wfile.flush()
                            self.close_connection = True
                            return
                        event(chunk({'role': 'assistant', 'content': piece} if fake.flavor == 'ollama' else {'content': piece}))
                    if fake.flavor == 'llamacpp':
                        event(chunk({}, 'stop', timings={'predicted_n': len(pieces), 'predicted_per_second': 55.5}))
                    else:
                        event(chunk({'role': 'assistant', 'content': ''}, 'stop'))
                        if (request.get('stream_options') or {}).get('include_usage'):
                            event({'id': 'chatcmpl-1', 'object': 'chat.completion.chunk', 'choices': [],
                                   'usage': {'prompt_tokens': 50, 'completion_tokens': len(pieces), 'total_tokens': 50 + len(pieces)}})
                    raw(b'data: [DONE]\n\n')
                    self.wfile.write(b'0\r\n\r\n')
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass

        class Server(ThreadingHTTPServer):
            daemon_threads = True

            def handle_error(self, request, client_address):  # a client closing a kept-alive socket is not a failure
                if not isinstance(sys.exc_info()[1], (ConnectionResetError, BrokenPipeError)):
                    super().handle_error(request, client_address)

        self.server = Server(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.url = f'http://127.0.0.1:{self.port}/v1'
        LIVE.add(self.port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        LIVE.discard(self.port)
        self.server.shutdown()
        self.server.server_close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def loopback_connect(port):
    """A Client `connect` that sends every request, whatever its host, to a loopback fake."""
    import http.client

    def connect(parts, timeout):
        return http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    return connect


def guarded_connect(parts, timeout):
    """A Client `connect` for tests: only running fakes answer, so a real local server (say Ollama on
    11434) is never contacted; anything else looks like a server that is off."""
    import http.client
    if parts['port'] not in LIVE or not parts['loopback']:
        raise ConnectionRefusedError('test guard: not a fake server')
    return http.client.HTTPConnection('127.0.0.1', parts['port'], timeout=timeout)
