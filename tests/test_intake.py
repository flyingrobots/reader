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


def test_source_whitespace_is_preserved_without_blocking_commit(vault):
    data = 'Space before a tab: \ttext.\n\n'
    (vault / 'inbox/report.md').write_text(data)
    plan = plan_for(vault)
    assert intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)['commit']
    assert (vault / plan['entries'][0]['destination'] / 'originals/report.md').read_text() == data


def test_a_reading_copy_keeps_its_source_whitespace_without_blocking_commit(vault, monkeypatch):
    # wide-md keeps a source's trailing blank line; a derived copy must not fail the whitespace gate for Reader's own notes.
    def reading_copy(root, relative, writer):
        copy = relative.removesuffix('.md') + '.reading.md'
        writer(copy, intake.markdown(copy, 'A reading copy', 'A fenced example:\n\n```\nconsole.log\n```\n\n'))
        return {'reading_copy': copy}
    monkeypatch.setattr('reader_mcp.reading.reading_copy', reading_copy)
    (vault / 'inbox/report.md').write_text('A fenced example:\n\n```\nconsole.log\n```\n\n')
    plan = plan_for(vault)
    assert intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)['commit']
    assert (vault / plan['entries'][0]['destination'] / 'originals/report.reading.md').read_bytes().endswith(b'```\n\n')


def test_large_owned_path_set_does_not_depend_on_os_argument_capacity(vault, monkeypatch):
    folder = vault / 'inbox/packet'
    folder.mkdir()
    for i in range(500):
        (folder / (f'{i:04}-' + 'a' * 80 + '.txt')).write_text('Original source')
    plan = plan_for(vault, 'inbox/packet')
    original_run = subprocess.run
    def bounded_argv(args, *rest, **kwargs):
        if args[0] == 'git' and sum(len(str(a).encode()) + 1 for a in args) > 65536:
            raise OSError(7, 'Synthetic OS argument limit')
        return original_run(args, *rest, **kwargs)
    monkeypatch.setattr(subprocess, 'run', bounded_argv)
    assert intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)['commit']
    assert len(list((vault / plan['entries'][0]['destination'] / 'originals').glob('*.txt'))) == 500


def test_invalid_delivery_identifies_the_arrival_before_any_move(vault):
    receipt = Store(vault).ingest(Submission(request_id=uuid4(), title='Damaged delivery', markdown='Original'))
    (vault / receipt['bundle_path'] / 'report.md').write_text('Edited after delivery')
    runtime = vault / '.reader/inbox-runner'
    run_id = str(uuid4())
    files = sorted(p.relative_to(vault).as_posix() for p in (vault / receipt['bundle_path']).iterdir())
    (runtime / 'selection.json').write_text(json.dumps({'run_id': run_id, 'arrivals': [receipt['bundle_path']], 'files': files}))
    with pytest.raises(ValueError, match=receipt['bundle_path'] + ':.*integrity'):
        intake.worker(vault, 'unused', run_id)
    assert (vault / receipt['bundle_path']).is_dir()


@pytest.mark.parametrize('identity', [None, 'not-a-uuid', 'ABCDEFAB-1234-5678-9012-123456789012'])
def test_invalid_receipt_identity_is_rejected_before_admission(vault, identity):
    receipt = Store(vault).ingest(Submission(request_id=uuid4(), title='Invalid identity', markdown='Original'))
    path = vault / receipt['bundle_path'] / 'receipt.json'
    data = json.loads(path.read_text())
    if identity is None:
        data.pop('id')
    else:
        data['id'] = identity
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match='receipt identity'):
        intake.snapshot(vault, receipt['bundle_path'])
    assert path.is_file() and not (vault / 'library/reports').exists()


