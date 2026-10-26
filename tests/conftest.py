"""Pin the tests to this checkout's ``src`` (#15).

The shared virtual environment can be an editable install of a different
worktree, which would silently test that worktree's code. Put this checkout's
absolute ``src`` first for this process and for subprocesses (an absolute path,
so a subprocess started from another cwd still finds it), then fail fast if
``reader_mcp`` still resolves elsewhere.
"""
import os
from pathlib import Path
import sys
import threading

import pytest

SRC = str(Path(__file__).resolve().parents[1] / 'src')
if 'reader_mcp' in sys.modules:
    raise RuntimeError(f'reader_mcp was imported before tests/conftest.py could pin {SRC}')
sys.path.insert(0, SRC)
os.environ['PYTHONPATH'] = os.pathsep.join([SRC, *[p for p in os.environ.get('PYTHONPATH', '').split(os.pathsep) if p and p != SRC]])

import reader_mcp  # noqa: E402

if not Path(reader_mcp.__file__).resolve().is_relative_to(Path(SRC).resolve()):
    raise RuntimeError(f'reader_mcp resolved to {reader_mcp.__file__}, outside {SRC}')


@pytest.fixture(autouse=True)
def close_test_libraries(monkeypatch):
    """A synthetic Reader's background workers belong to the test that created it.

    Several older read-only fixtures did not close WebLibrary. Running them together
    exhausted a bounded worker's process limit even though individual modules passed.
    """
    from reader_mcp.web import WebLibrary
    from reader_mcp.voice_runner import VoiceRunner
    created, runners = [], []
    before = set(threading.enumerate())
    original = WebLibrary.__init__

    def tracked(self, *args, **kwargs):
        original(self, *args, **kwargs)
        created.append(self)

    monkeypatch.setattr(WebLibrary, '__init__', tracked)
    runner_init = VoiceRunner.__init__
    def tracked_runner(self, *args, **kwargs):
        runner_init(self, *args, **kwargs)
        runners.append(self)
    monkeypatch.setattr(VoiceRunner, '__init__', tracked_runner)
    yield
    for library in reversed(created):
        library.close()
    for runner in reversed(runners):
        runner.close()
    for thread in set(threading.enumerate()) - before:
        if thread.name.startswith('reader-'):
            thread.join(timeout=5)
