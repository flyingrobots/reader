"""Operating-system metadata files are not library content in any inventory."""
import json

import pytest

from reader_mcp.browse import Browse
from reader_mcp.catalog import Catalog
from reader_mcp.inbox_runner import inventory as inbox_inventory
from reader_mcp.junk import os_junk
from reader_mcp.maintenance import Maintenance
from reader_mcp.metadata import validate_paths
from reader_mcp.search import Search

JUNK = ['.DS_Store', 'Thumbs.db', 'thumbs.db', 'desktop.ini', 'Desktop.ini', '._note.md', '._Icon']


@pytest.fixture
def vault(tmp_path):
    for folder in ('library/shelf', 'inbox/drop'):
        (tmp_path / folder).mkdir(parents=True)
    (tmp_path / 'library/note.md').write_text('---\ntitle: Notes\ntype: note\nadded: 2026-10-03\n---\n\n# A note\nQuiet ledgers.\n')
    (tmp_path / 'inbox/drop/arrival.md').write_text('# Arrival\n')
    for folder in ('library', 'library/shelf', 'inbox', 'inbox/drop'):
        for name in JUNK:
            (tmp_path / folder / name).write_bytes(b'\x00\x01junk')
    return tmp_path


def test_names():
    assert all(os_junk(name) for name in JUNK)
    for name in ('note.md', '.hidden', 'DS_Store', 'thumbs.db.md', 'my._file.md', 'desktop.ini.txt'):
        assert not os_junk(name)


def test_catalog_inventory_and_check_ignore_os_junk(vault):
    catalog = Catalog(vault)
    assert list(catalog.inventory()) == ['library/note.md']
    catalog.run('migrate')
    assert catalog.run('check')['documents'] == 1


def test_search_browse_maintenance_metadata_and_inbox_ignore_os_junk(vault):
    assert Search(vault).index(False)['changed'] == 1
    assert list(Maintenance(vault).library_files()) == ['library/note.md']
    assert list(Browse(vault).scan()) == ['library/note.md']
    assert [e['path'] for e in validate_paths(vault)['documents']] == ['library/note.md']
    assert inbox_inventory(vault) == ['inbox/drop/arrival.md']
    json.dumps(Browse(vault).inventory({}))