@pytest.mark.parametrize('limit', [2, 4])
def test_aggregate_catalog_capacity_includes_generated_files_before_moves(vault, monkeypatch, limit):
    from reader_mcp import catalog
    (vault / 'inbox/report.md').write_text('Original source\n')
    plan = plan_for(vault)
    monkeypatch.setattr(catalog, 'MAX_FILES', limit)
    with pytest.raises(ValueError, match='catalog capacity.*no arrivals were moved'):
        intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    assert (vault / 'inbox/report.md').read_text() == 'Original source\n'
    assert not (vault / 'library/reports').exists()


def test_generated_library_bytes_are_reserved_before_moving_sources(vault, monkeypatch):
    from reader_mcp import catalog
    (vault / 'inbox/report.md').write_text('Original source\n')
    plan = plan_for(vault)
    source_bytes = sum(p.stat().st_size for p in (vault / 'library').rglob('*') if p.is_file()) + 16
    monkeypatch.setattr(catalog, 'MAX_SOURCE_BYTES', source_bytes + 100)
    with pytest.raises(ValueError, match='catalog capacity.*no arrivals were moved'):
        intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    assert (vault / 'inbox/report.md').is_file()
    assert not (vault / plan['entries'][0]['destination']).exists()


def test_absolute_inbox_links_follow_preserved_batch_files_and_survive_repair(vault):
    from reader_mcp.portable_links import PortableLinks
    packet = vault / 'inbox/packet'
    packet.mkdir()
    image = packet / 'figure.svg'
    image.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    later = vault / 'inbox/later.md'
    later.write_text('Another source')
    text = f'![Figure]({image.as_uri()})\n\n[Later]({later.as_uri()}#section)\n'
    (packet / 'source.md').write_text(text)
    plan = plan_for(vault, 'inbox/packet')
    plan['entries'].extend(plan_for(vault, 'inbox/later.md')['entries'])
    result = intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    assert result['commit']
    path = plan['entries'][0]['destination'] + '/originals/source.md'
    expected = [plan['entries'][0]['destination'] + '/originals/figure.svg',
                plan['entries'][1]['destination'] + '/originals/later.md#section']
    engine = PortableLinks(vault)
    record = engine.stored(path, intake.digest(text.encode()))
    assert [row.get('target') for row in record['targets']] == expected
    assert (vault / path).read_text() == text
    assert [row.get('target') for row in engine.prepare(path, apply=True)['targets']] == expected


def test_repeated_shared_index_writes_reclaim_unreferenced_prepared_versions(vault, monkeypatch):
    from reader_mcp import intake_journal
    (vault / 'inbox/report.md').write_text('Original')
    runtime = vault / '.reader/inbox-runner'
    journal = Journal(vault, runtime, plan_for(vault))
    monkeypatch.setattr(intake_journal, 'MAX_OUTPUT', 1024)
    for number in range(100):
        journal.write('library/reports/index.md', (str(number) + 'x' * 200).encode())
    resumed = Journal(vault, runtime, load(runtime))
    resumed.replay()
    resumed.verify()
    assert (vault / 'library/reports/index.md').read_bytes() == b'99' + b'x' * 200
    assert sum(p.stat().st_size for p in resumed.blobs.iterdir()) <= 1024


def test_release_failure_retains_the_original_filing_diagnostic(vault, monkeypatch, capsys):
    from reader_mcp import companions
    (vault / 'inbox/report.md').write_text('Original')
    plan = plan_for(vault)
    tool = vault / '.reader/locks'
    tool.write_text('#!' + sys.executable + '\nimport sys,json\nif "claim" in sys.argv: print(json.dumps({"event":"claimed","acquisition":"owned"}))\nelse: raise SystemExit(1)\n')
    tool.chmod(0o755)
    monkeypatch.setattr(companions, 'find_git_locks', lambda **kwargs: str(tool))
    def failed(*args):
        raise ValueError('The original filing refusal')
    monkeypatch.setattr(intake, 'apply_plan', failed)
    with pytest.raises(ValueError, match='original filing refusal'):
        intake.locked_apply(vault, vault / '.reader/inbox-runner', plan)
    assert 'lock release failed' in capsys.readouterr().err


