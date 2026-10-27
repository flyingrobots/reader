"""A fake voice CLI for chat tests. It never contacts a model.

Options (from the registry argv): --style claude|codex|agy|text|garbage, --reply TEXT,
--chunks N, --delay SECONDS, --sleep SECONDS (before replying), --hang, --exit CODE,
--write PATH (vault-relative file to create), --commit (commit that file),
--log DIR (record argv, stdin and cwd), --child (spawn a sleeping grandchild first),
--wait-for-commit SUBJECT (reply only once the vault's Git history has a commit with that subject, at most 30 s).

Listening checks (a prompt containing "Reader listening check") answer --listen TEXT
(default PASS) at once, so --hang/--sleep/--write apply only to ordinary turns;
--listen-write PATH creates a file during a listening check instead. A chime-in turn
("You are chiming in") replies --chime-reply TEXT when given.
agy only: --narrate TEXT (an interim agent_response before a tool step), --tools (one tool step
that succeeds and one that fails), --streamed TEXT (streamed text that differs from the final
`result.response`), --no-result (omit the result event), --status STATUS (result status).
Art commissions (a prompt naming "Reader art brief", "Reader art scene" or "Reader art scene repair"):
--art-brief TEXT answers the brief, --art-scene FILE the scene (a JSON file, sent in a ```json fence),
--art-first FILE the first scene answer only (so a repair follows), --art-usage adds a Claude-style
`total_cost_usd` and usage to the result event.
The agy events copy the shapes of real `agy -p --output-format stream-json` output."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

if len(sys.argv) > 1 and sys.argv[1] == '--version':
    print('fake-voice 1.0.0')
    raise SystemExit(0)
parser = argparse.ArgumentParser()
parser.add_argument('--style', default='claude')
parser.add_argument('--name', default='Fake')
parser.add_argument('--reply')
parser.add_argument('--chunks', type=int, default=3)
parser.add_argument('--delay', type=float, default=0.0)
parser.add_argument('--sleep', type=float, default=0.0)
parser.add_argument('--hang', action='store_true')
parser.add_argument('--exit', type=int, default=0)
parser.add_argument('--write')
parser.add_argument('--commit', action='store_true')
parser.add_argument('--log')
parser.add_argument('--child', action='store_true')
parser.add_argument('--wait-for-commit')
parser.add_argument('--prompt')
parser.add_argument('--persona')
parser.add_argument('--listen', default='PASS')
parser.add_argument('--listen-write')
parser.add_argument('--chime-reply')
parser.add_argument('--narrate')
parser.add_argument('--tools', action='store_true')
parser.add_argument('--streamed')
parser.add_argument('--no-result', action='store_true')
parser.add_argument('--status', default='SUCCESS')
parser.add_argument('--art-brief', default='TITLE: A synthetic artwork\nBRIEF:\nTwo slow forms circle a quiet center in the accent and one chart hue, '
                    'while faint particles drift across the page color: an invented brief for tests, long enough to pass.')
parser.add_argument('--art-scene')
parser.add_argument('--art-first')
parser.add_argument('--art-usage', action='store_true')
parser.add_argument('--quiz-json')
parser.add_argument('--quiz-first')
parser.add_argument('--quiz-review-json')
parser.add_argument('--writing-prompt-json')
args, rest = parser.parse_known_args()
prompt = args.prompt if args.prompt is not None else sys.stdin.read()
seen = prompt + '\n' + (args.persona or '')
if 'Generate 5–8 independent questions' in prompt and args.quiz_json:
    marker = Path(args.log or '.reader/fake-quiz') / 'quiz-called'
    marker.parent.mkdir(parents=True, exist_ok=True)
    args.reply = args.quiz_first if args.quiz_first and not marker.exists() else args.quiz_json
    marker.touch()
elif 'Review this answer against the saved rubric' in prompt and args.quiz_review_json:
    args.reply = args.quiz_review_json
elif 'Reader writing prompt:' in prompt and args.writing_prompt_json:
    args.reply = args.writing_prompt_json
kind = 'listen' if 'Reader listening check' in seen else 'chime_in' if 'You are chiming in' in seen else 'turn'
if 'Reader art brief' in prompt:
    args.reply = args.art_brief
elif 'Reader art scene repair' in prompt and args.art_scene:
    args.reply = '```json\n' + Path(args.art_scene).read_text() + '\n```'
elif 'Reader art scene' in prompt and (args.art_first or args.art_scene):
    args.reply = '```json\n' + Path(args.art_first or args.art_scene).read_text() + '\n```'
if args.log:
    log = Path(args.log); log.mkdir(parents=True, exist_ok=True)
    with (log / 'calls.jsonl').open('a') as out:
        out.write(json.dumps({'argv': sys.argv[1:], 'stdin': prompt, 'cwd': os.getcwd(), 'pid': os.getpid(), 'pgid': os.getpgid(0),
                              'tmpdir': os.environ.get('TMPDIR'), 'time': time.time(), 'kind': kind}) + '\n')
if kind == 'listen':
    args.sleep, args.hang, args.write, args.child, args.exit = 0, False, args.listen_write, False, 0
    args.reply = args.listen
    args.narrate, args.tools, args.streamed = None, False, None  # A listening check answers in one step.
elif kind == 'chime_in' and args.chime_reply:
    args.reply = args.chime_reply
if args.child:
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'])
    if args.log:
        (Path(args.log) / 'child.pid').write_text(str(child.pid))
if args.sleep:
    time.sleep(args.sleep)
if args.wait_for_commit and kind == 'turn':
    # Orders this reply after another voice's commit, so a test never depends on which reply finishes first.
    deadline = time.monotonic() + 30
    while args.wait_for_commit not in subprocess.run(['git', 'log', '--format=%s'], capture_output=True, text=True).stdout:
        if time.monotonic() > deadline:
            sys.exit('fake voice: no commit "' + args.wait_for_commit + '" within 30 s')
        time.sleep(.05)
if args.hang:
    print(json.dumps({'type': 'system', 'subtype': 'init', 'model': 'fake-model'}), flush=True)
    time.sleep(3600)
if args.write:
    target = Path(args.write); target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f'Written by {args.name} during a chat turn.\n')
    if args.commit:
        subprocess.run(['git', 'add', '--', args.write], check=True, capture_output=True)
        subprocess.run(['git', 'commit', '-q', '-m', f'{args.name} wrote a note', '--', args.write], check=True, capture_output=True)
reply = args.reply or f'{args.name} says hello.'
words = reply.split(' ')
size = max(1, -(-len(words) // max(1, args.chunks)))
pieces = [' '.join(words[i:i + size]) + (' ' if i + size < len(words) else '') for i in range(0, len(words), size)]


def emit(value):
    print(json.dumps(value), flush=True)
    if args.delay:
        time.sleep(args.delay)


def chunks(text):
    words = text.split(' ')
    step = max(1, -(-len(words) // max(1, args.chunks)))
    return [' '.join(words[i:i + step]) + (' ' if i + step < len(words) else '') for i in range(0, len(words), step)]


if args.style == 'agy':
    conversation = 'fake-conversation-0001'
    usage = {'input_tokens': 120, 'output_tokens': 30, 'thinking_tokens': 5, 'cache_read_tokens': 0, 'total_tokens': 155}
    index = [0]

    def step(kind, state, **fields):
        emit({'event': 'step_update', 'step_update': {'conversation_id': conversation, 'step_index': index[0], 'state': state,
                                                      'step_type': kind, **fields}})

    emit({'event': 'init', 'conversation_id': conversation,
          'init': {'cwd': os.getcwd(), 'tools': ['view_file', 'run_command'], 'permission_mode': 'always-proceed'}})
    step('user_input', 'DONE')
    if args.narrate:
        index[0] += 1
        for piece in chunks(args.narrate):
            step('agent_response', 'ACTIVE', text_delta=piece)
        step('agent_response', 'DONE', duration_seconds=0.4, usage=usage)
    if args.tools:
        index[0] += 1
        info = {'name': 'view_file', 'parameters': {'Path': 'library/thought.md'}}
        step('tool', 'ACTIVE', tool_name='view_file', tool_info=info)
        step('tool', 'DONE', tool_name='view_file', duration_seconds=0.1, tool_info=info | {'output': 'A precise passage.'})
        index[0] += 1
        info = {'name': 'view_file', 'parameters': {'Path': 'library/missing.md', 'StartLine': 1, 'EndLine': 5}}
        step('tool', 'ACTIVE', tool_name='view_file', tool_info=info)
        step('tool', 'ERROR', tool_name='view_file', duration_seconds=0.1, tool_info=info | {'error': {'type': 'NOT_FOUND', 'message': 'file does not exist'}})
    index[0] += 1
    for piece in chunks(args.streamed or reply):
        step('agent_response', 'ACTIVE', text_delta=piece)
    step('agent_response', 'DONE', duration_seconds=0.8, usage=usage)
    if args.exit:
        print('fake failure on stderr', file=sys.stderr, flush=True)
        raise SystemExit(args.exit)
    if not args.no_result:
        emit({'event': 'result', 'result': {'conversation_id': conversation, 'status': args.status, 'response': reply,
                                            'duration_seconds': 1.5, 'num_turns': 1, 'usage': usage}})
elif args.style == 'garbage':
    # Exit 0 with output that is neither JSON events nor wanted text, as a CLI with a changed schema might.
    for value in ({'kind': 'unknown', 'payload': reply}, {'kind': 'done'}):
        emit(value)
elif args.style == 'claude':
    emit({'type': 'system', 'subtype': 'init', 'model': 'fake-model-1', 'session_id': 'fake-session'})
    emit({'type': 'stream_event', 'event': {'type': 'message_start', 'message': {'model': 'fake-model-1'}}})
    for piece in pieces:
        emit({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': piece}}})
    emit({'type': 'stream_event', 'event': {'type': 'message_stop'}})
    emit({'type': 'assistant', 'message': {'model': 'fake-model-1', 'content': [{'type': 'text', 'text': reply}]}})
    if args.exit:
        print('fake failure on stderr', file=sys.stderr, flush=True)
        raise SystemExit(args.exit)
    emit({'type': 'result', 'subtype': 'success', 'result': reply, 'session_id': 'fake-session'}
         | ({'total_cost_usd': 0.0123, 'usage': {'input_tokens': 1200, 'output_tokens': 800}} if args.art_usage else {}))
elif args.style == 'codex':
    emit({'type': 'thread.started', 'thread_id': 'fake-thread'})
    emit({'type': 'item.completed', 'item': {'type': 'reasoning', 'text': 'thinking'}})
    emit({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': reply}})
    for index, value in enumerate(rest):
        if value == '--output-last-message' and index + 1 < len(rest):
            Path(rest[index + 1]).write_text(reply)
    if args.exit:
        print('fake failure on stderr', file=sys.stderr, flush=True)
        raise SystemExit(args.exit)
    emit({'type': 'turn.completed'})
else:
    for piece in pieces:
        sys.stdout.write(piece); sys.stdout.flush()
        if args.delay:
            time.sleep(args.delay)
    print(flush=True)
    if args.exit:
        print('fake failure on stderr', file=sys.stderr, flush=True)
        raise SystemExit(args.exit)
