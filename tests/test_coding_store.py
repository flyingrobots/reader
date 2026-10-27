import os

from reader_mcp import coding_store
from reader_mcp.coding_store import Store


def test_runs_keeps_the_newest_records_when_there_are_more_than_the_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(coding_store, 'MAX_RUNS', 2)
    store = Store(tmp_path)
    # File names (random UUIDs) sort opposite to creation time here: the newest run has the largest name.
    for second, run_id in ((0, '00000000-0000-4000-8000-000000000000'), (60, '77777777-7777-4777-8777-777777777777'),
                           (120, 'ffffffff-ffff-4fff-bfff-ffffffffffff')):
        store.save({'id': run_id, 'created_at': f'2026-10-21T12:{second // 60:02d}:00+00:00'})
        os.utime(store.runtime / 'runs' / (run_id + '.json'), (1_800_000_000 + second, 1_800_000_000 + second))
    assert [run['id'][:2] for run in store.runs()] == ['ff', '77']
