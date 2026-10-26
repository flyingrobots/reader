"""Skill helpers for the live checks: this checkout's copy by default, an installed copy only when asked."""
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]


def upkeep_helper(argv, environ):
    """`skills/upkeep/scripts/check.py` in this checkout; with `--installed-skill`, the copy under CODEX_HOME (default ~/.codex)."""
    if '--installed-skill' in argv:
        return Path(environ.get('CODEX_HOME') or Path.home() / '.codex') / 'skills/upkeep/scripts/check.py'
    return REPO / 'skills/upkeep/scripts/check.py'
