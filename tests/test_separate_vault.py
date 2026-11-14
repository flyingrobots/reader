"""Configuration must never mistake the software checkout for private content."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess

import pytest

SPEC = importlib.util.spec_from_file_location('reader_paths', Path(__file__).parents[1] / 'scripts/reader_paths.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def test_vault_is_explicit_and_external(tmp_path, monkeypatch):
    monkeypatch.delenv('READER_ROOT', raising=False)
    code = tmp_path / 'software'; code.mkdir()
    with pytest.raises(ValueError, match='No private vault'):
        module.paths(code)
    vault = tmp_path / 'private'; vault.mkdir()
    for name in ('library', 'inbox'):
        (vault / name).mkdir()
    (code / '.reader').mkdir()
    (code / '.reader/config.json').write_text(json.dumps({'vault': str(vault)}))
    assert module.paths(code) == (code, vault)
    monkeypatch.setenv('READER_ROOT', str(code))
    with pytest.raises(ValueError, match='separate Reader vault'):
        module.paths(code)


def test_override_and_invalid_vault(tmp_path, monkeypatch):
    code = tmp_path / 'software'; code.mkdir()
    vault = tmp_path / 'private'; vault.mkdir()
    monkeypatch.setenv('READER_ROOT', str(vault))
    with pytest.raises(ValueError):
        module.paths(code)
    for name in ('library', 'inbox'):
        (vault / name).mkdir()
    assert module.paths(code) == (code, vault)


def checkout(path):
    path.mkdir(parents=True)
    (path / 'src').mkdir()
    subprocess.run(['git', 'init', '-q', str(path)], check=True)
    return path


def service(tmp_path, monkeypatch, **state):
    monkeypatch.setenv('HOME', str(tmp_path / 'home'))
    file = tmp_path / 'home/Library/Application Support/Reader/service.json'
    file.parent.mkdir(parents=True)
    file.write_text(json.dumps(state))


def vault_at(tmp_path):
    vault = tmp_path / 'private'
    (vault / 'library').mkdir(parents=True)
    return vault


def test_skills_run_the_services_live_checkout_with_its_interpreter(tmp_path, monkeypatch):
    for name in ('READER_ROOT', 'READER_CODE'):
        monkeypatch.delenv(name, raising=False)
    repo, vault = checkout(tmp_path / 'reader-code'), vault_at(tmp_path)
    live = tmp_path / 'live'
    subprocess.run(['git', '-C', str(repo), 'commit', '-q', '--allow-empty', '-m', 'x'], check=True,
                   env={**os.environ, 'GIT_AUTHOR_NAME': 'F', 'GIT_AUTHOR_EMAIL': 'f@example.invalid', 'GIT_COMMITTER_NAME': 'F', 'GIT_COMMITTER_EMAIL': 'f@example.invalid'})
    subprocess.run(['git', '-C', str(repo), 'worktree', 'add', '-q', '--detach', str(live)], check=True)
    python = tmp_path / 'python'
    python.write_text('')
    service(tmp_path, monkeypatch, repo=str(repo), live=str(live), python=str(python), vault=str(vault))
    # A skill linked into the developer checkout, which is on some other branch, still runs live code.
    code, found, interpreter, env = module.runtime(repo)
    assert (code, found, interpreter, env['PYTHONPATH']) == (live.resolve(), vault.resolve(), python, str(live.resolve() / 'src'))
    # A skill linked into the live checkout finds the vault from the service, which has no config file there.
    assert module.runtime(live)[:3] == (live.resolve(), vault.resolve(), python)


def test_a_service_for_another_repository_or_an_override_is_respected(tmp_path, monkeypatch):
    monkeypatch.delenv('READER_CODE', raising=False)
    own, other, vault = checkout(tmp_path / 'own'), checkout(tmp_path / 'other'), vault_at(tmp_path)
    monkeypatch.setenv('READER_ROOT', str(vault))
    (tmp_path / 'python').write_text('')
    service(tmp_path, monkeypatch, repo=str(other), live=str(other), python=str(tmp_path / 'python'), vault=str(vault))
    code, _, interpreter, env = module.runtime(own)
    assert (code, interpreter, env['PYTHONPATH']) == (own.resolve(), own.resolve() / '.venv/bin/python', str(own.resolve() / 'src'))
    monkeypatch.setenv('READER_CODE', str(other))
    assert module.runtime(own)[0] == other.resolve()
