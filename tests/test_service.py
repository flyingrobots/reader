"""reader_service.py against fake launchctl, tailscale, git and git-locks, with a temporary HOME.

Nothing here touches launchd, Tailscale, ~/Library or a real repository: the fakes keep their
world in one JSON file, and a small HTTP server stands in for the restarted Reader web."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import textwrap
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/reader_service.py'
GOOD, NEWER, BROKEN, SICK = 'a' * 40, 'b' * 40, 'c' * 40, 'd' * 40
TAILNET = 'reader-host.example-tailnet.ts.net'
LOGIN = 'user@example.com'

PRELUDE = '''#!{python}
import json, os, shutil, sys
from pathlib import Path
STATE = Path(os.environ['FAKE_WORLD'])
def load(): return json.loads(STATE.read_text())
def save(w): STATE.write_text(json.dumps(w))
w = load(); w['calls'].append([Path(sys.argv[0]).name, *sys.argv[1:]]); save(w)
args = sys.argv[1:]
'''

FAKE_GIT = '''
cwd = os.getcwd()
if args[:1] == ['-C']:
    cwd, args = args[1], args[2:]
def out(text): print(text); sys.exit(0)
if args[:2] == ['rev-parse', '--verify']:
    ref = args[-1].removesuffix('^{commit}')
    if ref in w['branches']: out(w['branches'][ref])
    if ref in w['templates'] or len(ref) == 40: out(ref)
    sys.exit(128)
if args == ['rev-parse', 'HEAD']:
    if cwd in w['heads']: out(w['heads'][cwd])
    sys.exit(128)
if args[:2] == ['show', '-s']:
    out('2026-10-20T10:00:00+00:00\\x00Synthetic change ' + args[-1][:7])
if args[:2] == ['worktree', 'add']:
    path, commit = args[-2], args[-1]
    template = Path(w['template_root']) / commit
    if template.is_dir(): shutil.copytree(template, path)
    else: Path(path).mkdir(parents=True)
    w = load(); w['heads'][path] = commit; save(w); sys.exit(0)
if args[:2] == ['worktree', 'remove']:
    path = args[-1]; shutil.rmtree(path, ignore_errors=True)
    w = load(); w['heads'].pop(path, None); save(w); sys.exit(0)
if args[:2] == ['worktree', 'prune']: sys.exit(0)
if args[:2] == ['status', '--porcelain']: out(w['dirty'].get(cwd, ''))
if args == ['remote']: out('origin')
if args[:1] == ['fetch']:
    if w.get('offline'): print('fatal: unable to access remote', file=sys.stderr); sys.exit(128)
    w = load(); w['branches'].update(w.get('upstream', {})); save(w); sys.exit(0)
if args[:1] == ['checkout']:
    w = load(); w['heads'][cwd] = args[-1]; save(w); sys.exit(0)
print('fake git: unsupported ' + ' '.join(args), file=sys.stderr); sys.exit(2)
'''

FAKE_GIT_LOCKS = '''
assert args[0] == 'with' and '.git/' in args, args
assert 'GIT_LOCKS_STORE' not in os.environ, 'the repo .git/ key uses the repository default store'
command = args[args.index('--') + 1:]
import subprocess
sys.exit(subprocess.run(command, cwd=os.getcwd()).returncode)
'''

FAKE_LAUNCHCTL = '''
import plistlib
if args[0] == 'print':
    label = args[1].rsplit('/', 1)[1]
    if label in w['loaded']:
        print('gui/501/' + label + ' = {\\n\\tstate = running\\n\\tpid = 4242\\n}'); sys.exit(0)
    sys.exit(113)
if args[0] == 'bootstrap':
    label = plistlib.loads(Path(args[2]).read_bytes())['Label']
    w = load(); w['loaded'].append(label); save(w); sys.exit(0)
if args[0] == 'bootout':
    label = args[1].rsplit('/', 1)[1]
    w = load(); w['loaded'] = [l for l in w['loaded'] if l != label]; save(w); sys.exit(0)
if args[0] == 'kickstart':
    w = load(); w['kicks'].append(args[-1].rsplit('/', 1)[1]); save(w); sys.exit(0)
sys.exit(2)
'''

FAKE_TAILSCALE = '''
if 'funnel' in args:
    print('fake tailscale: funnel must never be called', file=sys.stderr); sys.exit(99)
if args == ['status', '--json']:
    print(json.dumps({'BackendState': 'Running', 'Self': {'DNSName': w['dns'] + '.', 'UserID': 7},
                      'User': {'7': {'ID': 7, 'LoginName': w['login'], 'DisplayName': 'Example User'}}})); sys.exit(0)
if args == ['serve', 'status', '--json']:
    print(json.dumps(w['serve']) if w['serve'] else ''); sys.exit(0)
if args[:3] == ['serve', '--bg', '--https=443']:
    w = load(); w['serve'].setdefault('TCP', {})['443'] = {'HTTPS': True}
    w['serve'].setdefault('Web', {})[w['dns'] + ':443'] = {'Handlers': {'/': {'Proxy': args[3]}}}; save(w); sys.exit(0)
if args == ['serve', '--https=443', 'off']:
    w = load(); w['serve'].get('TCP', {}).pop('443', None); w['serve'].get('Web', {}).pop(w['dns'] + ':443', None)
    for key in ('TCP', 'Web'):
        if not w['serve'].get(key): w['serve'].pop(key, None)
    save(w); sys.exit(0)
sys.exit(2)
'''

PASSING_TEST = 'def test_ok():\n    assert True\n'
FAILING_TEST = 'def test_broken():\n    assert False, "synthetic regression"\n'
FIXTURE = textwrap.dedent('''
    import json
    from http.server import BaseHTTPRequestHandler, HTTPServer
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            body = {'/': b'<!doctype html><html><body>Reader</body></html>',
                    '/api/library': json.dumps({'works': [{'primary': 'library/thought.md'}]}).encode()}.get(self.path)
            if self.path.startswith('/api/document'):
                body = json.dumps({'text': 'A quiet thought.'}).encode()
            self.send_response(200 if body else 404); self.end_headers(); self.wfile.write(body or b'')
    server = HTTPServer(('127.0.0.1', 0), H)
    print(json.dumps({'url': 'http://127.0.0.1:%d' % server.server_port}), flush=True)
    server.serve_forever()
''')


@pytest.fixture
def world(tmp_path, monkeypatch):
    home, bin_dir, templates = tmp_path / 'home', tmp_path / 'bin', tmp_path / 'templates'
    repo, vault = tmp_path / 'repo', tmp_path / 'vault'
    for folder in (home, bin_dir, repo, vault / 'library', vault / 'inbox'):
        folder.mkdir(parents=True)
    for commit, test in ((GOOD, PASSING_TEST), (NEWER, PASSING_TEST), (BROKEN, FAILING_TEST), (SICK, PASSING_TEST)):
        (templates / commit / 'tests').mkdir(parents=True)
        (templates / commit / 'tests/test_web.py').write_text(test)
        (templates / commit / 'tests/web_fixture.py').write_text(FIXTURE)
    file = tmp_path / 'world.json'
    file.write_text(json.dumps({'calls': [], 'branches': {'origin/main': GOOD}, 'heads': {}, 'dirty': {},
                                'loaded': [], 'kicks': [], 'templates': [GOOD, NEWER, BROKEN, SICK], 'template_root': str(templates),
                                'unhealthy': [SICK], 'busy': [], 'dns': TAILNET, 'login': LOGIN,
                                'serve': {'TCP': {'1234': {'TCPForward': '127.0.0.1:1234'}}}}))
    for name, body in (('git', FAKE_GIT), ('git-locks', FAKE_GIT_LOCKS), ('launchctl', FAKE_LAUNCHCTL), ('tailscale', FAKE_TAILSCALE)):
        (bin_dir / name).write_text(PRELUDE.format(python=sys.executable) + body)
        (bin_dir / name).chmod(0o755)
    (repo / '.venv/bin').mkdir(parents=True)
    (repo / '.venv/bin/python').write_text(f'#!/bin/sh\nexec {sys.executable} "$@"\n')
    (repo / '.venv/bin/python').chmod(0o755)
    for key in list(os.environ):
        if key.startswith('READER_'):
            monkeypatch.delenv(key)
    env = {'HOME': str(home), 'FAKE_WORLD': str(file), 'READER_SERVICE_LAUNCHCTL': str(bin_dir / 'launchctl'),
           'READER_SERVICE_TAILSCALE': str(bin_dir / 'tailscale'), 'READER_SERVICE_GIT': str(bin_dir / 'git'),
           'READER_SERVICE_GIT_LOCKS': str(bin_dir / 'git-locks'), 'READER_SERVICE_HEALTH_TIMEOUT': '3',
           'READER_SERVICE_BUSY_POLL': '0.1', 'READER_SERVICE_SMOKE_TIMEOUT': '60'}
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    class Health(BaseHTTPRequestHandler):
        """The restarted Reader web: healthy unless its live commit is marked unhealthy."""
        def log_message(self, *_):
            pass

        def do_GET(self):
            state = json.loads(file.read_text())
            commit = state['heads'].get(str(home / 'Library/Application Support/Reader/live'))
            if self.path != '/api/health' or commit in state['unhealthy']:
                self.send_response(503); self.end_headers(); return
            body = json.dumps({'status': 'ok', 'commit': commit, 'busy': state['busy']}).encode()
            self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

    health = ThreadingHTTPServer(('127.0.0.1', 0), Health)
    threading.Thread(target=health.serve_forever, daemon=True).start()
    spec = importlib.util.spec_from_file_location('reader_service_under_test', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class World:
        def __init__(self):
            self.home, self.repo, self.vault, self.port, self.module, self.env = home, repo, vault, health.server_port, module, env

        @property
        def state(self):
            return json.loads(file.read_text())

        def edit(self, **changes):
            file.write_text(json.dumps(self.state | changes))

        def run(self, *argv, expect=0):
            import contextlib, io
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream):
                code = module.main(list(argv))
            result = json.loads(stream.getvalue())
            assert code == expect, result
            return result

        def install(self, *extra):
            return self.run('install', '--repo', str(repo), '--vault', str(vault), '--port', str(self.port), *extra)

        def calls(self, program):
            return [call[1:] for call in self.state['calls'] if call[0] == program]

        def service_state(self):
            return json.loads((home / 'Library/Application Support/Reader/service.json').read_text())

    yield World()
    health.shutdown()
    health.server_close()


def test_install_writes_agents_with_the_right_keys_and_backs_up_existing_ones(world):
    agents = world.home / 'Library/LaunchAgents'
    agents.mkdir(parents=True)
    original = plistlib.dumps({'Label': 'com.flyingrobots.reader.web', 'ProgramArguments': ['/usr/bin/true']})
    (agents / 'com.flyingrobots.reader.web.plist').write_bytes(original)
    os.environ['GIT_LOCKS_STORE'] = '/tmp/example-store'
    os.environ['READER_COLORFUL'] = '/opt/example/colorful'
    try:
        result = world.install()
        world.edit(branches={'origin/main': NEWER})
        assert world.run('update')['outcome'] == 'updated', 'locked checkouts ignore a host GIT_LOCKS_STORE'
        world.edit(branches={'origin/main': GOOD})
        assert world.run('update')['outcome'] == 'updated'
    finally:
        del os.environ['GIT_LOCKS_STORE'], os.environ['READER_COLORFUL']
    live = world.home / 'Library/Application Support/Reader/live'
    assert result['installed'] and result['healthy'] and result['live_created'] and result['commit'] == GOOD
    assert [s['step'] for s in result['smoke']] == ['pytest', 'GET /', 'GET /api/library', 'GET /api/document']
    web = plistlib.loads((agents / 'com.flyingrobots.reader.web.plist').read_bytes())
    python = str(world.repo / '.venv/bin/python')
    assert web['ProgramArguments'] == [python, str(live / 'scripts/start_web.py'), '--port', str(world.port)]
    assert web['RunAtLoad'] is True and web['KeepAlive'] is True and web['ProcessType'] == 'Interactive' and web['ThrottleInterval'] == 10
    assert web['WorkingDirectory'] == str(live)
    assert web['StandardOutPath'] == web['StandardErrorPath'] == str(world.home / 'Library/Logs/Reader/web.log')
    env = web['EnvironmentVariables']
    assert env['PYTHONPATH'] == str(live / 'src') and env['READER_ROOT'] == str(world.vault)
    assert env['GIT_LOCKS_STORE'] == '/tmp/example-store' and env['READER_COLORFUL'] == '/opt/example/colorful'
    assert not any(key.startswith('READER_SERVICE_') for key in env), 'test-only overrides never reach the agents'
    updater = plistlib.loads((agents / 'com.flyingrobots.reader.updater.plist').read_bytes())
    assert updater['ProgramArguments'] == [python, str(live / 'scripts/reader_service.py'), 'update']
    assert updater['StartInterval'] == 600 and updater['StandardOutPath'] == str(world.home / 'Library/Logs/Reader/updater.log')
    backups = list((world.home / 'Library/Application Support/Reader/backups').glob('com.flyingrobots.reader.web.plist.*'))
    assert len(backups) == 1 and backups[0].read_bytes() == original
    assert sorted(world.state['loaded']) == ['com.flyingrobots.reader.updater', 'com.flyingrobots.reader.web']
    assert ['bootstrap', f'gui/{os.getuid()}', str(agents / 'com.flyingrobots.reader.web.plist')] in world.calls('launchctl')
    # Worktree changes ran under the repo .git/ lock.
    adds = [c for c in world.calls('git-locks') if 'worktree' in c and 'add' in c]
    assert len(adds) == 4 and all('.git/' in c for c in adds)
    assert not [p for p in world.state['heads'] if 'reader-smoke-' in p], 'the smoke worktree is removed'
    # Reinstalling keeps the first backup, the original state.
    world.install()
    assert len(list(backups[0].parent.glob('com.flyingrobots.reader.web.plist.*'))) == 1


def test_live_worktree_defaults_to_app_data_and_a_recorded_location_is_kept(world, monkeypatch):
    custom = world.home / 'elsewhere/live'
    world.install('--live', str(custom))
    assert world.service_state()['live'] == str(custom) and custom.is_dir()
    world.install()
    assert world.service_state()['live'] == str(custom), 'an existing install keeps its recorded live worktree'
    assert not (world.home / 'Library/Application Support/Reader/live').exists()
    monkeypatch.setenv('PATH', f'/opt/example/tools:relative/bin:{os.environ["PATH"]}')
    path = world.module.launch_path().split(':')
    assert path[0] == '/opt/example/tools' and 'relative/bin' not in path, 'the installer PATH comes first; only absolute entries'
    assert path.index('/usr/bin') > 0 and str(world.home / '.local/bin') in path and len(path) == len(set(path))


def test_reinstall_preserves_saved_tool_environment_and_allows_explicit_override(world, monkeypatch):
    monkeypatch.setenv('READER_COLORFUL', '/opt/example/colorful')
    monkeypatch.setenv('READER_TOOL_SETTING', 'retained')
    world.install()
    monkeypatch.delenv('READER_COLORFUL')
    monkeypatch.delenv('READER_TOOL_SETTING')
    world.install()
    assert world.service_state()['env']['READER_COLORFUL'] == '/opt/example/colorful'
    web = plistlib.loads((world.home / 'Library/LaunchAgents/com.flyingrobots.reader.web.plist').read_bytes())
    assert web['EnvironmentVariables']['READER_COLORFUL'] == '/opt/example/colorful'
    world.install('--env', 'READER_COLORFUL=/opt/updated/colorful')
    assert world.service_state()['env']['READER_COLORFUL'] == '/opt/updated/colorful'
    assert world.service_state()['env']['READER_TOOL_SETTING'] == 'retained'


def test_uninstall_restores_the_original_state(world):
    agents = world.home / 'Library/LaunchAgents'
    agents.mkdir(parents=True)
    original = plistlib.dumps({'Label': 'com.flyingrobots.reader.web', 'ProgramArguments': ['/usr/bin/true']})
    (agents / 'com.flyingrobots.reader.web.plist').write_bytes(original)
    world.install()
    result = world.run('uninstall')
    assert result['uninstalled'] and result['restored'] == [str(agents / 'com.flyingrobots.reader.web.plist')]
    assert (agents / 'com.flyingrobots.reader.web.plist').read_bytes() == original
    assert not (agents / 'com.flyingrobots.reader.updater.plist').exists()
    assert world.state['loaded'] == [], 'the replaced plist was not loaded before install, so it stays unloaded'
    assert not (world.home / 'Library/Application Support/Reader/service.json').exists()
    assert world.run('status') == {'installed': False}
    assert (world.home / 'Library/Application Support/Reader/live').is_dir(), 'the live worktree stays unless asked'


def test_install_refuses_a_port_held_by_another_process_and_a_failing_source(world):
    import socket
    with socket.socket() as other:
        other.bind(('127.0.0.1', 0)); other.listen()
        result = world.run('install', '--repo', str(world.repo), '--vault', str(world.vault), '--port', str(other.getsockname()[1]), expect=1)
        assert 'already in use' in result['error']
    world.edit(branches={'origin/main': BROKEN})
    result = world.run('install', '--repo', str(world.repo), '--vault', str(world.vault), '--port', str(world.port), expect=1)
    assert 'failed its smoke test' in result['error']
    assert not (world.home / 'Library/LaunchAgents/com.flyingrobots.reader.web.plist').exists()
    assert not (world.home / 'Library/Application Support/Reader/live').exists()


def test_update_advances_only_after_the_smoke_test_passes(world):
    world.install()
    assert world.run('update')['outcome'] == 'current'
    world.edit(branches={'origin/main': BROKEN})
    kicks = len(world.state['kicks'])
    result = world.run('update')
    assert result['outcome'] == 'smoke-failed' and result['steps'][0] == {'step': 'pytest', 'ok': False, 'detail': result['steps'][0]['detail']}
    assert world.state['heads'][str(world.home / 'Library/Application Support/Reader/live')] == GOOD and len(world.state['kicks']) == kicks
    assert world.run('update')['outcome'] == 'skipped', 'a failed commit is not retested every interval'
    world.edit(branches={'origin/main': NEWER})
    result = world.run('update')
    assert result['outcome'] == 'updated' and result['from'] == GOOD and result['to'] == NEWER
    assert world.state['heads'][str(world.home / 'Library/Application Support/Reader/live')] == NEWER
    assert world.state['kicks'][-1] == 'com.flyingrobots.reader.web'
    assert ['kickstart', '-k', f'gui/{os.getuid()}/com.flyingrobots.reader.web'] in world.calls('launchctl')
    checkout = [c for c in world.calls('git-locks') if 'checkout' in c]
    assert checkout and all('.git/' in c for c in checkout)
    status = world.run('status')
    assert status['commit'] == NEWER and status['previous'] == GOOD and status['last_update']['outcome'] == 'updated'
    assert status['commit_facts']['subject'] == 'Synthetic change bbbbbbb'
    log = (world.home / 'Library/Logs/Reader/updates.jsonl').read_text().splitlines()
    assert [json.loads(line)['outcome'] for line in log] == ['smoke-failed', 'updated']


def test_update_rolls_back_when_the_restarted_server_is_unhealthy(world):
    world.install()
    world.edit(branches={'origin/main': SICK})
    result = world.run('update')
    assert result['outcome'] == 'rolled-back' and result['to'] == SICK
    assert world.state['heads'][str(world.home / 'Library/Application Support/Reader/live')] == GOOD
    assert world.state['kicks'][-2:] == ['com.flyingrobots.reader.web'] * 2
    assert world.service_state()['current'] == GOOD and world.service_state()['failed_commit'] == SICK


def test_update_waits_while_a_chat_turn_or_inbox_run_is_active(world, monkeypatch):
    world.install()
    world.edit(branches={'origin/main': NEWER}, busy=[{'kind': 'inbox', 'label': 'Inbox run'}])
    monkeypatch.setenv('READER_SERVICE_BUSY_WAIT', '0.5')
    kicks = len(world.state['kicks'])
    result = world.run('update')
    assert result['outcome'] == 'deferred' and result['busy'] == [{'kind': 'inbox', 'label': 'Inbox run'}]
    assert world.state['heads'][str(world.home / 'Library/Application Support/Reader/live')] == GOOD and len(world.state['kicks']) == kicks
    # The work finishes while the updater waits: it then switches and restarts.
    monkeypatch.setenv('READER_SERVICE_BUSY_WAIT', '30')
    timer = threading.Timer(1.0, lambda: world.edit(busy=[]))
    timer.start()
    try:
        result = world.run('update')
    finally:
        timer.cancel()
    assert result['outcome'] == 'updated' and world.state['heads'][str(world.home / 'Library/Application Support/Reader/live')] == NEWER


def test_pause_resume_request_update_and_a_dirty_live_worktree(world):
    world.install()
    world.edit(branches={'origin/main': NEWER})
    assert world.run('pause') == {'paused': True}
    assert world.run('update')['outcome'] == 'paused'
    assert world.run('request-update')['requested'] is True
    assert world.state['kicks'][-1] == 'com.flyingrobots.reader.updater'
    assert ['kickstart', f'gui/{os.getuid()}/com.flyingrobots.reader.updater'] in world.calls('launchctl'), 'no -k: a running update is never killed'
    live = str(world.home / 'Library/Application Support/Reader/live')
    world.edit(dirty={live: ' M src/reader_mcp/web.py'})
    result = world.run('update')
    assert result['outcome'] == 'checkout-failed' and 'local changes' in result['error']
    world.edit(dirty={})
    assert world.run('resume') == {'paused': False}
    assert world.run('update')['outcome'] == 'updated'


def test_tailscale_on_preserves_existing_serve_entries_and_never_calls_funnel(world):
    world.install()
    config = world.vault / '.reader/web-config.json'
    result = world.run('tailscale', 'on')
    assert result['url'] == f'https://{TAILNET}' and result['allowed_logins'] == [LOGIN]
    assert result['preserved']['TCP'] == {'1234': {'TCPForward': '127.0.0.1:1234'}}
    assert world.state['serve']['TCP']['1234'] == {'TCPForward': '127.0.0.1:1234'}
    assert ['serve', '--bg', '--https=443', f'http://127.0.0.1:{world.port}'] in world.calls('tailscale')
    assert json.loads(config.read_text()) == {'allowed_hosts': [TAILNET], 'allowed_origins': [f'https://{TAILNET}'],
                                              'trusted_proxy': 'tailscale', 'allowed_logins': [LOGIN]}
    status = world.run('tailscale', 'status')
    assert status['state'] == 'on' and status['url'] == f'https://{TAILNET}' and status['funnel'] is False
    assert world.run('status')['tailscale']['state'] == 'on'
    # Turning it on again is idempotent and keeps an edited allow list.
    config.write_text(json.dumps(json.loads(config.read_text()) | {'allowed_logins': [LOGIN, 'other@example.com']}))
    world.run('tailscale', 'on')
    assert json.loads(config.read_text())['allowed_logins'] == [LOGIN, 'other@example.com']
    assert sum(1 for c in world.calls('tailscale') if c[:2] == ['serve', '--bg']) == 1
    result = world.run('tailscale', 'off')
    assert result['removed_handler'] and world.state['serve'] == {'TCP': {'1234': {'TCPForward': '127.0.0.1:1234'}}}
    assert not config.exists(), 'off restores the original state: there was no web config before'
    assert not any('funnel' in c for c in world.calls('tailscale'))


def test_tailscale_on_refuses_to_replace_other_handlers_or_join_funnel(world):
    world.install()
    (world.vault / '.reader').mkdir()
    original = json.dumps({'allowed_logins': ['owner@example.com']})
    (world.vault / '.reader/web-config.json').write_text(original)
    world.edit(serve={'TCP': {'443': {'HTTPS': True}}, 'Web': {f'{TAILNET}:443': {'Handlers': {'/': {'Proxy': 'http://127.0.0.1:3000'}}}}})
    assert 'already serves http://127.0.0.1:3000' in world.run('tailscale', 'on', expect=1)['error']
    world.edit(serve={'TCP': {'443': {'TCPForward': '127.0.0.1:9443'}}})
    assert 'TCP forward' in world.run('tailscale', 'on', expect=1)['error']
    world.edit(serve={'AllowFunnel': {f'{TAILNET}:443': True}})
    assert 'Funnel' in world.run('tailscale', 'on', expect=1)['error']
    assert not any(c[:2] == ['serve', '--bg'] for c in world.calls('tailscale'))
    world.edit(serve={})
    result = world.run('tailscale', 'on')
    assert result['allowed_logins'] == ['owner@example.com'], 'an existing allow list is kept'
    world.run('tailscale', 'off')
    assert (world.vault / '.reader/web-config.json').read_text() == original, 'off restores the backed-up config'
    with pytest.raises(Exception):
        world.module.run(['/bin/echo', 'funnel', '443'])


def test_logs_rotate_at_the_limit_and_the_cli_prints_json(world, tmp_path):
    log = tmp_path / 'web.log'
    log.write_bytes(b'x' * 100)
    assert not world.module.rotate(log, limit=200)
    for round in range(5):
        log.write_bytes(bytes([65 + round]) * 300)
        assert world.module.rotate(log, limit=200, keep=3)
    assert log.stat().st_size == 0
    assert sorted(p.name for p in tmp_path.glob('web.log*')) == ['web.log', 'web.log.1', 'web.log.2', 'web.log.3']
    assert (tmp_path / 'web.log.1').read_bytes() == b'E' * 300 and (tmp_path / 'web.log.3').read_bytes() == b'C' * 300
    env = os.environ.copy()
    result = subprocess.run([sys.executable, str(SCRIPT), 'status', '--json'], capture_output=True, text=True, env=env, timeout=30)
    assert result.returncode == 0 and json.loads(result.stdout) == {'installed': False}


def test_install_and_update_work_without_git_locks(world, monkeypatch):
    """git-locks is optional: Git changes then serialize on the service's own flock."""
    monkeypatch.setenv('READER_SERVICE_GIT_LOCKS', 'none')
    result = world.install()
    assert result['installed'] and result['commit'] == GOOD
    assert 'git_locks' not in world.service_state()['executables']
    world.edit(branches={'origin/main': NEWER})
    assert world.run('update')['outcome'] == 'updated'
    assert world.state['heads'][str(world.home / 'Library/Application Support/Reader/live')] == NEWER
    assert world.calls('git-locks') == [] and any('checkout' in c for c in world.calls('git'))
    assert (world.home / 'Library/Application Support/Reader/git.lock').is_file()


