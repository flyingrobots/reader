"""Delivered companion files remain usable after byte-preserving filing."""
import hashlib
from urllib.parse import quote
from uuid import uuid4

import pytest

from reader_mcp.store import Store, Submission
from test_web import web


def test_delivered_companions_survive_filing_and_open(web, tmp_path):
    root, _, _, request = web
    payloads = {
        'implementation/index.html': b'<button>Run</button><script src="app.js"></script>',
        'implementation/app.js': b'document.querySelector("button").textContent="Ready";',
        'implementation/theme.css': b'button { color: green; }',
        'implementation/build.py': b'print("A companion")\n',
        'implementation/snapshot.json': b'{"tasks": 3}\n',
        'assets/data.zip': b'PK\x03\x04\x00\xff\x80',
        'assets/figure.svg': b'<svg xmlns="http://www.w3.org/2000/svg"/>',
    }
    attachments = []
    for i, (path, data) in enumerate(payloads.items()):
        source = tmp_path / f'attachment-{i}'
        source.write_bytes(data)
        attachments.append({'source_path': str(source), 'path': path})
    store = Store(root)
    receipt = store.ingest(Submission(request_id=uuid4(), title='Companions', filename='article.md',
        markdown='[Interactive map](implementation/index.html)\n', attachments=attachments))
    bundle = root / receipt['bundle_path']
    original_receipt = (bundle / 'receipt.json').read_bytes()
    filed = root / 'library/package'
    bundle.rename(filed)
    for path, data in payloads.items():
        resolved = request('/api/resolve?from=library/package/article.md&target=' + quote(path))[1]
        assert resolved['path'] == 'library/package/' + path
        status, body, _ = request('/api/file?path=' + quote(resolved['path']), raw=True)
        assert status == 200 and body == data
    status, doc, _ = request('/api/document?path=library/package/implementation/index.html')
    assert status == 200 and doc['text'] is None
    assert doc['preview_url'] == '/api/attachment/library/package/implementation/index.html'
    status, body, headers = request(doc['preview_url'], raw=True)
    assert status == 200 and body == payloads['implementation/index.html']
    assert headers['Content-Type'] == 'text/html; charset=utf-8'
    policy = headers['Content-Security-Policy']
    assert 'sandbox allow-scripts;' in policy and 'allow-same-origin' not in policy
    assert "connect-src 'none'" in policy and "form-action 'none'" in policy
    for path, kind in [('app.js', 'text/javascript'), ('theme.css', 'text/css')]:
        status, body, headers = request('/api/attachment/library/package/implementation/' + path, raw=True)
        assert status == 200 and headers['Content-Type'] == kind
        assert body == payloads['implementation/' + path]
    # Raw HTML remains source text. Previewing never changes source or receipt bytes.
    assert request(doc['file_url'], raw=True)[2]['Content-Type'].startswith('text/plain')
    assert (filed / 'receipt.json').read_bytes() == original_receipt
    result = store.status(receipt['id'])
    assert result['status'] == 'filed' and result['integrity'] == 'intact'


@pytest.mark.parametrize('data', [b'\xff\x80', b'PK\x03\x04\x00binary', b'x' * (4 * 1024**2 + 1)], ids=['non-utf8', 'nul-bytes', 'large'])
def test_binary_and_large_companions_are_downloadable(web, data):
    root, _, _, request = web
    path = 'library/data #1.zip'
    (root / path).write_bytes(data)
    status, doc, _ = request('/api/document?path=' + quote(path))
    assert status == 200 and doc['text'] is None
    assert doc['sha256'] == hashlib.sha256(data).hexdigest()
    status, body, headers = request('/api/file?path=' + quote(path) + '&download=1', raw=True)
    assert status == 200 and body == data
    assert headers['Content-Type'] == 'application/octet-stream'
    assert headers['Content-Disposition'] == "attachment; filename*=UTF-8''data%20%231.zip"
    assert 'allow-scripts' not in headers['Content-Security-Policy']


def test_attachment_route_rejects_escapes_and_preserves_encoded_names(web):
    root, _, _, request = web
    (root / 'private.html').write_text('private')
    (root / 'library/link.html').symlink_to(root / 'private.html')
    (root / 'library/a #b%.html').write_text('<p>Encoded name</p>')
    status, doc, _ = request('/api/document?path=' + quote('library/a #b%.html'))
    assert status == 200
    assert request(doc['preview_url'], raw=True)[1] == b'<p>Encoded name</p>'
    for path in ['../private.html', 'library/../private.html', 'library/link.html',
                 'library/.hidden.html', 'library/%2e%2e/private.html', 'inbox/../private.html']:
        assert request('/api/attachment/' + path, raw=True)[0] in (400, 404)
    (root / 'inbox/package').mkdir()
    (root / 'inbox/package/map.htm').write_text('<p>Inbox map</p>')
    doc = request('/api/document?path=inbox/package/map.htm')[1]
    assert doc['preview'] and doc['item'] is None
    assert request(doc['preview_url'], raw=True)[0] == 200


def test_html_preview_keeps_source_for_inline_chat_voices(web):
    root, library, _, request = web
    path = 'library/interactive.html'
    text = '<p>Café ∑ 🐈</p><script>const label = "café";</script>'
    (root / path).write_text(text, encoding='utf-8')
    assert request('/api/document?path=' + path)[1]['text'] is None
    assert library.chat_document(path, False)['text'] is None
    chat = library.chat_document(path, True)
    assert chat['text'] == text
    assert chat['sha256'] == hashlib.sha256(text.encode()).hexdigest()
    assert request('/api/attachment/' + path, raw=True)[2]['Content-Type'] == 'text/html; charset=utf-8'
    (root / path).write_bytes(b'x' * (4 * 1024**2 + 1))
    assert request('/api/document?path=' + path)[0] == 200
    with pytest.raises(ValueError, match='4 MiB'):
        library.chat_document(path, True)
