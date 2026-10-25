"""Inbox listing and the web launcher, against temp vaults and a controlled fake Codex. Never the real CLI."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import pytest

from reader_mcp.inbox_view import CANCEL_TEXT, MAX_REPORT, InboxView, RunConflict, codex_candidates, find_codex
from reader_mcp.web import WebLibrary


def deliver(root, request_id, name, text, title='A delivered spec', **provenance):
    folder = root / 'inbox' / request_id
    folder.mkdir(parents=True)
    (folder / name).write_text(text)
    data = text.encode()
    receipt = {'reader_receipt': 1, 'id': request_id, 'title': title, 'document': name, 'fingerprint': 'x',
               'received_at': '2026-10-24T20:19:46+00:00', 'provenance': provenance or {'author': 'Claude', 'project': 'Reader', 'report_date': '2026-10-24', 'source': 'Claude Code session'},
               'files': [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}
    (folder / 'receipt.json').write_text(json.dumps(receipt))
    return folder


def fake_codex(root, script):
    fake = root.parent / (root.name + '-fake-codex')
    fake.write_text('#!' + sys.executable + '\n' + script)
    fake.chmod(0o755)
    return fake


@pytest.fixture
def vault(tmp_path):
    root = tmp_path / 'vault'
    for name in ('inbox', 'library', 'indexes'):
        (root / name).mkdir(parents=True)
    (root / 'inbox/README.md').write_text('# Inbox guide\n')
    return root


def env_for(fake):
    # PYTHONPATH reaches the supervisor the same way it reaches this test process.
    return {'PATH': '/nonexistent', 'READER_CODEX': str(fake)}


def wait_for(view, statuses, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = view.state()
        if state and state['status'] in statuses:
            return state
        time.sleep(.05)
    raise AssertionError(f'runner never reached {statuses}: {view.state()}')


def test_bundles_group_with_receipt_joins_and_tolerate_missing_or_invalid_receipts(vault):
    deliver(vault, '11111111-1111-4111-8111-111111111111', 'RW-01.md', '# Heading one\n\nBody.\n', title='Behind the scenes')
    changed = deliver(vault, '22222222-2222-4222-8222-222222222222', 'RW-02.md', '# Two\n')
    (changed / 'RW-02.md').write_text('# Two, edited after delivery\n')
    (changed / 'attachment.png').write_bytes(b'\x89PNG')
    bad = vault / 'inbox/bad-receipt'; bad.mkdir()
    (bad / 'notes.md').write_text('---\ntitle: "Frontmatter title"\n---\n# Ignored heading\n')
    (bad / 'receipt.json').write_text('{not json')
    big = vault / 'inbox/huge-receipt'; big.mkdir()
    (big / 'draft.md').write_text('# Huge receipt draft\n')
    (big / 'receipt.json').write_text(json.dumps({'reader_receipt': 1, 'files': [], 'pad': 'x' * (256 * 1024)}))
    (vault / 'inbox/loose.txt').write_text('no heading here')
    (vault / 'inbox/.hidden.md').write_text('# hidden')
    (vault / 'inbox/empty-folder').mkdir()
    os.symlink(vault / 'library', vault / 'inbox/link')
    rows = {row['id']: row for row in InboxView(vault).arrivals()}
    assert sorted(rows) == ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'bad-receipt', 'huge-receipt', 'loose.txt']
    first = rows['11111111-1111-4111-8111-111111111111']
    assert first['title'] == 'Behind the scenes' and first['integrity'] == 'intact' and first['files'] == 2
    assert first['document'] == 'inbox/11111111-1111-4111-8111-111111111111/RW-01.md'
    assert first['author'] == 'Claude' and first['project'] == 'Reader' and first['report_date'] == '2026-10-24' and first['source'] == 'Claude Code session'
    assert first['received_at'] == '2026-10-24T20:19:46+00:00'
    assert rows['22222222-2222-4222-8222-222222222222']['integrity'] == 'changed' and rows['22222222-2222-4222-8222-222222222222']['files'] == 3
    assert rows['bad-receipt']['integrity'] is None and 'valid JSON' in rows['bad-receipt']['receipt_error']
    assert rows['bad-receipt']['title'] == 'Frontmatter title'
    assert rows['huge-receipt']['integrity'] is None and '256 KiB' in rows['huge-receipt']['receipt_error']
    assert rows['huge-receipt']['title'] == 'Huge receipt draft'
    assert rows['loose.txt']['title'] == 'loose.txt' and rows['loose.txt']['bundle'] is False and rows['loose.txt']['received_at']


def test_receipt_paths_cannot_escape_their_bundle(vault):
    folder = deliver(vault, '33333333-3333-4333-8333-333333333333', 'doc.md', '# Doc\n')
    receipt = json.loads((folder / 'receipt.json').read_text())
    receipt['files'].append({'path': '../../library/secret.md', 'bytes': 1, 'sha256': 'x'})
    (folder / 'receipt.json').write_text(json.dumps(receipt))
    assert InboxView(vault).arrivals()[0]['integrity'] == 'changed'


def test_codex_lookup_matches_the_plugin_order_and_override(tmp_path):
    first = tmp_path / 'a'; second = tmp_path / 'b'
    for folder in (first, second):
        folder.mkdir(); (folder / 'codex').write_text('#!/bin/sh\n'); (folder / 'codex').chmod(0o755)
    environ = {'PATH': f'{first}:{second}'}
    assert codex_candidates(environ)[:2] == [str(first / 'codex'), str(second / 'codex')]
    assert codex_candidates(environ)[-2:] == ['/opt/homebrew/bin/codex', '/usr/local/bin/codex']
    assert str(Path.home() / '.local/bin/codex') in codex_candidates(environ)
    assert find_codex(environ) == str(first / 'codex')
    assert find_codex({'PATH': str(first), 'READER_CODEX': str(second / 'codex')}) == str(second / 'codex')
    assert find_codex({'READER_CODEX': str(tmp_path / 'missing')}) is None


def test_start_spawns_the_supervisor_with_explicit_argv_and_no_shell(vault):
    deliver(vault, '44444444-4444-4444-8444-444444444444', 'spec.md', '# Spec\n')
    fake = fake_codex(vault, '')
    calls = []

    class Recorded:
        def __init__(self, argv, **options):
            calls.append((argv, options))
            self.code = None
        def poll(self):
            return self.code
        def wait(self):
            return 0

    view = InboxView(vault, environ=env_for(fake) | {'READER_WORKSTATION_LOCK_STORE': '/srv/git-locks/workstation.git'}, spawn=Recorded)
    result = view.start('danger-full-access', wait=.2)
    argv, options = calls[0]
    assert argv == [sys.executable, '-m', 'reader_mcp.inbox_runner', '--root', str(vault), '--codex', str(fake),
                    '--run-id', result['run_id'], '--sandbox-mode', 'danger-full-access',
                    '--workstation-lock-store', '/srv/git-locks/workstation.git']
    assert options['shell'] is False and options['start_new_session'] is True and options['cwd'] == str(vault)
    assert options['stdin'] == subprocess.DEVNULL and options['stdout'] == subprocess.DEVNULL
    with pytest.raises(ValueError):
        view.start('bypass')


def test_real_supervisor_run_reports_and_reads_a_capped_report(vault):
    deliver(vault, '55555555-5555-4555-8555-555555555555', 'spec.md', '# Spec five\n')
    fake = fake_codex(vault, '''import sys,pathlib,shutil
args=sys.argv
sys.stdin.read()
shutil.move('inbox/55555555-5555-4555-8555-555555555555','library/spec-five')
pathlib.Path(args[args.index('--output-last-message')+1]).write_text('# Filed\\n\\n- library/spec-five\\n\\n' + 'x'*300000 + '\\nEND')
''')
    view = InboxView(vault, environ=env_for(fake))
    result = view.start()
    assert result['state'] and result['state']['run_id'] == result['run_id']
    wait_for(view, ('finished', 'failed'))
    status = view.status()
    assert status['runner']['status'] == 'finished', status['runner']['message']
    assert status['runner']['arrivals'] == 1 and status['runner']['remaining'] == 0
    assert status['runner']['report_truncated'] is True and len(status['runner']['report_md'].encode()) <= MAX_REPORT
    assert status['runner']['report_md'].endswith('END')
    assert status['arrivals'] == [] and status['blocked']['reason'] == 'empty'


def test_report_commit_is_verified_against_git(vault):
    if not shutil.which('git'):
        pytest.skip('git unavailable')
    git = ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false']
    subprocess.run(['git', 'init', '-q'], cwd=vault, check=True)
    (vault / 'library/a.md').write_text('# A\n')
    subprocess.run(git + ['add', '.'], cwd=vault, check=True)
    subprocess.run(git + ['commit', '-q', '-m', 'Import inbox batch'], cwd=vault, check=True)
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=vault, capture_output=True, text=True, check=True).stdout.strip()
    view = InboxView(vault)
    assert view.commit(f'Local commit: `{head[:9]}`.') == {'hash': head, 'short': head[:12], 'subject': 'Import inbox batch'}
    assert view.commit('Committed deadbeefdeadbeef as well.') is None
    assert view.commit('No commit was made.') is None


def test_claims_and_interrupted_state_disable_start(vault):
    deliver(vault, '66666666-6666-4666-8666-666666666666', 'spec.md', '# Spec\n')
    fake = fake_codex(vault, 'raise SystemExit(0)\n')
    spawned = []
    view = InboxView(vault, environ=env_for(fake), spawn=lambda *a, **k: spawned.append(a))
    (vault / '.reader').mkdir()
    (vault / '.reader/upkeep-claims.json').write_text(json.dumps({'inbox/66666666-6666-4666-8666-666666666666': 'agent-1'}))
    status = view.status()
    assert status['claims_held'] == ['inbox/66666666-6666-4666-8666-666666666666']
    assert status['blocked']['reason'] == 'claims' and 'Filing already assigned' in status['blocked']['message']
    with pytest.raises(ValueError, match='Filing already assigned'):
        view.start()
    (vault / '.reader/upkeep-claims.json').write_text('{}')
    runtime = vault / '.reader/inbox-runner'; runtime.mkdir()
    dead = subprocess.Popen([sys.executable, '-c', 'pass']); dead.wait()
    state = {'run_id': 'old', 'status': 'running', 'supervisor_pid': dead.pid, 'message': 'Codex is processing the inbox'}
    (runtime / 'state.json').write_text(json.dumps(state))
    status = view.status()
    assert status['runner']['status'] == 'interrupted' and status['blocked']['reason'] == 'interrupted'
    assert 'remove only .reader/inbox-runner/state.json' in status['blocked']['message']
    with pytest.raises(ValueError, match='stopped unexpectedly'):
        view.start()
    assert json.loads((runtime / 'state.json').read_text()) == state, 'the server never rewrites runner state'
    assert spawned == []


def test_a_running_voice_chat_turn_blocks_you_got_mail_with_a_clear_message(vault):
    import fcntl
    deliver(vault, '77777777-7777-4777-8777-777777777777', 'spec.md', '# Spec\n')
    fake = fake_codex(vault, 'raise SystemExit(0)\n')
    spawned = []
    view = InboxView(vault, environ=env_for(fake), spawn=lambda *a, **k: spawned.append(a))
    lock = vault / '.reader/voice-runner/run.lock'
    lock.parent.mkdir(parents=True)
    lock.touch()
    assert view.status()['blocked'] is None  # an idle lock file does not block
    with lock.open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)  # a chat turn holds the run lock for its whole turn
        status = view.status()
        assert status['chat_turn'] is True and status['blocked']['reason'] == 'chat'
        with pytest.raises(ValueError, match='voice chat turn is running'):
            view.start()
    assert spawned == [] and view.status()['blocked'] is None


def test_supervisor_refuses_when_claims_appear_after_the_web_check(vault):
    deliver(vault, '77777777-7777-4777-8777-777777777777', 'spec.md', '# Spec\n')
    fake = fake_codex(vault, 'raise SystemExit(0)\n')
    view = InboxView(vault, environ=env_for(fake))
    original = view.blocked
    def racing(status):
        result = original(status)
        (vault / '.reader').mkdir(exist_ok=True)
        (vault / '.reader/upkeep-claims.json').write_text(json.dumps({'inbox/77777777-7777-4777-8777-777777777777': 'agent-2'}))
        return result
    view.blocked = racing
    result = view.start()
    assert result['state']['status'] == 'failed' and 'Upkeep intake workers hold arrivals' in result['state']['message']


def test_stop_writes_the_cancel_file_and_the_run_stops(vault):
    deliver(vault, '88888888-8888-4888-8888-888888888888', 'spec.md', '# Spec\n')
    fake = fake_codex(vault, 'import time\ntime.sleep(30)\n')
    view = InboxView(vault, environ=env_for(fake))
    with pytest.raises(ValueError, match='No inbox run'):
        view.stop()
    view.start()
    wait_for(view, ('running',))
    with pytest.raises(RunConflict, match='already reading the mail'):
        view.start()
    assert view.stop()['requested'] is True
    assert (vault / '.reader/inbox-runner/cancel').read_text() == CANCEL_TEXT
    state = wait_for(view, ('stopped', 'failed'))
    assert state['status'] == 'stopped'


def test_state_and_report_reads_are_bounded_and_symlink_safe(vault, tmp_path):
    runtime = vault / '.reader/inbox-runner'; runtime.mkdir(parents=True)
    (runtime / 'state.json').write_text(json.dumps({'status': 'failed', 'message': 'x' * 300000}))
    view = InboxView(vault)
    assert any('256 KiB' in error for error in view.status()['errors'])
    (runtime / 'state.json').unlink()
    outside = tmp_path / 'outside.json'; outside.write_text(json.dumps({'status': 'failed', 'message': 'outside'}))
    os.symlink(outside, runtime / 'state.json')
    assert any('symlink' in error for error in view.status()['errors'])
    assert view.status()['blocked']['reason'] == 'error'


def test_inbox_previews_are_read_only(vault):
    folder = deliver(vault, '99999999-9999-4999-8999-999999999999', 'spec.md', '# Preview me\n\n![figure](figure.png)\n')
    (folder / 'figure.png').write_bytes(b'\x89PNG')
    (vault / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': []}))
    library = WebLibrary(vault)
    path = 'inbox/99999999-9999-4999-8999-999999999999/spec.md'
    doc = library.document(path, 'Tester')
    assert doc['preview'] is True and doc['item'] is None and doc['bookmark'] is None and doc['text'].startswith('# Preview me')
    assert library.resolve(path, 'figure.png')['path'] == 'inbox/99999999-9999-4999-8999-999999999999/figure.png'
    with pytest.raises(ValueError):
        library.resolve(path, '../../library/x.md')
    hover = library.preview(path, '', 'Tester')  # link previews inside an inbox preview, with no unread mark
    assert hover['title'] == 'Preview me' and hover['read'] is True
    with pytest.raises(ValueError):
        library.path(path)  # writers (bookmarks, read receipts, Read next) keep the library-only boundary
    with pytest.raises(ValueError):
        library.engagement.seen('Tester', [{'key': 'document:' + path, 'version': doc['sha256']}])
    with pytest.raises(ValueError):
        library.annotations.list(path)
    with pytest.raises(ValueError):
        library.chat_document(path)  # voice chats, which may write in the vault, never start from an arrival
    with pytest.raises(ValueError):
        library.document('inbox/../library/x.md')
    assert not (vault / 'engagement').exists() and not (vault / 'bookmarks').exists()


def test_inbox_routes_validate_actions_and_keep_previews_read_only(vault):
    import threading
    from http.client import HTTPConnection
    from reader_mcp.web import WebServer
    deliver(vault, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'spec.md', '# Routed spec\n')
    (vault / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': []}))
    library = WebLibrary(vault, inbox_environ={'READER_CODEX': str(vault / 'missing-codex')})
    server = WebServer(('127.0.0.1', 0), library, 'Tester')
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    def request(path, payload=None, token=None):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
        connection.request('POST' if payload is not None else 'GET', path, json.dumps(payload) if payload is not None else None,
                           {'Content-Type': 'application/json', 'X-Reader-Token': token or server.token})
        response = connection.getresponse(); body = json.loads(response.read()); connection.close()
        return response.status, body
    try:
        status, body = request('/api/inbox')
        assert status == 200 and body['arrivals'][0]['title'] == 'A delivered spec' and body['codex'] is None
        assert body['blocked']['reason'] == 'codex'
        assert request('/api/inbox', {'action': 'start'}, token='wrong')[0] == 403
        assert request('/api/inbox', {'action': 'start', 'prompt': 'do something else'})[0] == 400
        assert request('/api/inbox', {'action': 'stop', 'force': True})[0] == 400
        status, body = request('/api/inbox', {'action': 'start'})
        assert status == 400 and 'Codex was not found' in body['error']
        assert request('/api/inbox', {'action': 'stop'})[0] == 400
        path = 'inbox/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/spec.md'
        status, doc = request('/api/document?path=' + path)
        assert status == 200 and doc['preview'] is True
        assert request('/api/bookmark', {'participant': 'Tester', 'path': path, 'source_sha256': doc['sha256'], 'progress': .5})[0] == 400
        assert request('/api/seen', {'participant': 'Tester', 'items': [{'key': 'document:' + path, 'version': doc['sha256']}]})[0] == 400
        assert request('/api/next?path=' + path)[0] == 400
        assert not (vault / '.reader/inbox-runner').exists(), 'GET and refused starts create no runner state'
    finally:
        server.shutdown(); server.server_close()


# Activity transcript events -------------------------------------------------------------------

def runtime_with(vault, status='running', **state):
    runtime = vault / '.reader/inbox-runner'
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / 'state.json').write_text(json.dumps({'status': status, 'message': 'm', 'run_id': 'run-1', 'supervisor_pid': os.getpid(),
                                                    'started_at': '2026-10-24T20:00:00+00:00', 'arrivals': ['a', 'b'], **state}))
    return runtime


def line(n, size=0):
    return (json.dumps({'type': 'item.completed', 'item': {'id': f'item_{n}', 'type': 'agent_message', 'text': 'x' * size}}) + '\n').encode()


def test_events_page_whole_lines_from_a_byte_offset(vault):
    runtime = runtime_with(vault)
    first, second = line(0), line(1)
    (runtime / 'events.jsonl').write_bytes(first + second[:20])  # The supervisor copies output in chunks.
    view = InboxView(vault)
    page = view.events(0)
    assert [e['item']['id'] for e in page['events']] == ['item_0'] and page['next_offset'] == len(first)
    assert page['done'] is False and page['arrivals'] == ['a', 'b'] and page['run_id'] == 'run-1'
    assert view.events(page['next_offset'])['events'] == [], 'a line still being written is not returned'
    (runtime / 'events.jsonl').write_bytes(first + second + b'not json\n' + b'[1]\n')
    page = view.events(len(first))
    assert [e.get('item', {}).get('id') or e['type'] for e in page['events']] == ['item_1', 'reader.skipped']
    assert page['next_offset'] == len(first + second) + 13
    with pytest.raises(ValueError):
        view.events(-1)
    with pytest.raises(ValueError):
        view.events(9 * 1024**2)


def test_events_read_at_most_256_kib_and_resynchronize_after_an_oversized_line(vault):
    from reader_mcp.inbox_view import MAX_EVENTS_READ
    runtime = runtime_with(vault)
    body = b''.join(line(n, 1000) for n in range(600))  # About 640 KiB.
    huge = line(999, 300 * 1024)
    (runtime / 'events.jsonl').write_bytes(body + huge + line(1000))
    view = InboxView(vault)
    offset, seen, pages, skipped = 0, [], 0, []
    while True:
        page = view.events(offset)
        assert page['next_offset'] - offset <= MAX_EVENTS_READ
        seen += [e['item']['id'] for e in page['events'] if 'item' in e]
        skipped += [e['bytes'] for e in page['events'] if e['type'] == 'reader.skipped']
        pages += 1
        if page['next_offset'] == offset or page['next_offset'] >= page['size']:
            offset = page['next_offset']
            break
        offset = page['next_offset']
    assert seen == [f'item_{n}' for n in range(600)] + ['item_1000'], 'the oversized line is skipped, the next one is read'
    assert sum(skipped) == len(huge) and pages >= 5
    assert offset == len(body + huge + line(1000))


def test_events_refuse_symlinks_and_report_done_only_at_the_end(vault, tmp_path):
    runtime = runtime_with(vault, 'finished', finished_at='2026-10-24T20:05:00+00:00', remaining=['inbox/b/file.md'])
    outside = tmp_path / 'outside.jsonl'; outside.write_bytes(line(0))
    os.symlink(outside, runtime / 'events.jsonl')
    view = InboxView(vault)
    with pytest.raises(ValueError, match='symlink'):
        view.events(0)
    (runtime / 'events.jsonl').unlink()
    (runtime / 'events.jsonl').write_bytes(line(0) + line(1) + b'{"type": "turn.completed", "usage": {"input_tokens": 5}}')
    first = view.events(0)
    assert first['done'] is True and first['remaining'] == ['b'] and first['finished_at']
    assert [e['type'] for e in first['events']] == ['item.completed', 'item.completed', 'turn.completed'], 'a final unterminated line is read once the run is over'
    assert view.events(first['next_offset'])['events'] == []
    # A shorter stream than the offset means a newer run cleared it.
    assert view.events(first['next_offset'] + 50)['reset'] is True
    runtime_with(vault, 'starting')
    assert view.events(0) == view.events(0) and view.events(0)['events'] == [] and view.events(0)['done'] is False
    shutil.rmtree(vault / '.reader')
    (vault / '.reader').mkdir(); os.symlink(tmp_path, vault / '.reader/inbox-runner')
    with pytest.raises(ValueError, match='symlink'):
        view.events(0)


def test_failed_runs_include_the_message_and_stderr_tail(vault):
    runtime = runtime_with(vault, 'failed', message='Codex exited with status 1. Open run details.')
    (runtime / 'events.jsonl').write_bytes(line(0))
    (runtime / 'stderr.log').write_text('noise\n' * 5000 + 'Error: quota exceeded\n')
    page = InboxView(vault).events(0)
    assert page['done'] and page['message'].startswith('Codex exited') and page['stderr_tail'].endswith('Error: quota exceeded\n')
    assert len(page['stderr_tail'].encode()) <= 8 * 1024


def test_events_bound_large_fields_and_show_vault_paths_relative(vault):
    runtime = runtime_with(vault)
    output = 'HEAD' + 'o' * 100_000 + 'TAIL'
    events = [{'type': 'item.completed', 'item': {'id': 'c', 'type': 'command_execution', 'command': 'cat', 'aggregated_output': output, 'exit_code': 0, 'status': 'completed'}},
              {'type': 'padding', 'data': 'x' * 70_000, 'small': 1},
              {'type': 'item.completed', 'item': {'id': 'f', 'type': 'file_change', 'status': 'completed', 'changes': [{'path': str(vault / 'library/a.md'), 'kind': 'add'}, {'path': '/tmp/x.py', 'kind': 'add'}]}},
              {'type': 'item.completed', 'item': {'id': 'm', 'type': 'agent_message', 'text': f'Filed [it]({vault}/library/a.md) and {vault}/library/b.md.'}}]
    (runtime / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))
    command, padding, files, message = InboxView(vault).events(0)['events']
    kept = command['item']['aggregated_output']
    assert kept.startswith('HEAD') and kept.endswith('TAIL') and 'characters omitted' in kept and len(kept) < 70_000
    assert command['reader_truncated'] == {'item.aggregated_output': len(output)}
    assert padding == {'type': 'padding', 'small': 1, 'reader_dropped': ['data']}
    assert [c['path'] for c in files['item']['changes']] == ['library/a.md', '/tmp/x.py']
    assert message['item']['text'] == 'Filed [it](library/a.md) and library/b.md.'


def test_supervisor_streams_events_while_codex_is_still_running(vault):
    deliver(vault, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'spec.md', '# Live\n')
    fake = fake_codex(vault, '''import json,sys,time
sys.stdin.read()
print(json.dumps({"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Reading the arrivals."}}), flush=True)
time.sleep(4)
''')
    view = InboxView(vault, environ=env_for(fake))
    view.start()
    deadline = time.monotonic() + 3.5
    while time.monotonic() < deadline:
        page = view.events(0)
        if page['events']:
            break
        time.sleep(.1)
    assert page['status'] == 'running' and page['events'][0]['item']['text'] == 'Reading the arrivals.', 'a short line reaches events.jsonl before Codex exits'
    assert page['done'] is False
    wait_for(view, ('finished', 'failed'))
    assert view.events(page['next_offset'])['done'] is True


def test_events_route_validates_the_offset(vault):
    import threading
    from http.client import HTTPConnection
    from reader_mcp.web import WebServer
    runtime = runtime_with(vault)
    (runtime / 'events.jsonl').write_bytes(line(0))
    server = WebServer(('127.0.0.1', 0), WebLibrary(vault), 'Tester')
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    def get(path):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
        connection.request('GET', path, headers={'X-Reader-Token': server.token})
        response = connection.getresponse(); body = json.loads(response.read()); connection.close()
        return response.status, body
    try:
        status, body = get('/api/inbox/events?after=0')
        assert status == 200 and body['events'][0]['item']['id'] == 'item_0' and body['next_offset'] == len(line(0))
        assert get('/api/inbox/events')[0] == 200
        for bad in ('-1', 'abc', '1e3', '99999999999'):
            assert get('/api/inbox/events?after=' + bad)[0] == 400
    finally:
        server.shutdown(); server.server_close()


def test_a_second_start_while_a_run_is_active_is_a_409_conflict(vault):
    import threading
    from http.client import HTTPConnection
    from reader_mcp.web import WebServer
    deliver(vault, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'spec.md', '# Spec\n')
    (vault / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-24', 'works': []}))
    fake = fake_codex(vault, 'import time\ntime.sleep(30)\n')
    library = WebLibrary(vault, inbox_environ=env_for(fake))
    server = WebServer(('127.0.0.1', 0), library, 'Tester')
    threading.Thread(target=server.serve_forever, daemon=True).start()
    def request(path, payload=None):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
        connection.request('POST' if payload is not None else 'GET', path, json.dumps(payload) if payload is not None else None,
                           {'Content-Type': 'application/json', 'X-Reader-Token': server.token})
        response = connection.getresponse(); body = json.loads(response.read()); connection.close()
        return response.status, body
    try:
        assert request('/api/inbox', {'action': 'start'})[0] == 200
        wait_for(library.inbox, ('running',))
        status, body = request('/api/inbox', {'action': 'start'})
        assert status == 409 and body['error'] == 'The librarian is already reading the mail.'
        assert request('/api/inbox')[1]['blocked']['reason'] == 'active'
        assert request('/api/inbox', {'action': 'stop'})[0] == 200
        wait_for(library.inbox, ('stopped', 'failed'))
    finally:
        server.shutdown(); server.server_close()
