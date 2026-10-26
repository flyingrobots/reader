"""Repository hygiene: shipped code never defaults to one deployment's participant names.

Who counts as a voice is vault configuration (`voices.json`). A name from one
particular vault, written into `src/` as a literal, silently applies that vault's
roster to every other vault (#93). The names are stored here only as SHA-256
digests of their exact spelling, so this guard does not repeat them.
Lowercase CLI and stream identifiers (`claude`, `agy`) are different strings and
remain legitimate.
"""
import hashlib
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]

# SHA-256 of each exact deployment-specific participant name.
DEPLOYMENT_NAMES = {
    '5de8b9f1bb9725d57075388debcdebd324de414efd013c5066e9685865b21e2b',
    '2d05a7750b8fc5be8ed885501c6932bffd7077d8c6d92a1e1634016ea700ce89',
    '89e592c6598b9f322872fff90389b50ab6aaf525bf64e53a975fd120b9696a59',
    '0615570f9ea136946c5dc08a250010320707646f57f72cedab1dfb73d95eade6',
    '94c8f390d7cb86ebdc1e81422d637fae406298a6efca59b2799de42b343d7cdf',
}
SCOPES = ('src/', 'web/src/')
SKIP_PREFIXES = ('src/reader_mcp/web_ui/controls/', 'src/reader_mcp/web_ui/vendor/')
# A quoted string literal on one line, in Python, JavaScript or TypeScript.
LITERAL = re.compile(r'''(['"`])([^'"`\\\n]{1,100})\1''')
# Explicit exceptions: (file, digest of the literal) -> reason. Keep this list short.
ALLOWED = {
    ('src/reader_mcp/browse.py', '5de8b9f1bb9725d57075388debcdebd324de414efd013c5066e9685865b21e2b'):
        "browse navigation_author default and catalog-wrapper heuristic; a separate configuration question, not voice classification (#139)",
}


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def source_files():
    names = subprocess.run(['git', '-C', str(ROOT), 'ls-files', '-z', '--', *SCOPES], capture_output=True, check=True).stdout.split(b'\0')
    for raw in names:
        name = raw.decode('utf-8', 'surrogateescape')
        path = ROOT / name
        if not name or name.startswith(SKIP_PREFIXES) or not path.is_file() or path.is_symlink():
            continue
        data = path.read_bytes()
        if b'\0' not in data[:8192]:
            yield name, data.decode('utf-8', 'replace')


def findings():
    found = []
    for name, text in source_files():
        for number, line in enumerate(text.splitlines(), 1):
            for match in LITERAL.finditer(line):
                hashed = digest(match.group(2).strip())
                if hashed in DEPLOYMENT_NAMES and (name, hashed) not in ALLOWED:
                    found.append(f'{name}:{number}: deployment-specific participant name {hashed[:12]}')
    return found


def test_shipped_code_names_no_deployment_participants():
    found = findings()
    assert not found, 'Read participant names from the vault (voices.json), not from source:\n' + '\n'.join(found)


def test_every_exception_is_still_needed():
    texts = dict(source_files())
    stale = [f'{name}: {hashed[:12]}' for name, hashed in ALLOWED
             if not any(digest(m.group(2).strip()) == hashed for m in LITERAL.finditer(texts.get(name, '')))]
    assert not stale, 'Remove exceptions that no longer match anything:\n' + '\n'.join(stale)


def test_the_pattern_catches_quoted_literals_only():
    synthetic = 'Synthetic voice'
    names = {digest(synthetic)}
    for line in (f"VOICES = ('{synthetic}',)", f'name = "{synthetic}"', f'const v=`{synthetic}`;'):
        assert any(digest(m.group(2).strip()) in names for m in LITERAL.finditer(line)), line
    assert not any(digest(m.group(2).strip()) in names for m in LITERAL.finditer(f'# {synthetic} in a comment'))
