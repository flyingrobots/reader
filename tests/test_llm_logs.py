"""The permanent LLM log archive: layout, gzip, crash records, commits and no pruning."""
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from chat_vault import make_vault  # noqa: E402

from reader_mcp import llm_logs
from reader_mcp.chats import Chats

WHEN = datetime(2026, 10, 24, 21, 5, tzinfo=timezone.utc)


def test_layout_and_gzip_roundtrip(tmp_path):
    log = llm_logs.RunLog(tmp_path, 'chat', 'run-1', {'voice': 'Agy'}, now=WHEN)
    assert log.relative == 'logs/llm/chat/2026/10/24/run-1' and log.dir == tmp_path.resolve() / log.relative
    body = ''.join(json.dumps({'event': 'step_update', 'n': i}) + '\n' for i in range(5000))
    with log.open('stdout.jsonl') as out:
        out.write(body.encode())
    log.write('prompt.txt', 'Prompt ✓')
    (log.dir / 'last-message.md').write_text('Last')  # A CLI may write its own file into the run directory.
    assert json.loads((log.dir / 'meta.json').read_text())['status'] == 'running'
    assert log.finish('done', exit_code=0) == log.relative
    names = sorted(p.name for p in log.dir.iterdir())
    assert names == ['last-message.md.gz', 'meta.json', 'prompt.txt.gz', 'stdout.jsonl.gz']
    assert gzip.decompress((log.dir / 'stdout.jsonl.gz').read_bytes()).decode() == body
    meta = json.loads((log.dir / 'meta.json').read_text())
    assert meta['status'] == 'done' and meta['exit_code'] == 0 and meta['voice'] == 'Agy' and meta['ended_at']
    assert meta['files']['stdout.jsonl']['bytes'] == len(body.encode()) and len(meta['files']['prompt.txt']['sha256']) == 64
    text, total, truncated = llm_logs.read(tmp_path, log.relative, 'prompt.txt', 1000)
    assert (text, truncated) == ('Prompt ✓', False)
    text, _, truncated = llm_logs.read(tmp_path, log.relative, 'stdout.jsonl', 100)
    assert len(text) == 100 and truncated


def test_partial_files_survive_a_crash_and_seal_later(tmp_path):
    log = llm_logs.RunLog(tmp_path, 'inbox', 'crash', now=WHEN)
    with log.open('stdout.jsonl') as out:
        out.write(b'{"type": "started"}\n')
    # The process dies here: the record is readable as is.
    assert (log.dir / 'stdout.jsonl.partial').read_bytes() == b'{"type": "started"}\n'
    assert llm_logs.read(tmp_path, log.relative, 'stdout.jsonl', 100)[0] == '{"type": "started"}\n'
    llm_logs.seal(tmp_path, log.relative, 'interrupted', 'Reader stopped.')
    meta = json.loads((log.dir / 'meta.json').read_text())
    assert meta['status'] == 'interrupted' and meta['note'] == 'Reader stopped.' and (log.dir / 'stdout.jsonl.gz').is_file()
    llm_logs.seal(tmp_path, log.relative)  # Sealing twice is a no-op.
    assert json.loads((log.dir / 'meta.json').read_text())['status'] == 'interrupted'


def test_paths_are_validated(tmp_path):
    with pytest.raises(ValueError):
        llm_logs.RunLog(tmp_path, 'other', 'x')
    with pytest.raises(ValueError):
        llm_logs.RunLog(tmp_path, 'chat', '../x')
    for bad in ('logs/llm/chat/2026/10/24/../../x', '/etc', 'chats/x', 'logs/llm/chat/2026/10/24/a/b'):
        with pytest.raises(ValueError):
            llm_logs.read(tmp_path, bad, 'stdout.jsonl', 10)
    (tmp_path / 'logs').mkdir()
    (tmp_path / 'elsewhere').mkdir()
    (tmp_path / 'logs/llm').symlink_to(tmp_path / 'elsewhere')
    with pytest.raises(ValueError, match='symlinks'):
        llm_logs.RunLog(tmp_path, 'chat', 'x')


def test_argv_redaction():
    argv = ['/bin/agy', '-p', 'LONG PROMPT', '--api-key', 'k123', '--token=abc', 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstu',
            '-c', 'approval_policy="never"', 'see sk-abcdefghijklmnopqrstuvwx', '--append-system-prompt', 'PERSONA']
    out = llm_logs.redact_argv(argv, {'LONG PROMPT': '<prompt.txt>', 'PERSONA': '<system.txt>'})
    assert out == ['/bin/agy', '-p', '<prompt.txt>', '--api-key', '<redacted>', '--token=<redacted>', 'OPENAI_API_KEY=<redacted>',
                   '-c', 'approval_policy="never"', 'see <redacted>', '--append-system-prompt', '<system.txt>']


def test_logs_are_never_pruned_and_usage_counts_them(tmp_path):
    for index in range(300):
        log = llm_logs.RunLog(tmp_path, 'chat', f'run-{index}', now=WHEN)
        log.write('stdout.jsonl', 'x' * 1000)
        log.finish('done')
    assert len(list((tmp_path / 'logs/llm/chat/2026/10/24').iterdir())) == 300
    usage = llm_logs.usage(tmp_path, ttl=0)
    assert usage['runs'] == 300 and usage['bytes'] > 0 and usage['retention'] == 'forever'
    assert not [name for name in dir(llm_logs) if 'prune' in name or 'expire' in name]


def test_log_directory_commits_with_its_chat_and_trailer(tmp_path):
    root = make_vault(tmp_path / 'v')
    chats = Chats(root)
    chat = chats.create('library/thought.md', 'a' * 64, 'A quiet thought', 'You')
    log = llm_logs.RunLog(root, 'chat', 'turn-1', now=WHEN)
    log.write('stdout.jsonl', '{}\n')
    result = chats.commit(chat['id'], 'Chat: A quiet thought — Agy replied', 'Agy', git_locks=False, logs=[log.relative])
    assert result['status'] == 'committed'
    git = lambda *a: subprocess.run(['git', *a], cwd=root, capture_output=True, text=True, check=True).stdout
    assert sorted(git('show', '--name-only', '--format=', 'HEAD').split()) == sorted(
        [f'chats/{chat["id"]}.json', f'{log.relative}/meta.json', f'{log.relative}/stdout.jsonl.partial'])
    log.finish('done')
    chats.commit(chat['id'], 'Chat: A quiet thought — Agy replied', 'Agy', git_locks=False, logs=[log.relative])
    body = git('log', '-1', '--format=%B')
    assert 'Reader-Chat: ' + chat['id'] in body and 'Reader-Voice: Agy' in body and 'Reader-Log: chat/turn-1' in body
    assert sorted(git('show', '--name-status', '--format=', 'HEAD').split('\n')[:-1]) == sorted(
        [f'M\t{log.relative}/meta.json', f'D\t{log.relative}/stdout.jsonl.partial', f'A\t{log.relative}/stdout.jsonl.gz']), \
        'the sealed archive replaces streamed partials'
    with pytest.raises(ValueError):
        chats.commit(chat['id'], 'x', logs=['library/thought.md'])
