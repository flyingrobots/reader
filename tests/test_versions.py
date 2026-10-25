"""The version explorer over a synthetic git vault: families with history, caps, content at a commit, any-to-any diffs."""
import hashlib
import itertools
import json
import os
import subprocess

import pytest

from reader_mcp import versions as versions_module
from reader_mcp.changes import Changes
from reader_mcp.versions import Versions, blob_id, parse_log, split_ref
from reader_mcp.web import WebLibrary, WebServer

ENV = {'PATH': os.environ['PATH'], 'GIT_AUTHOR_NAME': 'Ada', 'GIT_AUTHOR_EMAIL': 'ada@example.invalid', 'GIT_COMMITTER_NAME': 'Ada',
       'GIT_COMMITTER_EMAIL': 'ada@example.invalid', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1', 'HOME': os.devnull}
ESSAY = 'library/essays/gates'


def body(title, extra=''):
    return f'---\ntitle: {title}\nauthor: Ada\n---\n\n# {title}\n\nThe first paragraph stays.\n\nThe second paragraph {extra or "begins"} here.\n'


def git(root, *args, data=None):
    return subprocess.run(['git', '-C', str(root), *args], env=ENV, check=True, capture_output=True, input=data).stdout


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


@pytest.fixture
def vault(tmp_path):
    for name in ('library', 'inbox', 'indexes', 'engagement'):
        (tmp_path / name).mkdir()
    (tmp_path / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': []}))
    (tmp_path / ESSAY).mkdir(parents=True)
    git(tmp_path, 'init', '-q', '-b', 'main')
    v1 = tmp_path / f'{ESSAY}/gates.md'
    v1.write_text(body('Gates'))
    git(tmp_path, 'add', '-A')
    git(tmp_path, 'commit', '-q', '-m', 'File v1')
    v1.write_text(body('Gates', 'is revised'))
    git(tmp_path, 'commit', '-q', '-am', 'Revise v1')
    (tmp_path / f'{ESSAY}/gates.v2.md').write_text(body('Gates (v2)').replace('author: Ada\n', 'author: Ada\nprevious_version: gates.md\n'))
    (tmp_path / f'{ESSAY}/gates.v3.md').write_text(body('Gates (v3)', 'is final').replace('author: Ada\n', 'author: Ada\nprevious_version: gates.v2.md\n'))
    git(tmp_path, 'add', '-A')
    git(tmp_path, 'commit', '-q', '-m', 'Add v2 and v3')
    return tmp_path


def state(root):
    """Everything a read-only explorer must leave alone."""
    index = root / '.git/index'
    return (index.stat().st_mtime_ns, index.read_bytes(), git(root, 'for-each-ref'), git(root, '--no-optional-locks', 'status', '--porcelain'),
            sorted(p.name for p in (root / '.git').iterdir()))


def receipt(root, participant, path, version, at='2026-10-16T09:00:00Z'):
    folder = root / 'engagement'
    file = folder / (hashlib.sha256(participant.encode()).hexdigest() + '.json')
    record = json.loads(file.read_text()) if file.exists() else {'schema_version': 1, 'participant': participant, 'items': {}}
    record['items']['document:' + path] = {'version': version, 'at': at}
    file.write_text(json.dumps(record))


def test_refs_and_log_parsing():
    assert split_ref('library/a.md@3f2a1c9') == ('library/a.md', '3f2a1c9')
    assert split_ref('library/a.md') == ('library/a.md', None)
    assert split_ref('library/a@3f2a1c9') == ('library/a@3f2a1c9', None), 'a ref names a file with an extension'
    assert split_ref('library/a.md@HEAD~1') == ('library/a.md@HEAD~1', None), 'only hexadecimal commits'
    out = ('\x1e' + 'a' * 40 + '\x1f2026-10-12T09:00:00Z\x1fAda\x1fSubject\n\n:100644 100644 ' + '1' * 40 + ' ' + '2' * 40 + ' M\tlibrary/a.md\n'
           '\x1e' + 'b' * 40 + '\x1f2026-10-11T09:00:00Z\x1fAda\x1fMerge\n'
           '\x1e' + 'c' * 40 + '\x1f2026-10-10T09:00:00Z\x1fAda\x1fMove\n\n:100644 100644 ' + '3' * 40 + ' ' + '3' * 40 + ' R100\tinbox/a.md\tlibrary/a.md\n').encode()
    entries = parse_log(out)
    assert [e['short'] for e in entries] == ['aaaaaaa', 'ccccccc'], 'merges without a raw line are skipped'
    assert entries[0]['blob'] == '2' * 40 and entries[1]['from'] == 'inbox/a.md' and entries[1]['status'] == 'R'
    assert blob_id(b'hello\n') == 'ce013625030ba8dba906f756967f9e9ca394464a'


def test_family_and_history_combined_with_read_markers(vault):
    receipt(vault, 'You', f'{ESSAY}/gates.md', sha(body('Gates')))           # An earlier commit of v1.
    receipt(vault, 'Agy', f'{ESSAY}/gates.md', sha(body('Gates', 'is revised')))  # The current v1.
    before = state(vault)
    library = WebLibrary(vault)
    result = library.explore(f'{ESSAY}/gates.md', 'You')
    assert [(e['label'], e['revisions']) for e in result['family']] == [('v1', 2), ('v2', 1), ('v3', 1)]
    assert result['family'][0]['author'] == 'Ada'
    assert result['newer']['revision'] == 3 and result['git'] is True and not result['hashes']
    first = result['history'][f'{ESSAY}/gates.md']
    assert [e['subject'] for e in first] == ['Revise v1', 'File v1'] and first[0]['matches_current'] and 'sha256' not in first[0]
    assert first[0]['author'] == 'Ada' and len(first[0]['commit']) == 40 and first[0]['short'] == first[0]['commit'][:7]
    assert result['family'][0]['readers'] == ['Agy'] and not result['family'][0]['uncommitted']
    assert result['read'] == {'participant': 'You', 'path': f'{ESSAY}/gates.md', 'label': 'v1', 'version': sha(body('Gates')),
                              'at': '2026-10-16T09:00:00Z', 'where': 'earlier'}
    hashed = library.explore(f'{ESSAY}/gates.md', 'You', hashes=True)
    older = hashed['history'][f'{ESSAY}/gates.md'][1]
    assert older['sha256'] == sha(body('Gates')) and older['readers'] == ['You']
    assert hashed['read']['where'] == 'commit' and hashed['read']['commit'] == older['commit']
    assert state(vault) == before, 'no index, ref, status or .git change'


def test_uncommitted_working_copy_is_flagged(vault):
    (vault / f'{ESSAY}/gates.v3.md').write_text(body('Gates (v3)', 'is edited'))
    result = WebLibrary(vault).explore(f'{ESSAY}/gates.v3.md', 'You')
    v3 = next(e for e in result['family'] if e['label'] == 'v3')
    assert v3['uncommitted'] and not result['history'][f'{ESSAY}/gates.v3.md'][0].get('matches_current')


def test_caps_per_path_and_in_total(vault, monkeypatch):
    doc = vault / f'{ESSAY}/gates.md'
    for n in range(8):
        doc.write_text(body('Gates', f'round {n}'))
        git(vault, 'commit', '-q', '-am', f'Round {n}')
    monkeypatch.setattr(versions_module, 'MAX_PER_PATH', 5)
    result = WebLibrary(vault).explore(f'{ESSAY}/gates.md', 'You')
    assert len(result['history'][f'{ESSAY}/gates.md']) == 5 and result['history_status'][f'{ESSAY}/gates.md'] == 'truncated'
    monkeypatch.setattr(versions_module, 'MAX_TOTAL', 6)   # 3 members -> 2 commits each.
    result = WebLibrary(vault).explore(f'{ESSAY}/gates.md', 'You')
    assert len(result['history'][f'{ESSAY}/gates.md']) == 2 and result['stats']['commits'] <= 6


def test_timeout_and_no_repository(vault, tmp_path):
    ticks = itertools.chain([0.0], itertools.repeat(10.0))   # HEAD answers in time; every log runs out of it.
    library = WebLibrary(vault)
    library.versions = Versions(Changes(vault, clock=lambda: next(ticks)), clock=lambda: 0.0)
    result = library.explore(f'{ESSAY}/gates.md', 'You')
    assert set(result['history_status'].values()) == {'timeout'} and result['stats']['commits'] == 0
    plain = tmp_path / 'plain'
    for name in ('library', 'indexes', 'engagement'):
        (plain / name).mkdir(parents=True)
    (plain / 'library/a.md').write_text('# A\n')
    result = WebLibrary(plain).explore('library/a.md', 'You')
    assert result['git'] is False and result['family'][0]['revisions'] == 0
    with pytest.raises(ValueError):
        WebLibrary(plain).version('library/a.md', 'abcdef1')


def test_commit_content_retrieval(vault):
    library = WebLibrary(vault)
    history = library.explore(f'{ESSAY}/gates.md', 'You')['history'][f'{ESSAY}/gates.md']
    old = library.version(f'{ESSAY}/gates.md', history[1]['short'])
    assert old['historical'] and old['text'] == body('Gates') and old['sha256'] == sha(body('Gates'))
    assert old['commit'] == history[1]['commit'] and old['item'] is None and old['bookmark'] is None and old['metadata']['title'] == 'Gates'
    # Only commits in this path's own history are accepted; never revision expressions.
    v3_commit = library.explore(f'{ESSAY}/gates.v3.md', 'You')['history'][f'{ESSAY}/gates.v3.md'][0]['commit']
    assert library.version(f'{ESSAY}/gates.md', history[0]['commit'])['text'] == body('Gates', 'is revised')
    for bad in ('HEAD', 'HEAD~1', '--all', 'ABCDEF1', '123', 'g' * 7):
        with pytest.raises(ValueError):
            library.version(f'{ESSAY}/gates.md', bad)
    other = git(vault, 'commit-tree', '-m', 'unrelated', git(vault, 'write-tree').decode().strip()).decode().strip()
    with pytest.raises(ValueError, match='history'):
        library.version(f'{ESSAY}/gates.md', other)
    assert v3_commit != history[1]['commit']


def test_large_historical_blob_refused(vault, monkeypatch):
    monkeypatch.setattr(versions_module, 'MAX_BLOB', 10)
    library = WebLibrary(vault)
    history = library.explore(f'{ESSAY}/gates.md', 'You')['history'][f'{ESSAY}/gates.md']
    with pytest.raises(ValueError, match='4 MiB'):
        library.version(f'{ESSAY}/gates.md', history[0]['short'])


def test_any_to_any_comparison(vault):
    before = state(vault)
    library = WebLibrary(vault)
    history = library.explore(f'{ESSAY}/gates.md', 'You')['history'][f'{ESSAY}/gates.md']
    forward = library.compare_refs(f'{ESSAY}/gates.md', f'{ESSAY}/gates.v3.md')
    assert forward['status'] == 'changed' and forward['stats']['reworded'] >= 1 and forward['b']['path'] == f'{ESSAY}/gates.v3.md' and 'annotations' in forward
    backward = library.compare_refs(f'{ESSAY}/gates.v3.md', f'{ESSAY}/gates.md')
    assert backward['status'] == 'changed' and backward['a']['path'] == f'{ESSAY}/gates.v3.md'
    historical = library.compare_refs(f"{ESSAY}/gates.md@{history[1]['short']}", f'{ESSAY}/gates.md')
    assert historical['a']['commit'] == history[1]['commit'] and historical['stats']['reworded'] == 1
    two_old = library.compare_refs(f"{ESSAY}/gates.md@{history[1]['short']}", f"{ESSAY}/gates.md@{history[0]['short']}")
    assert two_old['status'] == 'changed' and 'annotations' not in two_old
    same = library.compare_refs(f'{ESSAY}/gates.md', f"{ESSAY}/gates.md@{history[0]['short']}")
    assert same['status'] == 'unchanged'
    with pytest.raises(ValueError):
        library.compare_refs('../etc/passwd', f'{ESSAY}/gates.md')
    assert state(vault) == before


def test_hash_budget_and_cache(vault, monkeypatch):
    library = WebLibrary(vault)
    monkeypatch.setattr(versions_module, 'MAX_HASH_BYTES', 1)
    partial = library.explore(f'{ESSAY}/gates.md', 'You', hashes=True)
    assert partial['hashes_partial'] and not any('sha256' in e for v in partial['history'].values() for e in v)
    monkeypatch.setattr(versions_module, 'MAX_HASH_BYTES', 32 * 1024**2)
    full = library.explore(f'{ESSAY}/gates.md', 'You', hashes=True)
    assert all('sha256' in e for v in full['history'].values() for e in v) and not full['hashes_partial']
    assert len(library.versions.sha) == sum(len(v) for v in full['history'].values())


def test_routes(vault):
    import threading
    import urllib.request
    import urllib.error
    server = WebServer(('127.0.0.1', 0), WebLibrary(vault), 'You')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'

    def get(path):
        try:
            with urllib.request.urlopen(base + path) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())
    try:
        status, data = get(f'/api/versions?path={ESSAY}/gates.v2.md&hashes=1')
        assert status == 200 and data['hashes'] and len(data['family']) == 3
        commit = data['history'][f'{ESSAY}/gates.md'][1]['short']
        status, old = get(f'/api/version?path={ESSAY}/gates.md&commit={commit}')
        assert status == 200 and old['text'] == body('Gates')
        status, diff = get(f'/api/changes?a={ESSAY}/gates.md%40{commit}&b={ESSAY}/gates.v3.md')
        assert status == 200 and diff['status'] == 'changed'
        assert get(f'/api/version?path={ESSAY}/gates.md&commit=HEAD')[0] == 400
        assert get('/api/versions?path=../x.md')[0] == 400
    finally:
        server.shutdown()
        server.server_close()
