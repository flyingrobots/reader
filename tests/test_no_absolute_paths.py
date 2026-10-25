"""Repository hygiene: nothing tracked names a developer's machine layout.

Everything in the repository is repo-relative. A path into somebody's home
folder, a temporary directory, or a sibling checkout only works on the machine
that wrote it, and a file outside the project is a red flag on its own.
"""
from pathlib import Path
import re
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
SELF = Path(__file__).resolve().relative_to(ROOT).as_posix()

# Generated or third-party bytes that are not authored here.
SKIP_PREFIXES = ('src/reader_mcp/web_ui/controls/', 'src/reader_mcp/web_ui/vendor/')
SKIP_NAMES = ('package-lock.json', 'uv.lock', 'Cargo.lock', 'poetry.lock', 'yarn.lock', 'pnpm-lock.yaml')

# Absolute or machine-specific locations: never acceptable anywhere.
ABSOLUTE = {
    'macOS home folder': re.compile(r'/Users/'),
    'Linux home folder': re.compile(r'/home/[A-Za-z0-9._-]+/'),
    'Windows home folder': re.compile(r'[A-Za-z]:\\{1,2}Users\\', re.IGNORECASE),
    'checkout under ~/git': re.compile(r'~/git/'),
    'macOS temporary folder': re.compile(r'/private/tmp'),
}
# Sibling checkouts and worktrees of this repository (allowed in CHANGELOG history only).
SIBLING = {
    'sibling checkout': re.compile(r'\.\./reader-code\b'),
    'worktree name': re.compile(r'(?<![\w.-])reader-code-(?!block\b)[a-z][\w-]*'),
}
HISTORY = ('CHANGELOG.md',)

# Explicit exceptions: (file, exact text) -> reason. Keep this list short.
ALLOWED = {
    ('tests/fixtures/codex-exec-real.jsonl', '/home/reader/'):
        'synthetic home folder of a fictional fixture user in a recorded Codex transcript',
    ('tests/test_static_demo.py', '/home/someone/'):
        'synthetic absolute path the static export must refuse or strip (the test proves scrubbing)',
    # TODO(#95): the companion-handling work replaces these with configurable or relative forms.
    ('src/reader_mcp/local_model.py', '/Users/Shared/git-locks/workstation.git'): '#95: fixed workstation git-locks store path, pending configuration',
    ('tests/test_inbox_view.py', '/Users/Shared/git-locks/workstation.git'): '#95: test passes the fixed workstation git-locks store path',
    ('docs/web.md', '/Users/Shared/git-locks/workstation.git'): '#95: local-model paragraph documents the fixed workstation git-locks store',
    ('src/reader_mcp/prose.py', '~/git/colorful-language/crates/colorful-cli'): '#95: Colorful Language install message names a clone location',
    ('tests/test_prose.py', '~/git/colorful-language/crates/colorful-cli'): '#95: asserts the Colorful Language install message',
}


def tracked_text_files():
    names = subprocess.run(['git', '-C', str(ROOT), 'ls-files', '-z'], capture_output=True, check=True).stdout.split(b'\0')
    for raw in names:
        name = raw.decode('utf-8', 'surrogateescape')
        if not name or name == SELF or name.startswith(SKIP_PREFIXES) or Path(name).name in SKIP_NAMES:
            continue
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            continue
        data = path.read_bytes()
        if b'\0' in data[:8192]:
            continue
        yield name, data.decode('utf-8', 'replace')


def covers(line, text, match):
    """True when the match lies inside an occurrence of the allowed text on this line."""
    start = line.find(text)
    while start >= 0:
        if start <= match.start() and match.end() <= start + len(text):
            return True
        start = line.find(text, start + 1)
    return False


def findings():
    found = []
    for name, text in tracked_text_files():
        patterns = dict(ABSOLUTE) | ({} if name in HISTORY else SIBLING)
        for line_number, line in enumerate(text.splitlines(), 1):
            for label, pattern in patterns.items():
                for match in pattern.finditer(line):
                    if any(name == allowed and covers(line, allowed_text, match) for allowed, allowed_text in ALLOWED):
                        continue
                    found.append(f'{name}:{line_number}: {label}: {line.strip()[:160]}')
    return found


def test_no_absolute_or_machine_specific_paths_are_tracked():
    found = findings()
    assert not found, 'Use repo-relative paths (or a documented app location):\n' + '\n'.join(found)


def test_every_exception_is_still_needed():
    texts = dict(tracked_text_files())
    stale = [f'{name}: {text!r}' for name, text in ALLOWED if text not in texts.get(name, '')]
    assert not stale, 'Remove exceptions that no longer match anything:\n' + '\n'.join(stale)


@pytest.mark.parametrize('sample', ['/Users/someone/project', '/home/someone/x', r'C:\Users\someone', '~/git/project',
                                    '/private/tmp/x', '../reader-code/src', 'cd reader-code-preview'])
def test_the_patterns_catch_each_kind(sample):
    patterns = list(ABSOLUTE.values()) + list(SIBLING.values())
    assert any(p.search(sample) for p in patterns)


def test_the_code_block_class_is_not_a_worktree_name():
    assert not any(p.search('.reader-code-block { margin: 0 }') for p in SIBLING.values())
