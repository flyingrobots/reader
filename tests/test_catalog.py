import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from reader_mcp.catalog import Catalog, Metadata, COLUMNS, frontmatter, emit


@pytest.fixture
def vault(tmp_path):
    (tmp_path / 'library').mkdir()
    (tmp_path / 'inbox').mkdir()
    (tmp_path / 'library/index.md').write_text('# Library\n\nKeep this body.\n')
    (tmp_path / 'library/note.md').write_text('---\ntitle: Notes\ntype: note\nadded: 2026-10-03\ntags: [evidence]\ncustom: {nested: [one, two]}\n---\n\n# A note\nBody stays intact.\n')
    (tmp_path / 'library/archive').mkdir()
    original = b'---\ntitle: Original\ntype: Feature\nadded: 2026-10-03\n---\n# Untouched\n'
    (tmp_path / 'library/archive/report.md').write_bytes(original)
    (tmp_path / 'library/archive/receipt.json').write_text(json.dumps({'files': [
        {'path': 'report.md', 'sha256': hashlib.sha256(original).hexdigest()}]}))
    (tmp_path / 'library/book.pdf').write_bytes(b'fake PDF bytes; catalog does not parse or rewrite')
    (tmp_path / 'library/.hidden').write_text('archive configuration\n')
    return tmp_path


def rows(vault):
    with sqlite3.connect(vault / '.reader/catalog.sqlite3') as db:
        db.row_factory = sqlite3.Row
        return {r['document_path']: dict(r) for r in db.execute('SELECT * FROM documents')}


def test_full_coverage_preservation_mirror_and_idempotence(vault):
    before = {p: p.read_bytes() for p in (vault / 'library').rglob('*') if p.is_file()}
    body = frontmatter((vault / 'library/note.md').read_bytes())[1]
    c = Catalog(vault)
    assert c.run('plan')['documents'] == 6
    assert not (vault / '.reader/catalog.sqlite3').exists()
    result = c.run('migrate')
    assert result['direct'] == 2 and result['placeholders'] == 4
    assert frontmatter((vault / 'library/note.md').read_bytes())[1] == body
    for p, data in before.items():
        if p.name not in ('note.md', 'index.md'):
            assert p.read_bytes() == data
    records = rows(vault)
    assert set(records) == {p.relative_to(vault).as_posix() for p in before}
    for path, row in records.items():
        meta = frontmatter((vault / row['metadata_path']).read_bytes())[0]
        assert json.loads(row['frontmatter_json']) == meta
        assert row['source_sha256'] == hashlib.sha256((vault / path).read_bytes()).hexdigest()
        if row['metadata_path'] != path:
            assert f'![[{path}]]' in (vault / row['metadata_path']).read_text()
    assert json.loads(records['library/note.md']['frontmatter_json'])['custom'] == {'nested': ['one', 'two']}
    assert records['library/index.md']['added'] is None  # No invented filing date.
    assert c.run('check')['status'] == 'valid'
    after = {p: p.read_bytes() for parent in ('library', 'catalog') for p in (vault / parent).rglob('*') if p.is_file()}
    assert c.run('migrate')['planned_writes'] == 0
    assert after == {p: p.read_bytes() for p in after}
    assert rows(vault) == records


def test_source_and_sql_drift_are_detected_and_repaired(vault):
    c = Catalog(vault); c.run('migrate')
    p = vault / 'library/note.md'; p.write_text(p.read_text().replace('title: Notes', 'title: Revised'))
    with pytest.raises(ValueError, match='differs'):
        c.run('check')
    c.run('sync'); assert rows(vault)['library/note.md']['title'] == 'Revised'
    with sqlite3.connect(c.db) as db:
        db.execute("UPDATE documents SET title='forged'")
    with pytest.raises(ValueError, match='differs'):
        c.run('check')
    c.run('sync'); c.run('check')


def test_invalid_metadata_does_not_replace_previous_sql_or_mutate_sources(vault):
    c = Catalog(vault); c.run('migrate'); before = rows(vault)
    p = vault / 'library/note.md'; p.write_text(p.read_text().replace('schema_version: 1', 'schema_version: 2'))
    bad = p.read_bytes()
    with pytest.raises(ValueError, match='schema_version'):
        c.run('migrate')
    assert rows(vault) == before and p.read_bytes() == bad


