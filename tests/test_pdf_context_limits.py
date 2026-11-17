"""Medium: real child processes witness PDF supervision and admission limits."""

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from reader_mcp import pdf_context


@pytest.mark.parametrize('mode,reason', [
    ('hang', 'wall-time'), ('eof-hang', 'wall-time'), ('flood', 'output limit'),
    ('unreadable-rss', 'could not be measured'), ('large-rss', 'sampled memory'),
])
def test_failed_child_is_killed_and_reaped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                         mode: str, reason: str) -> None:
    children = []
    real_popen = subprocess.Popen

    def observed_popen(*args: object, **kwargs: object) -> subprocess.Popen:
        child = real_popen(*args, **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(pdf_context.subprocess, 'Popen', observed_popen)
    if mode == 'unreadable-rss':
        def unavailable(_pid: int) -> int:
            raise OSError('Synthetic unavailable telemetry')
        monkeypatch.setattr(pdf_context, 'resident_bytes', unavailable)
    elif mode == 'large-rss':
        monkeypatch.setattr(pdf_context, 'resident_bytes', lambda _pid: 512 * 1024**2 + 1)
    code = 'import time; time.sleep(60)'
    if mode == 'eof-hang':
        code = 'import os, time; os.close(1); time.sleep(60)'
    elif mode == 'flood':
        code = 'import os\nwhile True: os.write(1, b"x" * 8192)'
    try:
        with open(os.devnull, 'rb') as source, pytest.raises(pdf_context.ExtractionRefused, match=reason):
            pdf_context.capture([sys.executable, '-c', code], descriptor=source.fileno(), timeout_seconds=1)
        assert len(children) == 1
        assert children[0].returncode is not None, 'Refusal must reap the child before returning'
        assert children[0].stdout.closed
    finally:
        # Retain ownership even when a deliberate cleanup fault makes an assertion fail.
        for child in children:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=2)


def test_child_cpu_limit_is_enforced() -> None:
    code = ('import resource\n'
            'from reader_mcp.pdf_worker import lower_limit\n'
            'lower_limit(resource.RLIMIT_CPU, 1)\n'
            'while True: pass')
    with open(os.devnull, 'rb') as source, pytest.raises(pdf_context.ExtractionRefused, match='CPU/memory'):
        pdf_context.capture([sys.executable, '-c', code], descriptor=source.fileno(), timeout_seconds=4)


def test_child_preserves_stricter_inherited_limits() -> None:
    code = ('import json, resource\n'
            'from reader_mcp.pdf_worker import lower_limit\n'
            'resource.setrlimit(resource.RLIMIT_CPU, (1, 1))\n'
            'lower_limit(resource.RLIMIT_CPU, 2)\n'
            'print(json.dumps(resource.getrlimit(resource.RLIMIT_CPU)))')
    with open(os.devnull, 'rb') as source:
        result = pdf_context.capture([sys.executable, '-c', code], descriptor=source.fileno(), timeout_seconds=4)
    assert json.loads(result) == [1, 1]


def test_json_escaping_does_not_confuse_payload_and_transport_limits() -> None:
    data = {'excerpt': '\x01' * 14976, 'title': 'é' * 256, 'author': 'あ' * 170 + 'ab', 'pages': 1}
    encoded = json.dumps(data, ensure_ascii=False).encode()
    assert 64 * 1024 < len(encoded) < 128 * 1024
    assert pdf_context.admitted_result(encoded, 16000) == data
    with pytest.raises(pdf_context.ExtractionRefused, match='text or page limits'):
        pdf_context.admitted_result(encoded, 15999)


@pytest.mark.parametrize('data', [b'not json', b'[]', b'{"error":"invented"}',
                                b'{"excerpt":false,"title":"","author":"","pages":1}',
                                b'{"excerpt":"text","title":"","author":"","pages":true}'])
def test_invalid_worker_protocol_is_refused(data: bytes) -> None:
    with pytest.raises(ValueError):
        pdf_context.admitted_result(data, 16000)


def test_oversized_source_is_refused_before_child_launch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / 'large.pdf'
    with path.open('wb') as source:
        source.truncate(32 * 1024**2 + 1)
    monkeypatch.setattr(pdf_context, 'capture', lambda *_args, **_kwargs: pytest.fail('Oversized input reached child'))
    record = pdf_context.reading(path, {'path': 'large.pdf', 'sha256': '0' * 64}, budget=16000, timeout_seconds=5)
    assert record['excerpt'] == ''
    assert '32 MiB' in record['reason']
    assert path.stat().st_size == 32 * 1024**2 + 1
