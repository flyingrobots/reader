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
                            client=Client(), gpu_lock=gpu, cli=None)
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
                            client=Offline('http://localhost:1'), gpu_lock=lambda note: nullcontext(), cli=None)
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
                                    client=Client(), gpu_lock=lambda note: nullcontext(), cli=None))
    assert check.run(request)['text'] == 'Only one'
