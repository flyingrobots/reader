"""Colorful Language prose roles: discovery, admission, limits, mapping and cache.

A fake ``colorful`` script stands in for the CLI; one test runs the real binary
when discovery finds it (READER_COLORFUL, PATH or ~/.cargo/bin) and skips otherwise.
"""
import hashlib
from http.client import HTTPConnection
import json
from pathlib import Path
import sys
import threading

import pytest

from reader_mcp import prose as prose_module
from reader_mcp.prose import AdmissionError, Prose, ProseUnavailable
from reader_mcp.web import WebLibrary, WebServer

FAKE = Path(__file__).with_name('fake_colorful.py')
DOC = ('library/a.md', '0' * 64)


def fake(tmp_path, mode='ok'):
    path = tmp_path / f'colorful-{mode}'
    path.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{FAKE}" --mode {mode} "$@"\n')
    path.chmod(0o755)
    return path


def words(text, spans):
    units = text.encode('utf-16-le')
    return [(units[2 * start:2 * end].decode('utf-16-le'), role) for start, end, role in spans]


def test_utf16_mapping_with_emoji_accents_and_segment_boundaries(tmp_path):
    engine = Prose(fake(tmp_path))
    first, second = 'An emoji 🐈 and Ada said “café” in 2024.', 'Ünïcode 🐈🐈 the quiet library.'
    result = engine.colorize(DOC, [{'id': 'p1', 'text': first}, {'id': 'p2', 'text': second}, {'id': 'blank', 'text': '   '}])
    assert result['version'] == '0.4.0' and 'function' in result['roles']
    assert words(first, result['segments']['p1']) == [('An', 'function'), ('🐈', 'punct'), ('and', 'function'), ('Ada', 'proper'),
                                                       ('“', 'quote'), ('”', 'quote'), ('in', 'function'), ('2024', 'number'), ('.', 'punct')]
    assert words(second, result['segments']['p2']) == [('🐈', 'punct'), ('🐈', 'punct'), ('the', 'function'), ('quiet', 'adjective'), ('library', 'noun'), ('.', 'punct')]
    assert result['segments']['blank'] == []
    # Line breaks are replaced in place, so offsets still index the browser's text.
    broken = engine.colorize(DOC, [{'id': 'x', 'text': 'the\nlibrary'}])['segments']['x']
    assert broken == [[0, 3, 'function'], [4, 11, 'noun']]


@pytest.mark.parametrize('mode,code', [('reverse', 'E_BYTE_RANGE_ORDER'), ('overlap', 'E_TOKEN_OVERLAP'), ('bounds', 'E_BYTE_RANGE_BOUNDS'),
                                       ('version', 'E_CONTRACT_VERSION'), ('midchar', 'E_BYTE_RANGE_BOUNDARY'), ('axes', 'E_TOKEN_AXES'),
                                       ('hash', 'E_CONTENT_HASH'), ('vocabulary', 'E_VOCABULARY_HASH'), ('cycle', 'E_STRUCTURE_CYCLE')])
def test_admission_rejects_whole_artifacts(tmp_path, mode, code):
    engine = Prose(fake(tmp_path, mode))
    with pytest.raises(AdmissionError) as caught:
        engine.colorize(DOC, [{'id': 'p', 'text': 'The quiet café holds “Ada” and 12 more.'}])
    assert caught.value.code == code and str(caught.value).startswith('Colorful output rejected:')
    assert not engine.cache, 'nothing from a rejected artifact is cached'


def test_admission_shape_checks_are_exact():
    data = b'hi'
    good = {'contractVersion': 'colorful.syntax/v1', 'schemaHash': next(iter(prose_module.SCHEMA_HASHES)), 'vocabularyHash': next(iter(prose_module.VOCABULARY_HASHES)),
            'source': {'unitId': 'stdin', 'contentHash': 'sha256:' + hashlib.sha256(data).hexdigest(), 'utf8ByteLength': 2},
            'tokens': [{'occurrenceId': 0, 'byteRange': {'startUtf8': 0, 'endUtf8': 2}, 'tokenKind': 'WORD', 'lexicalClass': 'CONTENT', 'functionKind': None, 'openClassKind': None}],
            'structure': [], 'diagnostics': [], 'derivation': [{'passId': 'p', 'ruleId': 'r', 'sourceRanges': [], 'compilerBuildHash': 'x'}]}
    prose_module.admit(data, good)
    for mutate, code in [(lambda a: a.update(extra=1), 'E_ARTIFACT_SHAPE'), (lambda a: a['tokens'][0].update(tokenKind='SYMBOL'), 'E_ARTIFACT_SHAPE'),
                         (lambda a: a['tokens'][0]['byteRange'].update(endUtf8=2**40), 'E_ARTIFACT_SHAPE'), (lambda a: a['tokens'][0].update(occurrenceId=True), 'E_ARTIFACT_SHAPE'),
                         (lambda a: a['tokens'][0]['byteRange'].update(endUtf8=0), 'E_TOKEN_EMPTY'), (lambda a: a['source'].update(utf8ByteLength=3), 'E_BYTE_LENGTH'),
                         (lambda a: a.update(derivation=[]), 'E_EMPTY_DERIVATION'), (lambda a: a.update(schemaHash='sha256:' + '2' * 64), 'E_SCHEMA_HASH'),
                         (lambda a: a['tokens'].append(dict(a['tokens'][0])), 'E_TOKEN_OVERLAP')]:
        artifact = json.loads(json.dumps(good))
        mutate(artifact)
        with pytest.raises(AdmissionError) as caught:
            prose_module.admit(data, artifact)
        assert caught.value.code == code


