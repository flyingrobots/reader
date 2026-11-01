import hashlib
import json
import os
from pathlib import Path
import subprocess

import pytest

from reader_mcp.portable_links import PortableLinks, references, github, safe_target


def repository(path, remote='git@github.com:example/actual-name.git'):
    path.mkdir(parents=True)
    env = dict(os.environ, GIT_AUTHOR_NAME='Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
               GIT_COMMITTER_NAME='Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid')
    def git(*args):
        return subprocess.run(['git', '-C', str(path), *args], env=env, capture_output=True,
                              text=True, check=True).stdout.strip()
    git('init', '-q')
    (path / 'a file.txt').write_text('source bytes\n')
    git('add', 'a file.txt')
    git('commit', '-qm', 'Synthetic source')
    git('remote', 'add', 'origin', remote)
    return git('rev-parse', 'HEAD')


def document(root, text):
    path = root / 'library/packet/source.md'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def test_parser_handles_references_and_preserves_code_and_metadata():
    refs = references('---\ntitle: "[ignore](file:///meta)"\n---\n\n'
                      '[A **bold** name][one]\n\n[one]: <file:///some%20file>\n\n'
                      '![A *picture*](file:///pic.png)\n\n'
                      '`[ignore](file:///code)`\n\n```md\n[x](file:///fence)\n```\n')
    assert refs == [dict(source_url='file:///some%20file', label='A bold name', kind='link'),
                    dict(source_url='file:///pic.png', label='A *picture*', kind='image')]


def test_remote_and_source_revision_drive_targets_without_changing_original(tmp_path):
    repo = tmp_path / 'git/checkout-name'
    commit = repository(repo)
    source = document(tmp_path, f'[Repository]({repo.as_uri()})\n\n[Code]({(repo / "a file.txt").as_uri()}#L1)\n'
                      f'\n[{commit[:8]}]({repo.as_uri()})\n')
    before = source.read_bytes()
    engine = PortableLinks(tmp_path, tmp_path / 'git')
    planned = engine.prepare('library/packet/source.md')
    assert not engine.record_path('library/packet/source.md').exists()
    result = engine.prepare('library/packet/source.md', apply=True)
    assert result['targets'] == planned['targets']
    assert [t['target'] for t in result['targets']] == [
        'https://github.com/example/actual-name',
        f'https://github.com/example/actual-name/blob/{commit}/a%20file.txt#L1',
        f'https://github.com/example/actual-name/commit/{commit}']
    assert source.read_bytes() == before
    sha = hashlib.sha256(before).hexdigest()
    assert engine.stored('library/packet/source.md', sha)['targets'] == result['targets']
    assert engine.stored('library/packet/source.md', '0' * 64) is None


def test_deleted_worktree_requires_source_evidence_and_object_identity(tmp_path):
    commit = repository(tmp_path / 'git/retained')
    gone = tmp_path / 'git/deleted'
    source = document(tmp_path, f'[Code]({(gone / "a file.txt").as_uri()})\n')
    engine = PortableLinks(tmp_path, tmp_path / 'git')
    assert engine.prepare('library/packet/source.md')['counts'] == {'unresolved': 1}
    (source.parent / 'receipt.json').write_text(json.dumps({'provenance': {
        'source': 'https://github.com/example/actual-name/pull/1', 'commit': commit}}))
    result = engine.prepare('library/packet/source.md')
    assert result['targets'][0]['commit'] == commit
    assert result['targets'][0]['revision_basis'] == 'source'
    assert result['targets'][0]['method'] == 'git-tree'
    (source.parent / 'receipt.json').write_text(json.dumps({'provenance': {'source': 'https://github.com/example/unknown'}}))
    assert engine.prepare('library/packet/source.md')['counts'] == {'unresolved': 1}


def test_images_are_copied_once_and_library_links_remain_local(tmp_path):
    image = tmp_path / 'diagram.svg'
    data = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
    image.write_bytes(data)
    other = tmp_path / 'library/other note.md'
    source = document(tmp_path, f'![Diagram]({image.as_uri()})\n\n[Other]({other.as_uri()}#heading)\n')
    other.write_text('# Heading\n')
    engine = PortableLinks(tmp_path)
    plan = engine.prepare('library/packet/source.md')
    assert not (source.parent / 'assets').exists()
    result = engine.prepare('library/packet/source.md', apply=True)
    assert result['targets'] == plan['targets']
    target = result['targets'][0]['target']
    assert (tmp_path / target).read_bytes() == data
    assert result['targets'][1]['target'] == 'library/other%20note.md#heading'
    record = engine.record_path('library/packet/source.md')
    timestamp = record.stat().st_mtime_ns
    engine.prepare('library/packet/source.md', apply=True)
    assert record.stat().st_mtime_ns == timestamp
    assert len(list((source.parent / 'assets').iterdir())) == 1


def test_missing_and_symlinked_images_have_explicit_dispositions(tmp_path):
    external = tmp_path / 'external'
    external.mkdir()
    (external / 'pic.png').write_bytes(b'image')
    alias = tmp_path / 'alias'
    alias.symlink_to(external, target_is_directory=True)
    document(tmp_path, f'![Missing]({(tmp_path / "missing.png").as_uri()})\n\n![Alias]({(alias / "pic.png").as_uri()})')
    result = PortableLinks(tmp_path).prepare('library/packet/source.md', apply=True)
    assert result['counts'] == {'unresolved': 2}
    assert all(t['reason'] for t in result['targets'])
    assert not (tmp_path / 'library/packet/assets').exists()


@pytest.mark.parametrize('value', [[], None, {'targets': []}, {'schema_version': 1, 'path': 'library/packet/source.md',
    'source_sha256': '0' * 64, 'targets': [None]}])
def test_malformed_records_fail_closed(tmp_path, value):
    document(tmp_path, 'source')
    engine = PortableLinks(tmp_path)
    record = engine.record_path('library/packet/source.md')
    record.parent.mkdir()
    record.write_text(json.dumps(value))
    assert engine.stored('library/packet/source.md', '0' * 64) is None


@pytest.mark.parametrize('target', ['javascript:alert(1)', 'file:///secret', 'https://github.com.evil/a/b',
    'https://github.com@evil/a/b', 'library/../secret', 'library/%2e%2e/secret', 'library/a\\b', 'library//a', None])
def test_projection_destinations_are_restricted(target):
    assert not safe_target(target)


def test_github_remote_normalization():
    for remote in ('git@github.com:example/project.git', 'ssh://git@github.com/example/project.git',
                   'https://github.com/example/project', 'https://github.com/example/project.git/'):
        assert github(remote) == 'https://github.com/example/project'
    assert github('https://github.com.evil/example/project') is None
