"""Failure-path evidence for the setup experiment; no real Docker daemon calls."""
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'planning/devcontainers/trial.py'
spec = importlib.util.spec_from_file_location('reader_devcontainer_trial', SCRIPT)
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)


def test_docker_cleanup_timeout_still_reaps_sigterm_ignoring_cli(monkeypatch):
    child = subprocess.Popen([sys.executable, '-c',
        'import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);print("ready",flush=True);time.sleep(300)'],
        stdout=subprocess.PIPE, text=True, start_new_session=True)
    try:
        assert child.stdout.readline().strip() == 'ready'
        inspections = 0

        def fake_call(*args, **kwargs):
            nonlocal inspections
            if args[:2] == ('docker', 'inspect'):
                inspections += 1
                return SimpleNamespace(returncode=1 if inspections == 1 else 0)
            if args[:2] == ('docker', 'rm'):
                raise subprocess.TimeoutExpired(args, 15)
            return SimpleNamespace(returncode=0)

        monkeypatch.setattr(trial, 'call', fake_call)
        monkeypatch.setattr(trial.shutil, 'disk_usage', lambda _: SimpleNamespace(free=10**12))
        monkeypatch.setattr(trial.shutil, 'which', lambda _: '/fake/devcontainer')
        monkeypatch.setattr(trial.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=0))
        monkeypatch.setattr(trial.subprocess, 'Popen', lambda *a, **k: child)
        monkeypatch.setattr(trial, 'measure', lambda _: (_ for _ in ()).throw(RuntimeError('synthetic setup failure')))
        with pytest.raises(subprocess.TimeoutExpired):
            trial.trial()
        assert child.poll() is not None, 'Docker cleanup failure must not bypass CLI reaping'
    finally:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait(timeout=5)
        child.stdout.close()