def test_filed_receipt_keeps_browse_identity_and_curation_context(vault):
    from reader_mcp.browse import Browse
    from reader_mcp.curation import Curation
    receipt = Store(vault).ingest(Submission(request_id=uuid4(), title='Delivered title',
        markdown='The delivered primary text.', provenance={'author': 'Source author', 'project': 'Source project'}))
    plan = plan_for(vault, receipt['bundle_path'])
    intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    dest = plan['entries'][0]['destination']
    works = Browse(vault).inventory({})
    assert len(works) == 1
    assert works[0]['id'] == 'receipt:' + receipt['id']
    assert works[0]['primary'] == dest + '/originals/report.md'
    assert works[0]['path'] == dest + '/index.md'
    assert works[0]['authors'] == ['Source author']
    assert works[0]['projects'] == ['Source project']
    assert works[0]['arrival_time'] == receipt['received_at'].replace('Z', '+00:00')
    units, _ = Curation(vault).inventory()
    assert len(units) == 1
    assert units[0]['catalog_path'] == dest + '/index.md'
    assert units[0]['key'] == works[0]['id']


def test_editorial_excerpt_budget_prioritizes_the_receipted_document(vault):
    receipt = Store(vault).ingest(Submission(request_id=uuid4(), title='Primary report',
        filename='z-primary.md', markdown='The declared primary source.'))
    bundle = vault / receipt['bundle_path']
    for number in range(8):
        (bundle / f'a-attachment-{number}.md').write_text('Attachment context. ' * 1000)
    entry = intake.snapshot(vault, receipt['bundle_path'])
    context = intake.model_context(vault, entry)
    assert context['reading'][0] == {'path': 'z-primary.md', 'excerpt': 'The declared primary source.', 'complete': True}
    assert context['files'] == entry['files'], 'Excerpt priority does not reorder or omit the frozen inventory'
    assert sum(len(row['excerpt'].encode()) for row in context['reading']) <= intake.MAX_CONTEXT


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


def test_identical_raw_arrivals_have_distinct_destinations(vault):
    entries = []
    for name in ('first', 'second'):
        folder = vault / 'inbox' / name
        folder.mkdir()
        (folder / 'source.md').write_text('Identical bytes')
        entries.append(plan_for(vault, 'inbox/' + name)['entries'][0])
    assert entries[0]['snapshot_sha256'] == entries[1]['snapshot_sha256']
    plan = {'schema_version': 1, 'batch_id': str(uuid4()), 'created_at': intake.stamp(), 'entries': entries}
    result = intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    assert result['commit'] and len({e['destination'] for e in entries}) == 2
    assert all((vault / e['destination'] / 'originals/source.md').read_text() == 'Identical bytes' for e in entries)


def test_committed_tracked_source_deletion_can_replay_after_queue_interruption(vault):
    (vault / 'inbox/report.md').write_text('Tracked original')
    intake.run_git(vault, 'add', 'inbox/report.md')
    intake.run_git(vault, 'commit', '-qm', 'Receive tracked original')
    plan = plan_for(vault)
    runtime = vault / '.reader/inbox-runner'
    first = intake.apply_plan(vault, runtime, plan)['commit']
    saved = load(runtime)
    saved.pop('commit')  # The commit landed, but the worker stopped before saving completion.
    save(runtime, saved)
    assert intake.apply_plan(vault, runtime, saved)['commit'] == first
    assert intake.run_git(vault, 'rev-parse', 'HEAD') == first


def test_unsupported_catalog_filename_is_deferred_before_other_arrivals_move(vault, monkeypatch):
    runtime = vault / '.reader/inbox-runner'
    sources = ['inbox/report [draft].md', 'inbox/valid.md']
    for source in sources:
        (vault / source).write_text('Original source')
    run_id = str(uuid4())
    (runtime / 'selection.json').write_text(json.dumps({'run_id': run_id, 'arrivals': sources, 'files': sorted(sources)}))
    calls = []
    def classify(root, runtime, entry, codex, checkpoint):
        calls.append(entry['source'])
        return decision(entry)
    monkeypatch.setattr(intake, 'classify', classify)
    monkeypatch.setattr(intake, 'locked_apply', intake.apply_plan)
    result = intake.worker(vault, 'unused', run_id)
    assert result['status'] == 'verified' and len(result['filed']) == 1
    assert result['deferred'][0]['source'] == sources[0]
    assert 'catalog' in result['deferred'][0]['reason'].lower()
    assert calls == [sources[1]] and (vault / sources[0]).read_text() == 'Original source'


