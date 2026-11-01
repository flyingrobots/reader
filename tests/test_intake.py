"""Synthetic preservation, recovery and model-boundary checks for scripted intake."""
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest

from reader_mcp import intake
from reader_mcp.intake_journal import Journal, load, save
from reader_mcp.store import Store, Submission


@pytest.fixture
def vault(tmp_path, monkeypatch):
    for key, value in {'GIT_AUTHOR_NAME': 'Fixture', 'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
                       'GIT_COMMITTER_NAME': 'Fixture', 'GIT_COMMITTER_EMAIL': 'fixture@example.invalid'}.items():
        monkeypatch.setenv(key, value)
    (tmp_path / 'library').mkdir()
    (tmp_path / 'inbox').mkdir()
    (tmp_path / '.reader/inbox-runner').mkdir(parents=True)
    (tmp_path / '.gitignore').write_text('.reader/\n')
    (tmp_path / 'README.md').write_text('# Synthetic vault\n')
    (tmp_path / 'library/index.md').write_bytes(intake.markdown('library/index.md', 'Library', '# Library\n'))
    intake.run_git(tmp_path, 'init', '-q')
    intake.run_git(tmp_path, 'add', '.')
    intake.run_git(tmp_path, 'commit', '-qm', 'Synthetic initial state')
    return tmp_path


def decision(entry, **overrides):
    return dict(source=entry['source'], snapshot_sha256=entry['snapshot_sha256'], disposition='file',
                collection='reports', slug='example', title='An example', author='',
                summary='A source description based on the supplied excerpt.', reason='', **overrides)


def plan_for(vault, source='inbox/report.md'):
    entry = intake.snapshot(vault, source)
    entry['decision'] = decision(entry)
    entry['destination'] = intake.destination(entry)
    plan = {'schema_version': 1, 'batch_id': str(uuid4()), 'created_at': intake.stamp(), 'entries': [entry]}
    save(vault / '.reader/inbox-runner', plan)
    return plan


def test_filing_preserves_receipt_and_hidden_bytes_and_excludes_unrelated_staging(vault):
    receipt = Store(vault).ingest(Submission(request_id=uuid4(), title='Example', filename='report.md',
        markdown='---\ntitle: Supplied\nadded: 2020-01-01\n---\n\n[Missing](file:///unavailable.txt)\n'))
    arrival = vault / receipt['bundle_path']
    (arrival / '.substantive.txt').write_text('hidden source bytes')
    before = {p.name: p.read_bytes() for p in arrival.iterdir()}
    plan = plan_for(vault, receipt['bundle_path'])
    unrelated = vault / 'other-person.txt'
    unrelated.write_text('another participant')
    intake.run_git(vault, 'add', 'other-person.txt')
    result = intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    original = vault / plan['entries'][0]['destination'] / 'originals'
    assert {name: (original / name).read_bytes() for name in before} == before
    assert Store(vault).status(receipt['id'])['integrity'] == 'intact'
    assert result['commit'] and result['warnings']
    assert 'other-person.txt' not in intake.run_git(vault, 'show', '--format=', '--name-only', result['commit'])
    assert intake.run_git(vault, 'diff', '--cached', '--name-only') == 'other-person.txt'
    assert (vault / 'catalog/metadata' / plan['entries'][0]['destination'].removeprefix('library/') / 'originals/report.md.md').is_file()
    from reader_mcp.catalog import Catalog
    assert Catalog(vault).run('check')['status'] == 'valid'


def test_stale_classification_cannot_move_an_arrival(vault):
    source = vault / 'inbox/report.md'
    source.write_text('original')
    plan = plan_for(vault)
    source.write_text('changed after classification')
    with pytest.raises(ValueError, match='changed after editorial'):
        intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    assert source.is_file()
    assert not (vault / plan['entries'][0]['destination']).exists()


def test_lock_contention_refuses_filing_without_touching_sources(vault, monkeypatch):
    from reader_mcp import companions
    source = vault / 'inbox/report.md'
    source.write_text('Preserve this arrival')
    plan = plan_for(vault)
    head = intake.run_git(vault, 'rev-parse', 'HEAD')
    tool = vault / '.reader/busy-locks'
    tool.write_text('#!/bin/sh\necho "resource held by another intake" >&2\nexit 1\n')
    tool.chmod(0o755)
    monkeypatch.setattr(companions, 'find_git_locks', lambda **kwargs: str(tool))
    with pytest.raises(ValueError, match='Intake lock admission failed.*resource held'):
        intake.locked_apply(vault, vault / '.reader/inbox-runner', plan)
    assert source.read_text() == 'Preserve this arrival'
    assert not (vault / plan['entries'][0]['destination']).exists()
    assert intake.run_git(vault, 'rev-parse', 'HEAD') == head
    assert not (vault / '.reader/inbox-runner/result.json').exists()


