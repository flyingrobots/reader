"""Refuse to run tests outside the enforced test sandbox (scripts/test_jail.py, docs/testing.md).

An environment variable alone proves nothing, since anyone can set it. Inside the sandbox the runner's probe
directory refuses writes, so a write that succeeds there means no sandbox is active. CI runs in containers instead,
which say so with READER_TEST_JAIL=container and the container runtime's marker file.
"""
import os
from pathlib import Path

MESSAGE = ('Refusing to run tests outside the enforced test sandbox. Run them through scripts/test_jail.py, for example\n'
           '  python3 scripts/test_jail.py -- .venv/bin/python -m pytest -q\n'
           'See docs/testing.md.')


def problem(environ=None):
    """Why this process may not run tests, or None inside the sandbox or a marked container."""
    environ = os.environ if environ is None else environ
    mode = environ.get('READER_TEST_JAIL')
    if mode == 'container':
        if Path('/.dockerenv').exists() or Path('/run/.containerenv').exists():
            return None
        return 'READER_TEST_JAIL=container is set, but this is not a container'
    if mode != 'sandbox-exec':
        return 'not started by scripts/test_jail.py'
    probe = environ.get('READER_TEST_JAIL_PROBE')
    if not probe:
        return 'the sandbox probe is not named'
    target = Path(probe) / f'guard-{os.getpid()}'
    try:
        target.write_text('')
    except PermissionError:
        return None
    except OSError as exc:
        return f'the sandbox probe cannot be checked: {exc}'
    target.unlink(missing_ok=True)
    return 'the sandbox probe accepted a write, so no sandbox is active'


def require():
    if reason := problem():
        raise SystemExit(f'{MESSAGE}\n({reason})')
