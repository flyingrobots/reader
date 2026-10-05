"""Real wide-md integration: formatting, provenance, refusal and receipt preservation."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest

from reader_mcp.metadata import frontmatter
from reader_mcp.reading import reading_copy
from reader_mcp.store import Store, Submission

PROJECT = Path(__file__).resolve().parents[1]
TOOLING = PROJECT / '.reader/tooling'


@pytest.fixture
def vault(tmp_path):
    if not (TOOLING / 'installed.json').exists():
        pytest.skip('Run python3 scripts/install_wide_md.py for real formatter integration tests')
    (tmp_path / 'library').mkdir()
    (tmp_path / 'inbox').mkdir()
    tools = tmp_path / '.reader/tooling'
    (tools / 'bin').mkdir(parents=True)
    (tools / 'bin/wide-md').symlink_to(TOOLING / 'bin/wide-md')
    (tools / 'installed.json').write_bytes((TOOLING / 'installed.json').read_bytes())
    return tmp_path


def test_receipted_markdown_cli_unwraps_without_changing_original_or_links(vault):
    store = Store(vault)
    text = ('---\ntitle: Example\nauthor: Source Author\n---\n\n# Example\n\n'
            'A wrapped paragraph with\n[an image](assets/image.svg).\n\n'
            'An explicit break  \nstays on two lines.\n\n'
            '```text\nkeep\nthese\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n')
    request = Submission(request_id=uuid4(),title='Example',filename='report.md',markdown=text)
    receipt = store.ingest(request)
    source_dir = vault / receipt['bundle_path']
    filed = vault / 'library/example'
    source_dir.rename(filed)
    receipt_before = (filed / 'receipt.json').read_bytes()
    source = filed / 'report.md'
    command = [sys.executable,'-m','reader_mcp.cli','--root',str(vault),'reading-copy','library/example/report.md']
    run = subprocess.run(command,capture_output=True,text=True)
    assert run.returncode == 0,run.stderr
    result = json.loads(run.stdout)
    assert result['status'] == 'created'
    output = vault / result['reading_copy']
    metadata, body = frontmatter(output.read_bytes())
    assert b'A wrapped paragraph with [an image](assets/image.svg).' in body
    assert b'An explicit break  \nstays on two lines.' in body
    assert b'```text\nkeep\nthese\n```' in body
    assert b'| A | B |\n| - | - |\n| 1 | 2 |' in body
    assert output.parent == source.parent
    assert metadata['reading_source_sha256'] == hashlib.sha256(text.encode()).hexdigest()
    assert metadata['author'] == 'Source Author'
    assert metadata['original_metadata'] == {'title':'Example','author':'Source Author'}
    assert source.read_bytes() == text.encode()
    assert (filed / 'receipt.json').read_bytes() == receipt_before
    assert store.status(str(request.request_id))['integrity'] == 'intact'
    assert reading_copy(vault,'library/example/report.md')['status'] == 'existing'
    before = output.read_bytes()
    source.write_text('A different\nparagraph.\n')
    with pytest.raises(ValueError,match='already exists'):
        reading_copy(vault,'library/example/report.md')
    assert output.read_bytes() == before


def test_refused_dialect_publishes_nothing(vault):
    source = vault / 'library/directive.md'
    source.write_text(':::note\nwrapped\nwords\n:::\n')
    with pytest.raises(ValueError,match='refused'):
        reading_copy(vault,'library/directive.md')
    assert not source.with_name('directive.reading.md').exists()
    with pytest.raises(ValueError,match='MDX'):
        reading_copy(vault,'library/example.mdx')


def test_noop_missing_tool_and_unsafe_source(vault):
    source = vault / 'library/plain.md';source.write_text('One paragraph.\n')
    assert reading_copy(vault,'library/plain.md')['status'] == 'unchanged'
    assert not (vault / 'library/plain.reading.md').exists()
    with pytest.raises(ValueError,match='explicit library'):
        reading_copy(vault,'library/../inbox/plain.md')
    link = vault / 'library/link.md';link.symlink_to(source)
    with pytest.raises(ValueError,match='symlink'):
        reading_copy(vault,'library/link.md')
    (vault / '.reader/tooling/installed.json').unlink()
    with pytest.raises(ValueError,match='Install wide-md'):
        reading_copy(vault,'library/plain.md')


def test_parent_width_configuration_does_not_rewrap(vault):
    (vault / '.wide-md.toml').write_text('width = 10\n')
    (vault / 'library/wrapped.md').write_text('Several words on the first line\nand several more words on the second.\n')
    result = reading_copy(vault,'library/wrapped.md')
    _,body = frontmatter((vault / result['reading_copy']).read_bytes())
    assert b'Several words on the first line and several more words on the second.\n' in body
