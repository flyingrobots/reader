#!/usr/bin/env python3
"""Bind this code checkout to a private vault and install its local Codex integrations."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', required=True, type=Path)
    parser.add_argument('--replace-existing', action='store_true', help='Replace integrations belonging to this same vault')
    args = parser.parse_args()
    code = Path(__file__).resolve().parents[1]
    vault = args.vault.expanduser().resolve(strict=True)
    if vault == code or not all((vault / p).is_dir() for p in ('library', 'inbox')):
        sys.exit('Choose a separate existing vault with library/ and inbox/.')
    python = code / '.venv/bin/python'
    if not python.is_file():
        sys.exit('Run uv sync --locked in the code checkout first.')
    codex = shutil.which('codex')
    if not codex:
        sys.exit('codex must be available on PATH.')
    home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
    links = []
    for name in ('reader', 'upkeep', 'reflective-reading'):
        link, target = home / 'skills' / name, code / 'skills' / name
        if link.exists() or link.is_symlink():
            if not link.is_symlink() or link.resolve() not in (target, vault / 'skills' / name):
                sys.exit(f'Refusing to replace an unrelated skill: {link}')
            if link.resolve() != target and not args.replace_existing:
                sys.exit('Pass --replace-existing to migrate this vault\'s existing skills.')
        links.append((link, target))
    command = [str(python), '-m', 'reader_mcp.cli', '--root', str(vault), 'serve']
    existing = subprocess.run([codex, 'mcp', 'get', 'reader', '--json'], capture_output=True, text=True)
    replace = False
    if existing.returncode == 0:
        transport = json.loads(existing.stdout).get('transport', {})
        if transport.get('command') != command[0] or transport.get('args') != command[1:]:
            old = [str(vault / '.venv/bin/python'), '-m', 'reader_mcp.cli', '--root', str(vault), 'serve']
            if not args.replace_existing or transport.get('command') != old[0] or transport.get('args') != old[1:]:
                sys.exit('Refusing to replace a different MCP server named reader.')
            replace = True
    elif 'No MCP server named' not in existing.stderr:
        sys.exit(existing.stderr or 'Could not inspect MCP configuration.')
    runtime = code / '.reader'
    runtime.mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=runtime, delete=False) as out:
        json.dump({'vault': str(vault)}, out)
        temporary = Path(out.name)
    os.replace(temporary, runtime / 'config.json')
    if replace:
        subprocess.run([codex, 'mcp', 'remove', 'reader'], check=True)
    if replace or existing.returncode:
        try:
            subprocess.run([codex, 'mcp', 'add', 'reader', '--', *command], check=True)
        except subprocess.CalledProcessError:
            if replace:
                subprocess.run([codex, 'mcp', 'add', 'reader', '--', *old], check=True)
            raise
    for link, target in links:
        link.parent.mkdir(parents=True, exist_ok=True)
        if link.is_symlink() and link.resolve() == target:
            continue
        pending = link.with_name(link.name + '.reader-install')
        if pending.exists() or pending.is_symlink():
            sys.exit(f'Existing installation temporary path: {pending}')
        pending.symlink_to(target, target_is_directory=True)
        os.replace(pending, link)
    print(f'Reader code: {code}\nPrivate vault: {vault}\nMCP and three skills installed.')


if __name__ == '__main__':
    main()
