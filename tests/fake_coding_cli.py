"""A controlled coding-agent CLI for coding-job tests (RW-44). Never a model, never the network.

Invoked with Codex's (`exec --cd … --output-last-message FILE -`) or Claude Code's (`-p --output-format
stream-json …`) argv, it reads the job brief and prompt from stdin, prints that CLI's event shapes, edits
and commits in its working directory (the job worktree) as the scenario says, and ends with a final
message carrying a reader-result block. The scenario is a JSON file named by FAKE_CODING_SCENARIO; each
invocation appends {argv, cwd, stdin_sha256, pid} to the scenario's `record` file."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True)


def main():
    scenario = json.loads(Path(os.environ['FAKE_CODING_SCENARIO']).read_text())
    stdin = sys.stdin.buffer.read()
    argv = sys.argv[1:]
    codex = argv[:1] == ['exec']
    with open(scenario['record'], 'a') as out:
        out.write(json.dumps({'argv': argv, 'cwd': os.getcwd(), 'stdin_sha256': hashlib.sha256(stdin).hexdigest(),
                              'stdin_head': stdin[:4000].decode('utf-8', 'replace'), 'pid': os.getpid(), 'pgid': os.getpgid(0)}) + '\n')
    emit = lambda event: print(json.dumps(event), flush=True)
    if codex:
        emit({'type': 'thread.started', 'thread_id': 'fake-thread'})
        emit({'type': 'turn.started'})
        emit({'type': 'item.completed', 'item': {'id': 'item_1', 'type': 'command_execution', 'command': "/bin/sh -lc 'pytest -q'",
                                                  'aggregated_output': '1 failed, 2 passed in 0.10s\n', 'exit_code': 1, 'status': 'failed'}})
    else:
        emit({'type': 'system', 'subtype': 'init', 'session_id': 'fake-session', 'model': 'fake-model'})
        emit({'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'id': 'tu1', 'name': 'Bash', 'input': {'command': 'pytest -q'}}]}})
        emit({'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'tu1', 'content': '2 passed in 0.10s', 'is_error': False}]}})
    print('not json: a progress line the trace must not invent meaning for', flush=True)
    print('fake agent diagnostics on stderr', file=sys.stderr, flush=True)
    if scenario.get('flood'):
        chunk = 'x' * 1023 + '\n'
        for _ in range(scenario['flood'] // 1024):
            sys.stdout.write(chunk)
        sys.stdout.flush()
    deadline = time.monotonic() + scenario.get('sleep', 0)
    while time.monotonic() < deadline:
        print(json.dumps({'type': 'reader.heartbeat'}), flush=True)
        time.sleep(0.1)
    outcome = scenario.get('outcome', 'implemented')
    branch = git('symbolic-ref', '--short', 'HEAD').stdout.strip()
    if scenario.get('commit', outcome == 'implemented'):
        Path('src').mkdir(exist_ok=True)
        Path('src/depth.txt').write_text('max depth: 256\n')
        Path('tests').mkdir(exist_ok=True)
        Path('tests/test_depth.txt').write_text('deep input -> diagnostic\n')
        git('add', 'src/depth.txt', 'tests/test_depth.txt')
        result = git('commit', '-q', '-m', 'Bound parser depth')
        sha = git('rev-parse', '--short', 'HEAD').stdout.strip()
        if codex:
            emit({'type': 'item.completed', 'item': {'id': 'item_2', 'type': 'command_execution', 'command': "/bin/sh -lc 'git commit -m \"Bound parser depth\"'",
                                                      'aggregated_output': f'[{branch} {sha}] Bound parser depth\n', 'exit_code': result.returncode, 'status': 'completed'}})
            emit({'type': 'item.completed', 'item': {'id': 'item_3', 'type': 'file_change', 'status': 'completed',
                                                      'changes': [{'path': 'src/depth.txt', 'kind': 'add'}]}})
    if scenario.get('dirty'):
        Path('src').mkdir(exist_ok=True)
        Path('src/uncommitted.txt').write_text('work in progress\n')
    if scenario.get('switch'):
        git('checkout', '-q', '-b', 'somewhere-else')
    if scenario.get('push') == 'same':
        git('push', '-q', 'origin', f'HEAD:refs/heads/{branch}')
    elif scenario.get('push') == 'other':
        git('commit', '-q', '--allow-empty', '-m', 'Something else')
        git('push', '-q', 'origin', f'HEAD:refs/heads/{branch}')
        git('reset', '-q', '--hard', 'HEAD~1')
    report = {'outcome': outcome, 'summary': scenario.get('summary', 'Bounded the parser depth; deep input now yields a diagnostic.'),
              'evidence': 'RED: deep input aborted. GREEN: 3 passed.', 'existing_pr': scenario.get('existing_pr'),
              'issue_title': 'Bound parser depth', 'issue_body': 'Deeply nested input aborts the process.\n\nAcceptance: a controlled diagnostic.',
              'pr_title': 'Bound parser depth', 'pr_body': 'Adds a depth limit with tests below and above it.'}
    final = 'Done.\n\n```reader-result\n' + json.dumps(report) + '\n```' if outcome not in (None, 'bad-json') else \
        'Done, without a report.' if outcome is None else 'Done.\n\n```reader-result\n{not json\n```'
    if codex:
        emit({'type': 'item.completed', 'item': {'id': 'item_9', 'type': 'agent_message', 'text': final}})
        emit({'type': 'turn.completed', 'usage': {'input_tokens': 1200, 'cached_input_tokens': 200, 'output_tokens': 300}})
        Path(argv[argv.index('--output-last-message') + 1]).write_text(final)
    else:
        emit({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': final}]}})
        emit({'type': 'result', 'subtype': 'success', 'result': final, 'usage': {'input_tokens': 10, 'output_tokens': 5}})
    sys.exit(scenario.get('exit', 0))


if __name__ == '__main__':
    main()
