import asyncio
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import numpy as np
import pytest

import reader_mcp
from reader_mcp.search import Search


@pytest.fixture
def vault(tmp_path):
    (tmp_path / 'library').mkdir()
    (tmp_path / 'inbox').mkdir()
    (tmp_path / 'library/architecture.md').write_text('---\ntitle: "Durable journal"\nauthor: Alice\nadded: 2026-10-04\n---\n# Journal\nA journal preserves transactions after a crash.\nThis is a proposal, not a verified implementation.\n')
    (tmp_path / 'library/gardening.txt').write_text('Roses need water and sunlight.\n')
    return tmp_path


def test_keyword_path_contents_fuzzy_and_read(vault):
    engine = Search(vault)
    engine.index(semantic=False)
    for query, mode in [('architecture.md', 'keyword'), ('transactions', 'keyword'), ('transactons', 'fuzzy')]:
        result = engine.search(query, mode)['results'][0]
        assert result['path'] == 'library/architecture.md'
        assert result['metadata']['author'] == 'Alice'
        assert 'not a verified implementation' in result['excerpt']
        read = engine.read(result['path'], expected_sha256=result['sha256'])
        assert 'proposal' in read['text']
        assert read['metadata']['added'] == '2026-10-04'
        json.dumps(read)
    assert engine.search('transactions', 'keyword', path_prefix='library/gardening')['results'] == []
    assert engine.search('zzzzunknown', 'keyword')['results'] == []


def test_refresh_move_delete_and_stale_excerpts(vault):
    engine = Search(vault)
    assert engine.index(False)['changed'] == 2
    assert engine.index(False)['changed'] == 0
    old = engine.search('transactions', 'keyword')['results'][0]
    (vault / old['path']).write_text('Completely revised document about airplanes.')
    result = engine.search('transactions', 'keyword')
    assert result['results'] == [] and result['warnings']
    with pytest.raises(ValueError, match='changed'):
        engine.read(old['path'], expected_sha256=old['sha256'])
    engine.index(False)
    assert engine.search('transactions', 'keyword')['results'] == []
    (vault / old['path']).rename(vault / 'library/moved.md')
    (vault / 'library/gardening.txt').unlink()
    report = engine.index(False)
    assert report['removed'] == 2
    assert engine.search('airplanes', 'keyword')['results'][0]['path'] == 'library/moved.md'


@pytest.mark.parametrize('path', ['../secret', '/etc/passwd', 'library/../../secret', 'inbox/x', 'library/.hidden'])
def test_read_confinement(vault, path):
    with pytest.raises(ValueError):
        Search(vault).read(path)


def test_symlinks_and_unsupported_formats(vault, tmp_path):
    (vault / 'library/escape.md').symlink_to(vault / 'library/gardening.txt')
    (vault / 'library/picture.png').write_bytes(b'not actually a picture')
    engine = Search(vault)
    report = engine.index(False)
    assert len(report['issues']) == 2
    with pytest.raises(ValueError, match='symlink'):
        engine.read('library/escape.md')
    result = engine.search('picture.png', 'keyword')['results'][0]
    assert result['content_status'].startswith('path_only')


class FakeModel:
    """Deterministic vectors test plumbing; they are not semantic-quality evidence."""
    def passage_embed(self, texts, **kwargs):
        for text in texts:
            yield np.array([1, 0] if 'crash' in text else [0, 1], dtype=np.float32)

    def query_embed(self, text):
        yield np.array([1, 0], dtype=np.float32)


def test_semantic_ranking_upgrade_and_hybrid(vault, monkeypatch):
    engine = Search(vault)
    engine.index(False)
    with pytest.raises(ValueError, match='Semantic index missing'):
        engine.search('recover lost work', 'semantic')
    monkeypatch.setattr(engine, 'model', lambda **kw: FakeModel())
    assert engine.index(True)['changed'] == 2
    assert engine.index(True)['changed'] == 0
    for mode in ('semantic', 'hybrid'):
        results = engine.search('recover lost work', mode)['results']
        assert results[0]['path'] == 'library/architecture.md'
        assert 'semantic' in results[0]['matched_by']
    assert engine.index(False)['changed'] == 0


def test_failed_refresh_rolls_back(vault, monkeypatch):
    engine = Search(vault)
    engine.index(False)
    original = (vault / 'library/architecture.md').read_bytes()
    (vault / 'library/architecture.md').write_text('changed')
    class BrokenModel:
        def passage_embed(self, texts, **kwargs):
            raise RuntimeError('embedding failure')
    monkeypatch.setattr(engine, 'model', lambda **kw: BrokenModel())
    with pytest.raises(RuntimeError, match='embedding failure'):
        engine.index(True)
    (vault / 'library/architecture.md').write_bytes(original)
    assert engine.search('transactions', 'keyword')['results']