def test_timeout_output_cap_and_request_limits(tmp_path, monkeypatch):
    monkeypatch.setattr(prose_module, 'TIMEOUT', 1)
    with pytest.raises(ValueError, match='longer than 1 s'):
        Prose(fake(tmp_path, 'sleep')).colorize(DOC, [{'id': 'p', 'text': 'the library'}])
    monkeypatch.setattr(prose_module, 'MAX_OUTPUT', 1024**2)
    with pytest.raises(ValueError, match='exceeded 16 MiB'):
        Prose(fake(tmp_path, 'flood')).colorize(DOC, [{'id': 'p', 'text': 'the library'}])
    with pytest.raises(ValueError, match='synthetic failure'):
        Prose(fake(tmp_path, 'fail')).colorize(DOC, [{'id': 'p', 'text': 'the library'}])
    engine = Prose(fake(tmp_path))
    with pytest.raises(ValueError, match='512 KiB'):
        engine.colorize(DOC, [{'id': f's{i}', 'text': 'a' * 100_000} for i in range(6)])
    with pytest.raises(ValueError, match='128 KiB'):
        engine.colorize(DOC, [{'id': 's', 'text': 'a' * (128 * 1024 + 1)}])
    for bad in [[], [{'id': 'a b', 'text': 'x'}], [{'id': 'a', 'text': 'x'}, {'id': 'a', 'text': 'y'}], [{'id': 'a', 'text': 1}], [{'id': 'a', 'text': 'x', 'more': 1}]]:
        with pytest.raises(ValueError):
            engine.colorize(DOC, bad)
    monkeypatch.setattr(prose_module, 'MAX_DOCUMENT_TEXT', 40)
    engine.colorize(DOC, [{'id': 'p', 'text': 'the library holds a quiet room'}])
    with pytest.raises(ValueError, match='4 MiB of text per document'):
        engine.colorize(DOC, [{'id': 'p', 'text': 'a different library holds it'}])
    assert engine.colorize(DOC, [{'id': 'p', 'text': 'the library holds a quiet room'}])['segments']['p'], 'cached text costs no budget'
    engine.colorize(('library/b.md', '1' * 64), [{'id': 'p', 'text': 'a different library holds it'}])


def test_missing_binary_and_version_floor_messages(tmp_path):
    empty = tmp_path / 'empty'
    empty.mkdir()
    status = Prose(environ={'PATH': str(empty), 'HOME': str(tmp_path)}).status()
    assert status['available'] is False and status['message'].startswith("Colorful Language isn't installed. Install it from Behind the scenes, Companions")
    with pytest.raises(ProseUnavailable, match="isn't installed"):
        Prose(environ={'PATH': str(empty), 'HOME': str(tmp_path)}).colorize(DOC, [{'id': 'p', 'text': 'the library'}])
    assert 'does not exist' in Prose(environ={'READER_COLORFUL': str(tmp_path / 'nope')}).status()['message']
    plain = tmp_path / 'not-executable'
    plain.write_text('x')
    assert 'not an executable file' in Prose(plain).status()['message']
    assert 'Colorful 0.2.1' in Prose(fake(tmp_path, 'old')).status()['message'] and 'too old' in Prose(fake(tmp_path, 'old')).status()['message']
    # Discovery order: PATH, then ~/.cargo/bin.
    cargo = tmp_path / '.cargo/bin'
    cargo.mkdir(parents=True)
    (cargo / 'colorful').write_bytes(fake(tmp_path).read_bytes())
    (cargo / 'colorful').chmod(0o755)
    found = Prose(environ={'PATH': str(empty), 'HOME': str(tmp_path)}).status()
    assert found['available'] and found['origin'] == 'cargo' and found['version'] == '0.4.0'


