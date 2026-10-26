"""The plugin's live checks use this checkout's skills, never whatever is installed in a Codex home (#100)."""
import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LIVE = REPO / 'plugins/reader/tests/live'


def load():
    spec = importlib.util.spec_from_file_location('skill_paths', LIVE / 'skill_paths.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_live_checks_resolve_the_upkeep_helper_from_this_checkout():
    helper = load().upkeep_helper([], {})
    assert helper == REPO / 'skills/upkeep/scripts/check.py'
    assert helper.is_file()


def test_an_installed_skill_is_used_only_when_asked(tmp_path):
    paths = load()
    assert paths.upkeep_helper(['--installed-skill'], {'CODEX_HOME': str(tmp_path)}) == tmp_path / 'skills/upkeep/scripts/check.py'
    assert paths.upkeep_helper(['--installed-skill'], {}) == Path.home() / '.codex/skills/upkeep/scripts/check.py'
    assert paths.upkeep_helper(['--other'], {'CODEX_HOME': str(tmp_path)}) == REPO / 'skills/upkeep/scripts/check.py'


def test_no_live_check_reads_a_codex_home_directly():
    for script in sorted(LIVE.glob('*.py')):
        if script.name != 'skill_paths.py':
            assert '.codex' not in script.read_text(), script.name
