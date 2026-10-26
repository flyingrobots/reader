"""RW-25: content types, passage deduplication, float16 vectors, budgets, resumable runs, format 1 retirement,
and quiet PDF warnings. Synthetic vaults only; the fake embedders count calls and never download."""
import io
import json
import sqlite3
from contextlib import closing

import numpy as np
import pytest

from reader_mcp import search as search_module  # noqa: E402
from reader_mcp.search import CONTENT_TYPES, MACHINE, Search, edition_rank, pack, unpack  # noqa: E402

WORDS = ['journal', 'crash', 'garden', 'ledger', 'river', 'proof', 'lattice', 'archive']


class CountingModel:
    """Deterministic bag-of-words vectors; counts every passage it is asked to embed."""
    def __init__(self):
        self.calls, self.texts = 0, 0

    @staticmethod
    def vector(text):
        lowered = text.casefold()
        return np.array([lowered.count(w) + 0.01 * (i + 1) for i, w in enumerate(WORDS)], dtype=np.float32)

    def passage_embed(self, texts, **kwargs):
        self.calls += 1
        self.texts += len(texts)
        for text in texts:
            yield self.vector(text)

    def query_embed(self, text):
        yield self.vector(text)


def configure(vault, **search):
    (vault / 'indexes').mkdir(exist_ok=True)
    (vault / 'indexes/settings.json').write_text(json.dumps({'search': search}))


def broken_cmap_pdf(words='a damaged lattice map'):
    """A real PDF whose ToUnicode map has odd-length hex strings, as in the user's library."""
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    cmap = DecodedStreamObject()
    cmap.set_data(b'/CIDInit /ProcSet findresource begin\nbegincmap\n1 begincodespacerange\n<00> <FF>\n'
                  b'endcodespacerange\n2 beginbfrange\n<41> <42> <1d546>\n<1626   162c   1ee6c>\nendbfrange\n'
                  b'2 beginbfchar\n<45> <1ee24>\n<46> <0046>\nendbfchar\nendcmap\n')
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
                             NameObject('/BaseFont'): NameObject('/Helvetica'), NameObject('/ToUnicode'): writer._add_object(cmap)})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(f'BT /F1 12 Tf 20 200 Td (ABEF {words}) Tj ET'.encode())
    page[NameObject('/Contents')] = writer._add_object(stream)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@pytest.fixture
def vault(tmp_path):
    (tmp_path / 'library/notes').mkdir(parents=True)
    (tmp_path / 'inbox').mkdir()
    (tmp_path / 'library/journal.md').write_text('# Journal\n\nA journal survives a crash. The journal is replayed.\n')
    (tmp_path / 'library/garden.txt').write_text('A garden by the river needs patience.\n')
    (tmp_path / 'library/notes/ledger.md').write_text('# Ledger\n\nThe ledger keeps an archive of proof.\n')
    (tmp_path / 'library/notes/receipt.json').write_text('{"ledger": "machine record about a crash"}')
    (tmp_path / 'library/notes/tool.rs').write_text('fn main() { println!("lattice crash"); }\n')
    (tmp_path / 'library/notes/run.log').write_text('lattice run complete\n')
    return tmp_path


def db(vault):
    con = sqlite3.connect(vault / '.reader/search.v2.sqlite3')
    con.row_factory = sqlite3.Row
    return con


def test_machine_files_are_path_only_by_default_and_content_indexed_when_configured(vault):
    engine = Search(vault)
    report = engine.index(False)
    assert report['path_only_machine'] == 3 and report['issues'] == []
    with db(vault) as con:
        statuses = dict(con.execute('SELECT path, status FROM docs'))
    assert statuses['library/notes/receipt.json'] == MACHINE and statuses['library/journal.md'] == 'text'
    assert engine.search('lattice', 'keyword')['results'] == []
    # Still findable by path, in keyword and fuzzy search.
    assert engine.search('tool.rs', 'keyword')['results'][0]['path'] == 'library/notes/tool.rs'
    assert engine.search('receipt', 'fuzzy')['results'][0]['path'] == 'library/notes/receipt.json'
    configure(vault, content_types=[*CONTENT_TYPES, '.rs', '.log'])
    report = Search(vault).index(False)
    assert report['changed'] == 2 and report['path_only_machine'] == 1
    assert {r['path'] for r in engine.search('lattice', 'keyword')['results']} == {'library/notes/tool.rs', 'library/notes/run.log'}
    configure(vault)  # Back to the defaults: their passages are dropped again.
    assert Search(vault).index(False)['changed'] == 2
    assert engine.search('lattice', 'keyword')['results'] == []


