"""Maintenance jobs and freshness checks against isolated synthetic vaults."""
import threading
import time

import pytest

from reader_mcp.maintenance import Maintenance


def wait(m, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = m.status()
        if not status['running'] and not status['checking']:
            return status
        time.sleep(.05)
    raise AssertionError('maintenance job did not finish')


@pytest.fixture
def vault(tmp_path):
    (tmp_path / 'library').mkdir()
    (tmp_path / 'inbox').mkdir()
    (tmp_path / 'library/a.md').write_text('# A\n\nCareful reading of a quiet library.\n')
    (tmp_path / 'library/b.md').write_text('# B\n\nAnother passage about ledgers.\n')
    return tmp_path


def test_status_shape_and_missing_indexes(vault):
    m = Maintenance(vault)
    assert m.status() == {'running': None, 'jobs': [], 'checks': {}, 'checking': False, 'kinds': m.status()['kinds']}
    assert m.check() == {'search': 'missing', 'browse': 'unconfigured', 'catalog': 'missing', 'links': 'missing', 'limits': 'ok'}
    checks = m.status()['checks']
    assert checks['search']['files'] == 2 and checks['search']['checked_at']


def test_one_job_at_a_time_and_failures_are_recorded(vault):
    gate = threading.Event()
    def slow():
        gate.wait(5)
        return {'documents': 1}
    def broken():
        raise ValueError('Synthetic failure')
    m = Maintenance(vault, {'search': slow, 'catalog': broken, 'check': lambda: {}})
    job = m.start('search')
    assert job['state'] == 'running' and m.status()['running']['id'] == job['id']
    with pytest.raises(BlockingIOError):
        m.start('catalog')
    gate.set()
    status = wait(m)
    assert status['jobs'][0]['state'] == 'succeeded' and status['jobs'][0]['result'] == {'documents': 1}
    m.start('catalog')
    status = wait(m)
    assert status['jobs'][0]['state'] == 'failed' and status['jobs'][0]['error'] == 'Synthetic failure'
    with pytest.raises(ValueError):
        m.start('nonsense')


def test_real_keyword_index_then_check_reports_partial_then_stale(vault):
    m = Maintenance(vault)
    m.start('search-keyword')
    status = wait(m, 120)
    job = status['jobs'][0]
    assert job['state'] == 'succeeded', job['error']
    assert job['result']['documents'] == 2 and job['result']['semantic'] is False
    search = status['checks']['search']
    # Keywords only: every file is indexed, but no text has embeddings yet.
    assert search['state'] == 'partial' and search['unembedded'] == 2 and search['new'] == 0
    (vault / 'library/c.md').write_text('# C\n\nNew arrival.\n')
    m.check()
    search = m.status()['checks']['search']
    assert search['state'] == 'stale' and search['new'] == 1 and 'library/c.md' in search['examples']


def test_limits_card_counts_other_inventories_and_flags_near_limits(vault, monkeypatch):
    import json
    import reader_mcp.annotations as annotations
    (vault / 'indexes').mkdir()
    (vault / 'indexes/coverage.json').write_text(json.dumps({'works': [{'id': 'a'}, {'id': 'b'}]}))
    (vault / 'inbox/README.md').write_text('guide')
    (vault / 'inbox/arrival.md').write_text('new')
    (vault / 'annotations').mkdir()
    for index in range(4):
        (vault / f'annotations/{index}.json').write_text('{}')
    result = Maintenance(vault).limits_check()
    used = {i['key']: (i['used'], i['limit']) for i in result['items']}
    assert used == {'works': (2, 10000), 'inbox': (1, 10000), 'participants': (0, 100), 'threads': (4, 5000)}
    assert result['state'] == 'ok'
    monkeypatch.setattr(annotations, 'MAX_THREADS', 5)
    near = Maintenance(vault).limits_check()
    assert near['state'] == 'near' and 'Annotation threads' in near['message']


def test_search_card_reports_usage_against_budgets(vault):
    import json
    (vault / 'library/receipt.json').write_text('{}')
    (vault / 'indexes').mkdir()
    (vault / 'indexes/settings.json').write_text(json.dumps({'search': {'max_passages': 50, 'max_database_mib': 32}}))
    from reader_mcp.search import Search
    Search(vault).index(False)
    check = Maintenance(vault).search_check()
    assert check['usage']['passages'] == [2, 50] and check['usage']['database'][1] == 32 * 1024 ** 2
    assert 0 < check['usage']['database'][0] <= 32 * 1024 ** 2 and check['path_only_machine'] == 1
    assert check['complete'] is True and check['passages'] == 2


@pytest.mark.parametrize(('kind', 'expected'), [
    ('search', ['search']), ('search-keyword', ['search']), ('remove-legacy-search', ['search']),
    ('browse', ['browse', 'links', 'limits']), ('catalog', ['catalog']), ('links', ['links']),
])
def test_rebuild_verifies_only_affected_projections(vault, monkeypatch, kind, expected):
    m = Maintenance(vault, {kind: lambda: {'changed': 1}})
    old = {'state': 'stale', 'checked_at': '2000-01-01T00:00:00Z', 'message': 'Prior observation'}
    m.checks = {name: dict(old) for name in ('search', 'browse', 'catalog', 'links', 'limits')}
    calls = []
    def probe(name):
        def run():
            calls.append(name)
            return {'state': 'current'}
        return run
    for name in ('search', 'browse', 'catalog', 'limits'):
        monkeypatch.setattr(m, name + '_check', probe(name))
    monkeypatch.setattr(m.links, 'check', probe('links'))
    m.start(kind)
    status = wait(m)
    assert calls == expected
    assert status['jobs'][0]['state'] == 'succeeded'
    for name, result in status['checks'].items():
        if name in expected:
            assert result['state'] == 'current' and result['checked_at'] != old['checked_at']
        else:
            assert result == old, 'An unrelated observation must keep its original age and state'


def test_full_check_publishes_each_result_and_reports_progress(vault, monkeypatch):
    m = Maintenance(vault)
    entered, release = threading.Event(), threading.Event()
    old = {'state': 'current', 'checked_at': '2000-01-01T00:00:00Z'}
    m.checks = {'catalog': old}
    monkeypatch.setattr(m, 'search_check', lambda: {'state': 'stale'})
    def slow_browse():
        entered.set()
        assert release.wait(5)
        raise ValueError('Synthetic invalid metadata')
    monkeypatch.setattr(m, 'browse_check', slow_browse)
    try:
        m.start('check')
        assert entered.wait(5)
        status = m.status()
        assert status['checking'] and status['running']['state'] == 'running'
        assert status['running']['progress'] == 'Checking Browse indexes (2/5)'
        assert status['checks']['search']['state'] == 'stale'
        assert status['checks']['catalog'] == old
        assert status['jobs'] == []
    finally:
        release.set()
    status = wait(m)
    assert status['checks']['browse']['state'] == 'error'
    assert status['checks']['browse']['message'] == 'Synthetic invalid metadata'
    assert status['checks']['catalog']['state'] == 'missing'
    assert status['jobs'][0]['result']['limits'] == 'ok', 'Later probes still run after an error'


def test_rebuild_keeps_admission_until_verification_finishes(vault, monkeypatch):
    m = Maintenance(vault, {'search': lambda: {'changed': 1}})
    entered, release = threading.Event(), threading.Event()
    def verify():
        entered.set()
        assert release.wait(5)
        return {'state': 'current'}
    monkeypatch.setattr(m, 'search_check', verify)
    try:
        job = m.start('search')
        assert entered.wait(5)
        status = m.status()
        assert status['running']['id'] == job['id'] and status['running']['state'] == 'running'
        assert status['running']['finished_at'] is None and status['jobs'] == []
        assert status['checking']
        with pytest.raises(BlockingIOError):
            m.start('catalog')
    finally:
        release.set()
    assert wait(m)['jobs'][0]['state'] == 'succeeded'


def test_failed_rebuild_still_verifies_its_partial_output(vault, monkeypatch):
    def broken():
        raise ValueError('Writer stopped partway')
    m = Maintenance(vault, {'search': broken})
    m.checks = {'search': {'state': 'current', 'checked_at': '2000-01-01T00:00:00Z'}}
    monkeypatch.setattr(m, 'search_check', lambda: {'state': 'partial'})
    m.start('search')
    status = wait(m)
    assert status['jobs'][0]['state'] == 'failed'
    assert status['jobs'][0]['error'] == 'Writer stopped partway'
    assert status['checks']['search']['state'] == 'partial'
