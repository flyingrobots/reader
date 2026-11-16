"""Send to AI-TTS against a fake AF_UNIX daemon (AI_TTS_SOCKET); never the real one."""
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile
import threading
import time

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from fake_aitts import FakeDaemon
from reader_mcp.speech import Speech, SpeechUnavailable
from reader_mcp.web import WebLibrary, WebServer

SOURCE = '---\ntitle: A quiet thought\nauthor: Ada\n---\n\n# A quiet thought\n\nAn emoji 🐈 and **a precise passage**.\n\nA second paragraph waits.\n'


@pytest.fixture
def daemon(monkeypatch):
    # AF_UNIX paths are limited to 104 bytes on macOS; pytest's tmp_path can exceed it.
    folder = Path(tempfile.mkdtemp(prefix='rs-', dir=os.environ.get('READER_TEST_SOCKET_ROOT') or ('/tmp' if Path('/tmp').is_dir() else None)))
    fake = FakeDaemon(folder, step=0.05)
    monkeypatch.setenv('AI_TTS_SOCKET', str(fake.path))
    yield fake
    fake.close()
    shutil.rmtree(folder, ignore_errors=True)


@pytest.fixture
def web(tmp_path, daemon):
    for name in ('library', 'inbox', 'indexes'):
        (tmp_path / name).mkdir()
    (tmp_path / 'library/thought.md').write_text(SOURCE)
    (tmp_path / 'library/notes.txt').write_text('Plain words to hear.\n')
    (tmp_path / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': []}))
    library = WebLibrary(tmp_path)
    server = WebServer(('127.0.0.1', 0), library, 'Test reader')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(path, payload=None):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
        connection.request('POST' if payload is not None else 'GET', path, json.dumps(payload) if payload is not None else None,
                           {'Content-Type': 'application/json', 'X-Reader-Token': server.token})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def raw(path, headers=None):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
        connection.request('GET', path, headers={'X-Reader-Token': server.token, **(headers or {})})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    request.raw = raw

    yield tmp_path, library, request
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def submits(daemon):
    return [r for r in daemon.requests() if r['op'] == 'submit']


def test_saved_voice_and_per_reading_override(web, daemon):
    root, library, request = web
    assert request('/api/speech-voices') == (200, {'voices': ['fake', 'voice-a', 'voice-b'], 'default_voice': None})
    assert request('/api/speech-voices', {'voice': 'voice-a'})[1]['default_voice'] == 'voice-a'
    assert json.loads((root / '.reader/speech.json').read_text())['voice'] == 'voice-a'
    # A new library instance reads the persisted choice.
    assert WebLibrary(root).speech.preferred_voice() == 'voice-a'
    body = {'path': 'library/thought.md', 'source_sha256': library.digest('library/thought.md'), 'scope': 'article'}
    assert request('/api/speak', body)[1]['voice'] == 'voice-a'
    assert submits(daemon)[-1]['voice'] == 'voice-a'
    assert 'source' not in submits(daemon)[-1] and submits(daemon)[-1]['origin'] == 'Reader'
    assert request('/api/speak', body | {'voice': 'voice-b'})[1]['voice'] == 'voice-b'
    assert request('/api/speech-voices')[1]['default_voice'] == 'voice-a'
    assert request('/api/speak', body | {'voice': ''})[0] == 200
    assert submits(daemon)[-1]['source'] == 'Reader' and 'voice' not in submits(daemon)[-1]
    count = len(submits(daemon))
    assert request('/api/speak', body | {'voice': 'missing'})[0] == 400
    assert request('/api/speech-voices', {'voice': 'missing'})[0] == 400
    assert len(submits(daemon)) == count
    assert request('/api/speech-voices')[1]['default_voice'] == 'voice-a'
    assert request('/api/speech-voices', {'voice': ''})[1]['default_voice'] is None
    assert not any(r['op'] == 'assign_voice' for r in daemon.requests())


def test_submit_payload_and_scopes(web, daemon):
    root, library, request = web
    sha = library.digest('library/thought.md')
    status, body = request('/api/speak', {'path': 'library/thought.md', 'source_sha256': sha, 'scope': 'article'})
    assert status == 200 and body['id'].startswith('utt_') and body['state'] == 'Queued' and body['held'] is False
    sent = submits(daemon)[-1]
    assert {k: sent[k] for k in ('origin', 'source', 'sensitivity', 'priority', 'content_format')} == {
        'origin': 'Reader', 'source': 'Reader', 'sensitivity': 'confidential', 'priority': 'normal', 'content_format': 'markdown'}
    # Frontmatter is dropped; the source H1 already carries the title, so it is not repeated.
    assert sent['text'] == SOURCE[SOURCE.index('---\n\n') + 4:]

    start = SOURCE.index('A second')  # Python str offsets are code points, as data-source-start.
    assert request('/api/speak', {'path': 'library/thought.md', 'source_sha256': sha, 'scope': 'from', 'start': start})[0] == 200
    assert submits(daemon)[-1]['text'] == 'A quiet thought.\n\nA second paragraph waits.\n'

    begin = SOURCE.index('a precise')
    assert request('/api/speak', {'path': 'library/thought.md', 'source_sha256': sha, 'scope': 'selection', 'start': begin, 'end': begin + 17})[0] == 200
    assert submits(daemon)[-1]['text'] == 'A quiet thought.\n\na precise passage'
    assert request('/api/speak', {'path': 'library/thought.md', 'source_sha256': sha, 'scope': 'selection', 'start': 9, 'end': 3})[0] == 400

    plain = library.digest('library/notes.txt')
    assert request('/api/speak', {'path': 'library/notes.txt', 'source_sha256': plain, 'scope': 'article'})[0] == 200
    assert submits(daemon)[-1]['content_format'] == 'plain_text'
    assert submits(daemon)[-1]['text'] == 'notes.\n\nPlain words to hear.\n'


def test_cap_hash_and_unreachable(web, daemon, monkeypatch):
    root, library, request = web
    (root / 'library/long.md').write_text('# Long\n\n' + 'word ' * (110 * 1024))
    sha = library.digest('library/long.md')
    status, body = request('/api/speak', {'path': 'library/long.md', 'source_sha256': sha, 'scope': 'article'})
    assert status == 400 and '512 KiB' in body['error'] and 'From here' in body['error']
    assert submits(daemon) == []
    status, body = request('/api/speak', {'path': 'library/thought.md', 'source_sha256': '0' * 64, 'scope': 'article'})
    assert status == 400 and 'changed' in body['error']
    assert request('/api/speak', {'path': 'library/thought.md', 'source_sha256': sha, 'scope': 'article', 'voice': 'x'})[0] == 400
    monkeypatch.setenv('AI_TTS_SOCKET', str(daemon.folder / 'missing.sock'))
    status, body = request('/api/speak', {'path': 'library/thought.md', 'source_sha256': library.digest('library/thought.md'), 'scope': 'article'})
    assert status == 503 and body['unavailable'] is True and 'isn’t running' in body['error']
    monkeypatch.setenv('AI_TTS_SOCKET', str(daemon.path))
    (daemon.folder / 'down').touch()
    status, body = request('/api/speak', {'path': 'library/thought.md', 'source_sha256': library.digest('library/thought.md'), 'scope': 'article'})
    assert status == 503 and 'without answering' in body['error']


def test_daemon_refusal_text_reaches_the_reader(daemon):
    with pytest.raises(ValueError, match="AI-TTS refused: unknown op 'nope'"):
        Speech().request({'op': 'nope'})


def test_progress_controls_and_foreign_ids(web, daemon):
    root, library, request = web
    daemon.step = 0.08
    sha = library.digest('library/thought.md')
    submitted = request('/api/speak', {'path': 'library/thought.md', 'source_sha256': sha, 'scope': 'article'})[1]
    utterance = submitted['id']
    assert submitted['playback'] is False
    assert submits(daemon)[-1]['playback'] is False
    foreign = 'utt_' + 'f' * 32
    assert request('/api/speak/' + foreign)[0] == 403
    assert request('/api/speak/' + foreign + '/segments/0')[0] == 403
    assert request('/api/speak/' + foreign, {'action': 'pause'})[0] == 403
    assert request('/api/speak/../library', {'action': 'pause'})[0] in (403, 404)
    assert request('/api/speak/' + utterance, {'action': 'explode'})[0] == 400
    assert request('/api/speak/' + utterance + '/segments/nope')[0] == 400
    # Before synthesis finishes, unready segments return 404.
    assert request('/api/speak/' + utterance + '/segments/2')[0] == 404
    deadline = time.monotonic() + 5
    while (state := request('/api/speak/' + utterance)[1])['state'] != 'Ready':
        assert time.monotonic() < deadline
        time.sleep(0.05)
    assert state['playback'] is False and state['current'] is False and 'text' not in state
    assert len(state['segments']) == 3
    assert all(seg['audio_ready'] is True and 'audio_path' not in seg for seg in state['segments'])
    # Daemon playback queue was never touched.
    assert Speech().status()['current'] is None
    # Stream full WAV and partial byte range for browser audio playback.
    status, headers, body = request.raw(f'/api/speak/{utterance}/segments/0')
    assert status == 200
    assert headers.get('Content-Type') in ('audio/wav', 'audio/x-wav')
    assert headers.get('Accept-Ranges') == 'bytes'
    assert body.startswith(b'RIFF')
    p_status, p_headers, p_body = request.raw(f'/api/speak/{utterance}/segments/0', {'Range': 'bytes=0-15'})
    assert p_status == 206 and len(p_body) == 16 and p_body == body[:16]
    assert p_headers.get('Content-Range', '').startswith('bytes 0-15/')
    # Local browser transport never forwards pause/resume/skip to the daemon; only cancel reaches it.
    assert request('/api/speak/' + utterance, {'action': 'cancel'})[1]['state'] == 'Cancelled'
    assert request('/api/speak/' + utterance)[1]['terminal'] is True
    assert all(r.get('id') != foreign for r in daemon.requests())


def test_submitted_ids_are_bounded(daemon):
    speech = Speech()
    ids = [speech.submit('Hello there.', 'plain_text', 'selection')['id'] for _ in range(52)]
    with pytest.raises(PermissionError):
        speech.owned(ids[0])
    assert speech.owned(ids[-1]) == ids[-1]


def test_symlinked_or_non_socket_paths_are_refused(daemon, monkeypatch):
    link = daemon.folder / 'link.sock'
    link.symlink_to(daemon.path)
    monkeypatch.setenv('AI_TTS_SOCKET', str(link))
    with pytest.raises(SpeechUnavailable, match='symlinked'):
        Speech().status()
    regular = daemon.folder / 'regular'
    regular.write_text('')
    with pytest.raises(SpeechUnavailable, match='not a socket'):
        Speech(regular).status()
    assert daemon.requests() == []


def test_pdf_text_layers_and_missing_text(web, daemon):
    root, library, request = web
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    writer = PdfWriter()
    for index in (1, 2):
        page = writer.add_blank_page(width=300, height=300)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 20 250 Td (Page {index} speaks.) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    writer.write(root / 'library/pages.pdf')
    blank = PdfWriter()
    blank.add_blank_page(width=300, height=300)
    blank.write(root / 'library/scan.pdf')
    sha = library.digest('library/pages.pdf')
    assert request('/api/speak', {'path': 'library/pages.pdf', 'source_sha256': sha, 'scope': 'article'})[0] == 200
    sent = submits(daemon)[-1]
    assert sent['content_format'] == 'plain_text' and sent['text'] == 'pages.\n\nPage 1 speaks.\n\nPage 2 speaks.'
    assert request('/api/speak', {'path': 'library/pages.pdf', 'source_sha256': sha, 'scope': 'from', 'page': 2})[0] == 200
    assert submits(daemon)[-1]['text'] == 'pages.\n\nPage 2 speaks.'
    assert request('/api/speak', {'path': 'library/pages.pdf', 'source_sha256': sha, 'scope': 'selection', 'start': 0, 'end': 3})[0] == 400
    status, body = request('/api/speak', {'path': 'library/scan.pdf', 'source_sha256': library.digest('library/scan.pdf'), 'scope': 'article'})
    assert status == 400 and 'no text layer' in body['error']


def test_older_aitts_version_is_refused(web, daemon):
    root, library, request = web
    sha = library.digest('library/thought.md')
    for old in ('0.1.0', None):
        daemon.version = old
        before = len(submits(daemon))
        status, body = request('/api/speak', {'path': 'library/thought.md', 'source_sha256': sha, 'scope': 'article'})
        assert status == 503 and body.get('unavailable') is True and '0.2.0 or newer' in body['error']
        assert len(submits(daemon)) == before
    daemon.version = '0.2.0'
    assert request('/api/speak', {'path': 'library/thought.md', 'source_sha256': sha, 'scope': 'article'})[0] == 200