def test_cli_and_mcp_from_external_cwd(vault, tmp_path):
    Search(vault).index(False)
    cmd = [sys.executable, '-m', 'reader_mcp.cli', '--root', str(vault)]
    result = subprocess.run(cmd + ['search', 'transactons', '--mode', 'fuzzy'],
        capture_output=True, text=True, check=True, cwd=tmp_path, timeout=30)
    assert json.loads(result.stdout)['results'][0]['path'] == 'library/architecture.md'
    async def exercise():
        async with stdio_client(StdioServerParameters(command=cmd[0], args=cmd[1:] + ['serve'], cwd=str(tmp_path),
                env={'PYTHONPATH': str(Path(reader_mcp.__file__).resolve().parents[1])})) as (read, write):
            async with ClientSession(read, write) as client:
                await client.initialize()
                result = await client.call_tool('reader_search', {'query': 'transactions', 'mode': 'keyword'})
                assert not result.isError
                doc = json.loads(result.content[0].text)['results'][0]
                result = await client.call_tool('reader_read', {'path': doc['path'], 'expected_sha256': doc['sha256']})
                assert not result.isError
                assert 'proposal' in json.loads(result.content[0].text)['text']
                bad = await client.call_tool('reader_read', {'path': '../secret'})
                assert bad.isError
    asyncio.run(exercise())


def test_pdf_coordinates_and_read(vault):
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    writer = PdfWriter()
    for text in ('First page about gardening.', 'Second page describes disaster recovery.'):
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
            NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):
            DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 50 700 Td ({text}) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    with (vault / 'library/test.pdf').open('wb') as output:
        writer.write(output)
    engine = Search(vault)
    engine.index(False)
    result = engine.search('disaster', 'keyword')['results'][0]
    assert result['path'] == 'library/test.pdf' and result['page'] == 2
    assert 'disaster recovery' in engine.read(result['path'], page=2)['text']
    with pytest.raises(ValueError, match='page out of range'):
        engine.read(result['path'], page=3)


def test_chunking_long_lines_and_duplicates(vault):
    from reader_mcp.search import chunks
    text = 'a' * 1300 + '\nneedle\n' + 'z' * 1300
    parts = list(chunks([(None, text)]))
    assert all(len(p[3]) <= 1200 for p in parts)
    assert any('needle' in p[3] for p in parts)
    for name in ('first.md', 'second.md'):
        (vault / 'library' / name).write_text('identical document with unicorns')
    engine = Search(vault)
    engine.index(False)
    results = engine.search('unicorns', 'keyword')['results']
    assert len(results) == 2 and results[0]['sha256'] == results[1]['sha256']


def test_guarded_cli_index_and_preflight_refusal(vault, monkeypatch):
    from reader_mcp.search_guard import run_index
    report = run_index(vault, semantic=False)
    assert report['documents'] == 2
    contract = json.loads((vault / '.reader/search-runtime/launch.json').read_text())
    assert contract['exit_code'] == 0 and contract['final_data_bytes'] > 0
    import reader_mcp.search_guard as guard
    from collections import namedtuple
    Disk = namedtuple('Disk', 'total used free')
    monkeypatch.setattr(guard.shutil, 'disk_usage', lambda _: Disk(1, 1, 0))
    with pytest.raises(ValueError, match='preflight refused'):
        run_index(vault, semantic=False)


def test_guard_stops_worker_on_monitor_failure(vault, monkeypatch):
    import reader_mcp.search_guard as guard
    original = guard.subprocess.check_output
    def fail(*args, **kwargs):
        raise OSError('simulated monitoring failure')
    monkeypatch.setattr(guard.subprocess, 'check_output', fail)
    with pytest.raises(OSError, match='monitoring failure'):
        guard.run_index(vault, semantic=False)
    contract = json.loads((vault / '.reader/search-runtime/launch.json').read_text())
    assert contract['exit_code'] is not None
    import os
    with pytest.raises(ProcessLookupError):
        os.killpg(contract['process_group'], 0)


