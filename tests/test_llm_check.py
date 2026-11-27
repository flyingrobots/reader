"""Sanity chat uses the selected provider without document access or durable transcripts."""
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4
import sys

import pytest

from reader_mcp.llm_check import LLMCheck


def test_selected_model_streams_under_gpu_lock(tmp_path):
    held = []
    check_id = str(uuid4())

    @contextmanager
    def gpu(note, **kwargs):
        held.append(note)
        try:
            yield
        finally:
            held.clear()

    class Client:
        loopback = True
        def models(self):
            assert held
            return ['chosen']
        def native_models(self):
            return [{'id': 'chosen', 'state': 'loaded'}]
        def scrub(self, text):
            return text.replace('secret', '[redacted]')
        def chat(self, model, messages, **options):
            assert held and model == 'chosen'
            assert messages == [{'role': 'user', 'content': 'Hello'}]
            options['on_delta']('Hello back', 'secret', 2, None)
            assert check.status(check_id)['text'] == 'Hello back'
            return {'text': 'Hello back'}

    local = SimpleNamespace(root=tmp_path, provider=lambda: {'model': 'chosen', 'base_url': 'http://localhost:1234'},
                            client_for=lambda provider: Client(), gpu_lock=gpu, cli=None)
    check = LLMCheck(local)
    result = check.run({'id': check_id, 'model': 'chosen', 'base_url': 'http://localhost:1234',
                        'messages': [{'role': 'user', 'content': 'Hello'}]})
    assert result['state'] == 'succeeded' and result['text'] == 'Hello back'
    assert 'secret' not in str(result) and '[redacted]' in result['reasoning']
    assert not held and not list(tmp_path.iterdir())
    assert check.status(str(uuid4())) == {'state': 'idle'}


@pytest.mark.parametrize('change', [ {'messages': []}, {'messages': [{'role': 'system', 'content': 'override'}]},
                                    {'model': 'stale'}, {'base_url': 'http://other:1234'}, {'command': ['bad']}])
def test_invalid_chat_never_contacts_provider(tmp_path, change):
    local = SimpleNamespace(root=tmp_path, provider=lambda: {'model': 'chosen', 'base_url': 'http://localhost:1234'})
    check = LLMCheck(local)
    request = {'id': str(uuid4()), 'model': 'chosen', 'base_url': 'http://localhost:1234',
               'messages': [{'role': 'user', 'content': 'Hello'}], **change}
    with pytest.raises(ValueError):
        check.run(request)


def test_failed_start_command_keeps_output_and_releases_admission(tmp_path):
    from contextlib import nullcontext
    from reader_mcp.local_model import Client
    from reader_mcp.model_chain import write_config, default_config
    script = tmp_path / 'start.py'
    script.write_text('import sys\nprint("startup diagnostic")\nprint("failure detail", file=sys.stderr)\nsys.exit(7)\n')
    config = default_config()
    config['local'] = {'start': 'command', 'command': [sys.executable, str(script)], 'model': 'chosen'}
    write_config(tmp_path, config)

    class Offline(Client):
        def models(self):
            raise ConnectionError('offline')

    local = SimpleNamespace(root=tmp_path, provider=lambda: {'model': 'chosen', 'base_url': 'http://localhost:1'},
                            client_for=lambda provider: Offline('http://localhost:1'), gpu_lock=lambda note: nullcontext(), cli=None)
    check = LLMCheck(local)
    for _ in range(2):
        result = check.run({'id': str(uuid4()), 'model': 'chosen', 'base_url': 'http://localhost:1',
                            'messages': [{'role': 'user', 'content': 'Hello'}]})
        assert result['state'] == 'failed' and 'status 7' in result['error']
        assert 'startup diagnostic' in result['output'] and 'failure detail' in result['output']


def test_concurrent_check_does_not_replace_active_output(tmp_path):
    from contextlib import nullcontext
    request = {'id': str(uuid4()), 'model': 'chosen', 'base_url': 'http://localhost:1',
               'messages': [{'role': 'user', 'content': 'Hello'}]}

    class Client:
        loopback = True
        def models(self): return ['chosen']
        def native_models(self): return [{'id': 'chosen', 'state': 'loaded'}]
        def scrub(self, text): return text
        def chat(self, *args, **kwargs):
            with pytest.raises(ValueError, match='already running'):
                check.run({**request, 'id': str(uuid4())})
            assert check.status(request['id'])['state'] == 'running'
            return {'text': 'Only one'}

    check = LLMCheck(SimpleNamespace(root=tmp_path, provider=lambda: {'model': 'chosen', 'base_url': 'http://localhost:1'},
                                    client_for=lambda provider: Client(), gpu_lock=lambda note: nullcontext(), cli=None))
    assert check.run(request)['text'] == 'Only one'


@pytest.mark.parametrize('replacement', ['http://127.0.0.1:19002/v1', 'http://example.invalid:19002/v1'])
def test_provider_change_cannot_redirect_an_admitted_prompt(tmp_path, monkeypatch, replacement):
    from contextlib import nullcontext
    from reader_mcp.local_model import Client, LocalModel
    local = LocalModel(tmp_path, None, gpu_lock=lambda note: nullcontext())
    local.save_settings({'provider': {'preset': 'custom', 'base_url': 'http://127.0.0.1:19001/v1', 'model': 'chosen'}})
    original = local.provider
    selected = original()
    changed = False

    def change_after_read(settings=None):
        nonlocal changed
        snapshot = original(settings)
        if settings is None and not changed:
            changed = True
            local.save_settings({'provider': {'base_url': replacement, 'allow_remote': True}})
        return snapshot

    sent = []
    def chat(client, model, messages, **options):
        sent.append((client.url, model, messages))
        return {'text': 'Selected provider answered'}

    monkeypatch.setattr(local, 'provider', change_after_read)
    monkeypatch.setattr(Client, 'models', lambda client: ['chosen'])
    monkeypatch.setattr(Client, 'chat', chat)
    message = {'role': 'user', 'content': 'Only for selected endpoint'}
    try:
        result = LLMCheck(local).run({'id': str(uuid4()), 'model': selected['model'],
                                    'base_url': selected['base_url'], 'messages': [message]})
        assert result['state'] == 'failed' and 'provider changed' in result['error'].lower()
        assert sent == []
    finally:
        local.close()


