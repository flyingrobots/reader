"""Portable-reference browser fixture using only synthetic documents and a local Git remote."""
import hashlib
from pathlib import Path
import subprocess

from reader_mcp.portable_links import PortableLinks


def create(root):
    root = root.resolve()
    repo = root / 'fixture-repos/example'
    repo.mkdir(parents=True)
    (repo / 'README.md').write_text('# Synthetic repository\n')
    for args in (['init', '-q'], ['config', 'user.name', 'Fixture'],
                 ['config', 'user.email', 'fixture@example.invalid'],
                 ['remote', 'add', 'origin', 'git@github.com:example/portable-fixture.git'],
                 ['add', '.'], ['commit', '-qm', 'Synthetic source']):
        subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True, timeout=30)
    commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True, timeout=30).strip()
    picture = root / 'diagram.svg'
    picture.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><view id="diagram" viewBox="0 0 40 30"/><rect width="40" height="30" fill="blue"/></svg>')
    folder = root / 'library/portable/originals'
    folder.mkdir(parents=True)
    original = folder / 'source.md'
    raw = ('# Portable references\n\nAn anchor sentence stays unchanged.\n\n'
           f'[Repository]({repo.as_uri()})\n\n'
           f'[Tracked file]({(repo / "README.md").as_uri()})\n\n'
           f'[~~Old~~]({(repo / "README.md").as_uri()})\n\n'
           f'[$x^2$]({(repo / "README.md").as_uri()})\n\n'
           f'[Library source]({(root / "library/thought.md").as_uri()})\n\n'
           f'![Blue diagram]({picture.as_uri()}#diagram)\n\n'
           f'[Missing target]({(root / "absent.md").as_uri()})\n\n'
           f'[Reference link][repo]\n\n[repo]: {repo.as_uri()}#readme\n\n'
           '`[Literal](file:///literal)`\n')
    original.write_text(raw)
    copy = folder / 'source.reading.md'
    sha = hashlib.sha256(original.read_bytes()).hexdigest()
    copy.write_text('---\ntitle: Portable reading copy\nkind: reading-copy\nsource_sha256: ' + sha + '\n---\n\n' + raw)
    disabled = folder / 'math-disabled.md'
    disabled.write_text('---\nmath: false\n---\n\n' + raw)
    repair = PortableLinks(root, git_root=repo.parent)
    for path in (original, copy, disabled):
        assert repair.prepare(path.relative_to(root).as_posix(), apply=True)['counts'] == {'resolved': 7, 'unresolved': 1}
    return {'original': original.relative_to(root).as_posix(), 'copy': copy.relative_to(root).as_posix(),
            'math_disabled': disabled.relative_to(root).as_posix(), 'sha256': sha, 'commit': commit}
