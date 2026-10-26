"""`reader demo --export-static`: output safety, lookup keys, base paths, privacy and a full export (RW-42)."""
from datetime import date
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from reader_mcp.demo import build as demo
from reader_mcp.demo import static
from reader_mcp.art_scene import validate

STATIC = Path(static.__file__).resolve().parent.parent / 'web_ui'


@pytest.fixture(scope='module')
def exported(tmp_path_factory):
    folder = tmp_path_factory.mktemp('static')
    root = folder / 'vault'
    demo.build(root)
    demo.index(root, semantic=False)
    out = folder / 'site'
    summary = static.export(root, out, '/reader/', 'https://example.invalid/reader/', say=lambda _: None)
    return root, out, summary


def test_key_matches_the_shim_and_ignores_the_utc_offset():
    assert static.key('/api/history', [('tz', '-60'), ('participant', 'You'), ('cursor', '0')]) == '["/api/history",[["cursor","0"],["participant","You"]]]'
    assert static.key('/api/document', [('path', 'library/ü (1).md')]) == '["/api/document",[["path","library/ü (1).md"]]]'
    assert static.key('/api/themes', []) == '["/api/themes",[]]'


@pytest.mark.parametrize('value,expected', [('/', '/'), ('/reader', '/reader/'), ('/apps/reader/', '/apps/reader/'), (None, '/')])
def test_base_paths(value, expected):
    assert static.normal_base(value) == expected


@pytest.mark.parametrize('value', ['reader/', '/a/../b/', '//evil/', '/a b/', '/a"/'])
def test_unsafe_base_paths_are_refused(value):
    with pytest.raises(ValueError):
        static.normal_base(value)


def test_rebase_rewrites_root_absolute_assets_and_panes_only():
    text = """<link href="/assets/style.css"> url('/assets/vendor/a.woff2') const s='/?pane=1'+x; fetch('/api/library'); '/assets'"""
    assert static.rebase(text, '/reader/') == """<link href="/reader/assets/style.css"> url('/reader/assets/vendor/a.woff2') const s='/reader/?pane=1'+x; fetch('/api/library'); '/assets'"""


def test_output_folder_safety(tmp_path):
    mine = tmp_path / 'mine'
    mine.mkdir()
    (mine / 'keep.txt').write_text('mine')
    with pytest.raises(ValueError, match='not an earlier Reader static demo'):
        static.check_output(mine)
    (mine / static.MARKER).write_text('{"kind": "something-else"}')
    with pytest.raises(ValueError, match='not an earlier Reader static demo'):
        static.check_output(mine)
    file = tmp_path / 'file'
    file.write_text('x')
    with pytest.raises(ValueError, match='not a folder'):
        static.check_output(file)
    link = tmp_path / 'link'
    link.symlink_to(tmp_path / 'empty', target_is_directory=True)
    with pytest.raises(ValueError, match='not a folder'):
        static.check_output(link)
    static.check_output(tmp_path / 'new')
    (tmp_path / 'empty').mkdir()
    static.check_output(tmp_path / 'empty')


def test_scrub_drops_machine_fields_and_points_files_at_the_export():
    data = {'results': [{'path': 'library/a.md'}], 'token': 'secret', 'codex': {'name': 'codex', 'installed': True},
            'file_url': '/api/file?path=library%2Fsub%2Fa%20b.pdf'}
    assert static.scrub(data) == {'results': [{'path': 'library/a.md'}], 'file_url': 'files/library/sub/a%20b.pdf'}


def test_issue_windows_cover_each_dated_week_and_its_quiet_widening():
    windows = static.issue_windows([{'date': '2030-03-14'}, {'date': None}, {'date': '1854'}], date(2030, 3, 14))
    assert windows == [('2030-03-04', '2030-03-17'), ('2030-03-11', '2030-03-17')]


def test_link_targets_skip_external_and_fragment_links():
    text = '[a](other.md) ![b](img/x.png "t") [c](https://example.invalid) [d](#h) <a href="../up.md#s">e</a> [a again](other.md)'
    assert static.link_targets(text) == ['other.md', 'img/x.png', '../up.md#s']


def test_the_served_page_never_loads_the_shim():
    html = (STATIC / 'index.html').read_text()
    assert 'static-demo' not in html and 'reader-static-demo' not in html


