"""Resolve the software checkout separately from the user's private vault."""
import json
import os
from pathlib import Path
import subprocess


def service_state():
    """The installed Reader service's state (see scripts/reader_service.py), or None."""
    file = Path.home() / 'Library/Application Support/Reader/service.json'
    if not file.is_file() or file.is_symlink() or file.stat().st_size > 1024**2:
        return None
    try:
        state = json.loads(file.read_text())
    except ValueError:
        return None
    return state if isinstance(state, dict) and all(isinstance(state.get(k), str) for k in ('repo', 'live', 'python')) else None


def git_common_dir(path):
    try:
        result = subprocess.run(['git', '-C', str(path), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                                capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return Path(result.stdout.strip()).resolve() if result.returncode == 0 else None


def serving(code):
    """The service state when it serves this checkout's repository, so skills and the server run the same code."""
    state = service_state()
    if not state or not Path(state['live']).is_dir() or not Path(state['python']).is_file():
        return None
    mine = git_common_dir(code)
    return state if mine and mine == git_common_dir(state['repo']) else None


def paths(code=None):
    code = Path(code or Path(__file__).resolve().parents[1]).resolve()
    config = code / '.reader/config.json'
    value = os.environ.get('READER_ROOT')
    if not value and config.is_file():
        value = json.loads(config.read_text()).get('vault')
    if not value:
        state = serving(code)
        value = state.get('vault') if state else None
    if not value:
        raise ValueError('No private vault configured. Run scripts/install.py --vault PATH or set READER_ROOT.')
    vault = Path(value).expanduser().resolve(strict=True)
    if vault == code or not (vault / 'library').is_dir():
        raise ValueError('Expected a separate Reader vault with a library/ directory')
    return code, vault


def runtime(code=None):
    """(code, vault, python, env) for running Reader as `python -m reader_mcp.cli`.

    The installed service's smoke-tested live checkout and interpreter when the service serves this repository, so
    a skill linked into a developer checkout never runs whatever branch that checkout is on. READER_CODE names
    another checkout instead, for trying a branch on purpose. Otherwise this checkout and its own .venv."""
    own, vault = paths(code)
    state = serving(own)
    override = os.environ.get('READER_CODE')
    if override:
        chosen = Path(override).expanduser().resolve(strict=True)
    else:
        chosen = Path(state['live']).resolve() if state else own
    python = chosen / '.venv/bin/python'
    if not python.is_file() and state:
        python = Path(state['python'])
    elif not python.is_file():
        python = own / '.venv/bin/python'
    return chosen, vault, python, dict(os.environ, PYTHONPATH=str(chosen / 'src'))


if __name__ == '__main__':
    code, vault = paths()
    print(json.dumps({'code': str(code), 'vault': str(vault)}))
