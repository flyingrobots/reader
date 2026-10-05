"""Metadata promises at parser, read/index, and CLI boundaries; no model calls."""
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

from reader_mcp.metadata import parse_metadata, schema, validate_paths
from reader_mcp.search import Search


def document(extra='', kind='Feature', revision='2'):
    return (f'---\nfrontmatter_schema_version: 1\ndocument_revision: {revision}\n'
            f'title: Example\ntype: {kind}\n{extra}---\nSearchable evidence.\n').encode()


@pytest.fixture
def vault(tmp_path):
    (tmp_path / 'library').mkdir()
    (tmp_path / 'inbox').mkdir()
    return tmp_path


def test_versioned_document_preserves_project_metadata():
    # Promise: source task metadata survives validation, including nested extension fields.
    data = document('depends_on:\n  - B01\nprerequisite_kinds:\n  - task_id: B01\n    kind: evidence\nscreens: []\n')
    result = parse_metadata(data)
    assert result.status == 'valid', result.diagnostics
    assert result.metadata['type'] == 'Feature'
    assert result.metadata['prerequisite_kinds'] == [{'task_id': 'B01', 'kind': 'evidence'}]
    assert result.metadata['screens'] == []


@pytest.mark.parametrize('revision', ['0', '-1', 'true', '"2"', '1.5', '9223372036854775808'])
def test_revision_requires_a_positive_integer(revision):
    result = parse_metadata(document(revision=revision))
    assert result.status == 'invalid', revision
    assert any(d['field'] == 'document_revision' for d in result.diagnostics), result.diagnostics
    assert result.metadata == {}, 'invalid revision must not publish validated metadata'


@pytest.mark.parametrize('version', ['2', 'true', '"1"'])
def test_unknown_or_coerced_schema_version_refuses(version):
    result = parse_metadata(document().replace(b'frontmatter_schema_version: 1',
                                             f'frontmatter_schema_version: {version}'.encode()))
    assert result.status == 'invalid', version
    assert result.diagnostics[0]['field'] == 'frontmatter_schema_version'


@pytest.mark.parametrize('extra', ['title: Duplicate\n', 'tags: &cycle [*cycle]\n',
                                   'other: .nan\n', 'added: 2026-02-30\n'])
def test_invalid_present_metadata_has_actionable_diagnostics(extra):
    result = parse_metadata(document(extra))
    assert result.status == 'invalid'
    assert result.diagnostics, extra
    assert all(d['field'] and d['message'] for d in result.diagnostics)


@pytest.mark.parametrize('extra', ['"owner": Alice\n', 'depends_on: [B01]\n', 'properties: {}\n'])
def test_explicit_version_uses_block_style_and_plain_keys(extra):
    result = parse_metadata(document(extra))
    assert result.status == 'invalid'
    assert any(d['code'] == 'yaml_style' for d in result.diagnostics)


def test_legacy_catalog_migration_is_explicit_without_rewriting(vault):
    path = vault / 'library/note.md'
    original = b'---\ntitle: Old note\ntype: note\nadded: 2026-10-04\n---\nOriginal.\n'
    path.write_bytes(original)
    strict = validate_paths(vault, ['library/note.md'])
    compatible = validate_paths(vault, ['library/note.md'], allow_legacy=True)
    assert strict['valid'] is False
    assert compatible['valid'] is True
    entry = compatible['documents'][0]
    assert entry['metadata_status'] == 'legacy'
    assert 'frontmatter_schema_version' not in entry['metadata']
    assert 'document_revision' not in entry['metadata']
    assert entry['metadata_diagnostics'][0]['code'] == 'legacy_metadata'
    assert path.read_bytes() == original, 'migration interpretation must preserve canonical bytes'


def test_catalog_contract_does_not_restrict_preserved_source_types(vault):
    bundle = vault / 'library/bundle'
    bundle.mkdir()
    (bundle / 'receipt.json').write_text('{"reader_receipt": 1}')
    (bundle / 'report.md').write_bytes(document())
    (bundle / 'index.md').write_bytes(document('added: 2026-10-04\n', kind='report'))
    assert validate_paths(vault, ['library/bundle/report.md', 'library/bundle/index.md'])['valid']
    (bundle / 'index.md').write_bytes(document(kind='report'))
    invalid = validate_paths(vault, ['library/bundle/index.md'])
    assert invalid['valid'] is False
    assert invalid['documents'][0]['metadata_diagnostics'][0]['field'] == 'added'


def test_missing_required_wrapper_frontmatter_is_reported(vault):
    bundle = vault / 'library/bundle'
    bundle.mkdir()
    (bundle / 'receipt.json').write_text('{"reader_receipt": 1}')
    (bundle / 'index.md').write_text('Catalog without metadata.')
    report = validate_paths(vault)
    assert report['invalid'] == 1
    assert report['documents'][0]['metadata_diagnostics'][0]['code'] == 'missing_frontmatter'


