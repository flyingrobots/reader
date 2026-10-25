"""Edition families from frontmatter and path conventions, in a synthetic vault."""
import os

import pytest

from reader_mcp.editions import MAX_FAMILY, Editions


def put(root, path, text):
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text)
    return file


def front(**fields):
    return '---\n' + ''.join(f'{k}: {v}\n' for k, v in fields.items()) + '---\n\n# Body\n\nText.\n'


@pytest.fixture
def vault(tmp_path):
    b = 'library/essays/2026-10-12-bundle'
    # A v1/v2/v3 chain: v2 uses a vault path, v3 a sibling-relative path.
    put(tmp_path, f'{b}/tidal.md', front(title='Tidal', created='2026-10-12'))
    put(tmp_path, f'{b}/tidal.v2.md', front(title='Tidal (v2)', document_revision=2, created='2026-10-15', previous_version=f'{b}/tidal.md'))
    put(tmp_path, f'{b}/tidal.v3.md', front(title='Tidal (v3)', document_revision=3, created='2026-10-20', previous_version='tidal.v2.md'))
    # A bundle-relative reference from a nested folder.
    put(tmp_path, f'{b}/evidence/REPORT.md', front(title='Report'))
    put(tmp_path, f'{b}/notes/REPORT.v2.md', front(title='Report v2', previous_version='evidence/REPORT.md'))
    # An unresolvable reference is reported, not guessed.
    put(tmp_path, f'{b}/orphan.v2.md', front(title='Orphan', previous_version='does-not-exist.md'))
    # A reading copy with reading_source.
    put(tmp_path, f'{b}/notes.md', front(title='Notes'))
    put(tmp_path, f'{b}/notes.reading.md', front(title='Notes — reading copy', kind='reading-copy', reading_source=f'{b}/notes.md'))
    # A preserved original beside its filed copy.
    put(tmp_path, f'{b}/original/docs/design.md', '# Design\n\nOriginal bytes.\n')
    put(tmp_path, f'{b}/docs/design.md', '# Design\n\nFiled copy.\n')
    # A catalog note by path convention, and one that names its document.
    put(tmp_path, f'catalog/metadata/essays/2026-10-12-bundle/tidal.v2.md.md', front(title='Tidal (v2)', type='note'))
    put(tmp_path, 'library/solo.md', '# Solo\n')
    return tmp_path


def roles(result):
    return [(e['path'].rsplit('/', 1)[-1], e['role'], e.get('revision')) for e in result['family']]


def test_version_chain_roles_order_and_newer(vault):
    editions = Editions(vault)
    result = editions.family('library/essays/2026-10-12-bundle/tidal.v2.md')
    assert roles(result) == [('tidal.md', 'version', 1), ('tidal.v2.md', 'version', 2), ('tidal.v3.md', 'version', 3)]
    assert [e.get('current', False) for e in result['family']] == [False, True, False]
    assert result['newer']['path'].endswith('tidal.v3.md') and result['newer']['revision'] == 3 and result['newer']['date'] == '2026-10-20'
    assert result['catalog'] == 'catalog/metadata/essays/2026-10-12-bundle/tidal.v2.md.md'
    assert editions.family('library/essays/2026-10-12-bundle/tidal.v3.md')['newer'] is None
    assert editions.family('library/essays/2026-10-12-bundle/tidal.md')['newer']['revision'] == 3


def test_bundle_relative_reference_resolves(vault):
    result = Editions(vault).family('library/essays/2026-10-12-bundle/notes/REPORT.v2.md')
    assert [e['path'] for e in result['family']] == ['library/essays/2026-10-12-bundle/evidence/REPORT.md', 'library/essays/2026-10-12-bundle/notes/REPORT.v2.md']


def test_reading_copy_and_original_pairs(vault):
    editions = Editions(vault)
    copy = editions.family('library/essays/2026-10-12-bundle/notes.reading.md')
    assert roles(copy) == [('notes.md', 'original', None), ('notes.reading.md', 'reading-copy', None)]
    assert copy['newer'] is None and copy['family'][1]['label'] == 'Reading copy'
    pair = editions.family('library/essays/2026-10-12-bundle/docs/design.md')
    assert [(e['path'].split('bundle/')[1], e['label']) for e in pair['family']] == [('docs/design.md', 'Filed copy'), ('original/docs/design.md', 'Preserved original')]


def test_unresolved_is_listed_and_singletons_stay_alone(vault):
    editions = Editions(vault)
    orphan = editions.family('library/essays/2026-10-12-bundle/orphan.v2.md')
    assert len(orphan['family']) == 1 and orphan['unresolved'] == [{'path': 'library/essays/2026-10-12-bundle/orphan.v2.md', 'field': 'previous_version', 'value': 'does-not-exist.md'}]
    solo = editions.family('library/solo.md')
    assert len(solo['family']) == 1 and solo['newer'] is None and solo['catalog'] is None
    stats = editions.diagnostics()
    assert stats['stats']['unresolved'] == 1 and stats['stats']['families'] == 4 and not stats['stats']['partial']


def test_symlinks_are_excluded_and_escaping_references_are_refused(vault, tmp_path_factory):
    outside = tmp_path_factory.mktemp('outside')
    put(outside, 'secret.md', front(title='Secret'))
    os.symlink(outside / 'secret.md', vault / 'library/linked.md')
    put(vault, 'library/escape.v2.md', front(title='Escape', previous_version='../../outside/secret.md'))
    put(vault, 'library/via-link.v2.md', front(title='Via link', previous_version='library/linked.md'))
    editions = Editions(vault)
    assert len(editions.family('library/escape.v2.md')['family']) == 1
    assert editions.family('library/via-link.v2.md')['unresolved'][0]['value'] == 'library/linked.md'
    assert 'library/linked.md' not in editions.index()['families']


def test_cache_rechecks_signatures_at_most_once_a_minute(vault):
    now = [0.0]
    editions = Editions(vault, clock=lambda: now[0])
    first = editions.index()
    put(vault, 'library/solo.v2.md', front(title='Solo v2', previous_version='solo.md'))
    assert editions.index() is first, 'within 60 s the cached index is served'
    now[0] = 61
    assert len(editions.family('library/solo.md')['family']) == 2
    now[0] = 130
    second = editions.index()
    now[0] = 200
    assert editions.index() is second, 'an unchanged signature keeps the built index'


def test_family_is_capped(tmp_path):
    put(tmp_path, 'library/big/base.md', front(title='Base'))
    for n in range(2, MAX_FAMILY + 6):
        put(tmp_path, f'library/big/base.v{n}.md', front(title=f'v{n}', previous_version='base.md'))
    result = Editions(tmp_path).family('library/big/base.md')
    assert len(result['family']) == MAX_FAMILY and result['more'] == 5
    last = Editions(tmp_path).family(f'library/big/base.v{MAX_FAMILY + 5}.md')
    assert last['family'][-1].get('current') and len(last['family']) == MAX_FAMILY


def test_duplicate_labels_name_their_folders(tmp_path):
    put(tmp_path, 'library/asides/essay.md', front(title='Essay'))
    put(tmp_path, 'library/asides/essay.v2.md', front(title='Essay v2', previous_version='library/asides/essay.md'))
    put(tmp_path, 'library/notes/essay.v2.md', front(title='Essay v2', previous_version='library/asides/essay.md'))
    result = Editions(tmp_path).family('library/asides/essay.md')
    assert [(e['label'], e.get('where')) for e in result['family']] == [('v1', None), ('v2', 'asides'), ('v2', 'notes')]
    assert result['newer']['path'] == 'library/asides/essay.v2.md', 'the same folder wins a tie'
