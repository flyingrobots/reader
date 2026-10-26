"""Every local-model run is archived in the vault's LLM log (`logs/llm/local-model/`), like chat turns.

Runs go to in-process fake OpenAI-compatible servers only (tests/fake_openai_servers.py). A sentinel
API key must never reach any archived file or the commit that carries it."""
from contextlib import contextmanager
import gzip
import json
from pathlib import Path
import subprocess
import sys
import time

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from fake_openai_servers import FakeServer, guarded_connect, loopback_connect  # noqa: E402

from reader_mcp import llm_logs  # noqa: E402
from reader_mcp import local_model as lm  # noqa: E402
from reader_mcp.web import WebLibrary  # noqa: E402

SENTINEL = 'sk-sentinel-' + 'Q7' * 14


class FakeLock:
    def __init__(self):
        self.entries = []

    @contextmanager
    def __call__(self, note, cancelled=lambda: False):
        self.entries.append(note)
        yield {'job': 'fake'}


class NoCLI(lm.CLI):
    @property
    def path(self):
        return '/nonexistent/lms'

    def run(self, *args, timeout=lm.CLI_TIMEOUT):
        raise AssertionError('lms ran for a non-LM Studio provider')


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.delenv(lm.API_KEY_ENV, raising=False)
    monkeypatch.delenv('READER_LMSTUDIO_URL', raising=False)
    root = tmp_path / 'vault'
    for name in ('library', 'indexes'):
        (root / name).mkdir(parents=True)
    works = []
    for i in range(3):
        path = f'library/note-{i}.md'
        body = (f'---\ntitle: Note {i}\n---\n\n# Note {i}\n\nCareful readers keep a quiet library of observations about '
                'Margins and Ledgers, written beside difficult passages.\n')
        (root / path).write_text(body)
        works.append(dict(id=path, title=f'Note {i}', primary=path, authors=['Ada'], topics=[], projects=[], date=f'2026-10-0{i + 1}',
                          primary_format='.md', primary_bytes=len(body)))
    (root / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-31', 'works': works}))
    (root / '.gitignore').write_text('.reader/\n')
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.email', 'tests@example.invalid')
    git(root, 'config', 'user.name', 'Tests')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'Synthetic vault')
    return root


def make(root, connect=None, **options):
    library = WebLibrary(root, local_model={'cli': NoCLI(), 'gpu_lock': FakeLock(), 'data_usage': lambda: 0,
                                            'connect': connect or guarded_connect, 'git_locks': False, **options})
    return library.local_model


def idle(model, timeout=20):
    deadline = time.monotonic() + timeout
    while model.worker and model.worker.is_alive():
        if time.monotonic() > deadline:
            raise AssertionError('worker still running')
        time.sleep(.05)
    return model.status()


def runs(root):
    base = root / 'logs/llm/local-model'
    return sorted(p.parent for p in base.rglob('meta.json')) if base.is_dir() else []


def unpacked(folder):
    """Every archived file's text, decompressed."""
    out = {}
    for path in sorted(folder.iterdir()):
        data = gzip.decompress(path.read_bytes()) if path.name.endswith('.gz') else path.read_bytes()
        out[path.name.removesuffix('.gz')] = data.decode()
    return out