def test_long_document_does_not_exclude_other_results(vault, monkeypatch):
    (vault / 'library/long.md').write_text(('crash recovery ' * 100) * 200)
    engine = Search(vault)
    monkeypatch.setattr(engine, 'model', lambda **kw: FakeModel())
    engine.index(True)
    for mode in ('semantic', 'fuzzy'):
        results = engine.search('crash', mode, limit=10)['results']
        assert 'library/architecture.md' in {r['path'] for r in results}
        assert 'library/long.md' in {r['path'] for r in results}
        assert len({r['path'] for r in results}) == len(results)


def test_cyclic_frontmatter_does_not_break_index(vault):
    (vault / 'library/cyclic.md').write_text('---\ntitle: Loops\ntags: &cycle [*cycle]\n---\nA searchable discussion of recursion.\n')
    engine = Search(vault)
    engine.index(False)
    result = engine.search('recursion', 'keyword')['results'][0]
    assert result['metadata'] == {}  # Shared codec refuses the entire alias header.
    assert 'recursion' in engine.read(result['path'])['text']


def test_interrupted_index_reuses_completed_embedding_batches(vault):
    class ResumableModel(FakeModel):
        def __init__(self, fail):
            self.calls, self.fail = 0, fail
        def passage_embed(self, texts, **kwargs):
            self.calls += 1
            if self.fail and self.calls == 2:
                raise RuntimeError('interrupted after a completed batch')
            return super().passage_embed(texts, **kwargs)
    engine = Search(vault)
    engine._model = ResumableModel(True)
    with pytest.raises(RuntimeError, match='interrupted'):
        engine.index(True)
    with pytest.raises(ValueError, match='incomplete'):
        engine.search('transactions', 'keyword')
    restarted = Search(vault)
    restarted._model = ResumableModel(False)
    assert restarted.index(True)['documents'] == 2
    assert restarted._model.calls == 1  # The first document survived only in the reusable cache.
    assert restarted.search('recover work', 'semantic')['results'][0]['path'] == 'library/architecture.md'


def test_changed_model_files_require_vector_refresh(vault):
    engine = Search(vault)
    engine._model = FakeModel()
    engine.index(True)
    (vault / '.reader/models').mkdir()
    (vault / '.reader/models/config.json').write_text('{"changed": true}')
    changed = Search(vault)
    changed._model = FakeModel()
    with pytest.raises(ValueError, match='model files changed'):
        changed.search('recovery', 'semantic')
    assert changed.index(True)['changed'] == 2
    assert changed.search('recovery', 'semantic')['results']


def test_search_reads_published_index_during_refresh_transaction(vault):
    engine = Search(vault)
    engine.index(False)
    with engine.connect(create=True) as writer:
        writer.execute('BEGIN EXCLUSIVE')
        writer.execute('DELETE FROM terms')
        writer.execute('DELETE FROM chunks')
        # A separate connection still sees the last completed snapshot.
        assert Search(vault).search('transactions', 'keyword')['results']
        writer.rollback()


def test_query_connection_keeps_one_snapshot_across_refresh(vault):
    engine = Search(vault)
    engine.index(False)
    with engine.connect() as reader:
        assert reader.execute('SELECT count(*) FROM docs').fetchone()[0] == 2
        (vault / 'library/new.txt').write_text('An additional document.')
        engine.index(False)
        assert reader.execute('SELECT count(*) FROM docs').fetchone()[0] == 2
    with engine.connect() as reader:
        assert reader.execute('SELECT count(*) FROM docs').fetchone()[0] == 3


@pytest.mark.parametrize('name', ['LICENSE', 'CITATION.cff', 'evidence.log', 'helper.mjs'])
def test_archival_text_formats_are_content_searchable(vault, name):
    (vault / 'library' / name).write_text('distinctive archival testimony')
    engine = Search(vault)
    engine.index(False)
    result = engine.search('testimony', 'keyword')['results'][0]
    assert result['path'] == 'library/' + name
    assert result['content_status'] == 'text'


def test_reading_material_ranks_above_administrative_receipts(vault):
    (vault / 'library/receipt.json').write_text('{"title": "crash recovery"}')
    class RankedModel(FakeModel):
        def passage_embed(self, texts, **kwargs):
            for text in texts:
                if 'receipt.json' in text:
                    yield np.array([1, 0], dtype=np.float32)
                elif 'crash' in text:
                    yield np.array([0.9, 0.1], dtype=np.float32)
                else:
                    yield np.array([0, 1], dtype=np.float32)
    engine = Search(vault)
    engine._model = RankedModel()
    engine.index(True)
    assert engine.search('recover work', 'semantic')['results'][0]['path'] == 'library/architecture.md'
    assert engine.search('receipt.json', 'semantic')['results'][0]['path'] == 'library/receipt.json'
