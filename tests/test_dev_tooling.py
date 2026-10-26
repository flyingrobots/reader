"""Development tooling resolves from this checkout, not from somewhere else.

Browser suites load Playwright from the repository's own pinned devDependency
(#14), and Python tests import this checkout's ``src`` even when the virtual
environment is an editable install of another worktree (#15).
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import reader_mcp

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'src'


def test_playwright_core_is_an_exact_root_dev_dependency():
    manifest = json.loads((ROOT / 'package.json').read_text())
    assert manifest['private'] is True
    assert 'dependencies' not in manifest
    pin = manifest['devDependencies']['playwright-core']
    assert re.fullmatch(r'\d+\.\d+\.\d+', pin), pin
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    assert lock['packages']['']['devDependencies'] == manifest['devDependencies']
    locked = lock['packages']['node_modules/playwright-core']
    assert locked['version'] == pin and locked['dev'] is True and locked['integrity'].startswith('sha512-')


def test_browser_suites_resolve_playwright_by_default_with_an_override():
    suites = sorted((ROOT / 'tests').glob('web_*.cjs'))
    assert suites
    load = re.compile(r"require\(process\.env\.READER_PLAYWRIGHT\s*\|\|\s*'playwright-core'\)")
    missing = [p.name for p in suites if 'playwright' in p.read_text() and not load.search(p.read_text())]
    assert missing == []


def test_imports_this_checkouts_src():
    assert Path(reader_mcp.__file__).resolve().is_relative_to(SRC.resolve())


def test_subprocess_from_another_cwd_imports_this_checkouts_src(tmp_path):
    out = subprocess.run([sys.executable, '-c', 'import reader_mcp; print(reader_mcp.__file__)'],
                         cwd=tmp_path, env=os.environ.copy(), capture_output=True, text=True, check=True).stdout.strip()
    assert Path(out).resolve().is_relative_to(SRC.resolve())