def test_export_writes_a_flagged_page_with_rebased_assets(exported):
    root, out, summary = exported
    html = (out / 'index.html').read_text()
    assert '<meta name="reader-static-demo"' in html and '<script src="/reader/assets/static-demo.js"></script>' in html
    assert 'Content-Security-Policy' in html and "connect-src 'self'" in html
    assert 'href="/assets/' not in html and 'src="/assets/' not in html
    assert '<meta property="og:image" content="https://example.invalid/reader/assets/icons/icon-512.png">' in html
    assert "url('/reader/assets/vendor/newsreader.woff2')" in (out / 'assets/style.css').read_text()
    assert "'/reader/?pane=1'" in (out / 'assets/split.mjs').read_text()
    manifest = json.loads((out / 'assets/manifest.webmanifest').read_text())
    assert manifest['start_url'] == manifest['scope'] == '/reader/' and manifest['icons'][0]['src'].startswith('/reader/assets/')
    assert (out / '.nojekyll').exists() and json.loads((out / static.MARKER).read_text())['kind'] == static.MARKER_KIND
    assert summary['base'] == '/reader/' and summary['files'] < static.MAX_FILES and summary['bytes'] < static.MAX_BYTES


def test_export_records_every_route_the_reader_needs(exported):
    root, out, _ = exported
    data = json.loads((out / 'data/manifest.json').read_text())
    routes = {json.loads(k)[0] for k in data['routes']}
    for route in ('/api/library', '/api/document', '/api/discussion', '/api/versions', '/api/changes', '/api/version', '/api/next', '/api/links',
                  '/api/issue', '/api/queue', '/api/history', '/api/readers', '/api/chats', '/api/chat', '/api/standfirst', '/api/editions', '/api/inbox'):
        assert route in routes, route
    assert not routes & {'/api/local-model', '/api/service', '/api/health', '/api/prose', '/api/art/jobs', '/api/art/still'}, 'machine routes are never exported'
    for name, status in data['routes'].values():
        assert (out / 'data/r' / f'{name}.json').is_file() and status in (200, 400, 404)
    works = json.loads((out / 'data/r' / (data['routes'][static.key('/api/library', [])][0] + '.json')).read_text())['works']
    for work in works:
        assert static.key('/api/document', [('path', work['primary']), ('participant', data['participant'])]) in data['routes']
        assert (out / 'files' / work['primary']).is_file()
    index = json.loads((out / 'data/search.json').read_text())
    assert index['paths'] and all(p.startswith('library/') for p in index['paths']) and len(index['chunks']) >= len(index['paths'])
    resolve = json.loads((out / 'data/resolve.json').read_text())
    assert any(result.get('path') for table in resolve.values() for result in table.values())


def test_export_carries_the_demo_art_without_stills_or_jobs(exported):
    root, out, _ = exported
    data = json.loads((out / 'data/manifest.json').read_text())
    answers = [json.loads((out / 'data/r' / f'{name}.json').read_text()) for k, (name, status) in data['routes'].items()
               if json.loads(k)[0] == '/api/art' and status == 200]
    drawn = [a for a in answers if a.get('art')]
    assert len(drawn) >= 4, 'the four handcrafted demo scenes are exported'
    for answer in answers:
        assert answer['job'] is None and all(v['still'] is None for v in answer['versions'])
    for answer in drawn:
        assert answer['art']['scene'] and answer['art']['brief'] and answer['art']['still'] is None
        validate(answer['art']['scene'])  # theme-role colors ({"token": …}) survive the export's scrub


def test_export_contains_no_machine_paths_or_tokens(exported):
    root, out, _ = exported
    for file in out.rglob('*'):
        if file.is_file() and file.suffix in static.TEXT_SUFFIXES:
            text = file.read_text(errors='ignore')
            assert str(root) not in text and str(Path.home()) not in text, file
    boot = json.loads((out / 'data/r' / (json.loads((out / 'data/manifest.json').read_text())['routes'][static.key('/api/library', [])][0] + '.json')).read_text())
    assert 'token' not in boot


def test_guard_refuses_a_machine_path(tmp_path):
    (tmp_path / 'a.json').write_text('{"p": "/somewhere/private/vault/x"}')
    with pytest.raises(ValueError, match='local machine path'):
        static.guard(tmp_path, ['/somewhere/private/vault'])


def test_reexport_into_an_earlier_export_replaces_it(exported, tmp_path):
    root, out, _ = exported
    again = tmp_path / 'again'
    static.export(root, again, '/', say=lambda _: None)
    (again / 'stale.txt').write_text('old')
    static.export(root, again, '/', say=lambda _: None)
    assert not (again / 'stale.txt').exists()
    assert '<script src="/assets/static-demo.js"></script>' in (again / 'index.html').read_text()


def test_cli_refuses_a_foreign_folder_before_building(tmp_path):
    mine = tmp_path / 'mine'
    mine.mkdir()
    (mine / 'keep.md').write_text('mine')
    env = {**os.environ, 'PYTHONPATH': str(Path(static.__file__).resolve().parents[2])}
    run = subprocess.run([sys.executable, '-m', 'reader_mcp.cli', 'demo', '--export-static', str(mine)], capture_output=True, text=True, env=env)
    assert run.returncode == 1 and 'not an earlier Reader static demo' in run.stderr and 'Building' not in run.stdout
    assert [p.name for p in mine.iterdir()] == ['keep.md']