def test_incompatible_source_metadata_is_deferred_before_filing(vault, monkeypatch):
    runtime = vault / '.reader/inbox-runner'
    sources = ['inbox/legacy.md', 'inbox/valid.md']
    original = '---\nauthor: 7\n---\nLegacy source with incompatible metadata.\n'
    (vault / sources[0]).write_text(original)
    (vault / sources[1]).write_text('Valid source')
    run_id = str(uuid4())
    (runtime / 'selection.json').write_text(json.dumps({'run_id': run_id, 'arrivals': sources, 'files': sources}))
    calls = []
    def classify(root, runtime, entry, codex, checkpoint):
        calls.append(entry['source'])
        return decision(entry)
    monkeypatch.setattr(intake, 'classify', classify)
    monkeypatch.setattr(intake, 'locked_apply', intake.apply_plan)
    result = intake.worker(vault, 'unused', run_id)
    assert result['status'] == 'verified' and len(result['filed']) == 1
    assert result['deferred'][0]['source'] == sources[0]
    assert 'author' in result['deferred'][0]['reason']
    assert calls == [sources[1]] and (vault / sources[0]).read_text() == original


def test_interrupted_publication_flush_removes_its_temporary_file(vault, monkeypatch):
    import reader_mcp.intake_journal as module
    (vault / 'inbox/report.md').write_text('Original')
    plan = plan_for(vault)
    journal = Journal(vault, vault / '.reader/inbox-runner', plan)
    target = plan['entries'][0]['destination'] + '/index.md'
    data = b'Prepared catalog bytes'
    after = intake.digest(data)
    (journal.blobs / after).write_bytes(data)
    record = {'before': None, 'after': after}
    def interrupt(fd):
        raise SystemExit('interrupted at fsync')
    with monkeypatch.context() as patch:
        patch.setattr(module.os, 'fsync', interrupt)
        with pytest.raises(SystemExit):
            journal.publish(target, record)
    assert not list((vault / target).parent.iterdir()), 'No foreign-looking temporary file may block replay'
    journal.publish(target, record)
    assert (vault / target).read_bytes() == data


@pytest.mark.parametrize('failed_flush', [1, 2])
def test_interrupted_preparation_and_checkpoint_can_retry(vault, monkeypatch, failed_flush):
    import reader_mcp.intake_journal as module
    (vault / 'inbox/report.md').write_text('Original')
    plan = plan_for(vault)
    runtime = vault / '.reader/inbox-runner'
    journal = Journal(vault, runtime, plan)
    target = plan['entries'][0]['destination'] + '/index.md'
    before = set(runtime.iterdir())
    original = module.os.fsync
    calls = 0
    def interrupt(fd):
        nonlocal calls
        calls += 1
        if calls == failed_flush:
            raise SystemExit('interrupted during preparation')
        original(fd)
    with monkeypatch.context() as patch:
        patch.setattr(module.os, 'fsync', interrupt)
        with pytest.raises(SystemExit):
            journal.write(target, b'Prepared bytes')
    assert set(runtime.iterdir()) == before
    resumed = Journal(vault, runtime, load(runtime))
    resumed.write(target, b'Prepared bytes')
    resumed.verify()
    assert (vault / target).read_bytes() == b'Prepared bytes'


@pytest.mark.parametrize('tracked', [False, True])
def test_commit_hook_failure_resumes_without_reclassification_or_duplicate_filing(vault, tracked):
    source = vault / 'inbox/report.md'
    source.write_text('Original source bytes\n')
    if tracked:
        intake.run_git(vault, 'add', 'inbox/report.md')
        intake.run_git(vault, 'commit', '-qm', 'Track arrival before intake')
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