def test_a_run_is_archived_sealed_and_committed_without_the_api_key(vault):
    with FakeServer('ollama', api_key=SENTINEL, echo_auth=True) as fake:
        model = make(vault)
        model.dispatch({'action': 'settings', 'settings': {'provider': {'preset': 'ollama', 'base_url': fake.url, 'model': 'llama3.2:3b',
                                                                        'api_key': SENTINEL}}})
        model.dispatch({'action': 'enqueue', 'task': 'standfirst', 'scope': 'path', 'path': 'library/note-0.md'})
        model.dispatch({'action': 'enqueue', 'task': 'keyterms', 'scope': 'path', 'path': 'library/note-1.md'})
        model.dispatch({'action': 'run'})
        status = idle(model)
        assert [i['state'] for i in status['recent']] == ['done', 'done'], status['recent']
        assert all(r['auth'] for r in fake.requests if r['path'] == '/v1/chat/completions'), 'the key is still sent'

        [folder] = runs(vault)
        relative = folder.relative_to(vault).as_posix()
        assert llm_logs.RELATIVE.fullmatch(relative) and relative.startswith('logs/llm/local-model/')
        files = unpacked(folder)
        assert not any(n.endswith('.partial') for n in files), 'sealed: every artifact is compressed'
        assert set(files) == {'meta.json', 'request-template.json', 'item-01-request.json', 'item-01-response.json',
                              'item-02-request.json', 'item-02-response.json'}
        meta = json.loads(files['meta.json'])
        assert meta['kind'] == 'local-model' and meta['status'] == 'done' and meta['ended_at']
        assert meta['runner'] == 'local-model' and meta['run'] == status['runs'][0]['id'] and meta['batch'] == 1
        assert meta['preset'] == 'ollama' and meta['provider'] == 'Ollama' and meta['host'] == '127.0.0.1' and meta['loopback'] is True
        assert meta['api_key'] is True and 'base_url' not in meta and fake.url not in files['meta.json']
        assert meta['model'] == 'llama3.2:3b' and meta['prompts'] == {'keyterms': 'keyterms-v1', 'standfirst': 'standfirst-v1'}
        assert meta['counts'] == {'done': 2} and [i['state'] for i in meta['items']] == ['done', 'done']
        assert {i['path'] for i in meta['items']} == {'library/note-0.md', 'library/note-1.md'}
        assert set(meta['files']) == set(files) - {'meta.json'}

        template = json.loads(files['request-template.json'])
        assert template['method'] == 'POST' and template['path'] == '/chat/completions'
        assert template['body']['model'] == 'llama3.2:3b' and template['body']['stream'] is True and 'messages' not in template['body']
        first = json.loads(files['item-01-request.json'])
        assert first['task'] in ('standfirst', 'keyterms') and first['prompt_version'].endswith('-v1')
        assert first['messages'][0]['role'] == 'system' and 'Careful readers' in first['messages'][1]['content']
        answer = json.loads(files['item-01-response.json'])
        assert answer['state'] == 'done' and answer['text'] and answer['output'] and answer['finish_reason'] == 'stop'

        # The run's log is linked from its items and committed on its own, with a Reader-Log trailer.
        assert all(i['log'] == relative for i in status['recent'])
        assert status['runs'][0]['commit']['status'] == 'committed'
        body = git(vault, 'log', '-1', '--format=%B')
        assert f'Reader-Log: local-model/{folder.name}' in body
        assert set(git(vault, 'show', '--name-only', '--format=', 'HEAD').split()) == {f'{relative}/{p.name}' for p in folder.iterdir()}
        assert git(vault, 'status', '--porcelain', '--', 'logs/') == ''

        # A failing item: the server echoes the Authorization header in its error, and Reader scrubs it.
        fake.options['api_key'] = 'another-key-entirely'
        model.dispatch({'action': 'enqueue', 'task': 'standfirst', 'scope': 'path', 'path': 'library/note-2.md'})
        model.dispatch({'action': 'run', 'task': 'standfirst'})
        assert idle(model)['recent'][0]['state'] == 'failed'
        [other] = [r for r in runs(vault) if r != folder]
        failed = unpacked(other)
        assert json.loads(failed['item-01-response.json'])['state'] == 'failed'
        assert '<redacted>' in failed['item-01-response.json']

    # The sentinel key appears in no archived file and in no commit.
    for run in runs(vault):
        for name, text in unpacked(run).items():
            assert SENTINEL not in text, name
            assert 'authorization' not in text.lower(), name
    history = git(vault, 'log', '-p', '--all')
    assert SENTINEL not in history and 'logs/llm/local-model/' in history


