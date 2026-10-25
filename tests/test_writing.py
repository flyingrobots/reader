"""Scratch pad saves (RW-33): /api/writing writes one notebook file atomically and commits only it."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import urllib.error
import urllib.request
from uuid import uuid4

import pytest

from reader_mcp.web import WebLibrary, WebServer
from reader_mcp.writing import Writing, WritingConflict

ENV = {'PATH': os.environ.get('PATH', os.defpath), 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1', 'HOME': '/dev/null'}
CLOCK = lambda: datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], env=ENV, check=True, capture_output=True, text=True).stdout


@pytest.fixture
def vault(tmp_path):
    root = tmp_path / 'vault'
    for name in ('library', 'writings', 'indexes'):
        (root / name).mkdir(parents=True)
    (root / 'library/index.md').write_text('# Index\n')
    (root / 'writings/index.md').write_text('# Writings\n')
    (root / 'library/answered.md').write_text('# A piece being answered\n\nText.\n')
    (root / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': []}))
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.name', 'Synthetic Writer')
    git(root, 'config', 'user.email', 'writer@example.invalid')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'Synthetic vault')
    return root


def writer(root, **options):
    library = WebLibrary(root, writing_options={'git_locks': False, 'clock': CLOCK} | options)
    return library, library.writing


def save(writing, participant='You', **fields):
    return writing.dispatch({'action': 'save', 'request_id': str(uuid4()), 'title': 'On splits', 'slug': 'on-splits', 'status': 'draft', 'body': '# On splits\n\nTwo panes.\n'} | fields, participant)


def test_save_writes_exact_frontmatter_and_commits_only_that_file(vault):
    library, writing = writer(vault)
    answered = hashlib.sha256((vault / 'library/answered.md').read_bytes()).hexdigest()
    (vault / 'library/index.md').write_text('# Index\n\nAn uncommitted librarian edit.\n')
    result = save(writing, responds_to='library/answered.md')
    assert result['path'] == 'library/notebook/2026-10-24-on-splits.md' and result['status'] == 'committed' and result['revision'] == 1
    text = (vault / result['path']).read_text()
    assert text == ('---\ntitle: "On splits"\nauthor: "Synthetic Writer"\nparticipant: "You"\ndate: 2026-10-24\nkind: Notebook\nstatus: draft\n'
                    f'responds_to: "library/answered.md"\nresponds_to_sha256: {answered}\ndocument_revision: 1\ntags: [you/writing]\n---\n\n# On splits\n\nTwo panes.\n')
    assert result['sha256'] == hashlib.sha256(text.encode()).hexdigest()
    shown = git(vault, 'show', '--name-only', '--format=%B', 'HEAD')
    assert 'Reader-Writing: library/notebook/2026-10-24-on-splits.md' in shown and 'Reader-Participant: You' in shown
    assert git(vault, 'show', '--name-only', '--format=', 'HEAD').split() == ['library/notebook/2026-10-24-on-splits.md']
    assert 'library/index.md' in git(vault, 'status', '--porcelain'), 'the librarian edit stays uncommitted'
    assert (vault / 'writings/index.md').read_text() == '# Writings\n' and (vault / 'library/index.md').read_text().endswith('librarian edit.\n')


def test_existing_paths_are_never_overwritten(vault):
    _, writing = writer(vault)
    first = save(writing)
    before = (vault / first['path']).read_bytes()
    with pytest.raises(WritingConflict) as refused:
        save(writing, body='Different text.')
    assert refused.value.extra == {'suggestion': 'on-splits-2'}
    assert (vault / first['path']).read_bytes() == before
    assert save(writing, slug='on-splits-2')['path'].endswith('on-splits-2.md')


def test_a_revision_writes_v2_and_keeps_the_original_bytes(vault):
    _, writing = writer(vault)
    first = save(writing)
    original = (vault / first['path']).read_bytes()
    second = save(writing, body='# On splits\n\nThree panes now.\n', base={'path': first['path'], 'sha256': first['sha256']}, shifted='A third pane.')
    assert second['path'] == 'library/notebook/2026-10-24-on-splits.v2.md' and second['revision'] == 2
    assert (vault / first['path']).read_bytes() == original
    text = (vault / second['path']).read_text()
    assert 'document_revision: 2\nprevious_version: "library/notebook/2026-10-24-on-splits.md"\nwhat_shifted: "A third pane."\n' in text
    third = save(writing, body='Four.\n', base={'path': second['path'], 'sha256': second['sha256']})
    assert third['path'].endswith('on-splits.v3.md') and third['previous_version'] == second['path']
    # A base that changed since the draft opened is refused.
    (vault / third['path']).write_text((vault / third['path']).read_text() + 'Edited elsewhere.\n')
    with pytest.raises(WritingConflict, match='changed since this draft opened'):
        save(writing, body='Five.\n', base={'path': third['path'], 'sha256': third['sha256']})
    assert not (vault / 'library/notebook/2026-10-24-on-splits.v4.md').exists()


def test_only_the_notebook_is_writable(vault):
    _, writing = writer(vault)
    for slug in ('../escape', 'Upper', 'a/b', '', 'x' * 61, '.hidden'):
        with pytest.raises(ValueError):
            save(writing, slug=slug)
    for path in ('library/answered.md', 'library/notebook/../answered.md', 'writings/index.md'):
        with pytest.raises((ValueError, FileNotFoundError)):
            save(writing, base={'path': path, 'sha256': '0' * 64})
    (vault / 'elsewhere').mkdir()
    if (vault / 'library/notebook').is_dir():
        (vault / 'library/notebook').rmdir()
    (vault / 'library/notebook').symlink_to(vault / 'elsewhere')
    with pytest.raises(ValueError, match='real folder'):
        save(writing)
    assert list((vault / 'elsewhere').iterdir()) == []


def test_bounds_and_idempotent_requests(vault):
    _, writing = writer(vault)
    with pytest.raises(ValueError, match='64 KiB'):
        save(writing, body='x' * (64 * 1024 + 1))
    with pytest.raises(ValueError, match='title'):
        save(writing, title='t' * 201)
    with pytest.raises(ValueError, match='title'):
        save(writing, title='two\nlines')
    with pytest.raises(ValueError, match='status'):
        save(writing, status='secret')
    with pytest.raises(ValueError, match='Unexpected'):
        save(writing, path='library/answered.md')
    request = {'action': 'save', 'request_id': str(uuid4()), 'title': 'Once', 'slug': 'once', 'status': 'published', 'body': 'Once.\n'}
    assert writing.dispatch(dict(request), 'You') == writing.dispatch(dict(request), 'You'), 'a retried request returns the first result'
    assert len(git(vault, 'log', '--format=%H').split()) == 2


def test_commit_goes_through_git_locks_and_a_failure_keeps_the_file(vault, tmp_path):
    record = tmp_path / 'locks.txt'
    tool = tmp_path / 'git-locks'
    tool.write_text(f'#!/bin/sh\necho "$@" >> {record}\nwhile [ "$1" != "--" ]; do shift; done; shift; exec "$@"\n')
    tool.chmod(0o755)
    _, writing = writer(vault, git_locks=str(tool))
    result = save(writing)
    assert result['status'] == 'committed' and result['locked_by'] == 'git-locks'
    args = record.read_text().split()
    assert args[:1] == ['with'] and '.git/' in args and args[args.index('--wait') + 1] == '120'
    broken = tmp_path / 'broken-locks'
    broken.write_text('#!/bin/sh\necho "lock wait timed out" >&2\nexit 125\n')
    broken.chmod(0o755)
    _, failing = writer(vault, git_locks=str(broken))
    kept = save(failing, slug='kept')
    assert kept['status'] == 'failed' and kept['commit'] is None and 'written but not committed' in kept['error']
    assert (vault / kept['path']).is_file()


def test_http_route_requires_the_token_and_bounds_the_body(vault):
    library = WebLibrary(vault, writing_options={'git_locks': False, 'clock': CLOCK})
    server = WebServer(('127.0.0.1', 0), library, 'You')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    def post(payload, token):
        data = json.dumps(payload).encode()
        request = urllib.request.Request(base + '/api/writing', data=data, method='POST', headers={'Content-Type': 'application/json', 'X-Reader-Token': token})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())
    try:
        good = {'action': 'save', 'request_id': str(uuid4()), 'title': 'Via HTTP', 'slug': 'via-http', 'status': 'draft', 'body': 'Hello.\n'}
        assert post(good, 'wrong')[0] == 403
        assert not (vault / 'library/notebook').exists()
        assert post(good | {'body': 'x' * (70 * 1024)}, server.token)[0] == 400
        status, body = post(good, server.token)
        assert status == 200 and body['path'] == 'library/notebook/2026-10-24-via-http.md' and body['status'] == 'committed'
        status, body = post(good | {'request_id': str(uuid4())}, server.token)
        assert status == 409 and body['suggestion'] == 'via-http-2'
    finally:
        server.shutdown()
        server.library.close()
        server.server_close()
