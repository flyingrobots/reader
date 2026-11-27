"""Bounded, ephemeral chat with the saved provider; never grants the model tools."""
from contextlib import nullcontext
from copy import deepcopy
import threading
import subprocess
from uuid import UUID

from .model_chain import Chain, ModelFailure, read_config


class LLMCheck:
    """One active request per server. Polling requires the caller's unguessable request id."""

    def __init__(self, local):
        self.local = local
        self.gate = threading.Lock()
        self.lock = threading.Lock()
        self.current = {}

    def status(self, ident):
        with self.lock:
            return deepcopy(self.current) if self.current.get('id') == ident else {'state': 'idle'}

    def update(self, **fields):
        with self.lock:
            self.current.update(fields)

    def run(self, request):
        if set(request) != {'id', 'model', 'base_url', 'messages'}:
            raise ValueError('Expected id, model, base_url and messages')
        try:
            ident = str(UUID(request['id']))
        except (ValueError, TypeError, AttributeError):
            raise ValueError('Expected a chat request UUID') from None
        provider = self.local.provider()
        if request['model'] != provider['model'] or request['base_url'] != provider['base_url']:
            raise ValueError('The selected provider changed. Refresh Models and start a new chat.')
        messages = request['messages']
        if not isinstance(messages, list) or not 1 <= len(messages) <= 15 or len(messages) % 2 != 1:
            raise ValueError('Send at most seven exchanges followed by a user message')
        for index, message in enumerate(messages):
            if (not isinstance(message, dict) or set(message) != {'role', 'content'}
                    or message['role'] != ('user' if index % 2 == 0 else 'assistant')
                    or not isinstance(message['content'], str) or not message['content'].strip()):
                raise ValueError('Expected alternating user and assistant messages with nonempty text')
        if sum(len(m['content']) for m in messages) > 24000:
            raise ValueError('Chat is limited to 24,000 characters; start a new chat')
        if not self.gate.acquire(blocking=False):
            raise ValueError('A sanity check is already running')
        client = None
        self.update(id=ident, state='running', text='', reasoning='', output='', error=None)
        try:
            client = self.local.client

            def report(record):
                with self.lock:
                    self.current['output'] = (self.current['output'] + client.scrub(record['message']) + '\n')[-24000:]

            def delta(text, reasoning, tokens, speed):
                self.update(text=client.scrub(text)[-24000:], reasoning=client.scrub(reasoning)[-24000:])

            chain = Chain(self.local.root, self.local.root / '.reader/llm-check', ident, client=client,
                          cli=self.local.cli, reporter=report)
            local = {**read_config(self.local.root)['local'], 'model': provider['model']}
            # Remote endpoints are contacted only; startup commands act on this workstation.
            if not client.loopback:
                local['start'] = 'off'
            with self.local.gpu_lock('Reader LLM Sanity Check') if client.loopback else nullcontext():
                chain.start_local(client, local)
                report({'message': 'Asking ' + provider['model'] + '…'})
                answer = client.chat(provider['model'], messages, on_delta=delta, timeout=90, max_output=2048, reasoning=1024)
                self.update(state='succeeded', text=client.scrub(answer['text'])[-24000:])
        except (OSError, ValueError, RuntimeError, ModelFailure, subprocess.TimeoutExpired) as exc:
            scrub = client.scrub if client else str
            self.update(id=ident, state='failed', error=scrub(str(exc))[-2000:])
        finally:
            self.gate.release()
        return self.status(ident)


def main(argv=None):
    """A tool-free voice command, using the same selected provider and startup path as the panel."""
    import argparse
    from pathlib import Path
    import sys
    from uuid import uuid4
    from .local_model import LocalModel

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args(argv)
    prompt = sys.stdin.read(24001)
    local = LocalModel(args.root, None)
    try:
        provider = local.provider()
        result = LLMCheck(local).run({'id': str(uuid4()), 'model': provider['model'], 'base_url': provider['base_url'],
                                      'messages': [{'role': 'user', 'content': prompt}]})
        print(result.get('output', ''), file=sys.stderr)
        if result['state'] != 'succeeded':
            print(result['error'], file=sys.stderr)
            return 1
        print(result['text'])
        return 0
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        local.close()


if __name__ == '__main__':
    raise SystemExit(main())