def test_duplicate_identity_rejected(vault):
    c = Catalog(vault); c.run('migrate')
    a = vault / 'library/index.md'; b = vault / 'library/note.md'
    first, _ = frontmatter(a.read_bytes()); second, body = frontmatter(b.read_bytes())
    second['document_id'] = first['document_id']; b.write_bytes(emit(second, body))
    with pytest.raises(ValueError, match='Duplicate document_id'):
        c.run('sync')


def test_orphan_and_moved_records_fail_explicitly(vault):
    c = Catalog(vault); c.run('migrate')
    (vault / 'library/book.pdf').rename(vault / 'library/moved.pdf')
    with pytest.raises(ValueError, match='Orphan'):
        c.run('check')


@pytest.mark.parametrize('header', ['title: x\ntitle: y', 'title: &x [*x]'])
def test_ambiguous_yaml_fails_before_any_migration(vault, header):
    p = vault / 'library/bad.md';p.write_text('---\n'+header+'\n---\nbody\n')
    before = (vault / 'library/index.md').read_bytes()
    with pytest.raises(ValueError):
        Catalog(vault).run('migrate')
    assert (vault / 'library/index.md').read_bytes() == before


def test_symlink_not_silently_omitted(vault):
    (vault / 'library/link').symlink_to(vault / 'library/note.md')
    with pytest.raises(ValueError, match='symlink'):
        Catalog(vault).run('plan')


def test_schema_sql_columns_agree():
    assert set(Metadata.model_fields) == set(COLUMNS)


def test_publication_rolls_back_on_insert_failure(vault):
    c = Catalog(vault);c.run('migrate');before = rows(vault)
    _, _, values = c.prepare()
    with pytest.raises(sqlite3.IntegrityError):
        c.publish(values + values)
    assert rows(vault) == before


def test_numeric_source_tags_keep_original_metadata(vault):
    p = vault / 'library/archive/odd.md'
    p.write_text('---\ntitle: Odd source\ntags: [1, 2, label]\n---\n# Original\n')
    original = p.read_bytes()
    c = Catalog(vault);c.run('migrate')
    assert p.read_bytes() == original
    meta = json.loads(rows(vault)['library/archive/odd.md']['frontmatter_json'])
    assert meta['tags'] == ['1', '2', 'label']
    assert meta['original_frontmatter']['tags'] == [1, 2, 'label']


def test_missing_embed_is_detected(vault):
    c = Catalog(vault);c.run('migrate')
    p = vault / rows(vault)['library/book.pdf']['metadata_path']
    p.write_text(p.read_text().replace('![[library/book.pdf]]', ''))
    with pytest.raises(ValueError, match='Missing Obsidian'):
        c.run('sync')


def test_direct_move_keeps_identity_but_requires_explicit_new_path(vault):
    c = Catalog(vault);c.run('migrate')
    before = rows(vault)['library/note.md']['document_id']
    p = vault / 'library/note.md'; moved = vault / 'library/renamed.md';p.rename(moved)
    with pytest.raises(ValueError, match='path mismatch'):
        c.run('sync')
    meta, body = frontmatter(moved.read_bytes());meta['document_path'] = 'library/renamed.md'
    moved.write_bytes(emit(meta, body));c.run('sync')
    assert 'library/note.md' not in rows(vault)
    assert rows(vault)['library/renamed.md']['document_id'] == before


def test_unrelated_database_is_not_replaced(vault):
    c = Catalog(vault);c.run('migrate')
    with sqlite3.connect(c.db) as db:db.execute('PRAGMA user_version=0')
    before = rows(vault)
    with pytest.raises(ValueError, match='unversioned nonempty'):
        c.run('sync')
    assert rows(vault) == before

def test_checked_in_schema_and_sql_match_executable_contract():
    from reader_mcp.catalog import DDL
    root = Path(__file__).resolve().parents[1]
    assert json.loads((root / 'schemas/catalog-envelope-v1.json').read_text()) == Metadata.model_json_schema()
    assert DDL + ';' in (root / 'schemas/catalog-v2.sql').read_text()


def test_cli_from_external_directory(vault, tmp_path):
    import subprocess
    import sys
    command = [sys.executable, '-m', 'reader_mcp.cli', '--root', str(vault), 'catalog']
    result = subprocess.run(command + ['migrate'], cwd=tmp_path.parent, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)['documents'] == 6
    result = subprocess.run(command + ['check'], cwd=tmp_path.parent, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    (vault / 'library/new.txt').write_text('A new arrival after filing.')
    result = subprocess.run(command + ['check'], cwd=tmp_path.parent, capture_output=True, text=True)
    assert result.returncode == 1 and 'Missing versioned frontmatter' in result.stderr
