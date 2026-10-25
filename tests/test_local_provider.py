"""Any OpenAI-compatible provider: URL rules, presets, API key handling, and fake Ollama / llama.cpp servers.

No test calls a real model or leaves loopback: "remote" URLs are routed to a loopback fake."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from fake_openai_servers import FakeServer, guarded_connect, loopback_connect  # noqa: E402

from reader_mcp import local_model as lm  # noqa: E402
from reader_mcp.web import WebLibrary  # noqa: E402


class FakeLock:
    def __init__(self):
        self.entries = []

    @contextmanager
    def __call__(self, note, cancelled=lambda: False):
        self.entries.append(note)
        yield {'job': 'fake'}


class NoCLI(lm.CLI):
    """An lms that must never run for a provider other than LM Studio."""
    calls = []

    @property
    def path(self):
        return '/nonexistent/lms'

    def run(self, *args, timeout=lm.CLI_TIMEOUT):
        self.calls.append(args)
        raise AssertionError('lms ran for a non-LM Studio provider')


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.delenv(lm.API_KEY_ENV, raising=False)
    monkeypatch.delenv('READER_LMSTUDIO_URL', raising=False)
    root = tmp_path / 'vault'
    for name in ('library', 'inbox', 'indexes'):
        (root / name).mkdir(parents=True)
    works = []
    for i in range(3):
        path = f'library/note-{i}.md'
        body = f'---\ntitle: Note {i}\n---\n\n# Note {i}\n\nCareful readers keep a quiet library of observations about Margins and Ledgers.\n'
        (root / path).write_text(body)
        works.append(dict(id=path, title=f'Note {i}', primary=path, authors=['Ada'], topics=[], projects=[], date=f'2026-10-0{i + 1}',
                          primary_format='.md', primary_bytes=len(body)))
    (root / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-31', 'works': works}))
    return root


def make(root, connect=None):
    lock = FakeLock()
    NoCLI.calls = []
    library = WebLibrary(root, local_model={'cli': NoCLI(), 'gpu_lock': lock, 'data_usage': lambda: 0, 'connect': connect or guarded_connect})
    return library.local_model, lock


def idle(model, timeout=20):
    deadline = time.monotonic() + timeout
    while model.worker and model.worker.is_alive():
        if time.monotonic() > deadline:
            raise AssertionError('worker still running')
        time.sleep(.05)
    return model.status()


def use(lmodel, preset, url, **extra):
    return lmodel.dispatch({"action": "settings", "settings": {"provider": {"preset": preset, "base_url": url, **extra}}})["settings"]


def run_one(model, path='library/note-0.md', task='standfirst'):
    model.dispatch({'action': 'enqueue', 'task': task, 'scope': 'path', 'path': path})
    model.dispatch({'action': 'run', 'task': task})
    return idle(model)


def test_provider_url_rules():
    assert lm.provider_url('http://127.0.0.1:1234')['base'] == 'http://127.0.0.1:1234/v1'
    assert lm.provider_url('http://localhost:11434/v1/')['base'] == 'http://localhost:11434/v1'
    assert lm.provider_url('http://[::1]:8080/v1')['base'] == 'http://[::1]:8080/v1'
    assert lm.provider_url('http://127.0.0.2:8000/openai/v1')['path'] == '/openai/v1'
    assert lm.provider_url('https://127.0.0.1')['port'] == 443
    for remote in ('http://192.168.1.4:11434/v1', 'http://example.com/v1', 'https://api.example.org/v1', 'http://0.0.0.0:8080'):
        with pytest.raises(ValueError, match='not a loopback address'):
            lm.provider_url(remote)
        assert not lm.provider_url(remote, allow_remote=True)['loopback']
    for bad in ('ftp://127.0.0.1/v1', 'http://user:pw@127.0.0.1:1/v1', 'http://127.0.0.1:1/v1?x=1', 'http://127.0.0.1:1/v1#f',
                'http://127.0.0.1:1/../v1', '127.0.0.1:1234', 'http://127.0.0.1:99999/v1', None, 'http://'):
        with pytest.raises(ValueError):
            lm.provider_url(bad, allow_remote=True)


def test_presets_and_defaults(vault):
    model, _ = make(vault)
    view = model.status()['provider']
    NoCLI.calls = []  # LM Studio, the default, lists models through lms; nothing below may
    assert view['preset'] == 'lmstudio' and view['base_url'] == 'http://127.0.0.1:1234/v1' and view['model'] == lm.DEFAULT_MODEL
    assert view['remote_notice'] is None and view['api_key'] == {'set': False, 'source': None, 'env': 'READER_LLM_API_KEY'}
    assert view['presets']['ollama']['base_url'] == 'http://127.0.0.1:11434/v1'
    assert view['presets']['llamacpp']['base_url'] == 'http://127.0.0.1:8080/v1'
    # A new preset starts from its own default URL; LM Studio keeps the lms extras, others do not.
    saved = model.dispatch({'action': 'settings', 'settings': {'provider': {'preset': 'ollama'}}})['settings']
    assert saved['provider']['base_url'] is None and model.url == 'http://127.0.0.1:11434/v1'
    status = model.status()
    assert status['server']['lms'] is False and status['server']['cli'] is None and status['provider']['start'] == 'ollama serve'
    assert status['server']['state'] in ('off', 'ready', 'error')
    with pytest.raises(ValueError, match='start Ollama yourself'):
        model.dispatch({'action': 'server-start'})
    with pytest.raises(ValueError, match='base URL'):
        model.dispatch({'action': 'settings', 'settings': {'provider': {'preset': 'custom'}}})
    assert NoCLI.calls == []


def test_ollama_discovery_streaming_run_and_no_lms(vault):
    with FakeServer('ollama', thinking=True) as fake:
        model, lock = make(vault)
        use(model, 'ollama', fake.url, model='llama3.2:3b')
        server = model.status()['server']
        assert server['state'] == 'ready' and server['label'] == 'Ready · 2 models'
        assert [(m['key'], m['type']) for m in server['available']] == [('llama3.2:3b', 'llm'), ('nomic-embed-text:latest', 'embedding')]
        status = run_one(model)
        item = status['recent'][0]
        assert item['state'] == 'done', item
        assert item['model'] == 'llama3.2:3b' and item['output'].startswith('Careful readers')
        assert 'Reading' not in item['output']  # Ollama's `reasoning` deltas are never the answer
        chats = [r for r in fake.requests if r['path'] == '/v1/chat/completions']
        assert chats and chats[0]['model'] == 'llama3.2:3b' and chats[0]['stream'] is True
        assert lock.entries, 'a loopback provider still holds the workstation GPU lock'
        assert NoCLI.calls == []
        # A model the server does not have: Ollama's 404 message reaches the item.
        model.dispatch({'action': 'settings', 'settings': {'tasks': {'standfirst': {'model': 'missing:1b'}}}})
        item = run_one(model, 'library/note-1.md')['recent'][0]
        assert item['state'] == 'failed' and 'not found, try pulling it first' in item['error'] and '404' in item['error']


def test_llamacpp_shapes_timings_plain_json_and_embeddings(vault):
    with FakeServer('llamacpp', thinking=True) as fake:
        model, _ = make(vault)
        use(model, 'llamacpp', fake.url, model='models/tiny-q4_k_m.gguf')
        server = model.status()['server']
        assert [m['key'] for m in server['available']] == ['models/tiny-q4_k_m.gguf'] and server['label'] == 'Ready · 1 model'
        item = run_one(model)['recent'][0]
        assert item['state'] == 'done' and item['tokens_per_second'] == 55.5  # from llama.cpp's timings
        # Embeddings are a 404 until llama-server runs with --embeddings.
        client = model.client
        with pytest.raises(ValueError, match='--embeddings'):
            client.embeddings('models/tiny-q4_k_m.gguf', ['one'])
        fake.options['embeddings'] = True
        vectors = client.embeddings('models/tiny-q4_k_m.gguf', ['one', 'two'])  # rows without `index` keep input order
        assert len(vectors) == 2 and vectors[0] != vectors[1]
        # A server that ignores `stream` and answers plain JSON without finish_reason.
        fake.options['stream'] = False
        result = client.chat('m', [{'role': 'system', 'content': 's'}, {'role': 'user', 'content': '<document>Careful words here.</document>'}])
        assert result['text'] == 'Careful words here.' and result['finish_reason'] == 'stop' and result['reasoning'] == 'Reading the document.'
        assert result['tokens'] == 3


def test_missing_fields_error_events_and_cut_streams(vault):
    assert lm.Client.model_rows({'data': [{'object': 'model'}, {'id': 'a'}, 'b', 7, {'id': 'a'}]}) == ['a', 'b']
    assert lm.Client.model_rows({'models': [{'name': 'x.gguf'}]}) == ['x.gguf']
    assert lm.Client.model_rows([]) == [] and lm.Client.model_rows({'data': None}) == []
    with FakeServer('ollama', error_event=True) as fake:
        model, _ = make(vault)
        use(model, 'ollama', fake.url, model='llama3.2:3b')
        item = run_one(model)['recent'][0]
        assert item['state'] == 'failed' and 'synthetic backend failure' in item['error']
        fake.options.update(error_event=False, cut=True)
        status = run_one(model, 'library/note-1.md')
        assert status['recent'][0]['state'] == 'failed' and status['recent'][0]['error'] == 'The Ollama server stopped while this item ran'
        assert status['runs'][0]['warning'] == 'server-stopped'


def test_api_key_is_stored_privately_sent_and_never_shown(vault, monkeypatch):
    secret = 'sk-test-' + 'x' * 24
    with FakeServer('ollama', api_key=secret, echo_auth=True) as fake:
        model, _ = make(vault)
        use(model, 'ollama', fake.url, model='llama3.2:3b')
        server = model.status()['server']
        assert server['state'] == 'error' and '401 (check the API key)' in server['error']
        use(model, 'ollama', fake.url, api_key=secret)
        key_file = vault / '.reader/local-model/api-key'
        assert stat.S_IMODE(key_file.stat().st_mode) == 0o600 and key_file.read_text().strip() == secret
        status = model.status()
        assert status['server']['state'] == 'ready' and status['provider']['api_key'] == {'set': True, 'source': 'file', 'env': 'READER_LLM_API_KEY'}
        everything = json.dumps(status) + (vault / '.reader/local-model/settings.json').read_text()
        assert secret not in everything and 'api_key": "sk' not in everything
        assert run_one(model)['recent'][0]['state'] == 'done'
        assert all(r['auth'] for r in fake.requests[-3:])
        # The server's error echoes the header; Reader scrubs the key from every message it keeps.
        fake.options['api_key'] = 'other'
        client = model.client
        with pytest.raises(ValueError) as caught:
            client.models()
        assert secret not in str(caught.value) and '<redacted>' in str(caught.value)
        # The environment wins over the file; clearing removes the file.
        monkeypatch.setenv(lm.API_KEY_ENV, 'other')
        assert model.status()['provider']['api_key']['source'] == 'environment' and model.status()['server']['state'] == 'ready'
        use(model, 'ollama', fake.url, api_key=None)
        assert not key_file.exists()
        with pytest.raises(ValueError, match='printable'):
            use(model, 'ollama', fake.url, api_key='has space')


def test_api_key_refused_when_git_would_commit_it(vault):
    subprocess.run(['git', 'init', '-q', str(vault)], check=True)
    model, _ = make(vault)
    with pytest.raises(ValueError, match='does not ignore .reader/'):
        use(model, 'ollama', None, api_key='sk-' + 'y' * 20)
    assert not (vault / '.reader/local-model/api-key').exists()
    (vault / '.gitignore').write_text('.reader/\n')
    use(model, 'ollama', None, api_key='sk-' + 'y' * 20)
    assert (vault / '.reader/local-model/api-key').is_file()
    tracked = subprocess.run(['git', '-C', str(vault), 'status', '--porcelain', '--untracked-files=all'], capture_output=True, text=True).stdout
    assert 'api-key' not in tracked


def test_remote_needs_explicit_opt_in_shows_notice_and_skips_gpu_lock(vault):
    with FakeServer('ollama') as fake:
        model, lock = make(vault, connect=loopback_connect(fake.port))  # "remote" traffic still lands on loopback
        with pytest.raises(ValueError, match='not a loopback address'):
            use(model, 'custom', 'http://192.0.2.10:8000/v1', model='llama3.2:3b')
        assert model.status()['provider']['preset'] == 'lmstudio', 'a refused save changes nothing'
        use(model, 'custom', 'http://192.0.2.10:8000/v1', model='llama3.2:3b', allow_remote=True)
        view = model.status()['provider']
        assert view['loopback'] is False and view['host'] == '192.0.2.10'
        assert view['remote_notice'] == 'Document text and prompts are sent to 192.0.2.10. They leave this machine, unencrypted over http.'
        assert run_one(model)['recent'][0]['state'] == 'done'
        assert lock.entries == [], 'a remote provider uses no local GPU'
        # Turning the opt-in off again refuses the remote URL instead of silently keeping it.
        with pytest.raises(ValueError, match='not a loopback address'):
            use(model, 'custom', 'http://192.0.2.10:8000/v1', allow_remote=False)
    # A hand-edited settings file naming a remote URL without the opt-in is refused at use.
    settings = json.loads((vault / '.reader/local-model/settings.json').read_text())
    settings['provider']['allow_remote'] = False
    (vault / '.reader/local-model/settings.json').write_text(json.dumps(settings))
    server = model.status()['server']
    assert server['state'] == 'error' and server['label'] == 'Refused' and 'not a loopback address' in server['error']


def test_startup_default_stays_loopback_only(vault, monkeypatch):
    monkeypatch.setenv('READER_LMSTUDIO_URL', 'http://10.0.0.2:1234')
    with pytest.raises(ValueError, match='loopback'):
        WebLibrary(vault)


def test_openai_embedding_backend_through_ollama(vault):
    with FakeServer('ollama') as fake:
        model, _ = make(vault)
        use(model, 'ollama', fake.url, model='llama3.2:3b')
        model.dispatch({'action': 'settings', 'settings': {'embedding_backend': 'openai:nomic-embed-text:latest'}})
        from reader_mcp.search import Search
        search = Search(vault)
        result = search.index(semantic=True)
        assert result['semantic'] and result['documents'] >= 3
        found = search.search('quiet library', mode='semantic', limit=2)
        assert found['model'] == 'openai:nomic-embed-text:latest' and found['results']
        assert any(r['path'] == '/v1/embeddings' and r['model'] == 'nomic-embed-text:latest' for r in fake.requests)
        # The signature names the server, unlike the older lmstudio: spelling.
        assert lm.embedding_signature(vault, 'openai:m') != lm.embedding_signature(vault, 'lmstudio:m')
        before = lm.embedding_signature(vault, 'openai:m')
        use(model, 'ollama', 'http://127.0.0.1:11435/v1')
        assert lm.embedding_signature(vault, 'openai:m') != before


def test_task_model_defaults_to_provider_model(vault):
    model, _ = make(vault)
    model.dispatch({'action': 'settings', 'settings': {'provider': {'model': 'llama3.2:3b'}}})
    model.dispatch({'action': 'enqueue', 'task': 'keyterms', 'scope': 'path', 'path': 'library/note-0.md'})
    assert next(iter(model.items.values()))['model'] == 'llama3.2:3b'
    model.dispatch({'action': 'settings', 'settings': {'provider': {'model': ''}}})
    with pytest.raises(ValueError, match='Choose a model'):
        model.dispatch({'action': 'enqueue', 'task': 'standfirst', 'scope': 'path', 'path': 'library/note-1.md'})
    with pytest.raises(ValueError):
        model.dispatch({'action': 'settings', 'settings': {'provider': {'model': 'bad model; rm'}}})
    with pytest.raises(ValueError):
        model.dispatch({'action': 'settings', 'settings': {'provider': {'unknown': 1}}})