def test_colorful_030_is_below_the_floor_because_its_artifacts_fail_admission(tmp_path):
    # Colorful 0.3.0's colorful ir artifacts carry a schema hash Reader refuses (#102), so
    # the floor is 0.4.0: status must not offer prose colors that every document would reject.
    status = Prose(fake(tmp_path, 'v030')).status()
    assert status['available'] is False
    assert 'Colorful 0.3.0' in status['message'] and 'too old' in status['message'] and 'needs 0.4.0 or newer' in status['message']
    with pytest.raises(ProseUnavailable, match='too old'):
        Prose(fake(tmp_path, 'v030')).colorize(DOC, [{'id': 'p', 'text': 'the library'}])


def test_cache_is_keyed_by_text_and_binary_version(tmp_path):
    binary = fake(tmp_path, 'count')
    calls = FAKE.with_name(FAKE.name + '.calls')
    calls.unlink(missing_ok=True)
    try:
        engine = Prose(binary)
        segments = [{'id': 'a', 'text': 'the quiet library'}, {'id': 'b', 'text': 'a careful passage'}]
        first = engine.colorize(DOC, segments)
        assert engine.colorize(DOC, [{'id': 'other-id', 'text': 'the quiet library'}])['segments']['other-id'] == first['segments']['a']
        engine.colorize(DOC, segments + [{'id': 'c', 'text': 'each room waits'}])
        assert calls.read_text().split() == [str(len('the quiet library\n\na careful passage')), str(len('each room waits'))], 'only uncached segments run'
        engine.probe = (engine.probe[0], engine.probe[1] | {'version': '0.5.0'})
        engine.colorize(DOC, segments)
        assert len(calls.read_text().split()) == 3, 'a new Colorful version misses the cache'
    finally:
        calls.unlink(missing_ok=True)


def test_prose_route_requires_current_edition_and_reports_unavailable(tmp_path):
    for name in ('library', 'inbox', 'indexes'):
        (tmp_path / name).mkdir()
    (tmp_path / 'library/a.md').write_text('# A\n\nThe quiet library.\n')
    (tmp_path / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': []}))
    assert WebServer.request_queue_size >= 32, 'page loads open many parallel connections'
    servers = []
    for engine in (Prose(fake(tmp_path)), Prose(environ={'PATH': str(tmp_path / 'library'), 'HOME': str(tmp_path)})):
        server = WebServer(('127.0.0.1', 0), WebLibrary(tmp_path, prose=engine), 'Tester')
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)

    def call(server, path, payload=None, body=None):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
        data = body if body is not None else json.dumps(payload).encode() if payload is not None else None
        connection.request('POST' if data is not None else 'GET', path, data, {'Content-Type': 'application/json', 'X-Reader-Token': server.token})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    try:
        good, missing = servers
        sha = hashlib.sha256((tmp_path / 'library/a.md').read_bytes()).hexdigest()
        assert call(good, '/api/prose')[1]['available'] is True
        status, body = call(good, '/api/prose', {'path': 'library/a.md', 'sha256': sha, 'segments': [{'id': 'p', 'text': 'The quiet library.'}]})
        assert status == 200 and body['segments']['p'][0] == [0, 3, 'function']
        assert call(good, '/api/prose', {'path': 'library/a.md', 'sha256': '0' * 64, 'segments': [{'id': 'p', 'text': 'x'}]})[0] == 400
        assert call(good, '/api/prose', {'path': '../a.md', 'sha256': sha, 'segments': [{'id': 'p', 'text': 'x'}]})[0] == 400
        # Prose batches may exceed the 128 KiB body cap of other routes (up to 1 MiB).
        status, body = call(good, '/api/prose', body=b'{"path":"' + b'x' * (900 * 1024) + b'"}')
        assert status == 400 and 'Expected {"path"' in body['error']
        status, body = call(missing, '/api/prose', {'path': 'library/a.md', 'sha256': sha, 'segments': [{'id': 'p', 'text': 'x'}]})
        assert status == 409 and body['unavailable'] is True and "Colorful Language isn't installed" in body['error']
        assert call(missing, '/api/prose')[1]['available'] is False
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()


def test_real_colorful_binary_when_installed():
    engine = Prose()
    status = engine.status()
    if not status['available']:
        pytest.skip('Colorful CLI not installed (set READER_COLORFUL to run this test)')
    text = 'Ada read the “quiet” passage in 2024, and it was really good. 🐈 café'
    result = engine.colorize(DOC, [{'id': 'p', 'text': text}, {'id': 'q', 'text': 'Then Paris waited.'}])
    found = words(text, result['segments']['p'])
    assert ('the', 'function') in found and ('2024', 'number') in found and ('“', 'quote') in found and ('.', 'punct') in found
    assert ('Paris', 'proper') in words('Then Paris waited.', result['segments']['q'])
