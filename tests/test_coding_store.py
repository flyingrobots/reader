import os

import pytest

from reader_mcp import coding_store, llm_logs
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


def test_an_event_larger_than_a_page_in_bytes_is_truncated_so_paging_advances(tmp_path):
    log = llm_logs.RunLog(tmp_path, 'coding-job', 'unicode', {})
    capture = coding_store.Capture(log)
    # 140,000 emoji are under the event limit in characters but four times larger in UTF-8 bytes.
    capture.event('unicode', 'agent', text='\U0001F600' * 140000)
    capture.close()
    rows, more = coding_store.archived_events(tmp_path, log.relative, 0)
    assert rows and rows[0]['truncated'] and not more


def test_a_record_too_large_to_read_back_is_refused_not_written(tmp_path):
    store = Store(tmp_path)
    run = {'id': '11111111-1111-4111-8111-111111111111', 'git': {'changed_paths': ['a' * 600 + str(i) for i in range(2000)]}}
    with pytest.raises(ValueError):
        store.save(run)
    assert not (store.runtime / 'runs' / (run['id'] + '.json')).exists()
