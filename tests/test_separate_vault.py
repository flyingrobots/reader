"""Configuration must never mistake the software checkout for private content."""
import importlib.util
import json
from pathlib import Path
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
