"""The default hidden inbox: arrivals wait in .reader/inbox/, and the old inbox/ folder still works as a drop box."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest

from reader_mcp import inbox_paths, uploads
from reader_mcp.inbox_runner import inventory, run
from reader_mcp.inbox_view import InboxView
from reader_mcp.store import Store, Submission
from reader_mcp.web import WebLibrary


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.delenv('READER_INBOX', raising=False)
    root = tmp_path / 'vault'
    (root / 'library').mkdir(parents=True)
    subprocess.run(['git', 'init', '-q', '-b', 'main'], cwd=root, check=True)
    subprocess.run(['git', 'config', 'user.email', 't@example.com'], cwd=root, check=True)
    subprocess.run(['git', 'config', 'user.name', 'T'], cwd=root, check=True)
    (root / '.gitignore').write_text('.reader/\n')
    subprocess.run(['git', 'add', '-A'], cwd=root, check=True)
    subprocess.run(['git', 'commit', '-q', '-m', 'init'], cwd=root, check=True)
    return root


def deliver(root, text='# Report\n', name='report.md'):
    data = text.encode()
    identity = str(uuid4())
    header = {'upload': 1, 'request_id': identity, 'title': 'A report', 'privacy': 'normal',
              'files': [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}
    body = json.dumps(header).encode() + b'\n' + data
    uploads.receive(root, io.BytesIO(body), len(body), {'via': 'local'})
    return identity


def test_a_vault_needs_no_inbox_folder_and_git_never_sees_an_arrival(vault):
    identity = deliver(vault)
    assert not (vault / 'inbox').exists()
    assert (vault / '.reader/inbox' / identity / 'report.md').is_file()
    assert subprocess.run(['git', 'status', '--porcelain'], cwd=vault, capture_output=True, text=True).stdout == ''
    status = Store(vault).status(identity)
    assert status['status'] == 'awaiting_filing' and status['bundle_path'] == 'inbox/' + identity
    assert status['document_path'].endswith('.reader/inbox/' + identity + '/report.md')
    assert inventory(vault) == [f'inbox/{identity}/receipt.json', f'inbox/{identity}/report.md']


def test_the_old_folder_is_swept_and_never_overwrites(vault):
    legacy = vault / 'inbox'
    legacy.mkdir()
    (legacy / 'README.md').write_text('guide')
    (legacy / 'loose.md').write_text('dropped')
    (legacy / 'bundle').mkdir()
    (legacy / 'bundle/doc.md').write_text('in a bundle')
    (vault / '.reader/inbox').mkdir(parents=True)
    (vault / '.reader/inbox/taken.md').write_text('already here')
    (legacy / 'taken.md').write_text('a different file')
    assert inbox_paths.sweep(vault) == ['taken.md']
    assert (vault / '.reader/inbox/loose.md').read_text() == 'dropped'
    assert (vault / '.reader/inbox/bundle/doc.md').read_text() == 'in a bundle'
    assert (vault / '.reader/inbox/taken.md').read_text() == 'already here' and (legacy / 'taken.md').read_text() == 'a different file'
    assert (legacy / 'README.md').read_text() == 'guide' and not (legacy / 'loose.md').exists()
    errors = InboxView(vault).status()['errors']
    assert any('taken.md' in error and 'Rename' in error for error in errors)


def test_a_symlink_in_the_old_folder_is_not_moved(vault, tmp_path):
    legacy = vault / 'inbox'
    legacy.mkdir()
    (tmp_path / 'outside.md').write_text('outside')
    (legacy / 'link.md').symlink_to(tmp_path / 'outside.md')
    inbox_paths.sweep(vault)
    assert (legacy / 'link.md').is_symlink() and not (vault / '.reader/inbox/link.md').exists()


def test_an_older_helpers_delivery_is_found_by_its_receipt_after_the_sweep(vault):
    identity = str(uuid4())
    bundle = vault / 'inbox' / identity
    bundle.mkdir(parents=True)
    (bundle / 'a.md').write_text('# Old helper\n')
    digest = hashlib.sha256(b'# Old helper\n').hexdigest()
    (bundle / 'receipt.json').write_text(json.dumps({'reader_receipt': 1, 'id': identity, 'fingerprint': 'x', 'title': 'Old', 'document': 'a.md',
                                                     'provenance': {}, 'files': [{'path': 'a.md', 'bytes': 13, 'sha256': digest}]}))
    assert Store(vault).status(identity)['status'] == 'awaiting_filing'
    assert not bundle.exists() and (vault / '.reader/inbox' / identity / 'a.md').is_file()


def test_the_web_previews_a_hidden_arrival_but_refuses_traversal(vault):
    identity = deliver(vault)
    library = WebLibrary(vault)
    try:
        assert library.path(f'inbox/{identity}/report.md', preview=True).is_file()
        for bad in (f'inbox/{identity}/../../config.json', 'inbox/.hidden', '.reader/inbox/' + identity + '/report.md'):
            with pytest.raises(ValueError):
                library.path(bad, preview=True)
        with pytest.raises(ValueError):
            library.path(f'inbox/{identity}/report.md', preview=False)
    finally:
        library.close()


def test_a_run_files_from_the_hidden_folder(vault, monkeypatch):
    tool = vault / '.reader/fake-git-locks'
    tool.parent.mkdir(exist_ok=True)
    tool.write_text('#!' + sys.executable + '\nimport sys,json\nprint(json.dumps({"event":"claimed","acquisition":"test-acquisition"} if "claim" in sys.argv else {"event":"released"}))\n')
    tool.chmod(0o755)
    monkeypatch.setenv('READER_GIT_LOCKS', str(tool))
    fake = vault / '.reader/fake-codex'
    fake.write_text('#!' + sys.executable + '''
import sys, json, pathlib
args = sys.argv
context = json.loads(sys.stdin.read().rsplit("\\n\\n", 1)[1])
value = dict(source=context["source"], snapshot_sha256=context["snapshot_sha256"], disposition="file", collection="reports", slug="example",
             title="Example", author="", project="", summary="A summary.", reason="")
pathlib.Path(args[args.index("--output-last-message") + 1]).write_text(json.dumps(value))
''')
    fake.chmod(0o755)
    linked = deliver(vault)
    code = run(vault, str(fake), only={linked})
    state = json.loads((vault / '.reader/inbox-runner/state.json').read_text())
    assert code == 0, state['message'] + (vault / '.reader/inbox-runner/stderr.log').read_text()[-1500:]
    assert state['status'] == 'finished' and state['result']['filed_count'] == 1 and state['result']['commit']
    assert not (vault / '.reader/inbox' / linked).exists()
    filed = Store(vault).status(linked)
    assert filed['status'] == 'filed' and filed['integrity'] == 'intact' and filed['bundle_path'].startswith('library/')
    assert Path(filed['document_path']).read_text().startswith('# Report')
    tracked = subprocess.run(['git', 'ls-files'], cwd=vault, capture_output=True, text=True).stdout
    assert 'originals/report.md' in tracked and '.reader/' not in tracked
