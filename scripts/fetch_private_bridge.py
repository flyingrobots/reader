#!/usr/bin/env python3
"""Download the private shelf's pinned packages into .reader/npm-cache, so tests/web_private.cjs installs them offline.

Run it with the other installs, outside the test sandbox, which refuses the network. When the suite installs from the
cache, npm checks every tarball against the integrity hash in src/reader_mcp/private_bridge/package-lock.json.
"""
from pathlib import Path
import json
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'src/reader_mcp/private_bridge/package-lock.json'
CACHE = ROOT / '.reader/npm-cache'


def tarballs(lock=LOCK):
    packages = json.loads(lock.read_text())['packages']
    return sorted(entry['resolved'] for name, entry in packages.items() if name and 'resolved' in entry)


def main():
    npm = shutil.which('npm')
    if not npm:
        sys.exit('npm was not found')
    wanted = tarballs()
    CACHE.mkdir(parents=True, exist_ok=True)
    subprocess.run([npm, 'cache', 'add', '--cache', str(CACHE), *wanted], check=True)
    print(f'cached {len(wanted)} packages in {CACHE.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
