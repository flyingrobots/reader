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
            return SimpleNamespace(returncode=0, stdout='Filesystem 1024-blocks Used Available Capacity Mounted\nroot 999999999 0 999999999 0% /\n')

        monkeypatch.setattr(trial, 'call', fake_call)
        monkeypatch.setattr(trial.shutil, 'disk_usage', lambda _: SimpleNamespace(free=10**12))
        monkeypatch.setattr(trial.shutil, 'which', lambda _: '/fake/devcontainer')
        monkeypatch.setattr(trial.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=0))
        monkeypatch.setattr(trial.subprocess, 'Popen', lambda *a, **k: child)
        monkeypatch.setattr(trial, 'build_image', lambda *a, **k: None, raising=False)
        monkeypatch.setattr(trial, 'measure', lambda _, **kwargs: (_ for _ in ()).throw(RuntimeError('synthetic setup failure')))
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


def test_image_preparation_has_contract_and_cleanup_scope(monkeypatch, capsys):
    class BuildStopped(Exception):
        pass
    calls = []

    def fake_call(*args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=1 if args[:2] == ('docker', 'inspect') else 0, stderr='', stdout='Filesystem 1024-blocks Used Available Capacity Mounted\nroot 999999999 0 999999999 0% /\n')

    def stop_build(*args, **kwargs):
        assert 'launch_contract' in capsys.readouterr().out, 'Image preparation must follow its launch contract'
        raise BuildStopped()

    monkeypatch.setattr(trial, 'call', fake_call)
    monkeypatch.setattr(trial.shutil, 'disk_usage', lambda _: SimpleNamespace(free=10**12))
    monkeypatch.setattr(trial.shutil, 'which', lambda _: '/fake/devcontainer')
    monkeypatch.setattr(trial.subprocess, 'run', stop_build)
    monkeypatch.setattr(trial, 'build_image', stop_build, raising=False)
    with pytest.raises(BuildStopped):
        trial.trial()
    assert ('docker', 'rm', '-f', trial.NAME) in calls, 'Build-stage failure still enters cleanup'


@pytest.mark.parametrize('failure', ['output', 'deadline'])
def test_watched_commands_stop_at_output_or_deadline(tmp_path, monkeypatch, failure):
    children = []
    actual_popen = subprocess.Popen

    def record(*args, **kwargs):
        child = actual_popen(*args, **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(trial.subprocess, 'Popen', record)
    monkeypatch.setattr(trial, 'LIMIT', 1024)
    script = 'import time;time.sleep(30)' if failure == 'deadline' else 'print("x"*10000)'
    expected = TimeoutError if failure == 'deadline' else RuntimeError
    log = tmp_path / 'command.log'
    with pytest.raises(expected, match='deadline' if failure == 'deadline' else 'data/log limit'):
        trial.watch([sys.executable, '-c', script], log, trial.time.monotonic() + .3)
    assert log.stat().st_size <= 1024
    assert len(children) == 1 and children[0].poll() is not None


def test_each_probe_uses_remaining_shared_deadline(monkeypatch):
    now, seen = [10.0], []
    monkeypatch.setattr(trial.time, 'monotonic', lambda: now[0])

    def run(*args, **kwargs):
        seen.append(kwargs['timeout'])
        now[0] += kwargs['timeout']
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(trial.subprocess, 'run', run)
    trial.call('docker', 'inspect', trial.NAME, deadline=12.5)
    assert seen == [2.5]
    with pytest.raises(TimeoutError, match='deadline'):
        trial.call('docker', 'inspect', trial.NAME, deadline=12.5)
    assert seen == [2.5], 'No new probe starts after the shared deadline'


def test_unreviewed_image_commands_never_start_a_build(tmp_path, monkeypatch):
    from shutil import copyfile
    config = tmp_path / 'config/devcontainer.json'
    config.parent.mkdir()
    for name in trial.APPROVED_IMAGE_INPUTS:
        copyfile(SCRIPT.parent / name, config.parent / name)
    (config.parent / 'Dockerfile').write_text('FROM node:24.18.0\nRUN unbounded-command\n')
    scratch = tmp_path / 'scratch'
    scratch.mkdir()
    started = []
    monkeypatch.setattr(trial, 'watch', lambda *a, **k: started.append(a))
    with pytest.raises(RuntimeError, match='Image configuration changed'):
        trial.build_image(config, 'reader-development:local', scratch, trial.time.monotonic() + 1, lambda: None)
    assert started == []
