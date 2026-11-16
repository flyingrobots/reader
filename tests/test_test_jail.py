"""The sandbox runner refuses to start when it cannot protect the live Reader (#247)."""
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('test_jail', Path(__file__).resolve().parents[1] / 'scripts/test_jail.py')
test_jail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(test_jail)


def test_a_checkout_inside_a_protected_path_is_refused(tmp_path):
    with pytest.raises(test_jail.JailError, match='overlap'):
        test_jail.protected_paths(root=tmp_path / 'checkout', extra=[tmp_path])


def test_an_unreadable_service_record_is_refused(tmp_path, monkeypatch):
    record = tmp_path / 'service.json'
    record.write_text('{not json')
    monkeypatch.setattr(test_jail, 'SERVICE', record)
    with pytest.raises(test_jail.JailError, match='service record'):
        test_jail.protected_paths(root=tmp_path / 'checkout')


def test_the_service_record_names_the_vault_and_port_to_protect(tmp_path, monkeypatch):
    record = tmp_path / 'service.json'
    record.write_text('{"vault": "/srv/example-vault", "live": "/srv/example-live", "port": 9123}')
    monkeypatch.setattr(test_jail, 'SERVICE', record)
    protected = test_jail.protected_paths(root=tmp_path / 'checkout')
    assert Path('/srv/example-vault') in protected and Path('/srv/example-live') in protected
    assert 9123 in test_jail.denied_ports()