def test_commit_hook_failure_resumes_without_reclassification_or_duplicate_filing(vault):
    source = vault / 'inbox/report.md'
    source.write_text('Original source bytes\n')
    plan = plan_for(vault)
    hook = vault / '.git/hooks/pre-commit'
    hook.write_text('#!/bin/sh\necho intentional-hook-refusal >&2\nexit 1\n')
    hook.chmod(0o755)
    runtime = vault / '.reader/inbox-runner'
    with pytest.raises(ValueError, match='intentional-hook-refusal'):
        intake.apply_plan(vault, runtime, plan)
    assert not source.exists()
    saved = load(runtime)
    assert saved['entries'][0]['filed']
    original = vault / saved['entries'][0]['destination'] / 'originals/report.md'
    assert original.read_text() == 'Original source bytes\n'
    # Repair the synthetic hook; the workflow itself never bypasses it.
    hook.write_text('#!/bin/sh\nexit 0\n')
    result = intake.apply_plan(vault, runtime, saved)
    assert result['commit'] and original.read_text() == 'Original source bytes\n'
    assert len(list((vault / 'library/reports').glob('example-*'))) == 1
    first = result['commit']
    assert intake.apply_plan(vault, runtime, load(runtime))['commit'] == first


def test_interrupted_write_replays_exact_bytes_and_rejects_foreign_edits(vault, monkeypatch):
    (vault / 'inbox/report.md').write_text('Original')
    plan = plan_for(vault)
    runtime = vault / '.reader/inbox-runner'
    original_publish = Journal.publish
    calls = []
    def interrupt(self, relative, record):
        if relative == 'library/reports/index.md':
            calls.append(relative)
            raise RuntimeError('interrupted before publication')
        return original_publish(self, relative, record)
    monkeypatch.setattr(Journal, 'publish', interrupt)
    with pytest.raises(RuntimeError, match='interrupted'):
        intake.apply_plan(vault, runtime, plan)
    assert calls and not (vault / 'library/reports/index.md').exists()
    monkeypatch.setattr(Journal, 'publish', original_publish)
    # An unrelated edit to an already published catalog cannot be silently adopted.
    index = vault / plan['entries'][0]['destination'] / 'index.md'
    correct = index.read_bytes()
    index.write_text('A different writer changed this file')
    with pytest.raises(ValueError, match='changed outside this batch'):
        intake.apply_plan(vault, runtime, load(runtime))
    index.write_bytes(correct)
    assert intake.apply_plan(vault, runtime, load(runtime))['commit']


def test_classification_validation_rejects_extra_fields_path_escape_and_stale_identity(vault):
    (vault / 'inbox/report.md').write_text('source')
    entry = intake.snapshot(vault, 'inbox/report.md')
    good = decision(entry)
    assert intake.validate_decision(good, entry) == good
    for bad in [dict(good, command='rm -rf'), dict(good, collection='../escape'),
                dict(good, snapshot_sha256='0' * 64), dict(good, title='One\nTwo'), dict(good, collection='perspectives')]:
        with pytest.raises(ValueError):
            intake.validate_decision(bad, entry)
    assert not list((vault / 'library').glob('reports/*'))


def test_frozen_inventory_refuses_files_added_after_selection(vault):
    runtime = vault / '.reader/inbox-runner'
    (vault / 'inbox/packet').mkdir()
    (vault / 'inbox/packet/first.md').write_text('First')
    run_id = str(uuid4())
    (runtime / 'selection.json').write_text(json.dumps({'run_id': run_id, 'arrivals': ['inbox/packet'], 'files': ['inbox/packet/first.md']}))
    (vault / 'inbox/packet/later.md').write_text('Later')
    with pytest.raises(ValueError, match='contents changed'):
        intake.worker(vault, 'never-invoked-codex', run_id)
    assert (vault / 'inbox/packet/first.md').is_file()
    assert not (runtime / 'pending.json').exists()


def test_source_cannot_replace_a_frozen_payload_through_the_journal(vault):
    (vault / 'inbox/report.md').write_text('original')
    plan = plan_for(vault)
    journal = Journal(vault, vault / '.reader/inbox-runner', plan)
    with pytest.raises(ValueError, match='preserved payload'):
        journal.write(plan['entries'][0]['destination'] + '/originals/report.md', b'changed')
    with pytest.raises(ValueError, match='outside this intake'):
        journal.write('library/someone-else/essay.md', b'changed')