@pytest.mark.parametrize('search, message', [
    ({'content_types': ['.png']}, 'cannot be read as text'),
    ({'max_passages': 0}, 'search.max_passages must be an integer'),
    ({'max_database_mib': 3000, 'max_cache_mib': 1024}, '3,584 MiB'),
    ({'surprise': 1}, 'Unknown search settings'),
])
def test_invalid_settings_are_refused_by_name(vault, search, message):
    configure(vault, **search)
    with pytest.raises(ValueError, match=message):
        Search(vault).index(False)


def test_identical_text_is_stored_once_and_both_paths_resolve(vault):
    body = '# Report\n\nThe archive of proof is a ledger of every crash.\n'
    (vault / 'library/report.md').write_text(body)
    (vault / 'library/report.reading.md').write_text(body)
    (vault / 'library/original').mkdir()
    (vault / 'library/original/report.md').write_text(body)
    engine = Search(vault)
    engine._model = CountingModel()
    engine.index(True)
    with db(vault) as con:
        holders = con.execute('SELECT passage_id, count(*) FROM chunks WHERE path LIKE ? GROUP BY passage_id',
                              ('%report%',)).fetchall()
        assert len(holders) == 1 and holders[0][1] == 3
        assert con.execute('SELECT count(*) FROM passages').fetchone()[0] == con.execute(
            'SELECT count(DISTINCT passage_id) FROM chunks WHERE passage_id IS NOT NULL').fetchone()[0]
    # One passage, embedded once.
    assert engine._model.texts == 3 + 1  # journal, garden, ledger, and the shared report passage
    keyword = {r['path'] for r in engine.search('archive proof', 'keyword')['results']}
    assert {'library/report.md', 'library/report.reading.md', 'library/original/report.md'} <= keyword
    for path in keyword:
        assert 'archive of proof' in engine.read(path)['text']
    semantic = [r['path'] for r in engine.search('archive proof ledger', 'semantic')['results']]
    assert 'library/report.reading.md' in semantic
    assert 'library/report.md' not in semantic and 'library/original/report.md' not in semantic
    every = [r['path'] for r in engine.search('archive proof ledger', 'semantic', editions='all')['results']]
    assert {'library/report.md', 'library/report.reading.md', 'library/original/report.md'} <= set(every)
    assert sorted(['library/original/report.md', 'library/report.md', 'library/report.reading.md'],
                  key=edition_rank)[0] == 'library/report.reading.md'
    # Removing one edition keeps the shared passage; removing all of them collects it.
    (vault / 'library/report.md').unlink()
    engine.index(True)
    assert engine.search('archive proof', 'keyword')['results']
    (vault / 'library/report.reading.md').unlink()
    (vault / 'library/original/report.md').unlink()
    engine.index(True)
    assert engine.search('archive proof', 'keyword')['results'][0]['path'] == 'library/notes/ledger.md'
    with db(vault) as con:
        assert Search.validate(con) == []


def overlap_at_10(matrix, queries, quantized):
    def top(m, q):
        unit = m / np.linalg.norm(m, axis=1, keepdims=True)
        return np.argsort(-(unit @ (q / np.linalg.norm(q))), kind='stable')[:10]
    return float(np.mean([len(set(top(matrix, q)) & set(top(quantized, q))) / 10 for q in queries]))


def test_float16_ranking_agrees_with_float32():
    rng = np.random.default_rng(25)
    # Clustered unit vectors with near neighbours, the hard case for quantization (384 = bge-small).
    centres = rng.normal(size=(40, 384))
    matrix = np.concatenate([c + rng.normal(scale=0.35, size=(100, 384)) for c in centres]).astype(np.float32)
    matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
    queries = [centres[i % 40] + rng.normal(scale=0.5, size=384) for i in range(200)]
    quantized = np.stack([unpack(pack(v)) for v in matrix])
    assert quantized.dtype == np.float32 and len(pack(matrix[0])) == 768
    assert overlap_at_10(matrix, queries, quantized) >= 0.99


def test_exceeding_max_passages_refuses_by_setting_and_keeps_completed_files(vault):
    configure(vault, max_passages=2)
    engine = Search(vault)
    with pytest.raises(ValueError, match=r'more than 2 passages \(indexes/settings.json search.max_passages\); 2 passages saved'):
        engine.index(False)
    result = engine.search('garden', 'keyword')
    assert result['results'] and result['complete'] is False
    configure(vault, max_passages=100)
    assert Search(vault).index(False)['complete'] is True


def test_database_budget_breach_names_its_setting(vault, monkeypatch):
    engine = Search(vault)
    def full(path, ctx):
        raise sqlite3.OperationalError('database or disk is full')
    monkeypatch.setattr(engine, '_refresh', full)
    with pytest.raises(ValueError, match='search.max_database_mib'):
        engine.index(False)