@pytest.mark.parametrize('collection', ['assets', 'evidence', 'reading', 'fonts', 'originals', 'snapshot', 'dist', 'build', 'target'])
def test_browse_excluded_collection_cannot_hide_a_filed_arrival(vault, collection):
    (vault / 'inbox/report.md').write_text('Original source')
    plan = plan_for(vault)
    entry = plan['entries'][0]
    entry['decision']['collection'] = collection
    entry['destination'] = intake.destination(entry)
    with pytest.raises(ValueError, match='browse-excluded collections'):
        intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)
    assert (vault / 'inbox/report.md').read_text() == 'Original source'
    assert not (vault / entry['destination']).exists()


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


def queue_of_packets(vault, count):
    runtime = vault / '.reader/inbox-runner'
    sources, files = [], []
    for number in range(count):
        source = f'inbox/packet-{number:03}'
        (vault / source).mkdir()
        (vault / source / 'source.md').write_text('Source')
        sources.append(source)
        files.append(source + '/source.md')
    run_id = str(uuid4())
    (runtime / 'selection.json').write_text(json.dumps({'run_id': run_id, 'arrivals': sources, 'files': sorted(files)}))
    return runtime, run_id


def record_progress(monkeypatch):
    """Every checkpoint the worker writes, read back from progress.json: what the supervisor sees."""
    seen, original = [], intake.progress
    def record(runtime, phase, done=None, total=None):
        original(runtime, phase, done, total)
        seen.append(json.loads((runtime / 'progress.json').read_text()))
    monkeypatch.setattr(intake, 'progress', record)
    return seen


def defer(root, runtime, entry, codex, checkpoint):
    value = decision(entry)
    value.update(disposition='defer', reason='Synthetic deferral for this progress check')
    return value


def test_progress_counts_arrivals_read_then_decided_across_batches(vault, monkeypatch):
    runtime, run_id = queue_of_packets(vault, 102)  # two batches: 100 and 2
    seen = record_progress(monkeypatch)
    monkeypatch.setattr(intake, 'classify', defer)
    intake.worker(vault, 'never-invoked', run_id)
    counted = [c for c in seen if 'total' in c]
    assert counted and {c['total'] for c in counted} == {102}
    assert [c['done'] for c in counted if c['phase'] == 'snapshot'] == list(range(1, 103))
    decided = [c['done'] for c in counted if c['phase'] != 'snapshot']
    assert decided[0] == 0 and decided == sorted(decided) and decided[-1] == 102
    assert counted[-1]['phase'] == 'committed'
    # One decision checkpoint when classification starts, then one per arrival decided.
    assert [c['done'] for c in counted if c['phase'] == 'decision'] == list(range(0, 103))
    assert [c['done'] for c in counted if c['phase'] == 'committed'] == [100, 102]


def test_a_resumed_queue_counts_the_arrivals_its_earlier_batch_decided(vault, monkeypatch):
    runtime, run_id = queue_of_packets(vault, 102)
    def stop_in_second_batch(root, runtime, entry, codex, checkpoint):
        if entry['source'] == 'inbox/packet-101':
            raise RuntimeError('simulated interruption')
        return defer(root, runtime, entry, codex, checkpoint)
    monkeypatch.setattr(intake, 'classify', stop_in_second_batch)
    with pytest.raises(RuntimeError, match='simulated interruption'):
        intake.worker(vault, 'never-invoked', run_id)
    seen = record_progress(monkeypatch)
    monkeypatch.setattr(intake, 'classify', defer)
    intake.worker(vault, 'never-invoked', run_id)
    counted = [c for c in seen if 'total' in c]
    # The first batch's 100 and the second batch's already-saved decision count from the start of the resumed run.
    assert counted[0] == {**counted[0], 'phase': 'decision', 'done': 100, 'total': 102}
    assert counted[-1] == {**counted[-1], 'phase': 'committed', 'done': 102, 'total': 102}