def test_low_disk_refuses_to_start_and_writes_no_log(vault):
    with FakeServer('ollama') as fake:
        model = make(vault, capacity=lambda _: False)
        model.dispatch({'action': 'settings', 'settings': {'provider': {'preset': 'ollama', 'base_url': fake.url, 'model': 'llama3.2:3b'}}})
        model.dispatch({'action': 'enqueue', 'task': 'standfirst', 'scope': 'path', 'path': 'library/note-0.md'})
        with pytest.raises(ValueError, match='refuses to start LLM runs'):
            model.dispatch({'action': 'run', 'task': 'standfirst'})
        assert not [r for r in fake.requests if r['path'] == '/v1/chat/completions']
    assert runs(vault) == [] and model.waiting()  # the item still waits


def test_low_disk_mid_run_stops_before_the_next_batch(vault):
    with FakeServer('ollama') as fake:
        free = iter([True, True, False])  # start, first batch, second batch
        model = make(vault, capacity=lambda _: next(free, False))
        model.dispatch({'action': 'settings', 'settings': {'provider': {'preset': 'ollama', 'base_url': fake.url, 'model': 'llama3.2:3b'}}})
        model.dispatch({'action': 'enqueue', 'task': 'standfirst', 'scope': 'all'})
        model.dispatch({'action': 'enqueue', 'task': 'keyterms', 'scope': 'path', 'path': 'library/note-0.md'})
        lm_batch, lm.BATCH = lm.BATCH, 3
        try:
            model.dispatch({'action': 'run'})
            status = idle(model)
        finally:
            lm.BATCH = lm_batch
        assert status['runs'][0]['state'] == 'failed' and 'refuses to start LLM runs' in status['runs'][0]['error']
        assert len(runs(vault)) == 1 and model.waiting('keyterms')


def test_a_remote_provider_logs_its_host_only(vault):
    with FakeServer('ollama') as fake:
        model = make(vault, connect=loopback_connect(fake.port))
        model.dispatch({'action': 'settings', 'settings': {'provider': {'preset': 'custom', 'base_url': 'http://192.0.2.10:8000/private/v1',
                                                                        'model': 'llama3.2:3b', 'allow_remote': True}}})
        model.dispatch({'action': 'enqueue', 'task': 'standfirst', 'scope': 'path', 'path': 'library/note-0.md'})
        model.dispatch({'action': 'run', 'task': 'standfirst'})
        idle(model)
    [folder] = runs(vault)
    files = unpacked(folder)
    meta = json.loads(files['meta.json'])
    assert meta['host'] == '192.0.2.10' and meta['loopback'] is False and meta['preset'] == 'custom' and meta['api_key'] is False
    assert all('/private' not in text and '8000' not in text for text in files.values())


def test_an_interrupted_run_is_sealed_on_restart(vault):
    with FakeServer('ollama') as fake:
        model = make(vault)
        model.dispatch({'action': 'settings', 'settings': {'provider': {'preset': 'ollama', 'base_url': fake.url, 'model': 'llama3.2:3b'}}})
        model.dispatch({'action': 'enqueue', 'task': 'standfirst', 'scope': 'path', 'path': 'library/note-0.md'})
    # Simulate a crash mid-item: a running log and a running journal entry.
    item = next(iter(model.items.values()))
    log = llm_logs.RunLog(vault, 'local-model', 'crashed-run-b001', {'runner': 'local-model'})
    log.write('item-01-request.json', '{}')
    item.update(state='running', log=log.relative)
    model.record(item)
    again = make(vault)
    again.load()
    meta = json.loads((vault / log.relative / 'meta.json').read_text())
    assert meta['status'] == 'interrupted' and 'item-01-request.json' in meta['files']
    assert again.items[item['id']]['state'] == 'queued'
