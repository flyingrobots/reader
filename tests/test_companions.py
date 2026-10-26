"""Companion tools: discovery, the no-git-locks fallbacks, status and pinned installs.

Every tool here is a fake (tests/fake_toolchain.py): nothing clones, builds, starts a
daemon or touches this Mac's git-locks store, AI-TTS or launchd."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
import urllib.error
import urllib.request
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import fake_toolchain  # noqa: E402
from chat_vault import default_voices, git_locks_shim, make_vault  # noqa: E402

from reader_mcp import companions as cp  # noqa: E402
from reader_mcp import local_model as lm  # noqa: E402
from reader_mcp.chats import Chats  # noqa: E402
from reader_mcp.inbox_runner import sandbox_writable_paths  # noqa: E402
from reader_mcp.prose import Prose  # noqa: E402
from reader_mcp.voice_runner import Conversations  # noqa: E402
from reader_mcp.web import WebLibrary, WebServer  # noqa: E402

SYSTEM_PATH = '/usr/bin:/bin'  # git, sh and ps; never a git-locks folder


@pytest.fixture(autouse=True)
def no_git_locks(monkeypatch, tmp_path):
    """git-locks hidden from PATH and from the usual install folders; no store configured."""
    monkeypatch.setenv('PATH', SYSTEM_PATH)
    monkeypatch.setenv('READER_GIT_LOCKS_CANDIDATES', '')
    for name in ('READER_GIT_LOCKS', 'READER_GIT_LOCKS_STORE', 'GIT_LOCKS_STORE', 'READER_COLORFUL', 'AI_TTS_SOCKET'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('AI_TTS_SOCKET', str(tmp_path / 'no-ai-tts.sock'))
    # These installs use fake tools and tiny fixtures. Model the install's capacity
    # input without changing the Docker guard or any other subsystem's disk probe.
    usage = cp.shutil.disk_usage
    monkeypatch.setattr(cp, 'shutil', SimpleNamespace(**(vars(cp.shutil) | {
        'disk_usage': lambda path: usage(path)._replace(free=10 * 1024**3)})))


def vault(path, git=False):
    root = Path(path)
    for name in ('library', 'inbox', 'indexes'):
        (root / name).mkdir(parents=True, exist_ok=True)
    (root / 'library/note.md').write_text('---\ntitle: A note\n---\n\n# A note\n\nCareful readers keep a quiet library of observations about Margins and Ledgers.\n')
    if git:
        env = {'PATH': SYSTEM_PATH, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1', 'HOME': '/dev/null'}
        for args in (['init', '-q', '-b', 'main'], ['config', 'user.name', 'Synthetic'], ['config', 'user.email', 's@example.invalid'],
                     ['add', '-A'], ['commit', '-q', '-m', 'Synthetic vault']):
            subprocess.run(['git', '-C', str(root), *args], env=env, check=True, capture_output=True)
    return root


# Discovery -------------------------------------------------------------------

def test_git_locks_discovery_is_injectable(tmp_path, monkeypatch):
    assert cp.find_git_locks() is None
    tools = fake_toolchain.install(tmp_path / 'bin', ('git-locks',))
    monkeypatch.setenv('READER_GIT_LOCKS_CANDIDATES', str(tmp_path / 'bin'))
    assert cp.find_git_locks() == str(tools['git-locks'])
    monkeypatch.setenv('READER_GIT_LOCKS', 'none')
    assert cp.find_git_locks() is None, 'READER_GIT_LOCKS=none hides it entirely'
    monkeypatch.delenv('READER_GIT_LOCKS')
    monkeypatch.setenv('READER_GIT_LOCKS_CANDIDATES', '')
    root = vault(tmp_path / 'v')
    cp.save_setting(root, 'git-locks', str(tools['git-locks']))
    assert cp.find_git_locks(root=root) == str(tools['git-locks']), 'a path set in Behind the scenes is found'


def test_coordination_is_local_without_git_locks_or_a_store_and_fails_closed_on_a_bad_store(tmp_path, monkeypatch):
    assert cp.coordination()['mode'] == 'local'
    fake_toolchain.install(tmp_path / 'bin', ('git-locks',))
    monkeypatch.setenv('READER_GIT_LOCKS_CANDIDATES', str(tmp_path / 'bin'))
    assert cp.coordination()['mode'] == 'local', 'git-locks without any store is this Reader only'
    monkeypatch.setenv('READER_GIT_LOCKS_STORE', str(fake_toolchain.store(tmp_path / 'store.git')))
    mode = cp.coordination()
    assert mode['mode'] == 'git-locks' and mode['store_origin'] == 'READER_GIT_LOCKS_STORE'
    monkeypatch.setenv('READER_GIT_LOCKS_STORE', str(tmp_path / 'missing.git'))
    assert cp.coordination()['mode'] == 'error', 'a configured store that is not a Git directory fails closed'


# The GPU lock (issue: no fallback without git-locks) ---------------------------

def test_gpu_lock_falls_back_to_a_reader_local_flock(tmp_path):
    root = vault(tmp_path / 'v')
    lock = lm.GPULock(root, wait=0)
    assert lock.mode()['label'] == 'This Reader only'
    with lock('batch') as held:
        assert held['mode'] == 'local' and (root / '.reader/gpu.lock').is_file()
        with pytest.raises(BlockingIOError, match='this Reader'):
            with lm.GPULock(root, wait=0)('second batch'):
                pass
    with lock('again'):
        pass


def test_gpu_lock_uses_git_locks_when_present_and_fails_closed_on_store_errors(tmp_path, monkeypatch):
    root = vault(tmp_path / 'v')
    fake_toolchain.install(tmp_path / 'bin', ('git-locks',))
    log = tmp_path / 'tools.jsonl'
    monkeypatch.setenv('FAKE_TOOL_LOG', str(log))
    monkeypatch.setenv('READER_GIT_LOCKS_CANDIDATES', str(tmp_path / 'bin'))
    store = fake_toolchain.store(tmp_path / 'store.git')
    monkeypatch.setenv('READER_GIT_LOCKS_STORE', str(store))
    with lm.GPULock(root)('batch') as held:
        assert held['mode'] == 'git-locks' and held['acquisition'] == 'acq-fake'
    claim, release = fake_toolchain.calls(log, 'git-locks')
    assert claim['argv'][0] == 'claim' and claim['argv'][-1] == 'host/gpu/' and claim['store'] == str(store) and release['argv'][0] == 'release'
    broken = tmp_path / 'broken' / 'git-locks'
    broken.parent.mkdir()
    broken.write_text('#!/bin/sh\necho store unreadable >&2\nexit 2\n')
    broken.chmod(0o755)
    monkeypatch.setenv('READER_GIT_LOCKS', str(broken))
    with pytest.raises(RuntimeError, match='fails closed'):
        with lm.GPULock(root)('batch'):
            pass
    monkeypatch.setenv('READER_GIT_LOCKS_STORE', str(tmp_path / 'not-a-store'))
    with pytest.raises(RuntimeError, match='fail closed'):
        with lm.GPULock(root)('batch'):
            pass


def test_local_model_batch_runs_without_git_locks(tmp_path, monkeypatch):
    import fake_lmstudio
    root = vault(tmp_path / 'v')
    works = [dict(id='library/note.md', title='A note', primary='library/note.md', authors=['Ada'], topics=[], projects=[],
                  date='2026-10-01', primary_format='.md', primary_bytes=60)]
    (root / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-01', 'works': works}))
    state = tmp_path / 'lms-state'
    monkeypatch.setenv('FAKE_LMS_STATE', str(state))
    exe = fake_lmstudio.install(tmp_path / 'lms-bin')
    library = WebLibrary(root, local_model={'url': f'http://127.0.0.1:{fake_lmstudio.free_port()}', 'cli': lm.CLI(str(exe)), 'data_usage': lambda: 0})
    model = library.local_model
    try:
        assert isinstance(model.gpu_lock, lm.GPULock) and model.status()['gpu']['label'] == 'This Reader only'
        from test_local_model import idle, start_server
        start_server(model)
        assert model.dispatch({'action': 'enqueue', 'task': 'standfirst', 'scope': 'recent'})['added'] == 1
        model.dispatch({'action': 'run', 'task': 'standfirst'})
        status = idle(model)
        assert [r['state'] for r in status['recent']] == ['done'] and status['runs'][0]['state'] == 'finished', status['runs']
        assert (root / '.reader/gpu.lock').is_file()
    finally:
        model.close()
        fake_lmstudio.stop(state)


# Commits without git-locks -----------------------------------------------------

def test_chat_commit_falls_back_to_flock_without_git_locks(tmp_path):
    root = make_vault(tmp_path / 'v')
    chats = Chats(root)
    chat_id = str(uuid4())
    (root / 'chats').mkdir(exist_ok=True)
    (root / 'chats' / f'{chat_id}.json').write_text('{"synthetic": true}\n')
    result = chats.commit(chat_id, 'Chat: synthetic')
    assert result['status'] == 'committed' and result['locked_by'] == 'flock'


def test_voice_turn_commits_without_git_locks(tmp_path):
    root = make_vault(tmp_path / 'v')
    from test_chats import documents
    conversations = Conversations(root, documents(root), git_locks=None)
    try:
        chat = conversations.create('library/thought.md', 'You', request_id=str(uuid4()))['chat']
        conversations.send(chat['id'], '@claude what stands out?', 'You')
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            info = conversations.get(chat['id'])
            if not conversations.runner.pending(chat['id']) and conversations.runner.commits.unfinished_tasks == 0 and len(info['chat']['messages']) >= 2:
                break
            time.sleep(.05)
        commit = conversations.get(chat['id'])['commit']
        assert commit['status'] == 'committed' and commit.get('locked_by') == 'flock', commit
    finally:
        conversations.close()


def test_repo_lock_never_uses_a_host_git_locks_store(tmp_path, monkeypatch):
    """GIT_LOCKS_STORE names the workstation store; the vault's .git/ key belongs to the vault's own store."""
    root = make_vault(tmp_path / 'v')
    log = tmp_path / 'shim.jsonl'
    shim = git_locks_shim(tmp_path, log)
    env_log = tmp_path / 'env.txt'
    shim.write_text(shim.read_text().replace('command = ', f'open({str(env_log)!r}, "a").write(str(__import__("os").environ.get("GIT_LOCKS_STORE")) + "\\n")\ncommand = ', 1))
    monkeypatch.setenv('GIT_LOCKS_STORE', '/tmp/host-store-not-for-repos')
    chat_id = str(uuid4())
    (root / 'chats').mkdir(exist_ok=True)
    (root / 'chats' / f'{chat_id}.json').write_text('{}\n')
    assert Chats(root).commit(chat_id, 'Chat: synthetic', git_locks=str(shim))['locked_by'] == 'git-locks'
    assert env_log.read_text().split() == ['None']


def test_scratch_pad_save_commits_without_git_locks(tmp_path):
    root = vault(tmp_path / 'v', git=True)
    (root / 'writings').mkdir()
    library = WebLibrary(root)
    result = library.writing.dispatch({'action': 'save', 'request_id': str(uuid4()), 'title': 'Without locks', 'slug': 'without-locks',
                                       'status': 'draft', 'body': '# Without locks\n\nSaved.\n'}, 'You')
    assert result['status'] == 'committed' and result['locked_by'] == 'flock', result
    library.close()


def test_inbox_runner_paths_without_git_locks(tmp_path):
    root = vault(tmp_path / 'v', git=True)
    paths = sandbox_writable_paths(root)
    assert paths and all('git-locks' not in p for p in paths)


# Status ---------------------------------------------------------------------------

def companions(tmp_path, monkeypatch, tools=('git', 'cargo'), **options):
    root = vault(tmp_path / 'v')
    fake_toolchain.install(tmp_path / 'bin', tools)
    log = tmp_path / 'tools.jsonl'
    monkeypatch.setenv('FAKE_TOOL_LOG', str(log))
    environ = dict(os.environ, PATH=str(tmp_path / 'bin') + ':' + SYSTEM_PATH, HOME=str(tmp_path / 'home'))
    prose = Prose(environ={'PATH': str(tmp_path / 'empty'), 'HOME': str(tmp_path / 'home')})
    library = WebLibrary(root, prose=prose, companions={'environ': environ, **options})
    return root, library, log


def fake_cli(folder, name):
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text('#!/bin/sh\nexit 0\n')
    path.chmod(0o755)
    return str(path)


def test_agents_card_uses_the_configured_environment_not_the_host(tmp_path, monkeypatch):
    # #134: the Agents and models card looks CLIs up on Companions' own PATH and HOME, never the server process's.
    root = vault(tmp_path / 'v')
    claude = fake_cli(tmp_path / 'bin', 'claude')
    agy = fake_cli(tmp_path / 'home/.local/bin', 'agy')
    environ = {'PATH': str(tmp_path / 'bin'), 'HOME': str(tmp_path / 'home'), 'READER_CLI_CANDIDATES': '~/.local/bin'}
    library = WebLibrary(root, prose=Prose(environ={'PATH': str(tmp_path / 'empty'), 'HOME': str(tmp_path / 'home')}),
                         companions={'environ': environ})
    rows = {c['name']: c for c in library.companions.voices()}
    assert rows['claude']['path'] == claude and rows['claude']['state'] == 'installed'
    assert rows['agy']['path'] == agy, 'the usual folders expand against the configured HOME'
    assert rows['codex']['state'] == 'missing' and rows['codex']['path'] is None, 'a host codex never leaks into the card'
    hidden = WebLibrary(vault(tmp_path / 'w'), prose=Prose(environ={'PATH': str(tmp_path / 'empty'), 'HOME': str(tmp_path / 'home')}),
                        companions={'environ': {'PATH': str(tmp_path / 'empty'), 'HOME': str(tmp_path / 'home'), 'READER_CLI_CANDIDATES': ''}})
    assert {c['name']: c['state'] for c in hidden.companions.voices()} == {'claude': 'missing', 'codex': 'missing', 'agy': 'missing'}
    library.close()
    hidden.close()


def wait_job(library, timeout=30):
    deadline = time.monotonic() + timeout
    while library.maintenance.status()['running']:
        if time.monotonic() > deadline:
            raise AssertionError('install job did not finish')
        time.sleep(.05)
    return library.maintenance.status()['jobs'][0]


def test_status_renders_every_companion_when_all_are_missing(tmp_path, monkeypatch):
    root, library, _ = companions(tmp_path, monkeypatch, tools=())
    status = library.companions.status()
    states = {c['name']: c['state'] for c in status['companions']}
    assert states == {'ai-tts': 'missing', 'colorful': 'missing', 'wide-md': 'missing', 'git-locks': 'missing'}
    colorful = next(c for c in status['companions'] if c['name'] == 'colorful')
    assert 'install' not in colorful['actions'] and 'rustup.rs' in colorful['install']['reason'], 'no cargo: explain Rust, never install it'
    git_locks = next(c for c in status['companions'] if c['name'] == 'git-locks')
    assert git_locks['coordination']['label'] == 'This Reader only' and git_locks['guide']['commands']
    assert {c['name'] for c in status['cli']} == {'claude', 'codex', 'agy'}
    with pytest.raises(ValueError, match='Rust'):
        library.companions.dispatch({'action': 'install', 'name': 'colorful'})
    with pytest.raises(ValueError, match='no automated install'):
        library.companions.dispatch({'action': 'install', 'name': 'git-locks'})
    library.close()


# Installs ---------------------------------------------------------------------------

def test_colorful_install_clones_the_pin_builds_and_records_the_path(tmp_path, monkeypatch):
    root, library, log = companions(tmp_path, monkeypatch)
    assert library.prose.status()['available'] is False
    job = library.companions.dispatch({'action': 'install', 'name': 'colorful'})
    assert job['kind'] == 'install-colorful' and job['label'] == 'Install Colorful Language'
    done = wait_job(library)
    assert done['state'] == 'succeeded', done
    git = [c['argv'] for c in fake_toolchain.calls(log, 'git')]
    assert ['clone', '--quiet', '--no-checkout', cp.COLORFUL_REPO, str(root / '.reader/tooling/colorful-language')] in git
    assert any(a[-1] == cp.COLORFUL_COMMIT and 'checkout' in a for a in git), 'checks out the pinned commit'
    cargo = fake_toolchain.calls(log, 'cargo')[0]['argv']
    assert cargo[:5] == ['build', '--locked', '--release', '-p', 'colorful-cli']
    binary = root / '.reader/tooling/bin/colorful'
    assert json.loads((root / '.reader/companions.json').read_text())['paths']['colorful'] == str(binary)
    status = library.prose.status()
    assert status['available'] and status['path'] == str(binary) and status['version'] == '0.4.0'
    entry = library.companions.status('colorful')['companions'][0]
    assert entry['state'] == 'installed' and entry['managed'] and 'update' not in entry['actions']
    assert 'Compiling colorful-cli' in library.companions.log('colorful')['log']
    # Prose colors now work end to end with the built (fake) binary.
    assert library.prose.colorize(('library/note.md', 'x'), [{'id': 'a', 'text': 'A quiet library.'}])['segments']['a']
    library.close()


def test_colorful_build_takes_host_heavy_work_when_git_locks_and_a_store_exist(tmp_path, monkeypatch):
    store = fake_toolchain.store(tmp_path / 'store.git')
    monkeypatch.setenv('READER_GIT_LOCKS_STORE', str(store))
    root, library, log = companions(tmp_path, monkeypatch, tools=('git', 'cargo', 'git-locks'))
    library.companions.environ['READER_GIT_LOCKS_CANDIDATES'] = str(tmp_path / 'bin')
    library.companions.dispatch({'action': 'install', 'name': 'colorful'})
    assert wait_job(library)['state'] == 'succeeded'
    wrapped = fake_toolchain.calls(log, 'git-locks')[0]
    assert wrapped['argv'][0] == 'with' and 'host/heavy-work' in wrapped['argv'] and wrapped['store'] == str(store)
    assert wrapped['argv'][wrapped['argv'].index('--') + 2] == 'build'
    library.close()


def test_installs_refuse_concurrency_report_progress_and_failures(tmp_path, monkeypatch):
    monkeypatch.setenv('FAKE_CARGO_SLEEP', '1.5')
    root, library, _ = companions(tmp_path, monkeypatch)
    library.companions.dispatch({'action': 'install', 'name': 'colorful'})
    with pytest.raises(BlockingIOError, match='already running'):
        library.companions.dispatch({'action': 'install', 'name': 'wide-md'})
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and 'Building' not in ((library.maintenance.status()['running'] or {}).get('progress') or ''):
        time.sleep(.05)
    assert 'Building' in library.maintenance.status()['running']['progress']
    assert library.companions.status('colorful')['companions'][0]['job']['kind'] == 'install-colorful'
    assert wait_job(library)['state'] == 'succeeded'
    monkeypatch.setenv('FAKE_CARGO_SLEEP', '0')
    monkeypatch.setenv('FAKE_CARGO_FAIL', '1')
    library.companions.environ['FAKE_CARGO_FAIL'] = '1'
    library.companions.dispatch({'action': 'check', 'name': 'colorful'})
    (root / '.reader/tooling/colorful-language/.git/HEAD_REV').write_text('stale')
    (root / '.reader/tooling/colorful.json').write_text(json.dumps({'revision': 'older', 'executable': str(root / '.reader/tooling/bin/colorful')}))
    entry = library.companions.status('colorful')['companions'][0]
    assert 'update' in entry['actions'], 'a Reader-built copy at another revision offers Update'
    library.companions.dispatch({'action': 'update', 'name': 'colorful'})
    failed = wait_job(library)
    assert failed['state'] == 'failed' and 'synthetic build failure' in failed['error']
    library.close()


def test_install_refuses_a_foreign_or_edited_checkout_and_times_out(tmp_path, monkeypatch):
    root, library, _ = companions(tmp_path, monkeypatch)
    source = root / '.reader/tooling/colorful-language/.git'
    source.mkdir(parents=True)
    (source / 'origin').write_text('https://example.invalid/someone-else')
    library.companions.dispatch({'action': 'install', 'name': 'colorful'})
    assert 'not the pinned public repository' in wait_job(library)['error']
    (source / 'origin').write_text(cp.COLORFUL_REPO)
    (source / 'dirty').write_text(' M src/lib.rs\n')
    library.companions.dispatch({'action': 'install', 'name': 'colorful'})
    assert 'local edits' in wait_job(library)['error']
    (source / 'dirty').unlink()
    log = root / '.reader/tooling/logs/colorful.log'
    started = time.monotonic()
    with pytest.raises(TimeoutError, match='took longer'):
        library.companions.step('Sleeping', [sys.executable, '-c', 'import time; time.sleep(30)'], log, timeout=1)
    assert time.monotonic() - started < 10
    library.close()


def test_install_log_is_bounded(tmp_path, monkeypatch):
    root, library, _ = companions(tmp_path, monkeypatch)
    log = library.companions.prepare('colorful')
    library.companions.step('Chatty', [sys.executable, '-c', 'print("x" * 1000 + "\\n", end="", flush=True) or [print("y" * 4000) for _ in range(600)]'], log)
    assert log.stat().st_size <= cp.LOG_LIMIT + 4096
    assert len(library.companions.log('colorful')['log']) <= cp.LOG_TAIL
    library.close()


def test_wide_md_install_runs_the_existing_script(tmp_path, monkeypatch):
    from reader_mcp.reading import REVISION
    code = tmp_path / 'code'
    (code / 'scripts').mkdir(parents=True)
    (code / 'scripts/install_wide_md.py').write_text(
        'import hashlib, json, os, pathlib\n'
        'tooling = pathlib.Path(os.environ["READER_ROOT"]) / ".reader/tooling"\n'
        '(tooling / "bin").mkdir(parents=True, exist_ok=True)\n'
        'tool = tooling / "bin/wide-md"; tool.write_text("#!/bin/sh\\ncat\\n"); tool.chmod(0o755)\n'
        f'(tooling / "installed.json").write_text(json.dumps({{"revision": {REVISION!r}, "executable_sha256": hashlib.sha256(tool.read_bytes()).hexdigest()}}))\n'
        'print("built wide-md")\n')
    root, library, _ = companions(tmp_path, monkeypatch, code=code)
    assert library.companions.status('wide-md')['companions'][0]['state'] == 'missing'
    library.companions.dispatch({'action': 'install', 'name': 'wide-md'})
    done = wait_job(library)
    assert done['state'] == 'succeeded', done
    assert library.companions.status('wide-md')['companions'][0]['state'] == 'installed'
    library.close()


def test_ai_tts_is_guided_and_start_asks_its_launch_agent(tmp_path, monkeypatch):
    root, library, log = companions(tmp_path, monkeypatch, tools=('launchctl',), launchctl=str(tmp_path / 'bin/launchctl'))
    entry = library.companions.status('ai-tts')['companions'][0]
    assert entry['state'] == 'missing' and entry['actions'] == ['guide', 'check'] and 'make install' in entry['guide']['commands']
    with pytest.raises(ValueError, match='launch agent'):
        library.companions.dispatch({'action': 'start', 'name': 'ai-tts'})
    agents = tmp_path / 'home/Library/LaunchAgents'
    agents.mkdir(parents=True)
    (agents / 'com.flyingrobots.ai-tts.plist').write_text('<plist/>')
    state = tmp_path / 'launchd-state'
    library.companions.environ['FAKE_LAUNCHCTL_STATE'] = str(state)
    entry = library.companions.status('ai-tts')['companions'][0]
    assert entry['state'] == 'not-running' and 'start' in entry['actions'] and entry['start']['changes']

    class Speech:
        socket_path = tmp_path / 'sock'
        def status(self):
            if not state.exists():
                from reader_mcp.speech import SpeechUnavailable
                raise SpeechUnavailable('not yet')
            return {'held': False, 'playback_state': 'Idle', 'current': None, 'segment': None}
    library.companions.speech = Speech()
    library.companions.dispatch({'action': 'start', 'name': 'ai-tts'})
    assert wait_job(library)['state'] == 'succeeded'
    argv = [c['argv'] for c in fake_toolchain.calls(log, 'launchctl')]
    assert argv[0][0] == 'print' and argv[1][0] == 'bootstrap' and argv[1][-1].endswith('com.flyingrobots.ai-tts.plist')
    assert library.companions.status('ai-tts')['companions'][0]['label'] == 'Running'
    library.close()


def test_colorful_030_reads_too_old_in_companions_and_set_path(tmp_path, monkeypatch):
    root, library, _ = companions(tmp_path, monkeypatch)
    v030 = tmp_path / 'colorful-030'
    v030.write_text('#!/bin/sh\necho colorful 0.3.0\n')
    v030.chmod(0o755)
    with pytest.raises(ValueError, match=r'Colorful 0\.3\.0 is too old; Reader needs 0\.4\.0 or newer'):
        library.companions.dispatch({'action': 'set-path', 'name': 'colorful', 'path': str(v030)})
    library.prose.environ['READER_COLORFUL'] = str(v030)
    entry = library.companions.status('colorful')['companions'][0]
    assert entry['state'] == 'too-old' and entry['label'] == 'Too old', entry
    assert 'needs 0.4.0 or newer' in entry['message'] and 'install' in entry['actions']
    assert library.prose.status()['available'] is False


def test_colorful_install_refuses_a_build_below_the_floor(tmp_path, monkeypatch):
    monkeypatch.setenv('FAKE_CARGO_VERSION', '0.3.0')
    root, library, _ = companions(tmp_path, monkeypatch)
    library.companions.dispatch({'action': 'install', 'name': 'colorful'})
    done = wait_job(library)
    assert done['state'] == 'failed' and 'did not report version 0.4.0 or newer' in json.dumps(done), done


def test_set_path_validates_and_records(tmp_path, monkeypatch):
    root, library, _ = companions(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match='absolute'):
        library.companions.dispatch({'action': 'set-path', 'name': 'colorful', 'path': 'colorful'})
    with pytest.raises(ValueError, match='not an executable'):
        library.companions.dispatch({'action': 'set-path', 'name': 'colorful', 'path': str(tmp_path / 'nothing')})
    old = tmp_path / 'old-colorful'
    old.write_text('#!/bin/sh\necho colorful 0.2.1\n')
    old.chmod(0o755)
    with pytest.raises(ValueError, match='too old'):
        library.companions.dispatch({'action': 'set-path', 'name': 'colorful', 'path': str(old)})
    good = tmp_path / 'good-colorful'
    good.write_text(f'#!/bin/sh\nif [ "$1" = "--version" ]; then echo colorful 0.4.0; exit 0; fi\nexec {sys.executable} {Path(__file__).with_name("fake_colorful.py")} "$@"\n')
    good.chmod(0o755)
    entry = library.companions.dispatch({'action': 'set-path', 'name': 'colorful', 'path': str(good)})['companions'][0]
    assert entry['state'] == 'installed' and entry['path'] == str(good) and entry['origin'] == 'settings'
    store = fake_toolchain.store(tmp_path / 'chosen.git')
    library.companions.dispatch({'action': 'set-path', 'name': 'git-locks', 'path': str(store)})
    assert cp.load_settings(root)['git-locks-store'] == str(store)
    library.companions.dispatch({'action': 'set-path', 'name': 'colorful', 'path': ''})
    assert 'colorful' not in cp.load_settings(root)
    library.close()


# HTTP ------------------------------------------------------------------------------------

def test_routes_require_the_token_and_installs_never_start_through_maintenance(tmp_path, monkeypatch):
    root, library, _ = companions(tmp_path, monkeypatch, tools=())
    server = WebServer(('127.0.0.1', 0), library, 'You')
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'

    def call(path, payload=None, token=None, headers=None):
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(base + path, data=data, method='POST' if data else 'GET',
                                         headers={'Content-Type': 'application/json', 'X-Reader-Token': token or server.token} | (headers or {}))
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())
    try:
        status, body = call('/api/companions')
        assert status == 200 and len(body['companions']) == 4
        assert call('/api/companions', {'action': 'install', 'name': 'colorful'}, token='wrong')[0] == 403
        assert call('/api/companions', {'action': 'install', 'name': 'colorful'}, headers={'X-Forwarded-For': '100.64.0.9'})[0] == 403, \
            'a proxied request without an allowed tailnet login is refused'
        assert call('/api/maintenance', {'action': 'start', 'kind': 'install-colorful'})[0] == 400
        assert call('/api/companions', {'action': 'install', 'name': 'colorful', 'url': 'https://example.invalid'})[0] == 400, 'no user-supplied sources'
        assert call('/api/companions/log?name=colorful')[0] == 200
        # A missing companion is a calm, explained refusal, never a 500.
        status, body = call('/api/prose', {'path': 'library/note.md', 'sha256': library.digest('library/note.md'), 'segments': [{'id': 'a', 'text': 'Hi.'}]})
        assert status == 409 and body['unavailable'] and 'Companions' in body['error']
        status, body = call('/api/speak', {'path': 'library/note.md', 'source_sha256': library.digest('library/note.md')})
        assert status == 503 and body['unavailable']
    finally:
        server.shutdown()
        library.close()
