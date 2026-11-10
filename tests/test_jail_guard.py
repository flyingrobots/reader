"""Every test entry point refuses to run outside the enforced sandbox (#251).

The ratchet finds entry files by how the suites are run, not from a list kept by hand, so a new suite without the guard
fails here. The behaviour checks run the guards themselves: they pass in this sandbox and refuse a hand-set variable.
"""
import os
from pathlib import Path
import subprocess
import sys

import jail_guard

ROOT = Path(__file__).resolve().parents[1]
HELPERS = {'tests/web_wait.cjs', 'tests/web_clock.cjs', 'tests/jail_guard.cjs'}
# Not tests: manual acceptance scripts run from a real vault against a running Obsidian, by design.
LIVE_ACCEPTANCE = 'plugins/reader/tests/live/'


def entry_files():
    """Every file a test runner starts: browser and node suites, contract, server and plugin tests."""
    patterns = ['tests/*.cjs', 'tests/*.test.mjs', 'tests/contract/*.test.mjs', 'server/test/*.test.mjs', 'plugins/reader/tests/*.test.ts']
    found = sorted({p.relative_to(ROOT).as_posix() for pattern in patterns for p in ROOT.glob(pattern)})
    return [name for name in found if name not in HELPERS]


def test_every_test_entry_file_loads_the_guard_first():
    files = entry_files()
    assert len(files) > 120  # witness: 100 browser suites alone
    missing = []
    for name in files:
        text = (ROOT / name).read_text()
        if name.startswith('tests/contract/'):
            # Contract tests reach the guard through their harness, which is checked below.
            ok = "from './harness.mjs'" in text
        else:
            ok = 'jail_guard.cjs' in text
        if not ok:
            missing.append(name)
    assert not missing, 'Load tests/jail_guard.cjs first in: ' + ', '.join(missing)
    assert "import '../jail_guard.cjs';" in (ROOT / 'tests/contract/harness.mjs').read_text()


def test_python_entry_points_use_the_guard():
    for name in ('tests/conftest.py', 'tests/web_fixture.py', 'scripts/run_browser_suites.py'):
        assert 'jail_guard' in (ROOT / name).read_text(), name
    assert not list(ROOT.glob(LIVE_ACCEPTANCE + '*.test.*')), 'live acceptance scripts are not automated tests'


def test_the_guards_accept_this_sandbox():
    assert jail_guard.problem() is None
    done = subprocess.run(['node', str(ROOT / 'tests/jail_guard.cjs')], capture_output=True, text=True, timeout=30)
    assert done.returncode == 0, done.stderr


def test_the_guards_refuse_a_hand_set_variable_outside_a_sandbox(tmp_path):
    # A writable probe is what a process outside the sandbox sees, whatever its environment claims.
    spoofed = dict(os.environ, READER_TEST_JAIL='sandbox-exec', READER_TEST_JAIL_PROBE=str(tmp_path))
    assert 'no sandbox is active' in jail_guard.problem(spoofed)
    for command in (['node', str(ROOT / 'tests/jail_guard.cjs')],
                    [sys.executable, '-c', 'import jail_guard; jail_guard.require()']):
        done = subprocess.run(command, capture_output=True, text=True, timeout=30, env=spoofed, cwd=ROOT / 'tests')
        assert done.returncode != 0 and 'scripts/test_jail.py' in done.stderr, command


def test_the_guards_refuse_when_not_started_by_the_runner():
    bare = {k: v for k, v in os.environ.items() if not k.startswith('READER_TEST_JAIL')}
    assert jail_guard.problem(bare) == 'not started by scripts/test_jail.py'
    done = subprocess.run(['node', str(ROOT / 'tests/jail_guard.cjs')], capture_output=True, text=True, timeout=30, env=bare)
    assert done.returncode == 2 and 'not started by scripts/test_jail.py' in done.stderr


def test_a_container_marker_needs_a_container():
    marked = {'READER_TEST_JAIL': 'container'}
    inside = Path('/.dockerenv').exists() or Path('/run/.containerenv').exists()
    assert (jail_guard.problem(marked) is None) == inside