def test_update_fetches_a_remote_tracking_source_and_survives_being_offline(world):
    """origin/main follows what was pushed: the updater fetches it, under the repo `.git/` lock, before resolving."""
    world.install()
    world.edit(upstream={'origin/main': NEWER})
    result = world.run('update')
    assert result['outcome'] == 'updated' and result['to'] == NEWER
    fetches = [c for c in world.calls('git-locks') if 'fetch' in c]
    assert fetches and all('.git/' in c for c in fetches)
    assert fetches[-1][-2:] == ['origin', '+refs/heads/main:refs/remotes/origin/main']
    world.edit(offline=True, upstream={'origin/main': GOOD})
    assert world.run('update')['outcome'] == 'current', 'offline, it keeps following the last fetched commit'
    log = [json.loads(line) for line in (world.home / 'Library/Logs/Reader/updates.jsonl').read_text().splitlines()]
    assert log[-1]['outcome'] == 'fetch-failed' and log[-1]['following'] == NEWER and 'unable to access' in log[-1]['error']


def test_a_local_branch_source_is_not_fetched(world):
    world.edit(branches={'origin/main': GOOD, 'preview/integration': GOOD})
    world.install('--source', 'preview/integration')
    world.run('update')
    assert not [c for c in world.calls('git-locks') + world.calls('git') if 'fetch' in c]