def test_timeout_publishes_completed_batches_and_next_run_resumes(vault, monkeypatch):
    clock = iter(range(1000))
    monkeypatch.setattr(search_module.time, 'time', lambda: next(clock))
    monkeypatch.setattr(search_module, 'BATCH_PATHS', 1)
    engine = Search(vault)
    engine._model = CountingModel()
    report = engine.index(True, deadline=2)  # garden.txt and journal.md, then the clock runs out
    assert report['complete'] is False and report['stopped'] == 'time limit' and report['changed'] == 2
    assert report['message'] == f'Stopped at the time limit; {report["passages"]:,} passages saved. Run again to continue.'
    first = engine._model.texts
    partial = engine.search('journal crash', 'keyword')
    assert partial['results'] and any('stopped before finishing' in w for w in partial['warnings'])
    from reader_mcp.maintenance import Maintenance
    check = Maintenance(vault).search_check()
    assert check['state'] == 'partial' and 'Run again to continue' in check['message']
    monkeypatch.setattr(search_module.time, 'time', lambda: 0)
    resumed = Search(vault)
    resumed._model = engine._model
    report = resumed.index(True)
    assert report['complete'] is True and report['changed'] == 4  # only the files the first run did not reach
    assert engine._model.texts == first + 1  # ledger.md; nothing already saved is embedded again
    assert not any('stopped' in w for w in resumed.search('journal', 'keyword')['warnings'])


def format_1(vault):
    """A format 1 index file as older Reader processes left it (`.reader/search.sqlite3`): settings, docs and
    chunks with float32 vectors. Format 1 is retired (#9), so nothing reads it; only the explicit removal job touches it."""
    path = vault / '.reader/search.sqlite3'
    path.parent.mkdir(exist_ok=True)
    with closing(sqlite3.connect(path)) as con, con:
        con.executescript('''
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE docs (path TEXT PRIMARY KEY, sha256 TEXT, metadata TEXT, status TEXT, size INTEGER, mtime INTEGER,
                               frontmatter_schema_version INTEGER, document_revision INTEGER, metadata_status TEXT,
                               metadata_profile TEXT, metadata_diagnostics TEXT);
            CREATE TABLE chunks (id INTEGER PRIMARY KEY, path TEXT, page INTEGER, start_line INTEGER, end_line INTEGER, text TEXT, vector BLOB);
            CREATE VIRTUAL TABLE terms USING fts5(path, text, tokenize='unicode61');
        ''')
        con.executemany('INSERT INTO settings VALUES (?,?)', [('version', '1'), ('metadata_index_version', '1'),
                                                               ('embedding_signature', 'counting'), ('indexed_at', '2026-10-01T00:00:00Z')])
        text = 'A journal survives a crash. The journal is replayed.'
        con.execute("INSERT INTO docs VALUES ('library/journal.md','x','{}','text',1,0,NULL,NULL,'none','document','[]')")
        con.execute('INSERT INTO chunks VALUES (1,?,NULL,1,3,?,?)', ('library/journal.md', text, CountingModel.vector(text).tobytes()))
        con.execute('INSERT INTO terms(rowid,path,text) VALUES (1,?,?)', ('library/journal.md', text))
    return path


def fingerprint(path):
    import hashlib
    # The shared-memory index (-shm) is touched by any WAL reader; the data is the file and its WAL.
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(path.parent.glob(path.name + '*'))
            if not p.name.endswith('-shm')}


def test_format_1_alone_is_not_read_and_asks_for_a_rebuild(vault):
    """#9: format 1 is retired. A vault with only the old index gets a clear rebuild state, never format 1 results."""
    import importlib.util
    from reader_mcp.maintenance import Maintenance
    from reader_mcp.related import Related
    v1 = format_1(vault)
    untouched = fingerprint(v1)
    engine = Search(vault)
    engine._model = CountingModel()
    for query in (lambda: engine.search('journal crash', 'keyword'), lambda: engine.passages('journal crash', 'keyword', 10)):
        with pytest.raises(ValueError, match=r'no longer reads the format 1 index.*run reader index'):
            query()
    assert Related(vault).vectors({'library/journal.md'}) == {}
    check = Maintenance(vault).search_check()
    assert check['state'] == 'missing' and 'Rebuild the search index' in check['message'] and 'format 1' in check['message']
    assert check['legacy'] == {'format': 1, 'bytes': check['legacy']['bytes'], 'removable': True} and check['legacy']['bytes'] > 0
    assert fingerprint(v1) == untouched and not engine.db.exists()
    assert importlib.util.find_spec('reader_mcp.search_legacy') is None


