"""Resource accounting must tolerate journals removed by a live SQLite writer."""
from pathlib import Path
import pytest
from reader_mcp.search_guard import usage


def test_usage_tolerates_disappearance_after_type_check(tmp_path, monkeypatch):
    journal = tmp_path / "embedding-cache.sqlite3-journal"
    journal.write_bytes(b"temporary")
    (tmp_path / "stable").write_bytes(b"stable")
    original = Path.stat
    calls = 0

    def racing_stat(path, *args, **kwargs):
        nonlocal calls
        if path == journal:
            calls += 1
            if calls == 2:
                journal.unlink()
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", racing_stat)
    assert usage(tmp_path) == len(b"stable")


def test_usage_does_not_hide_measurement_failures(tmp_path, monkeypatch):
    target = tmp_path / "data"
    target.write_bytes(b"data")
    original = Path.stat

    def denied(path, *args, **kwargs):
        if path == target:
            raise PermissionError("measurement unavailable")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", denied)
    with pytest.raises(PermissionError, match="measurement unavailable"):
        usage(tmp_path)
