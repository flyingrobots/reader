"""Recovering the edition a receipt names from a synthetic git vault, and diffing it."""
import hashlib
import itertools
import json
import os
import subprocess

import pytest

from reader_mcp import changes as changes_module
from reader_mcp.changes import Changes, Unavailable, blocks, diff, words
from reader_mcp.web import WebLibrary

ENV = {'PATH': os.environ['PATH'], 'GIT_AUTHOR_NAME': 'T', 'GIT_AUTHOR_EMAIL': 't@example.invalid', 'GIT_COMMITTER_NAME': 'T',
       'GIT_COMMITTER_EMAIL': 't@example.invalid', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1', 'HOME': os.devnull}
V1 = '---\ntitle: Gates\n---\n\n# Gates\n\nThe first paragraph stays.\n\nThe old second paragraph will be reworded slightly here.\n\nA paragraph that will be removed.\n\n```js\nconst kept = "fence\n\nwith a blank line";\n```\n'
V2 = '---\ntitle: Gates\nupdated: 2026-10-24\n---\n\n# Gates\n\nThe first paragraph stays.\n\nThe new second paragraph was reworded slightly here.\n\n```js\nconst kept = "fence\n\nwith a blank line";\n```\n\nA wholly new closing thought appears.\n'


def git(root, *args, data=None):
    return subprocess.run(['git', '-C', str(root), *args], env=ENV, check=True, capture_output=True, input=data).stdout


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


@pytest.fixture
def vault(tmp_path):
    for name in ('library', 'inbox', 'indexes', 'engagement'):
        (tmp_path / name).mkdir()
    (tmp_path / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': []}))
    git(tmp_path, 'init', '-q', '-b', 'main')
    doc = tmp_path / 'library/gates.md'
    doc.write_text(V1)
    git(tmp_path, 'add', '-A')
    git(tmp_path, 'commit', '-q', '-m', 'v1')
    doc.write_text(V2)
    git(tmp_path, 'commit', '-q', '-am', 'v2')
    return tmp_path


def state(root):
    """Everything a read-only search must leave alone."""
    index = root / '.git/index'
    return (index.stat().st_mtime_ns, index.read_bytes(), git(root, 'for-each-ref'), git(root, '--no-optional-locks', 'status', '--porcelain', '--', 'library'),
            sorted(p.name for p in (root / '.git').iterdir()))


def receipt(root, participant, path, version, at='2026-10-12T09:00:00Z'):
    library = WebLibrary(root)
    folder = root / 'engagement'
    file = folder / (hashlib.sha256(participant.encode()).hexdigest() + '.json')
    record = json.loads(file.read_text()) if file.exists() else {'schema_version': 1, 'participant': participant, 'items': {}}
    record['items']['document:' + path] = {'version': version, 'at': at}
    file.write_text(json.dumps(record))
    return library


def test_blocks_keep_fences_whole_and_skip_frontmatter():
    parts = blocks(V1)
    assert [p[0].split('\n')[0] for p in parts] == ['# Gates', 'The first paragraph stays.', 'The old second paragraph will be reworded slightly here.', 'A paragraph that will be removed.', '```js']
    assert all(V1[s:e].rstrip() == t for t, s, e in parts)
    assert parts[0][1] == V1.index('# Gates')


def test_word_diff_for_a_reworded_paragraph():
    assert words('The old second paragraph', 'The new second paragraph') == [['=', 'The '], ['-', 'old'], ['+', 'new'], ['=', ' second paragraph']]


def test_diff_hunks_and_stats():
    stats, hunks = diff(V1, V2)
    assert stats == {'added': 1, 'removed': 1, 'reworded': 1, 'unchanged': 3}
    ops = [h['op'] for h in hunks]
    assert ops == ['equal', 'replace', 'delete', 'equal', 'insert']
    reworded = hunks[1]
    assert ['-', 'old'] in reworded['words'] and ['+', 'new'] in reworded['words']
    assert V2[reworded['new_start']:reworded['new_end']].startswith('The new second paragraph')
    assert V2[hunks[4]['new_start']:].startswith('A wholly new closing thought')
    assert hunks[2]['old'] == 'A paragraph that will be removed.' and hunks[2]['new_start'] == V2.index('```js')


def test_diff_hunks_carry_old_offsets_for_split_scrollbind():
    _, hunks = diff(V1, V2)
    assert all({'old_start', 'old_end'} <= set(h) for h in hunks)
    assert V1[hunks[1]['old_start']:hunks[1]['old_end']].startswith('The old second paragraph')
    assert V1[hunks[2]['old_start']:hunks[2]['old_end']].rstrip() == 'A paragraph that will be removed.'
    assert hunks[0]['old_start'] == V1.index('# Gates') and V1[hunks[3]['old_start']:].startswith('```js')
    assert hunks[4]['old_start'] == hunks[4]['old_end'] == len(V1)  # An insert at the end lands at the old text's end.


def test_changed_unchanged_unavailable_and_unread(vault):
    before = state(vault)
    library = receipt(vault, 'You', 'library/gates.md', sha(V1))
    result = library.changes('library/gates.md', 'You')
    assert result['status'] == 'changed' and result['read_version'] == sha(V1) and result['current_version'] == sha(V2)
    assert result['stats']['reworded'] == 1 and result['read_at'] == '2026-10-12T09:00:00Z'
    assert result['recovery']['commits'] == 2
    assert library.changes('library/gates.md', 'You')['recovery'] == {'cached': True}
    receipt(vault, 'You', 'library/gates.md', sha(V2))
    assert WebLibrary(vault).changes('library/gates.md', 'You')['status'] == 'unchanged'
    receipt(vault, 'You', 'library/gates.md', sha('never committed'))
    gone = WebLibrary(vault).changes('library/gates.md', 'You')
    assert gone['status'] == 'unavailable' and 'history' in gone['reason'] and 'hunks' not in gone
    assert WebLibrary(vault).changes('library/gates.md', 'Nobody')['status'] == 'unread'
    assert state(vault) == before, 'no index, ref, status or .git change'


def test_against_another_participant_and_unknown_refused(vault):
    receipt(vault, 'You', 'library/gates.md', sha(V2))
    library = receipt(vault, 'Agy', 'library/gates.md', sha(V1), at='2026-10-11T08:00:00Z')
    mine = library.changes('library/gates.md', 'You')
    assert mine['status'] == 'unchanged' and mine['others'] == [{'participant': 'Agy', 'read_at': '2026-10-11T08:00:00Z'}]
    theirs = library.changes('library/gates.md', 'You', against='Agy')
    assert theirs['status'] == 'changed' and theirs['against'] == 'Agy'
    with pytest.raises(ValueError, match='receipt'):
        library.changes('library/gates.md', 'You', against='Stranger')


def test_successor_compares_working_tree_versions(vault):
    (vault / 'library/gates.v2.md').write_text(V2.replace('closing thought', 'final thought'))
    library = WebLibrary(vault)
    result = library.changes('library/gates.md', 'You', successor=True)
    assert result['status'] == 'changed' and result['successor'] == 'library/gates.v2.md' and result['stats']['reworded'] >= 1
    with pytest.raises(ValueError, match='newer'):
        library.changes('library/gates.v2.md', 'You', successor=True)


def test_large_blobs_are_skipped(vault, monkeypatch):
    big = 'x' * (changes_module.MAX_BLOB + 1)
    (vault / 'library/gates.md').write_text(big)
    git(vault, 'commit', '-q', '-am', 'huge')
    (vault / 'library/gates.md').write_text(V2)
    git(vault, 'commit', '-q', '-am', 'back')
    found, meta = Changes(vault).recover('library/gates.md', sha(V1))
    assert found.decode() == V1 and meta['skipped_large'] == 1
    with pytest.raises(Unavailable):
        Changes(vault).recover('library/gates.md', sha(big))


def test_commit_bound_is_respected(vault, monkeypatch):
    doc = vault / 'library/gates.md'
    for n in range(12):
        doc.write_text(V2 + f'\nRevision {n}.\n')
        git(vault, 'commit', '-q', '-am', f'r{n}')
    monkeypatch.setattr(changes_module, 'MAX_COMMITS', 5)
    with pytest.raises(Unavailable):
        Changes(vault).recover('library/gates.md', sha(V1))
    found, meta = Changes(vault).recover('library/gates.md', sha(V2 + '\nRevision 9.\n'))
    assert meta['commits'] == 5 and found.decode().endswith('Revision 9.\n')


def test_time_bound_and_no_repository(tmp_path, vault):
    ticks = itertools.chain([0.0], itertools.repeat(10.0))
    with pytest.raises(Unavailable, match='time'):
        Changes(vault, clock=lambda: next(ticks)).recover('library/gates.md', sha(V1))
    plain = tmp_path / 'plain'
    (plain / 'library').mkdir(parents=True)
    (plain / 'library/a.md').write_text('a')
    with pytest.raises(Unavailable):
        Changes(plain).recover('library/a.md', sha('b'))


def test_cache_is_bounded():
    changes = Changes('/nonexistent')
    for n in range(changes_module.CACHE_ENTRIES + 5):
        changes.remember(f'{n:064x}', b'x')
    assert len(changes.cache) == changes_module.CACHE_ENTRIES and changes.cached(f'{0:064x}') is None


def test_a_parent_repository_is_never_used(vault):
    nested = vault / 'library/nested-vault'
    (nested / 'library').mkdir(parents=True)
    (nested / 'library/gates.md').write_text(V2)
    git(vault, 'add', '-A')
    git(vault, 'commit', '-q', '-m', 'nested')
    with pytest.raises(Unavailable, match='git history'):
        Changes(nested).recover('library/gates.md', sha(V2))


def test_metadata_only_editions_have_no_visible_changes(vault):
    """Frontmatter-only or rewrapped editions are not offered as changes (#60)."""
    v3 = V2.replace('updated: 2026-10-24', 'updated: 2026-10-25').replace('The first paragraph stays.', 'The first\nparagraph   stays.')
    (vault / 'library/gates.md').write_text(v3)
    git(vault, 'commit', '-q', '-am', 'metadata')
    receipt(vault, 'You', 'library/gates.md', sha(v3))
    receipt(vault, 'Agy', 'library/gates.md', sha(V2), at='2026-10-11T08:00:00Z')
    library = receipt(vault, 'Bo', 'library/gates.md', sha(V1), at='2026-10-10T08:00:00Z')
    receipt(vault, 'Cy', 'library/gates.md', sha('never committed'), at='2026-10-09T08:00:00Z')
    library = WebLibrary(vault)
    mine = library.changes('library/gates.md', 'You')
    assert mine['status'] == 'unchanged'
    assert [o['participant'] for o in mine['others']] == ['Bo', 'Cy'], 'Agy saw the same prose; Cy’s edition is unknown'
    agy = library.changes('library/gates.md', 'Agy')
    assert agy['status'] == 'changed' and agy['prose_changed'] is False and sum(agy['stats'][k] for k in ('added', 'removed', 'reworded')) == 0
    bo = library.changes('library/gates.md', 'Bo')
    assert bo['status'] == 'changed' and bo['prose_changed'] is True
