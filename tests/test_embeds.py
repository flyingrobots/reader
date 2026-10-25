"""Obsidian embeds: the shared conformance corpus (also run by tests/embeds.test.mjs) and /api/embeds."""
import json
from pathlib import Path
import time

import pytest

from reader_mcp import embeds
from reader_mcp.links import extract
from reader_mcp.web import WebLibrary

CORPUS = json.loads((Path(__file__).parent / 'fixtures/transclusion/corpus.json').read_text())


@pytest.fixture
def vault(tmp_path):
    for name in ('library', 'inbox', 'indexes'):
        (tmp_path / name).mkdir()
    for path, text in CORPUS['files'].items():
        file = tmp_path / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)
    return tmp_path


@pytest.mark.parametrize('case', CORPUS['parse'], ids=lambda c: c['raw'])
def test_parse_matches_the_corpus(case):
    parsed = embeds.parse(case['raw'])
    assert {k: parsed[k] for k in case['expect']} == case['expect']


@pytest.mark.parametrize('case', CORPUS['scan'], ids=lambda c: c['text'][:24])
def test_scan_finds_embeds_outside_code(case):
    assert embeds.scan(case['text']) == case['expect']


@pytest.mark.parametrize('case', CORPUS['fragments'], ids=lambda c: c['fragment'] or '(whole)')
def test_fragment_ranges_match_the_corpus(case):
    text = CORPUS['files'][case['file']]
    span = embeds.fragment_range(text, case['fragment'])
    assert (None if span is None else text[span[0]:span[1]]) == case['expect']


def test_offsets_are_code_points():
    text = '# 🐈 Cat\n\nA 🐈 line. ^cat\n'
    start, end = embeds.fragment_range(text, '^cat')
    assert text[start:end] == 'A 🐈 line. ^cat'  # Python indexes code points, as the annotation API does


def walk(node):
    """Statuses down the first-child chain."""
    chain = [node['status']]
    while node['children']:
        node = node['children'][0]
        chain.append(node['status'])
    return chain


@pytest.mark.parametrize('case', CORPUS['tree'], ids=lambda c: c['raw'])
def test_tree_statuses_match_the_corpus(vault, case):
    library = WebLibrary(vault)
    try:
        result = library.embeds(case['from'], [case['raw']], [case['from'] + '#'])
    finally:
        library.close()
    node = result['nodes'][0]
    expect = dict(case['expect'])
    if 'chain' in expect:
        assert walk(node) == expect.pop('chain')
    assert {k: node.get(k) for k in expect} == expect
    if node['status'] == 'ok' and node['kind'] == 'markdown':
        text = result['documents'][node['path']]['text']
        assert 0 <= node['start'] <= node['end'] <= len(text)
        assert result['documents'][node['path']]['sha256'] == library.digest(node['path'])


def test_tree_carries_each_document_once_with_fragment_ranges(vault):
    library = WebLibrary(vault)
    try:
        result = library.embeds('library/main.md', ['Target Note', 'Target Note#^list-two', 'notes/deep/Target Note#Alpha|An alias'], ['library/main.md#'])
    finally:
        library.close()
    assert list(result['documents']) == ['library/notes/deep/Target Note.md']
    text = result['documents']['library/notes/deep/Target Note.md']['text']
    whole, block, alpha = result['nodes']
    assert text[whole['start']:].startswith('# Target Note') and not text[whole['start']:].startswith('---')
    assert text[block['start']:block['end']] == '- list item two ^list-two\n  - nested under two'
    assert text[alpha['start']:alpha['end']].endswith('Child body.') and alpha['alias'] == 'An alias'


def test_tree_limits_and_validation(vault, monkeypatch):
    library = WebLibrary(vault)
    try:
        with pytest.raises(ValueError):
            library.embeds('library/main.md', ['x'] * (embeds.MAX_TARGETS + 1))
        with pytest.raises(ValueError):
            library.embeds('library/main.md', ['x'], depth=embeds.MAX_DEPTH + 1)
        with pytest.raises(ValueError):
            library.embeds('library/../etc/passwd', ['x'])
        (vault / 'library/big.md').write_text('# Big\n\n' + 'word ' * (embeds.MAX_EMBED_CHARS // 4))
        big = library.embeds('library/main.md', ['big'])['nodes'][0]
        assert big['status'] == 'too-large' and big['bytes'] > embeds.MAX_EMBED_CHARS
        # A response stops adding documents at its budget; later embeds are deferred to another request.
        monkeypatch.setattr(embeds, 'MAX_RESPONSE_CHARS', len(CORPUS['files']['library/notes/deep/Target Note.md']) + 10)
        nodes = library.embeds('library/main.md', ['Target Note', 'notes/deep/sibling'])['nodes']
        assert [n['status'] for n in nodes] == ['ok', 'deferred']
        monkeypatch.setattr(embeds, 'MAX_NODES', 1)
        assert [n['status'] for n in library.embeds('library/main.md', ['Target Note', 'Nope'])['nodes']] == ['ok', 'deferred']
    finally:
        library.close()


def test_route_and_fifty_embeds_in_one_request(vault):
    """The 50-embed document: one request resolves everything a fetch per embed used to."""
    for i in range(50):
        (vault / f'library/many/note-{i:02}.md').parent.mkdir(exist_ok=True)
        (vault / f'library/many/note-{i:02}.md').write_text(f'# Note {i}\n\n' + f'Paragraph {i} of a synthetic note. ' * 120 + '\n')
    library = WebLibrary(vault)
    try:
        started = time.perf_counter()
        result = library.embeds('library/main.md', [f'note-{i:02}' for i in range(50)])
        elapsed = time.perf_counter() - started
    finally:
        library.close()
    assert [n['status'] for n in result['nodes']] == ['ok'] * 50 and len(result['documents']) == 50
    assert elapsed < 5, elapsed


def test_link_graph_skips_escaped_embeds():
    kinds = [(l['kind'], l['raw']) for l in extract('\\![[escaped]] and ![[real]]\n')]
    assert kinds == [('wikilink', 'escaped'), ('embed', 'real')]
