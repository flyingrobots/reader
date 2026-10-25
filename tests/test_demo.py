"""`reader demo`: marker safety, idempotent refresh and dates relative to the build day."""
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import pytest

from reader_mcp.demo import build as demo

TODAY = date(2030, 3, 14)  # a Thursday
NOW = datetime(2030, 3, 14, 18, 30, tzinfo=timezone.utc)


def tree(root, folder):
    base = root / folder
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(base.rglob('*')) if p.is_file()}


def log(root):
    return subprocess.run(['git', '-C', str(root), 'log', '--format=%aI|%an|%s'], check=True, capture_output=True, text=True).stdout.splitlines()


@pytest.fixture(scope='module')
def built(tmp_path_factory):
    return demo.build(tmp_path_factory.mktemp('demo') / 'Reader Demo', today=TODAY, now=NOW)


def test_refuses_any_directory_without_the_marker(tmp_path):
    mine = tmp_path / 'notes'
    mine.mkdir()
    (mine / 'keep.md').write_text('mine')
    with pytest.raises(ValueError, match='not a Reader demo vault'):
        demo.build(mine, today=TODAY, now=NOW)
    assert [p.name for p in mine.iterdir()] == ['keep.md'] and (mine / 'keep.md').read_text() == 'mine'
    (mine / demo.MARKER).write_text('not json')  # a look-alike marker is not a marker
    with pytest.raises(ValueError, match='not a Reader demo vault'):
        demo.build(mine, today=TODAY, now=NOW)
    (mine / demo.MARKER).write_text(json.dumps({'kind': 'something-else'}))
    with pytest.raises(ValueError):
        demo.check(mine)
    link = tmp_path / 'link'
    link.symlink_to(mine)
    with pytest.raises(ValueError, match='symlink'):
        demo.build(link, today=TODAY, now=NOW)
    file = tmp_path / 'file'
    file.write_text('x')
    with pytest.raises(ValueError, match='not a directory'):
        demo.build(file, today=TODAY, now=NOW)
    assert (mine / 'keep.md').read_text() == 'mine' and file.read_text() == 'x'


def test_cli_refuses_a_foreign_directory_and_never_uses_reader_root(tmp_path):
    mine = tmp_path / 'vault'
    (mine / 'library').mkdir(parents=True)
    env = dict(os.environ, READER_ROOT=str(mine), PYTHONPATH=str(Path(__file__).parents[1] / 'src'))
    result = subprocess.run([sys.executable, '-m', 'reader_mcp.cli', 'demo', '--dir', str(mine), '--no-serve'],
                            capture_output=True, text=True, env=env, timeout=120)
    assert result.returncode == 1 and 'refusing to touch it' in result.stderr
    assert 'Building' not in result.stdout, 'refuses before announcing a build'
    assert [p.name for p in mine.iterdir()] == ['library']