def test_sqlite_mirrors_full_metadata_and_reports_invalid_fields(vault):
    path = vault / 'library/task.md'
    path.write_bytes(document('depends_on:\n  - B01\nowner: Engineer\n'))
    engine = Search(vault)
    engine.index(False)
    result = engine.search('Searchable', 'keyword')['results'][0]
    assert result['metadata']['depends_on'] == ['B01']
    assert result['metadata_status'] == 'valid'
    assert engine.read('library/task.md')['metadata'] == result['metadata']
    with engine.connect() as con:
        row = con.execute('SELECT frontmatter_schema_version, document_revision FROM docs').fetchone()
        assert tuple(row) == (1, 2), 'explicit mirror must match source schema and revision'
    path.write_bytes(document(revision='false'))
    report = engine.index(False)
    result = engine.search('Searchable', 'keyword')['results'][0]
    assert result['metadata_status'] == 'invalid'
    assert result['metadata'] == {}
    assert report['metadata_issues'][0]['diagnostics'][0]['field'] == 'document_revision'
    with engine.connect() as con:
        assert con.execute('SELECT document_revision FROM docs').fetchone()[0] is None
    assert path.read_bytes() == document(revision='false'), 'indexing must never repair an original'


def test_no_frontmatter_and_cyclic_sources_remain_readable(vault):
    (vault / 'library/plain.md').write_text('Ordinary source without metadata.')
    (vault / 'library/cyclic.md').write_text('---\ntitle: Loops\ntags: &cycle [*cycle]\n---\nRecursion.\n')
    engine = Search(vault)
    engine.index(False)
    assert engine.read('library/plain.md')['metadata_status'] == 'absent'
    cyclic = engine.read('library/cyclic.md')
    assert cyclic['metadata'] == {}  # Shared codec refuses the entire alias header.
    assert cyclic['metadata_status'] == 'invalid'
    assert cyclic['metadata_diagnostics'][0]['code'] == 'invalid_yaml'
    assert 'Recursion.' in cyclic['text']


def test_version_one_index_upgrades_without_reembedding_unchanged_sources(vault):
    original = document('project: salesos\n')
    (vault / 'library/task.md').write_bytes(original)
    state = vault / '.reader'
    state.mkdir()
    with sqlite3.connect(state / 'search.sqlite3') as con:
        con.executescript('''
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO settings VALUES ('version','1');
            CREATE TABLE docs (path TEXT PRIMARY KEY, sha256 TEXT, metadata TEXT, status TEXT, size INTEGER, mtime INTEGER);
            CREATE TABLE chunks (id INTEGER PRIMARY KEY, path TEXT, page INTEGER, start_line INTEGER, end_line INTEGER, text TEXT, vector BLOB);
            CREATE VIRTUAL TABLE terms USING fts5(path,text,tokenize='unicode61');
        ''')
        con.execute('INSERT INTO docs VALUES (?,?,?,?,?,?)', ('library/task.md',hashlib.sha256(original).hexdigest(),'{}','text',len(original),0))
        con.execute('INSERT INTO chunks VALUES (1,?,NULL,1,1,?,?)', ('library/task.md','Searchable evidence.',b'old-vector'))
        con.execute('INSERT INTO terms(rowid,path,text) VALUES (1,?,?)',('library/task.md','Searchable evidence.'))
    engine = Search(vault)
    with pytest.raises(ValueError, match='run reader index'):
        engine.search('Searchable','keyword')
    report = engine.index(False)
    assert report['changed'] == 0, 'metadata upgrade must not rebuild unchanged content'
    with engine.connect() as con:
        assert con.execute('SELECT vector FROM chunks').fetchone()[0] == b'old-vector'
        assert con.execute("SELECT value FROM settings WHERE key='version'").fetchone()[0] == '1'
        assert con.execute("SELECT value FROM settings WHERE key='metadata_index_version'").fetchone()[0] == '1'
    assert engine.search('Searchable','keyword')['results'][0]['metadata']['project'] == 'salesos'
    assert (vault / 'library/task.md').read_bytes() == original


def test_cli_validator_enforces_and_schema_is_available_without_a_vault(vault):
    (vault / 'library/task.md').write_bytes(document(revision='0'))
    cmd = [sys.executable, '-m', 'reader_mcp.cli']
    failed = subprocess.run(cmd + ['--root',str(vault),'validate-metadata','library/task.md'],
                            capture_output=True,text=True,timeout=15)
    assert failed.returncode == 1
    assert json.loads(failed.stdout)['invalid'] == 1
    published = subprocess.run(cmd + ['metadata-schema'],capture_output=True,text=True,check=True,timeout=15)
    assert json.loads(published.stdout)['properties']['document_revision']['minimum'] == 1
    assert 'added' in schema('catalog')['required']


