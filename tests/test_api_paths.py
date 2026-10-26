"""No web API answer names a host filesystem path (#105).

Starts the synthetic browser fixture (tests/web_fixture.py) as its own server process, walks every
GET route that `WebHandler.handle_request` routes (read from web.py's source, so a new route is
covered without editing this test), and asserts that no answer body contains the fixture vault's
folder, the home folder, this code checkout, or the Python executable. MCP tools are not covered:
they run for local agents and keep `absolute_path` on purpose.
"""
import ast
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pytest

HERE = Path(__file__).resolve().parent
CODE = HERE.parent
WEB = CODE / 'src/reader_mcp/web.py'
FLAGS = ['--inbox', '--local-model', '--chat', '--search-page', '--maintenance']

DOC = 'library/thought.md'
# Query parameters per route; any route not named here gets DEFAULT. A list asks the route once per entry.
DEFAULT = {'path': DOC}
PARAMS = {
    '/api/library': {},
    '/api/search': [{'q': 'quiet', 'mode': mode} for mode in ('fuzzy', 'keyword', 'semantic')],
    '/api/search/page': [{'q': 'quiet', 'mode': mode} for mode in ('best', 'words', 'meaning')],
    '/api/resolve-batch': {'from': DOC, 'target': 'other'},
    '/api/embeds': {'from': DOC, 'target': 'other', 'depth': '0'},
    '/api/resolve': {'from': DOC, 'target': 'other'},
    '/api/preview': {'path': 'library/other.md'},
    '/api/chats': {'path': DOC},
    '/api/chat': {'id': '{chat}'},
    '/api/chat/raw': {'id': '{chat}', 'turn': '{turn}'},
    '/api/companions': [{}, {'name': 'colorful'}, {'name': 'git-locks'}, {'name': 'ai-tts'}, {'name': 'wide-md'}],
    '/api/companions/log': [{'name': 'colorful'}, {'name': 'wide-md'}, {'name': 'ai-tts'}],
    '/api/inbox/events': {'after': '0'},
    '/api/issue': {'start': '2026-10-01', 'end': '2026-10-31'},
    '/api/changes': [{'path': DOC}, {'a': 'HEAD', 'b': 'HEAD'}],
    '/api/version': {'path': DOC, 'commit': 'HEAD'},
    '/api/versions': [{'path': DOC}, {'path': DOC, 'hashes': '1'}],
    '/api/history': [{'cursor': '0'}, {'cursor': '0', 'filter': 'finished'}],
    '/api/fonts': {'q': 'serif'},
    '/api/queue': {},
    '/api/themes': {},
    '/api/link-counts': {},
    '/api/editions/diagnostics': {},
    '/api/file': {'path': DOC},
    '/api/art/prompt': [{'path': DOC}, {'path': 'library/other.md'}],
}
PREFIXES = {'/api/speak/': ['/api/speak/status', '/api/speak/unknown']}
SKIP = {'/api/art/still': 'answers a stored image, not JSON'}


def get_routes():
    """Every literal route the GET branch of handle_request compares `parsed.path` with."""
    tree = ast.parse(WEB.read_text())
    handler = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'handle_request')
    is_write = lambda n: isinstance(n, ast.If) and isinstance(n.test, ast.Name) and n.test.id == 'write'
    body = next(n for n in ast.walk(handler) if isinstance(n, ast.Try) and any(map(is_write, n.body))).body
    write = next(i for i, n in enumerate(body) if is_write(n))
    exact, prefixes = set(), set()
    for statement in body[write + 1:]:
        for node in ast.walk(statement):
            target = lambda n: isinstance(n, ast.Attribute) and n.attr == 'path' and getattr(n.value, 'id', None) == 'parsed'
            if isinstance(node, ast.Compare) and target(node.left):
                for op, value in zip(node.ops, node.comparators):
                    if isinstance(op, ast.Eq) and isinstance(value, ast.Constant) and str(value.value).startswith('/api/'):
                        exact.add(value.value)
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'startswith'
                    and target(node.func.value) and node.args and isinstance(node.args[0], ast.Constant)
                    and str(node.args[0].value).startswith('/api/')):
                prefixes.add(node.args[0].value)
    return sorted(exact), sorted(prefixes)