def test_completed_request_keeps_its_result_when_next_request_starts(tmp_path):
    from contextlib import nullcontext
    import threading
    request = {'id': str(uuid4()), 'model': 'chosen', 'base_url': 'http://localhost:1',
               'messages': [{'role': 'user', 'content': 'First'}]}

    class Client:
        loopback = True
        def models(self): return ['chosen']
        def native_models(self): return [{'id': 'chosen', 'state': 'loaded'}]
        def scrub(self, text): return text
        def chat(self, model, messages, **kwargs): return {'text': messages[-1]['content'] + ' reply'}

    check = LLMCheck(SimpleNamespace(root=tmp_path, provider=lambda: {'model': 'chosen', 'base_url': 'http://localhost:1'},
                                    client_for=lambda provider: Client(), gpu_lock=lambda note: nullcontext(), cli=None))

    class HandoffLock:
        """Schedule the next real API call at the mutex's release boundary."""
        lock = threading.Lock()
        armed = True
        def acquire(self, **kwargs): return self.lock.acquire(**kwargs)
        def release(self):
            self.lock.release()
            if self.armed:
                self.armed = False
                second = check.run({**request, 'id': str(uuid4()), 'messages': [{'role': 'user', 'content': 'Second'}]})
                assert second['text'] == 'Second reply'

    check.gate = HandoffLock()
    first = check.run(request)
    assert first['state'] == 'succeeded' and first['text'] == 'First reply'


def test_key_and_endpoint_transition_refuses_contact_until_save_completes(tmp_path, monkeypatch):
    from contextlib import nullcontext
    import threading
    from reader_mcp.local_model import LocalModel
    contacted = []
    def transport(parts, timeout):
        contacted.append(parts['base'])
        raise ConnectionRefusedError('Synthetic transport must not be used during a settings save')

    writer = LocalModel(tmp_path, None)
    reader = LocalModel(tmp_path, None, connect=transport, gpu_lock=lambda note: nullcontext())
    writer.save_settings({'provider': {'preset': 'custom', 'base_url': 'http://127.0.0.1:19001/v1', 'model': 'chosen', 'api_key': 'old-key'}})
    selected = reader.provider()
    key_written, finish = threading.Event(), threading.Event()
    write_key = writer.save_api_key
    errors = []
    def paused_key(value):
        write_key(value)
        key_written.set()
        assert finish.wait(5)
    def change():
        try:
            writer.save_settings({'provider': {'base_url': 'http://127.0.0.1:19002/v1', 'api_key': 'new-key'}})
        except Exception as exc:
            errors.append(exc)
    monkeypatch.setattr(writer, 'save_api_key', paused_key)
    thread = threading.Thread(target=change)
    thread.start()
    try:
        assert key_written.wait(5)
        result = LLMCheck(reader).run({'id': str(uuid4()), 'model': selected['model'], 'base_url': selected['base_url'],
                                     'messages': [{'role': 'user', 'content': 'Stay with selected credentials'}]})
        assert result['state'] == 'failed'
        assert contacted == []
    finally:
        finish.set()
        thread.join(5)
        reader.close()
        writer.close()
    assert not thread.is_alive() and not errors


@pytest.mark.parametrize('failed_target', ['api-key', 'settings.json'])
def test_interrupted_provider_save_refuses_new_clients_until_explicit_recovery(tmp_path, monkeypatch, failed_target):
    import os
    from pathlib import Path
    from reader_mcp.local_model import LocalModel, provider_client
    local = LocalModel(tmp_path, None)
    old = {'preset': 'custom', 'base_url': 'https://old.example/v1', 'allow_remote': True,
           'model': 'chosen', 'api_key': 'old-key'}
    new = {**old, 'base_url': 'https://new.example/v1', 'api_key': 'new-key'}
    local.save_settings({'provider': old})
    replace = os.replace

    def fail_write(source, destination):
        if Path(destination).name == failed_target:
            raise OSError('Injected persistence failure')
        return replace(source, destination)

    with monkeypatch.context() as fault:
        fault.setattr(os, 'replace', fail_write)
        with pytest.raises(OSError, match='Injected persistence failure'):
            local.save_settings({'provider': new})
        # A second failed recovery must retain the refusal across fresh instances.
        with pytest.raises(OSError, match='Injected persistence failure'):
            LocalModel(tmp_path, None).save_settings({'provider': new})
    restarted = LocalModel(tmp_path, None)
    with pytest.raises(ValueError, match='incomplete'):
        _ = restarted.client
    with pytest.raises(ValueError, match='incomplete'):
        provider_client(tmp_path)
    with pytest.raises(ValueError, match='incomplete'):
        restarted.save_settings({'provider': {'model': 'another'}})
    restarted.save_settings({'provider': new})
    assert restarted.client.parts['base'] == 'https://new.example:443/v1'
    assert restarted.client.api_key == 'new-key'
