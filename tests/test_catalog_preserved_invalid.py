import hashlib
import json

import pytest

from reader_mcp.catalog import Catalog


@pytest.mark.parametrize('header', [
    'frontmatter_schema_version: 1\ndocument_revision: 1\ntitle: Source\n',
    'frontmatter_schema_version: 1\ndocument_revision: 1\ntitle: Source\ntype: report\ndocument_id: source-owned-name\n',
])
def test_receipted_invalid_header_gets_independent_catalog_owner(tmp_path, header):
    bundle = tmp_path / 'library/archive'
    bundle.mkdir(parents=True)
    source = ('---\n' + header + '---\n# Preserved source\n').encode()
    (bundle / 'report.md').write_bytes(source)
    (bundle / 'receipt.json').write_text(json.dumps({'files': [
        {'path': 'report.md', 'sha256': hashlib.sha256(source).hexdigest()}]}))
    catalog = Catalog(tmp_path)
    catalog.run('migrate')
    assert catalog.run('check')['status'] == 'valid'
    assert (bundle / 'report.md').read_bytes() == source
    owner = tmp_path / 'catalog/metadata/archive/report.md.md'
    assert owner.exists()
    assert ('original_metadata_diagnostics:' in owner.read_text()
            or 'original_frontmatter:' in owner.read_text())
    assert catalog.run('plan')['planned_writes'] == 0


def test_unprotected_invalid_header_still_refuses(tmp_path):
    (tmp_path / 'library').mkdir()
    (tmp_path / 'library/index.md').write_text(
        '---\nfrontmatter_schema_version: 1\ndocument_revision: 1\ntitle: Invalid\n---\n')
    with pytest.raises(ValueError):
        Catalog(tmp_path).run('migrate')