def test_large_editorial_context_is_partitioned_and_reduced_automatically(vault, monkeypatch):
    (vault / 'inbox/report.md').write_text('source')
    entry = intake.snapshot(vault, 'inbox/report.md')
    rows = [{'path': str(i) + '-' + 'x' * 160 + '.md', 'bytes': 10, 'sha256': '0' * 64} for i in range(2000)]
    context = dict(source=entry['source'], snapshot_sha256=entry['snapshot_sha256'], files=rows,
                   reading=[], provenance={}, existing_collections=['reports'], reading_scope='Inventory only')
    monkeypatch.setattr(intake, 'model_context', lambda root, entry: context)
    calls, checkpoints = [], []
    def model(root, runtime, selected, codex, data):
        calls.append(data)
        assert len(json.dumps(data).encode()) < 192 * 1024
        return decision(selected)
    monkeypatch.setattr(intake, 'model_call', model)
    result = intake.classify(vault, vault / '.reader/inbox-runner', entry, 'fixture', checkpoint=lambda: checkpoints.append(1))
    assert result['source'] == entry['source']
    assert [r for call in calls for r in call.get('files', [])] == rows
    assert 'observations' in calls[-1] and len(calls) > 2
    assert len(checkpoints) == len(calls)
    before = len(calls)
    assert intake.classify(vault, vault / '.reader/inbox-runner', entry, 'fixture') == result
    assert len(calls) == before, 'A retry reuses each completed, snapshot-bound model response'


def test_large_arrival_queue_is_batched_without_splitting_bundles_or_requesting_user_work(vault, monkeypatch):
    runtime = vault / '.reader/inbox-runner'
    sources, files = [], []
    for number in range(102):
        source = f'inbox/packet-{number:03}'
        folder = vault / source
        folder.mkdir()
        (folder / 'source.md').write_text('Source')
        (folder / '.attachment').write_text('Attachment')
        sources.append(source)
        files.extend([source + '/.attachment', source + '/source.md'])
    run_id = str(uuid4())
    (runtime / 'selection.json').write_text(json.dumps({'run_id': run_id, 'arrivals': sources, 'files': sorted(files)}))
    batches = {}
    original_save = intake.save
    def record(runtime, plan):
        batches[plan['batch_id']] = [e['source'] for e in plan['entries']]
        original_save(runtime, plan)
    def defer(root, runtime, entry, codex, checkpoint):
        value = decision(entry)
        value.update(disposition='defer', reason='Synthetic deferral for this scheduling check')
        return value
    monkeypatch.setattr(intake, 'save', record)
    monkeypatch.setattr(intake, 'classify', defer)
    result = intake.worker(vault, 'never-invoked', run_id)
    assert [len(v) for v in batches.values()] == [100, 2]
    assert [s for batch in batches.values() for s in batch] == sources
    assert [d['source'] for d in result['deferred']] == sources
    assert all((vault / file).is_file() for file in files)
    assert result['status'] == 'verified' and not result['commits']
    assert not (runtime / 'queue.json').exists() and not (runtime / 'pending.json').exists()


def test_oversized_provenance_is_partitioned_without_dropping_metadata(vault, monkeypatch):
    (vault / 'inbox/report.md').write_text('source')
    entry = intake.snapshot(vault, 'inbox/report.md')
    context = intake.model_context(vault, entry)
    context['provenance'] = {'notes': 'Long provenance. 🧭\n' * 15000}
    monkeypatch.setattr(intake, 'model_context', lambda root, entry: context)
    calls = []
    def model(root, runtime, selected, codex, data):
        assert len(json.dumps(data, ensure_ascii=False).encode()) < 192 * 1024
        calls.append(data)
        return decision(selected)
    monkeypatch.setattr(intake, 'model_call', model)
    assert intake.classify(vault, vault / '.reader/inbox-runner', entry, 'fixture') == decision(entry)
    metadata = json.loads(''.join(c['metadata_fragment'] for c in calls if 'metadata_fragment' in c))
    assert metadata == {k: context[k] for k in ('provenance', 'existing_collections')}
    assert [r for c in calls for r in c.get('files', [])] == entry['files']
    assert 'observations' in calls[-1]


def test_uncataloged_existing_source_refuses_before_moving_arrivals(vault):
    (vault / 'library/existing.md').write_text('An older source without catalog metadata')
    (vault / 'inbox/report.md').write_text('An arrival')
    plan = plan_for(vault)
    with pytest.raises(ValueError, match='Existing library requires catalog migration'):
        intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    assert (vault / 'inbox/report.md').read_text() == 'An arrival'
    assert not (vault / 'library/reports').exists()


def test_changed_later_source_refuses_the_whole_fresh_batch_before_any_move(vault):
    (vault / 'inbox/first.md').write_text('First original')
    (vault / 'inbox/second.md').write_text('Second original')
    first = plan_for(vault, 'inbox/first.md')
    second = plan_for(vault, 'inbox/second.md')
    first['entries'].append(second['entries'][0])
    (vault / 'inbox/second.md').write_text('Changed after classification')
    with pytest.raises(ValueError, match='changed after editorial'):
        intake.apply_plan(vault, vault / '.reader/inbox-runner', first)
    assert (vault / 'inbox/first.md').read_text() == 'First original'
    assert not (vault / 'library/reports').exists()