def test_route_enumeration_finds_the_router():
    exact, prefixes = get_routes()
    assert {'/api/search', '/api/local-model', '/api/inbox', '/api/companions', '/api/library'} <= set(exact)
    assert '/api/speak/' in prefixes
    assert set(prefixes) <= set(PREFIXES), f'Give {set(prefixes) - set(PREFIXES)} sample routes in PREFIXES'
    assert not set(PARAMS) - set(exact), 'PARAMS names a route the router no longer has'


@pytest.fixture(scope='module')
def server(tmp_path_factory):
    tmp = tmp_path_factory.mktemp('api-paths')
    env = dict(os.environ, PYTHONPATH=str(CODE / 'src'), TMPDIR=str(tmp))
    process = subprocess.Popen([sys.executable, str(HERE / 'web_fixture.py'), *FLAGS], cwd=str(tmp), env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        info = json.loads(process.stdout.readline())
        yield info
    finally:
        process.terminate()
        try:
            process.wait(10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def needles(info):
    root = info['root']
    found = {root, os.path.realpath(root), str(Path.home()), str(CODE), os.path.realpath(CODE),
             sys.executable, os.path.realpath(sys.executable), sys.prefix}
    return sorted(n for n in found if n and n != '/')


def fetch(url):
    try:
        with urlopen(Request(url), timeout=60) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()


def stream_head(url, limit=64 * 1024):
    """The first events of an SSE stream (hello and any pending state), then hang up."""
    host, port = url.split('//')[1].split('/')[0].split(':')
    with socket.create_connection((host, int(port)), timeout=5) as connection:
        connection.sendall(f'GET {url.split(port, 1)[1]} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n'.encode())
        data = b''
        try:
            while b'event: hello' not in data or not data.endswith(b'\n\n'):
                chunk = connection.recv(4096)
                if not chunk or len(data) > limit:
                    break
                data += chunk
        except socket.timeout:
            pass
    return data


def post(base, route, payload, token):
    request = Request(base + route, json.dumps(payload).encode(), method='POST',
                      headers={'Content-Type': 'application/json', 'X-Reader-Token': token})
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def chat_with_reply(base):
    """A chat on DOC with one finished fake-voice turn, so the chat routes answer real transcripts."""
    token = json.loads(fetch(base + '/api/library')[1])['token']
    chat = post(base, '/api/chat', {'action': 'create', 'path': DOC}, token)['chat']['id']
    turns = post(base, '/api/chat', {'action': 'send', 'id': chat, 'body': '@Claude what does the passage keep?'}, token)['turns']
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        state = json.loads(fetch(base + '/api/chat?' + urlencode({'id': chat}))[1])
        if turns and not state.get('pending'):
            break
        time.sleep(0.2)
    return chat, turns[0]['id'] if turns else 'missing'


def finished_inbox_run(base):
    """One You got mail run with the fake Codex, so /api/inbox and its events answer a real report."""
    token = json.loads(fetch(base + '/api/library')[1])['token']
    post(base, '/api/inbox', {'action': 'start'}, token)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        runner = json.loads(fetch(base + '/api/inbox')[1])['runner'] or {}
        if runner.get('status') not in ('starting', 'running', None):
            return runner
        time.sleep(0.2)
    raise AssertionError('The fake inbox run did not finish')


def seed_art(root):
    """One art version for DOC whose provenance points at an archived run log, so /api/art/prompt (#146) answers
    real prompts in the walk. Written directly: a second Reader library on this vault would run its own art worker."""
    import hashlib
    sys.path.insert(0, str(CODE / 'src'))
    from reader_mcp import art, art_scene, llm_logs
    root = Path(root)
    scene, counts = art_scene.validate(json.loads((CODE / 'src/reader_mcp/demo/content/art/halo.json').read_text())['scene'])
    generation = '20261026T080000Z-0a0b'
    folder = root / 'art/thought.md' / hashlib.sha256((root / DOC).read_bytes()).hexdigest() / generation
    folder.mkdir(parents=True)
    log = llm_logs.RunLog(root, 'art', 'api-paths-seeded', {'document_path': DOC})
    log.write('brief-prompt.txt', art.render('brief', title='A thought', path=DOC, nonce='0123456789abcdef', text=(root / DOC).read_text()))
    log.write('scene-prompt.txt', art.render('scene', art_title='Seeded', brief='A seeded brief.', nonce='0123456789abcdef', dsl=art.template('dsl')))
    relative = log.finish('done')
    (folder / 'scene.json').write_text(json.dumps(scene))
    (folder / 'brief.md').write_text('---\ntitle: "Seeded"\n---\n\nA seeded brief.\n')
    (folder / 'provenance.json').write_text(json.dumps({'schema_version': 1, 'title': 'Seeded', 'created_at': '2026-10-26T08:00:00+00:00', 'prompts': art.PROMPT_VERSIONS,
                                                        'producer': {'label': 'Painter', 'model': 'fake-model-1', 'kind': 'voice'}, 'log': relative, 'counts': counts}))


def test_no_api_answer_names_a_host_path(server):
    base = server['url']
    seed_art(server['root'])
    prompt = json.loads(fetch(base + '/api/art/prompt?' + urlencode({'path': DOC}))[1])
    assert prompt['recorded'] is True and [s['name'] for s in prompt['stages']] == ['brief', 'scene'], prompt
    chat, turn = chat_with_reply(base)
    assert finished_inbox_run(base)['report_md']
    # The walk below covers the chat owner record (#20, #72) that /api/chats carries.
    assert json.loads(fetch(base + '/api/chats?' + urlencode({'path': DOC}))[1])['owner']['owner'] is True
    exact, _ = get_routes()
    requests = []
    for route in exact:
        if route in SKIP:
            continue
        params = PARAMS.get(route, DEFAULT)
        for query in params if isinstance(params, list) else [params]:
            query = {k: v.format(chat=chat, turn=turn) for k, v in query.items()}
            requests.append(route + ('?' + urlencode(query) if query else ''))
    for prefix, samples in PREFIXES.items():
        requests.extend(samples)
    leaks = {}
    for request in requests:
        status, body = fetch(base + request)
        text = body.decode('utf-8', 'replace')
        hits = [n for n in needles(server) if n in text]
        if hits:
            leaks[request] = (status, hits)
    head = stream_head(base + '/api/chat/stream?' + urlencode({'id': chat})).decode('utf-8', 'replace')
    hits = [n for n in needles(server) if n in head]
    if hits:
        leaks['/api/chat/stream'] = ('stream', hits)
    assert not leaks, 'Answers that name a host path:\n' + '\n'.join(f'  {r} ({s}): {h}' for r, (s, h) in sorted(leaks.items()))
    assert len(requests) > 50


def test_shown_and_resolve_round_trip(tmp_path):
    from reader_mcp.display import resolve, shown
    home = tmp_path / 'home'
    vault = home / 'vault'
    data = {'cwd': str(vault), 'argv': [str(vault / 'bin/voice'), str(home / '.local/bin/claude'), '/opt/homebrew/bin/codex'],
            'note': f'Vault root: {vault}\nsee {home}/notes', 'n': 3}
    out = shown(data, vault, str(home))
    assert out == {'cwd': '<vault>', 'argv': ['<vault>/bin/voice', '~/.local/bin/claude', '/opt/homebrew/bin/codex'],
                   'note': 'Vault root: <vault>\nsee ~/notes', 'n': 3}
    assert resolve('<vault>/bin/voice', vault, str(home)) == str(vault / 'bin/voice')
    assert resolve('~/.local/bin/claude', vault, str(home)) == str(home / '.local/bin/claude')
    assert resolve('/usr/bin/git', vault, str(home)) == '/usr/bin/git'


def test_companion_set_path_accepts_its_display_form(tmp_path):
    from reader_mcp.companions import Companions
    home, vault = tmp_path / 'home', tmp_path / 'vault'
    (home / 'bin').mkdir(parents=True)
    vault.mkdir()
    tool = home / 'bin/git-locks'
    tool.write_text('#!/bin/sh\necho "git-locks 1.2.3"\n')
    tool.chmod(0o755)
    companions = Companions(vault, environ={'PATH': '/usr/bin:/bin', 'HOME': str(home), 'READER_GIT_LOCKS_CANDIDATES': ''},
                            launchctl=str(tmp_path / 'no-launchctl'))
    status = companions.dispatch({'action': 'set-path', 'name': 'git-locks', 'path': '~/bin/git-locks'}, {'via': 'local'})
    assert status['companions'][0]['path'] == '~/bin/git-locks'
    assert str(tmp_path) not in json.dumps(status)
    assert json.loads((vault / '.reader/companions.json').read_text())['paths']['git-locks'] == str(tool)