def test_a_model_step_checkpoint_keeps_the_last_arrival_counts(vault):
    # The supervisor reads only the newest checkpoint; a model step written right after a decision must not hide it.
    runtime = vault / '.reader/inbox-runner'
    intake.progress(runtime, 'decision', 2, 5)
    intake.progress(runtime, 'editorial')
    checkpoint = json.loads((runtime / 'progress.json').read_text())
    assert (checkpoint['phase'], checkpoint['done'], checkpoint['total']) == ('editorial', 2, 5)


def test_apply_plan_uses_opening_byline_fallback_and_ignores_unknown_placeholders(vault):
    from reader_mcp.browse import Browse
    from reader_mcp.metadata import source_frontmatter

    receipt = Store(vault).ingest(Submission(
        request_id=uuid4(), title='Byline report', filename='report.md',
        markdown='Written by Ada Lovelace\n\nFirst body paragraph.\n',
    ))
    entry = intake.snapshot(vault, receipt['bundle_path'])
    entry['decision'] = {**decision(entry), 'slug': 'byline-report', 'title': 'Byline report', 'author': 'Unknown'}
    entry['destination'] = intake.destination(entry)

    prose = Store(vault).ingest(Submission(
        request_id=uuid4(), title='Prose report', filename='prose.md',
        markdown='# Prose report\n\nBy inspection all hashes match.\n',
    ))
    entry2 = intake.snapshot(vault, prose['bundle_path'])
    entry2['decision'] = {**decision(entry2), 'slug': 'prose-report', 'title': 'Prose report', 'author': ''}
    entry2['destination'] = intake.destination(entry2)

    placeholder_fm = Store(vault).ingest(Submission(
        request_id=uuid4(), title='Placeholder source_author', filename='fm.md',
        markdown='---\nsource_author: Unknown\nauthor: Grace Hopper\n---\n\nBody.\n',
    ))
    entry3 = intake.snapshot(vault, placeholder_fm['bundle_path'])
    entry3['decision'] = {**decision(entry3), 'slug': 'placeholder-fm', 'title': 'Placeholder source_author', 'author': ''}
    entry3['destination'] = intake.destination(entry3)

    role_byline = Store(vault).ingest(Submission(
        request_id=uuid4(), title='Role byline', filename='role.md',
        markdown='Written by Reader intake\n\nBody.\n',
    ))
    entry4 = intake.snapshot(vault, role_byline['bundle_path'])
    entry4['decision'] = {**decision(entry4), 'slug': 'role-byline', 'title': 'Role byline', 'author': ''}
    entry4['destination'] = intake.destination(entry4)

    plan = {'schema_version': 1, 'batch_id': str(uuid4()), 'created_at': intake.stamp(), 'entries': [entry, entry2, entry3, entry4]}
    save(vault / '.reader/inbox-runner', plan)
    intake.apply_plan(vault, vault / '.reader/inbox-runner', plan)

    first_meta, _ = source_frontmatter((vault / entry['destination'] / 'index.md').read_bytes())
    second_meta, _ = source_frontmatter((vault / entry2['destination'] / 'index.md').read_bytes())
    third_meta, _ = source_frontmatter((vault / entry3['destination'] / 'index.md').read_bytes())
    fourth_meta, _ = source_frontmatter((vault / entry4['destination'] / 'index.md').read_bytes())
    assert first_meta['author'] == 'Ada Lovelace'
    assert second_meta['author'] is None
    assert third_meta['author'] == 'Grace Hopper'
    assert fourth_meta['author'] is None

    works = {w['title']: w['authors'] for w in Browse(vault).inventory({})}
    assert works == {
        'Byline report': ['Ada Lovelace'],
        'Prose report': ['Unspecified author'],
        'Placeholder source_author': ['Grace Hopper'],
        'Role byline': ['Unspecified author'],
    }