def test_unrelated_receipt_does_not_turn_a_source_into_a_catalog(vault):
    folder = vault / 'library/archive'
    folder.mkdir()
    (folder / 'receipt.json').write_text('{"external_receipt": true}')
    (folder / 'index.md').write_bytes(document(kind='design'))
    result = validate_paths(vault, ['library/archive/index.md'])
    assert result['valid'] is True
    assert result['documents'][0]['metadata_profile'] == 'document'


def test_legacy_sqlite_columns_remain_null(vault):
    (vault / 'library/legacy.md').write_bytes(b'---\ntitle: Legacy\ntype: note\nadded: 2026-10-04\n---\nLegacy content.\n')
    engine = Search(vault)
    engine.index(False)
    with engine.connect() as con:
        row = con.execute('SELECT frontmatter_schema_version, document_revision, metadata_status, metadata FROM docs').fetchone()
        assert tuple(row)[:3] == (None, None, 'legacy'), 'mirror must not invent source version values'
        assert 'document_revision' not in json.loads(row['metadata'])


def test_maximum_sqlite_revision_round_trips(vault):
    (vault / 'library/task.md').write_bytes(document(revision='9223372036854775807'))
    engine = Search(vault)
    engine.index(False)
    with engine.connect() as con:
        assert con.execute('SELECT document_revision FROM docs').fetchone()[0] == 9223372036854775807
    assert engine.read('library/task.md')['metadata']['document_revision'] == 9223372036854775807


def test_new_reader_requires_complete_metadata_marker_and_columns(vault):
    (vault / 'library/task.md').write_bytes(document())
    engine = Search(vault)
    engine.index(False)
    with sqlite3.connect(engine.db) as con:
        con.execute("DELETE FROM settings WHERE key='metadata_index_version'")
    with pytest.raises(ValueError, match='Metadata index incomplete'):
        engine.search('Searchable', 'keyword')
    engine.index(False)
    assert engine.search('Searchable', 'keyword')['results'][0]['metadata']['document_revision'] == 2


def test_legacy_read_layout_remains_available_after_metadata_refresh(vault):
    (vault / 'library/task.md').write_bytes(document())
    engine = Search(vault)
    engine.index(False)
    with sqlite3.connect(engine.db) as legacy:
        # The previous reader checks this version and reads the original columns.
        assert dict(legacy.execute('SELECT key,value FROM settings'))['version'] == '1'
        old = legacy.execute('SELECT path,sha256,metadata,status,size,mtime FROM docs').fetchone()
        assert old[0] == 'library/task.md'
        assert json.loads(old[2])['document_revision'] == 2
        assert legacy.execute('SELECT text FROM chunks WHERE path=?', (old[0],)).fetchone()[0]


def test_malformed_header_encoding_never_becomes_replacement_metadata():
    result = parse_metadata(document().replace(b'title: Example', b'title: Bad \xff'))
    assert result.status == 'invalid'
    assert result.metadata == {}
    assert result.diagnostics[0]['code'] == 'invalid_encoding'


def test_valid_header_ignores_multibyte_body_at_header_scan_boundary():
    from reader_mcp.metadata import MAX_HEADER
    prefix = document()
    data = prefix + b'x' * (MAX_HEADER - len(prefix) - 1) + '😀'.encode()
    result = parse_metadata(data)
    assert result.status == 'valid', result.diagnostics
    assert result.metadata['title'] == 'Example'


def test_yaml_merge_keys_refuse_before_expansion():
    result = parse_metadata(document('base: &base\n  value: 1\nmerged:\n  <<: *base\n'))
    assert result.status == 'invalid'
    assert result.diagnostics[0]['code'] == 'invalid_yaml'
    assert 'not supported' in result.diagnostics[0]['message']


def test_exported_schema_exposes_nonblank_and_calendar_constraints():
    doc = schema()
    assert doc['properties']['title']['pattern'] == r'\S'
    assert doc['properties']['type']['pattern'] == r'\S'
    calendar = schema('catalog')['properties']['added']
    assert calendar['pattern'] == r'^\d{4}-\d{2}-\d{2}$'
    assert calendar['format'] == 'date'


def test_default_validator_includes_uppercase_markdown(vault):
    (vault / 'library/task.MD').write_bytes(document(revision='0'))
    result = validate_paths(vault)
    assert result['examined'] == 1
    assert result['invalid'] == 1
    assert result['documents'][0]['path'] == 'library/task.MD'
