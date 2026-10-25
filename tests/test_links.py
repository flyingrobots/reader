"""The library link graph against isolated synthetic vaults."""
import json
import os
import sqlite3
import time

import pytest

from reader_mcp import links as links_module
from reader_mcp.links import LinkGraph, excerpt, extract, slug
from reader_mcp.maintenance import Maintenance
from reader_mcp.web import WebLibrary


def write(root, path, text):
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text)
    return file


def touch(file):
    """Change mtime_ns visibly even on coarse filesystem clocks."""
    info = file.stat()
    os.utime(file, ns=(info.st_atime_ns, info.st_mtime_ns + 2_000_000_000))


@pytest.fixture
def vault(tmp_path):
    for name in ('library', 'inbox', 'indexes'):
        (tmp_path / name).mkdir()
    write(tmp_path, 'library/essays/target.md', '---\ntitle: The target\nauthor: Ada\n---\n\n# The target\n\nOpening words.\n\n## Second section\n\nWords under the second section.\n')
    write(tmp_path, 'library/notes/citer.md', '# Citer\n\nIntro [plain](../essays/target.md).\n\n## Why it matters\n\nSee [the section](../essays/target.md#second-section "Title"),\n'
          'a wikilink [[target#Second section|label]] and an embed ![[target]].\n\n```markdown\n[fenced](../essays/target.md) [[target]]\n```\n\nInline `[code](../essays/target.md)` is ignored.\n'
          'An [external](https://example.com/x.md), a [same-page](#why-it-matters) link and [outside](../../indexes/x.md).\n[ref]: ../essays/target.md\n[^1]: A footnote, not a link.\n')
    write(tmp_path, 'library/notes/ambiguous.md', '# Ambiguous\n\n[[twin]] and [[nowhere]] and [deep](library/essays/target.md).\n')
    write(tmp_path, 'library/a/twin.md', '# Twin A\n')
    write(tmp_path, 'library/b/twin.md', '# Twin B\n')
    write(tmp_path, 'library/notes/picture.png', 'not really a png')
    write(tmp_path, 'library/notes/with-image.md', '# Image\n\n![a picture](picture.png)\n')
    works = [{'id': p, 'title': p, 'primary': p, 'authors': ['Ada'], 'projects': ['Synthetic']} for p in ('library/essays/target.md', 'library/notes/citer.md')]
    (tmp_path / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': works}))
    return tmp_path


def graph(vault):
    return LinkGraph(vault)


def rows(g, table, where='1', args=()):
    with sqlite3.connect(g.db) as con:
        con.row_factory = sqlite3.Row
        return [dict(r) for r in con.execute(f'SELECT * FROM {table} WHERE {where} ORDER BY source, line', args)]


def test_extraction_kinds_fragments_headings_and_code(vault):
    found = extract((vault / 'library/notes/citer.md').read_text())
    simple = [(l['kind'], l['raw'], l['heading'], l['anchor']) for l in found]
    assert simple == [
        ('link', '../essays/target.md', 'Citer', 'citer'),
        ('link', '../essays/target.md#second-section', 'Why it matters', 'why-it-matters'),
        ('wikilink', 'target#Second section', 'Why it matters', 'why-it-matters'),
        ('embed', 'target', 'Why it matters', 'why-it-matters'),
        ('link', '../../indexes/x.md', 'Why it matters', 'why-it-matters'),
        ('link', '../essays/target.md', 'Why it matters', 'why-it-matters'),
    ], 'fenced and inline code, external, same-page and footnote targets are skipped'
    assert found[2]['label'] == 'label' and found[0]['line'] == 3
    assert slug('1. The *real* `thing` & [more](x)') == '1-the-real-thing--more'
    assert slug('Ünïcode — dash’s') == 'ünïcode--dashs', 'the same cases as tests/web_logic.test.mjs'
    headings = extract('# A\n[x](y.md)\n# A\n[z](w.md)\n')
    assert [l['anchor'] for l in headings] == ['a', 'a-1'], 'duplicate headings are numbered as in the client'


def test_full_build_resolution_and_unresolved_reasons(vault):
    g = graph(vault)
    summary = g.refresh()
    assert summary['documents'] == 6 and summary['files'] == 7 and summary['links'] == 7 and summary['unresolved'] == 3
    inbound = g.inbound('library/essays/target.md')
    assert inbound['inbound_count'] == 2 and inbound['inbound_links'] == 6
    citer = inbound['inbound'][0]
    assert citer == {'source': 'library/notes/citer.md', 'title': 'Citer', 'count': 5, 'heading': 'Citer', 'fragment': 'citer', 'line': 3}
    stored = rows(g, 'links', 'source=?', ('library/notes/citer.md',))
    assert {r['kind'] for r in stored} == {'link', 'wikilink', 'embed'}
    assert [r['fragment'] for r in stored if r['kind'] != 'embed'] == [None, 'second-section', 'Second section', None]
    assert {r['method'] for r in stored} == {'path', 'name'}
    missing = {(r['raw'], r['reason']) for r in rows(g, 'unresolved')}
    assert missing == {('twin', 'ambiguous'), ('nowhere', 'missing'), ('../../indexes/x.md', 'outside')}
    assert g.inbound('library/notes/picture.png')['inbound_count'] == 1, 'markdown images are embeds'
    counts = g.counts(['library/essays/target.md'])['counts']
    assert counts == {'library/essays/target.md': {'inbound': 6, 'sources': 2, 'outbound': 0}}
    assert g.check()['state'] == 'current'


def test_incremental_refresh_reparses_only_changed_files(vault):
    g = graph(vault)
    g.refresh()
    again = g.refresh()
    assert again['parsed'] == 0 and again['added'] == again['changed'] == again['removed'] == 0
    citer = vault / 'library/notes/citer.md'
    citer.write_text(citer.read_text() + '\nOne more [link](../essays/target.md).\n')
    touch(citer)
    assert g.check()['state'] == 'stale'
    result = g.refresh()
    assert result['parsed'] == 1 and result['changed'] == 1 and result['rewired'] == 0
    assert g.inbound('library/essays/target.md')['inbound'][0]['count'] == 6


def test_adding_a_file_reresolves_an_ambiguous_wikilink_and_deleting_removes_rows(vault):
    g = graph(vault)
    g.refresh()
    (vault / 'library/b/twin.md').unlink()
    result = g.refresh()
    assert result['removed'] == 1 and result['parsed'] == 0 and result['rewired'] == 1
    assert g.inbound('library/a/twin.md')['inbound_count'] == 1, 'the remaining twin is now unique'
    assert ('twin', 'ambiguous') not in {(r['raw'], r['reason']) for r in rows(g, 'unresolved')}
    write(vault, 'library/b/twin.md', '# Twin B returns\n')
    write(vault, 'library/c/nowhere.md', '# Now somewhere\n')
    result = g.refresh()
    assert result['added'] == 2 and result['parsed'] == 2
    assert g.inbound('library/a/twin.md')['inbound_count'] == 0, 'ambiguous again'
    assert g.inbound('library/c/nowhere.md')['inbound'][0]['source'] == 'library/notes/ambiguous.md', 'a missing wikilink now resolves'
    (vault / 'library/notes/citer.md').unlink()
    g.refresh()
    assert rows(g, 'links', 'source=?', ('library/notes/citer.md',)) == []
    assert rows(g, 'unresolved', 'source=?', ('library/notes/citer.md',)) == []
    assert 'library/notes/citer.md' not in {r['path'] for r in rows_files(g)}
    # Removing a path-resolved target turns its links into unresolved rows.
    (vault / 'library/notes/picture.png').unlink()
    g.refresh()
    assert ('picture.png', 'missing') in {(r['raw'], r['reason']) for r in rows(g, 'unresolved')}


def rows_files(g):
    with sqlite3.connect(g.db) as con:
        return [{'path': p} for (p,) in con.execute('SELECT path FROM files')]


def test_graph_and_click_resolution_agree(vault):
    library = WebLibrary(vault)
    library.links.refresh()
    for link in rows(library.links, 'links'):
        assert library.resolve(link['source'], link['raw'])['path'] == link['target'], link
    for link in rows(library.links, 'unresolved'):
        with pytest.raises(ValueError):
            library.resolve(link['source'], link['raw'])
    assert library.resolve('library/notes/citer.md', 'target')['path'] == 'library/essays/target.md'
    assert library.resolve('library/notes/citer.md', '/library/essays/target#x') == {'path': 'library/essays/target.md', 'fragment': 'x'}


def test_bounds_symlinks_and_failure_keep_the_previous_graph(vault, monkeypatch):
    (vault / 'library/linked.md').symlink_to(vault / 'library/essays/target.md')
    (vault / 'library/.hidden.md').write_text('[x](essays/target.md)')
    big = write(vault, 'library/big.md', '[x](essays/target.md)\n' + 'x' * 10000)
    monkeypatch.setattr(links_module, 'MAX_PARSE', 5000)
    g = graph(vault)
    summary = g.refresh()
    assert summary['path_only'] == 1 and summary['files'] == 8
    files = {r['path'] for r in rows_files(g)}
    assert 'library/linked.md' not in files and 'library/.hidden.md' not in files and 'library/big.md' in files
    before = g.inbound('library/essays/target.md')
    monkeypatch.setattr(links_module, 'MAX_LINKS', 1)
    big.write_text('# small now\n[x](essays/target.md)\n')
    touch(big)
    with pytest.raises(ValueError, match='previous graph is kept'):
        g.refresh()
    assert g.inbound('library/essays/target.md') == before


def test_excerpt_plain_text_from_heading():
    text = '---\ntitle: T\n---\n\n# T\n\nFirst <b>bold</b> [link](x.md) and **strong**.\n\n## Second section\n\n- item one\n- item two\n\n```\ncode\n```\n'
    assert excerpt(text) == (None, 'First bold link and strong. Second section item one item two')
    assert excerpt(text, 'second-section') == ('Second section', 'item one item two')
    assert excerpt(text, 'Second%20section')[0] == 'Second section'
    long = excerpt('word ' * 400)[1]
    assert len(long) <= 330 and long.endswith('…')


def test_maintenance_job_and_check(vault):
    m = Maintenance(vault)
    assert m.check()['links'] == 'missing'
    m.start('links')
    deadline = time.monotonic() + 20
    while (m.status()['running'] or m.status()['checking']) and time.monotonic() < deadline:
        time.sleep(.05)
    status = m.status()
    assert status['jobs'][0]['state'] == 'succeeded' and status['jobs'][0]['result']['links'] == 7
    assert status['checks']['links']['state'] == 'current' and status['checks']['links']['links'] == 7


def test_web_routes_build_lazily_and_preview(vault):
    library = WebLibrary(vault)
    first = library.backlinks('library/essays/target.md')
    assert first['state'] == 'building'
    deadline = time.monotonic() + 20
    while library.maintenance.status()['running'] and time.monotonic() < deadline:
        time.sleep(.05)
    assert library.maintenance.status()['jobs'][0]['quiet'] is True
    ready = library.backlinks('library/essays/target.md')
    assert ready['state'] == 'ready' and ready['inbound_count'] == 2 and ready['stale'] is False
    preview = library.preview('library/essays/target.md', 'second-section', 'Tester')
    assert preview == {'path': 'library/essays/target.md', 'title': 'library/essays/target.md', 'authors': ['Ada'], 'project': 'Synthetic',
                       'read': False, 'kind': '.md', 'heading': 'Second section', 'excerpt': 'Words under the second section.'}
    assert library.preview('library/notes/ambiguous.md')['title'] == 'Ambiguous'
    hostile = write(vault, 'library/hostile.md', '# Hi\n\n<script>alert(1)</script><img src=x onerror=alert(1)> plain words\n')
    assert '<' not in library.preview('library/hostile.md')['excerpt']
    with pytest.raises(ValueError):
        library.preview('library/../etc/passwd')
    counts = library.link_counts()
    assert counts['counts']['library/essays/target.md']['sources'] == 2 and 'library/a/twin.md' not in counts['counts']


def test_indented_code_is_skipped_but_list_and_lazy_continuations_are_not():
    text = ('Intro.\n\n    [code](skip.md) [[skip-wiki]]\n\tmore [tabbed](skip-tab.md)\n\nAfter [real](keep.md).\n\n'
            '- item\n\n    [list paragraph](list.md)\n\nA paragraph line\n    [lazy](lazy.md)\n')
    assert [l['raw'] for l in extract(text)] == ['keep.md', 'list.md', 'lazy.md']


def test_setext_and_html_heading_slugs_match_the_renderer():
    text = ('First line\nsecond *line*\n===\n\n[a](a.md)\n\n<h2 id="custom">Html <em>heading</em></h2>\n\n[b](b.md)\n\n'
            '- a list item\n---\n\n[c](c.md)\n\n# Html heading\n\n[d](d.md)\n')
    found = extract(text)
    assert [(l['raw'], l['heading'], l['anchor']) for l in found] == [
        ('a.md', 'First line second line', 'first-line-second-line'),
        ('b.md', 'Html heading', 'html-heading'),
        ('c.md', 'Html heading', 'html-heading'),
        ('d.md', 'Html heading', 'html-heading-1')], 'a list item before --- is not a heading; repeats count HTML headings'
    assert excerpt('<h3>Notes</h3>\n\nBody under notes.\n', 'notes')[0] == 'Notes'
