"""Medium, offline contract tests for the shared catalog/search metadata codec."""
import hashlib
import json
import sqlite3

import pytest

from reader_mcp.catalog import Catalog
from reader_mcp.search import Search


@pytest.fixture
def vault(tmp_path):
    (tmp_path / 'library').mkdir()
    (tmp_path / 'inbox').mkdir()
    return tmp_path


def record(*, canonical=False, extra=''):
    versions = ('frontmatter_schema_version: 1\ndocument_revision: 3\n' if canonical
                else 'schema_version: 1\n')
    return ('---\n' + versions + 'document_id: 00000000-0000-4000-8000-000000000001\n'
            'document_path: library/note.md\ntitle: Catalog note\ntype: Feature\n'
            'metadata_created: 2026-10-04\nadded: null\nauthor:\n  - Ada\n  - Grace\n'
            'depends_on: []\ncustom:\n  evidence:\n    - proof\n' + extra + '---\nSearchable note.\n').encode()


def catalog_row(vault):
    with sqlite3.connect(vault / '.reader/catalog.sqlite3') as db:
        db.row_factory = sqlite3.Row
        return dict(db.execute('SELECT * FROM documents WHERE document_path=?',
                               ('library/note.md',)).fetchone())


def test_catalog_and_search_retain_the_same_declared_versions(vault):
    # Promise: both query surfaces preserve authored metadata. Oracle: supplied source fields.
    data = record(canonical=True)
    (vault / 'library/note.md').write_bytes(data)
    Catalog(vault).run('sync')
    engine = Search(vault); engine.index(False)
    catalog = catalog_row(vault)
    search = engine.read('library/note.md')
    assert catalog['frontmatter_schema_version'] == 1
    assert catalog['document_revision'] == 3
    assert json.loads(catalog['frontmatter_json']) == search['metadata']
    assert search['metadata']['author'] == ['Ada', 'Grace']
    assert search['metadata']['depends_on'] == []
    assert search['metadata']['custom'] == {'evidence': ['proof']}
    assert (vault / 'library/note.md').read_bytes() == data


def test_legacy_alias_does_not_invent_source_revision_or_rewrite_source(vault):
    # Promise: old catalog metadata remains usable without asserting a nonexistent revision.
    data = record()
    (vault / 'library/note.md').write_bytes(data)
    c = Catalog(vault); c.run('sync'); c.run('check')
    engine = Search(vault); engine.index(False)
    row = catalog_row(vault)
    result = engine.read('library/note.md')
    assert row['frontmatter_schema_version'] is None
    assert row['document_revision'] is None
    assert row['schema_version'] == 1
    assert result['metadata_status'] == 'legacy'
    assert 'frontmatter_schema_version' not in result['metadata']
    assert 'document_revision' not in result['metadata']
    assert json.loads(row['frontmatter_json']) == result['metadata']
    assert (vault / 'library/note.md').read_bytes() == data


def test_old_catalog_database_upgrades_without_source_migration(vault):
    # Promise: sync alone upgrades rebuildable SQL; it does not migrate authoritative files.
    data = record()
    (vault / 'library/note.md').write_bytes(data)
    (vault / '.reader').mkdir()
    with sqlite3.connect(vault / '.reader/catalog.sqlite3') as db:
        db.execute('CREATE TABLE documents (schema_version INTEGER, document_path TEXT)')
        db.execute("INSERT INTO documents VALUES (1, 'library/note.md')")
        db.execute('PRAGMA user_version=1')
    Catalog(vault).run('sync')
    assert Catalog(vault).run('check')['status'] == 'valid'
    assert catalog_row(vault)['document_revision'] is None
    assert (vault / 'library/note.md').read_bytes() == data
    assert not (vault / 'catalog/metadata').exists()


@pytest.mark.parametrize('old,new', [
    (b'document_revision: 3', b'document_revision: true'),
    (b'document_revision: 3', b'document_revision: 9223372036854775808'),
    (b'frontmatter_schema_version: 1', b'frontmatter_schema_version: 2'),
    (b'title: Catalog note', b'title: Bad \xff'),
    (b'metadata_created: 2026-10-04', b'metadata_created: 2026-02-30'),
])
def test_invalid_document_contract_refuses_catalog_and_is_diagnosed_by_search(vault, old, new):
    # Promise: shared constraints cannot admit a catalog record that search rejects.
    path = vault / 'library/note.md'
    path.write_bytes(record(canonical=True))
    c = Catalog(vault); c.run('sync')
    before = catalog_row(vault)
    bad = path.read_bytes().replace(old, new)
    path.write_bytes(bad)
    with pytest.raises(ValueError):
        c.run('sync')
    engine = Search(vault); engine.index(False)
    result = engine.search('note.md', 'keyword')['results'][0]
    assert result['metadata_status'] == 'invalid'
    assert result['metadata_diagnostics']
    assert catalog_row(vault) == before
    assert path.read_bytes() == bad


def test_new_sidecar_revision_belongs_to_the_sidecar_not_its_preserved_source(vault):
    # Promise: cataloging never assigns a source revision to an unchanged original.
    data = b'---\ntitle: External source\n---\nExternal content.\n'
    path = vault / 'library/note.md'; path.write_bytes(data)
    Catalog(vault).run('migrate')
    row = catalog_row(vault)
    engine = Search(vault); engine.index(False)
    source = engine.read('library/note.md')
    assert row['metadata_path'] == 'catalog/metadata/note.md.md'
    assert row['document_revision'] == 1
    assert source['metadata'] == {'title': 'External source'}
    assert row['source_sha256'] == hashlib.sha256(data).hexdigest()
    assert path.read_bytes() == data


def test_sidecar_starts_its_own_revision_for_a_versioned_source(vault):
    # Promise: a new catalog owner does not borrow its source's revision history.
    source = (b'---\nfrontmatter_schema_version: 1\ndocument_revision: 9\n'
              b'title: External source\ntype: Feature\n---\nOriginal body.\n')
    (vault / 'library/note.md').write_bytes(source)
    Catalog(vault).run('migrate')
    row = catalog_row(vault)
    engine = Search(vault); engine.index(False)
    assert row['document_revision'] == 1
    assert json.loads(row['frontmatter_json'])['original_frontmatter']['document_revision'] == 9
    assert engine.read('library/note.md')['metadata']['document_revision'] == 9
    assert (vault / 'library/note.md').read_bytes() == source
