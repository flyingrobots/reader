import os
from datetime import datetime, timezone

import pytest

from reader_mcp import llm_inventory
from reader_mcp.llm_logs import RunLog


def run(root, name, minute):
    log = RunLog(root, 'chat', name, {'runner': 'chat'}, now=datetime(2026, 10, 21, 12, minute, tzinfo=timezone.utc))
    log.write('prompt.txt', 'synthetic')
    return log


def every_page(root, after_first=None):
    rows, cursor, pages = [], None, 0
    while True:
        page = llm_inventory.page(root, cursor=cursor, limit=1)
        rows += [r['run_id'] for r in page['runs']]
        pages += 1
        if pages == 1 and after_first:
            after_first()
        cursor = page['next']
        if not cursor or pages > 10:
            return rows


def test_pages_list_a_days_runs_newest_first(tmp_path):
    for minute, name in enumerate(['first', 'second', 'third']):
        run(tmp_path, name, minute)
    assert every_page(tmp_path) == ['third', 'second', 'first']


def test_a_run_that_writes_while_paging_neither_repeats_nor_drops_a_row(tmp_path):
    logs = [run(tmp_path, name, minute) for minute, name in enumerate(['first', 'second', 'third'])]
    # A still-running log keeps writing artifacts, which moves its folder's modification time.
    touch = lambda: (logs[0].write('stdout.jsonl', 'more'), os.utime(logs[0].dir, (2_000_000_000, 2_000_000_000)))
    assert every_page(tmp_path, after_first=touch) == ['third', 'second', 'first']


def test_page_refuses_unknown_kinds_and_cursors(tmp_path):
    with pytest.raises(ValueError):
        llm_inventory.page(tmp_path, kind='no-such-kind')
    with pytest.raises(ValueError):
        llm_inventory.page(tmp_path, cursor='../outside')


def test_a_day_lists_every_kinds_runs_newest_first(tmp_path):
    for kind, name, hour in (('coding-job', 'older', 1), ('chat', 'newer', 2)):
        RunLog(tmp_path, kind, name, {}, now=datetime(2026, 10, 21, hour, tzinfo=timezone.utc)).finish('done')
    assert [r['run_id'] for r in llm_inventory.page(tmp_path)['runs']] == ['newer', 'older']
