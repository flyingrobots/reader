"""The browser-suite runner's contracts (#286): which browser a suite launches, and how a missing prerequisite is reported."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import fetch_private_bridge  # noqa: E402
import run_browser_suites  # noqa: E402

SHARED_DEFAULT = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def test_every_suite_launches_the_configured_browser_or_the_shared_default():
    # Oracle: docs/testing.md says READER_CHROME overrides the browser; a suite with its own default fails on a host
    # where only the documented default exists.
    defaults = {}
    for name in run_browser_suites.suites([]):
        for found in re.findall(r"executablePath:\s*process\.env\.READER_CHROME\s*\|\|\s*'([^']*)'", (ROOT / f'tests/{name}.cjs').read_text()):
            defaults.setdefault(found, []).append(name)
    assert sum(map(len, defaults.values())) > 100  # witness: the scan finds the suites
    others = {path: names for path, names in defaults.items() if path != SHARED_DEFAULT}
    assert not others, f'suites with their own browser default: {others}'


def test_a_skip_status_is_neither_a_pass_nor_a_failure():
    assert run_browser_suites.verdict(run_browser_suites.SKIP) == 'skip'
    assert run_browser_suites.verdict(0) == 'ok'
    assert run_browser_suites.verdict(None) == 'TIMEOUT'
    for code in (1, 2, 76, 78, -9):
        assert run_browser_suites.verdict(code) == f'FAIL ({code})', code


def test_missing_lists_each_wanted_tarball_absent_from_the_cache_listing():
    wanted = ['https://registry.npmjs.org/a/-/a-1.0.0.tgz', 'https://registry.npmjs.org/b/-/b-2.0.0.tgz']
    key = 'make-fetch-happen:request-cache:'
    assert fetch_private_bridge.missing(wanted, []) == wanted
    assert fetch_private_bridge.missing(wanted, [key + wanted[0]]) == wanted[1:]
    assert fetch_private_bridge.missing(wanted, [key + url for url in wanted]) == []
    # A key for a different version does not count as the pinned one.
    assert fetch_private_bridge.missing(wanted[:1], [key + wanted[0].replace('1.0.0', '1.0.1')]) == wanted[:1]