def test_a_format_2_build_ignores_format_1(vault, monkeypatch):
    v1 = format_1(vault)
    untouched = fingerprint(v1)
    clock = iter(range(1000))
    monkeypatch.setattr(search_module.time, 'time', lambda: next(clock))
    engine = Search(vault)
    engine._model = CountingModel()
    engine._signature = 'counting'
    first = engine.index(True, deadline=2)
    assert first['complete'] is False and 'seeded_from_legacy' not in first
    # A stopped first build serves what it saved, with the usual warning, rather than format 1.
    partial = engine.search('journal crash', 'keyword')
    assert partial['results'] and 'format' not in partial and any('stopped before finishing' in w for w in partial['warnings'])
    monkeypatch.setattr(search_module.time, 'time', lambda: 0)
    report = engine.index(True)
    assert report['complete'] and report['embedded'] + first['embedded'] > 0, 'vectors come from the cache or the model, never format 1'
    assert fingerprint(v1) == untouched, 'the format 1 index is never written'
    with db(vault) as con:
        assert con.execute("SELECT value FROM settings WHERE key='validated'").fetchone()[0] == '1'
        assert Search.validate(con) == []


def test_legacy_index_is_removed_only_on_request_and_never_while_busy(vault):
    import fcntl
    from reader_mcp.maintenance import Maintenance
    format_1(vault)
    m = Maintenance(vault)
    assert m.search_check()['legacy']['removable'] is True, 'nothing reads format 1, so it is removable even before a rebuild'
    with (vault / '.reader/search.lock').open('a') as held:  # an index run holds this
        fcntl.flock(held, fcntl.LOCK_EX)
        with pytest.raises(ValueError, match='holds .reader/search.lock'):
            m.remove_legacy_search()
    assert (vault / '.reader/search.sqlite3').is_file()
    writer = sqlite3.connect(vault / '.reader/search.sqlite3')
    writer.execute('BEGIN EXCLUSIVE')  # an older process mid-write
    with pytest.raises(ValueError, match='Another Reader process'):
        m.remove_legacy_search()
    writer.rollback(); writer.close()
    result = m.remove_legacy_search()
    assert result['freed_bytes'] > 0 and not list((vault / '.reader').glob('search.sqlite3*'))
    check = m.search_check()
    assert 'legacy' not in check and check['state'] == 'missing'
    with pytest.raises(ValueError, match='no legacy search index'):
        m.remove_legacy_search()


def test_pdf_text_map_warnings_are_counted_not_printed(vault, capfd):
    data = broken_cmap_pdf()
    (vault / 'library/damaged.pdf').write_bytes(data)
    counts = {}
    sections, _ = search_module.extract('library/damaged.pdf', data, counts)
    assert 'lattice' in sections[0][1] and counts['library/damaged.pdf'] >= 3
    assert capfd.readouterr().err == ''
    engine = Search(vault)
    report = engine.index(False)
    assert report['pdf_warnings']['files'] == 1 and report['pdf_warnings']['messages'] >= 3
    assert report['pdf_warnings']['examples'] == ['library/damaged.pdf']
    err = capfd.readouterr().err
    assert 'Skipping broken line' not in err and 'invalid hex' not in err
    assert err.count('\n') == 1 and 'PDF text-map warnings in 1 files' in err
    assert engine.search('lattice', 'keyword')['results'][0]['path'] == 'library/damaged.pdf'


def test_guard_surfaces_the_last_meaningful_error_not_the_log_tail(vault):
    from reader_mcp.search_guard import failure_line, run_index
    noise = '\n'.join(["Skipping broken line b'1626   162c   1ee6c': Odd-length string"] * 500
                      + ["Got invalid hex string: Odd-length string (b'1d546')"] * 50)
    log = noise + '\nReader: Index exceeds 100,000 chunks; narrow the library before retrying\n' + noise
    assert failure_line(log) == 'Index exceeds 100,000 chunks; narrow the library before retrying'
    assert failure_line(noise + '\nRuntimeError: model crashed\n' + noise) == 'RuntimeError: model crashed'
    for index in range(30):  # Real worker: broken PDFs plus a passage budget breach.
        (vault / f'library/damaged-{index}.pdf').write_bytes(broken_cmap_pdf(f'damaged map number {index}'))
    configure(vault, max_passages=5)
    with pytest.raises(ValueError) as caught:
        run_index(vault, semantic=False)
    message = str(caught.value)
    assert message.startswith('Search index would hold more than 5 passages (indexes/settings.json search.max_passages)')
    assert 'Skipping broken line' not in message and 'stderr.log' in message
    log = (vault / '.reader/search-runtime/stderr.log').read_text()
    assert 'Skipping broken line' not in log


def test_a_fresh_search_reads_its_budgets_before_any_build(tmp_path):
    (tmp_path / 'library').mkdir()
    from reader_mcp.search import Search as Fresh
    engine = Fresh(tmp_path)
    assert engine.limits and engine._vectors is None, 'budgets load lazily on a Search that has not indexed'