def test_builds_a_marked_git_vault_with_every_feature_seeded(built):
    marker = demo.marker_info(built)
    assert marker['kind'] == demo.MARKER_KIND and marker['built'] == TODAY.isoformat()
    assert subprocess.run(['git', '-C', str(built), 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True).stdout.strip() == 'main'
    status = subprocess.run(['git', '-C', str(built), 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines()
    assert status and all(line.startswith('?? inbox/') for line in status), 'only the inbox arrivals are uncommitted'
    assert len(list((built / 'inbox').glob('*/receipt.json'))) == 2 and (built / 'inbox/autumn-reading-list.md').exists()
    library = built / 'library'
    assert (library / 'lantern/design/sync-design.md').exists() and 'previous_version: sync-design.md' in (library / 'lantern/design/sync-design.v2.md').read_text()
    assert len(list((built / 'annotations').glob('*.json'))) >= 15 and len(list((built / 'chats').glob('*.json'))) == 1
    assert len(list((built / 'engagement').glob('*.json'))) >= 6 and list((built / 'history').glob('*.jsonl'))
    history = subprocess.run(['git', '-C', str(built), 'log', '--format=%s', '--', 'library/lantern/design/sync-design.md'],
                             capture_output=True, text=True).stdout.splitlines()
    assert len(history) == 2, 'two commits of the same file give What changed something to show'
    voices = json.loads((built / 'voices.json').read_text())['voices']
    assert [v['name'] for v in voices] == ['Archivist', 'Architect', 'Plain Reader', 'Wren'] and voices[-1]['manual']
    version = subprocess.run([str(built / 'bin/demo-voice'), '--version'], capture_output=True, text=True, timeout=30)
    assert version.stdout.strip() == 'demo-voice 1.0 (scripted replies)'


def test_public_domain_and_fictional_documents_say_which_they_are(built):
    for file in (built / 'library').rglob('*.md'):
        head = file.read_text().split('\n---\n')[0]
        rights = re.search(r'^rights: (.*)$', head, re.M)
        assert rights, f'{file} has no rights line'
        value = json.loads(rights.group(1))
        assert value in ('Public domain (Project Gutenberg)', demo.FICTIONAL), (file, value)
        if value.startswith('Public domain'):
            assert re.search(r'^source_url: "https://www\.gutenberg\.org/ebooks/\d+"$', head, re.M), file
    text = '\n'.join(p.read_text(errors='replace') for p in built.rglob('*') if p.is_file() and '.git' not in p.parts and p.suffix in ('.md', '.json'))
    for name in ('Agy', 'Kai', 'Reader librarian'):
        assert not re.search(rf'\b{name}\b', text), name


def test_dates_are_relative_to_the_build_day(built):
    base = TODAY - timedelta(days=5)
    weekstart = TODAY - timedelta(days=TODAY.weekday())
    letters = list((built / 'library/newsletters').glob('*-weekly.md'))
    assert [p.name for p in letters] == [f'{weekstart.isoformat()}-weekly.md']
    assert f"newsletter_week_start: '{weekstart.isoformat()}'" in letters[0].read_text()
    fiction = (built / 'library/essayists/woolf/modern-fiction.md').read_text()
    assert f'added: "{(base + timedelta(days=4)).isoformat()}"' in fiction
    assert (built / f'library/lantern/journal/week-{base.isocalendar()[1]:02d}.md').exists()
    stamps = [datetime.fromisoformat(line.split('|')[0]) for line in log(built)]
    assert all(s <= NOW for s in stamps) and min(stamps) >= NOW - timedelta(days=20)
    assert stamps == sorted(stamps, reverse=True), 'history reads in order'
    receipts = [item['at'] for f in (built / 'engagement').glob('*.json') for item in json.loads(f.read_text())['items'].values()]
    assert receipts and all(datetime.fromisoformat(at) <= NOW for at in receipts)


def test_refresh_is_idempotent_and_keeps_only_models(tmp_path):
    root = demo.build(tmp_path / 'demo', today=TODAY, now=NOW)
    first = {folder: tree(root, folder) for folder in ('library', 'catalog', 'indexes', 'annotations', 'chats')}
    first_log = log(root)
    (root / '.reader/models').mkdir(parents=True, exist_ok=True)
    (root / '.reader/models/weights.bin').write_bytes(b'model')
    (root / 'library/scratch.md').write_text('played with the demo')
    again = demo.build(root, today=TODAY, now=NOW)
    assert again == root
    assert {folder: tree(root, folder) for folder in first} == first
    assert log(root) == first_log
    assert (root / '.reader/models/weights.bin').read_bytes() == b'model', 'downloaded models survive a refresh'
    assert not (root / 'library/scratch.md').exists(), 'the demo is disposable: a refresh rebuilds it'
    later = demo.build(root, today=TODAY + timedelta(days=7), now=NOW + timedelta(days=7))
    assert demo.marker_info(later)['built'] == (TODAY + timedelta(days=7)).isoformat()
    assert log(later)[0].split('|')[0] > first_log[0].split('|')[0]


def test_four_pieces_have_handcrafted_art_and_the_scripted_voice_makes_more(built, tmp_path):
    from reader_mcp.art_scene import validate
    from reader_mcp.web import WebLibrary
    versions = sorted(p.parent for p in (built / 'art').rglob('scene.json'))
    assert len(versions) == 4
    for folder in versions:
        validate(json.loads((folder / 'scene.json').read_text()))
        provenance = json.loads((folder / 'provenance.json').read_text())
        assert provenance['producer']['model'] == demo.VOICE_LABEL and provenance['note'].startswith('Handcrafted for the Reader demo')
        assert (folder / 'brief.md').read_text().startswith('---\ntitle: ')
    assert 'Add art for four of this week’s pieces (scripted demo artist, no AI)' in [line.split('|')[2] for line in log(built)]
    # Of Books is left for you: the scripted demo voice (canned answers from bin/art.json, no model) makes its art.
    root = demo.build(tmp_path / 'again', today=TODAY, now=NOW)
    library = WebLibrary(root, art_options={'capacity': lambda _: True, 'git_locks': False})
    try:
        job = library.art.enqueue('library/essayists/montaigne/of-books.md', None)
        assert job['producer'] == 'voice:Archivist'
        deadline = datetime.now() + timedelta(seconds=60)
        while library.art.jobs[job['id']]['state'] in ('queued', 'waiting', 'running') and datetime.now() < deadline:
            import time
            time.sleep(.1)
        done = library.art.jobs[job['id']]
        assert done['state'] == 'done', done.get('error')
        art = library.art.art('library/essayists/montaigne/of-books.md')['art']
        assert art['title'] == 'Notes at the back' and art['provenance']['producer']['label'] == 'Archivist'
    finally:
        library.close()


def test_empty_directory_is_allowed(tmp_path):
    empty = tmp_path / 'empty'
    empty.mkdir()
    assert demo.check(empty) == empty
