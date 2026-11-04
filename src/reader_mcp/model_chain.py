"""The prescribed model order for one bounded, tool-free structured decision: Codex, Claude, agy, then a local model.

A failed provider never ends the work while another remains, and every step is reported as it happens: a
transcript event on stdout (the supervisor copies it to events.jsonl) and a bounded `model-chain.json` the
inbox status serves. Source text is untrusted, so each provider runs without tools and without the operator's
configuration. agy has no flag that removes its tools (plan mode and --sandbox still wrote files when tested),
so it runs in a scratch workspace whose PreToolUse hook denies every tool but `finish`.

This is for decisions that belong to no one. A voice's turn stays with its own CLI: an answer under Claude's
name written by Codex would forge that voice, so voices and coding jobs do not use this chain.

The order and how to start the local model are per-machine settings in the ignored `.reader/model-chain.json`."""
from collections import deque
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

from .portable_links import atomic

ORDER = ('codex', 'claude', 'agy', 'local')
LABELS = {'codex': 'Codex', 'claude': 'Claude', 'agy': 'agy', 'local': 'the local model'}
CONFIG = '.reader/model-chain.json'
STATE = 'model-chain.json'
START_MODES = ('off', 'lmstudio', 'command')
MAX_CONFIG = 64 * 1024
MAX_COMMAND = 32
MAX_ARGUMENT = 1024
MAX_MODEL_OUTPUT = 1024 ** 2
MAX_ATTEMPTS_KEPT = 200
CALL_TIMEOUT = 600
START_TIMEOUT = 300
SERVER_WAIT = 30
LOCAL_OUTPUT_TOKENS = 2048
LOCAL_REASONING_TOKENS = 8192
LOCAL_PROMPT_CHARS = 24_000 * 4
FAILURES = {
    'missing': 'is not installed', 'quota': 'is out of usage', 'auth': 'is not signed in',
    'timeout': 'did not answer in time', 'invalid': 'gave an answer that could not be accepted',
    'unavailable': 'could not be reached', 'off': 'is not running and starting it is turned off',
    'too-large': 'cannot fit this document', 'failed': 'failed'}
# Worth no second try this run: repeating them only delays the next provider, once per document.
STICKY = ('missing', 'quota', 'auth', 'off')
QUOTA = re.compile(r'usage.?limit|rate.?limit|quota|exhausted|credit balance|too many requests|\b429\b|limit reached|hit your .{0,40}limit', re.I)
AUTH = re.compile(r'not logged in|please log ?in|codex login|claude (/)?login|unauthori[sz]ed|authenticat|\b401\b|oauth', re.I)
DENY_HOOK = '''import json, sys
name = json.load(sys.stdin).get("toolCall", {}).get("name")
print(json.dumps({"decision": "allow" if name == "finish" else "deny", "reason": "Reader gives this call no tools"}))
'''
LIBRARIAN = 'codex'
STAND_IN = ('Codex, the Reader librarian, is out of office, so you are working as a stand-in for this one bounded task. '
            'You are not the librarian: do not adopt their persona, voice or name, and do not claim their past work or judgment. '
            'Do this task on its own terms.\n\n')
DIRECTORIES = ('~/.local/bin', '~/.cargo/bin', '/opt/homebrew/bin', '/usr/local/bin')


class ModelFailure(Exception):
    def __init__(self, reason, detail=None):
        super().__init__(detail or FAILURES.get(reason, reason))
        self.reason = reason


def default_config():
    return {'order': list(ORDER), 'local': {'start': 'lmstudio', 'command': [], 'model': ''}}


def checked_config(value):
    """A complete configuration, or ValueError. The command is argv: it is never given to a shell."""
    if not isinstance(value, dict) or set(value) - {'order', 'local'}:
        raise ValueError('Expected order and local')
    result = default_config()
    order = value.get('order', result['order'])
    if not isinstance(order, list) or not order or set(order) - set(ORDER) or len(set(order)) != len(order):
        raise ValueError('The model order lists codex, claude, agy and local, each at most once')
    result['order'] = order
    local = value.get('local', {})
    if not isinstance(local, dict) or set(local) - {'start', 'command', 'model'}:
        raise ValueError('Local settings are start, command and model')
    result['local'].update(local)
    if result['local']['start'] not in START_MODES:
        raise ValueError('Starting the local model is off, lmstudio or command')
    command, model = result['local']['command'], result['local']['model']
    if (not isinstance(command, list) or len(command) > MAX_COMMAND
            or not all(isinstance(a, str) and a and len(a) <= MAX_ARGUMENT and '\0' not in a for a in command)):
        raise ValueError('The local start command is a short list of arguments')
    if command and not os.path.isabs(os.path.expanduser(command[0])):
        raise ValueError('The local start command begins with an absolute path')
    if result['local']['start'] == 'command' and not command:
        raise ValueError('Choose a start command, or another way to start the local model')
    if not isinstance(model, str) or len(model) > 200:
        raise ValueError('The local model is a model name')
    return result


def read_config(root):
    """The saved settings, or the defaults when nothing is saved. A damaged file is an error, not a silent default."""
    file = Path(root) / CONFIG
    if file.is_symlink():
        raise ValueError(CONFIG + ' must not be a symlink')
    if not file.is_file():
        config = default_config()
    else:
        if file.stat().st_size > MAX_CONFIG:
            raise ValueError(CONFIG + ' is too large')
        config = checked_config(json.loads(file.read_text()))
    order = os.environ.get('READER_MODEL_CHAIN')
    if order:
        config['order'] = checked_config({'order': order.split(',')})['order']
    return config


def write_config(root, value):
    config = checked_config(value)
    atomic(Path(root) / CONFIG, config, limit=MAX_CONFIG)
    return config


def settings_view(root, identity=None, environ=None):
    """The settings page's data. The start command names a path and runs a program, so only this Mac's own browser sees it."""
    config = read_config(root)
    local_browser = identity is None or identity.get('via') == 'local'
    if not local_browser:
        config['local'].pop('command')
    return {'config': config, 'can_edit_command': local_browser,
            'providers': [{'name': name, 'label': LABELS[name], 'installed': name == 'local' or bool(find_cli(name, environ))} for name in ORDER]}


def configure(root, value, identity=None, environ=None):
    """Save settings. A tailnet browser may choose among modes but can never name a program to run on this Mac."""
    if not isinstance(value, dict):
        raise ValueError('Expected order and local')
    if identity is not None and identity.get('via') != 'local':
        local = value.get('local')
        if isinstance(local, dict) and 'command' in local:
            raise ValueError('The start command can only be changed in a browser on this Mac')
        value = {**value, 'local': {**(local if isinstance(local, dict) else {}), 'command': read_config(root)['local']['command']}}
    write_config(root, value)
    return settings_view(root, identity, environ)


def find_cli(name, environ=None, explicit=None):
    environ = os.environ if environ is None else environ
    override = explicit or (environ.get('READER_' + name.upper()) or '').strip()
    if override:
        found = shutil.which(override, path=environ.get('PATH', ''))
        return found or (override if os.path.isfile(override) and os.access(override, os.X_OK) else None)
    directories = [p for p in (environ.get('PATH') or '').split(':') if p] + [os.path.expanduser(p) for p in DIRECTORIES]
    return shutil.which(name, path=':'.join(directories))


def available(root, environ=None):
    """The providers this machine could try, in order. A local model counts as long as one is configured to be tried."""
    config = read_config(root)
    return [name for name in config['order'] if name == 'local' or find_cli(name, environ)]


def classify_failure(text):
    return 'quota' if QUOTA.search(text) else 'auth' if AUTH.search(text) else 'failed'


def run_cli(command, *, stdin_text, cwd, forward=False, timeout=CALL_TIMEOUT):
    """(status, stdout, stderr tail). Stderr, and stdout when forwarded, reach the transcript as they arrive.
    The child stays in this worker's process group, so cancellation also stops it."""
    process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    captured, tail = bytearray(), deque(maxlen=64)

    def out():
        # Whatever is available, not whole lines, so a partial event still reaches the transcript live.
        while chunk := process.stdout.read1(65536):
            if forward:
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
            if len(captured) + len(chunk) <= MAX_MODEL_OUTPUT:
                captured.extend(chunk)

    def err():
        for line in process.stderr:
            sys.stderr.buffer.write(line)
            sys.stderr.buffer.flush()
            tail.append(line)

    readers = [threading.Thread(target=out, daemon=True), threading.Thread(target=err, daemon=True)]
    for reader in readers:
        reader.start()
    try:
        process.stdin.write(stdin_text.encode())
        process.stdin.close()
    except OSError:
        pass  # It exited without reading its prompt; its status says why.
    try:
        status = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise ModelFailure('timeout') from None
    for reader in readers:
        reader.join(timeout=5)
    return status, bytes(captured), b''.join(tail).decode('utf-8', 'replace')


def parse_json_object(text):
    """The JSON object in a model's text, tolerating the code fence some local models add."""
    text = text.strip()
    start, end = text.find('{'), text.rfind('}')
    if start < 0 or end < start:
        raise ModelFailure('invalid', 'returned no JSON')
    try:
        value = json.loads(text[start:end + 1])
    except ValueError:
        raise ModelFailure('invalid', 'returned malformed JSON') from None
    if not isinstance(value, dict):
        raise ModelFailure('invalid', 'returned no JSON object')
    return value


def checked_exit(status, stdout, stderr):
    if status:
        reason = classify_failure(stderr + '\n' + stdout.decode('utf-8', 'replace')[-16000:])
        raise ModelFailure(reason, None if reason != 'failed' else f'exited with status {status}')


def structured_output(stdout):
    """The structured answer in Claude's or agy's JSON result. An error reported with status 0 is still a failure."""
    try:
        result = json.loads(stdout)
    except ValueError:
        raise ModelFailure('invalid', 'returned malformed JSON') from None
    if not isinstance(result, dict):
        raise ModelFailure('invalid', 'returned no JSON object')
    if result.get('is_error') or result.get('status') not in (None, 'SUCCESS'):
        reason = classify_failure(json.dumps(result)[-16000:])
        raise ModelFailure(reason)
    value = result.get('structured_output')
    if not isinstance(value, dict):
        raise ModelFailure('invalid', 'returned no structured answer')
    return value


def call_codex(executable, work, schema, prompt):
    schema_file, output = work / 'schema.json', work / 'decision.json'
    schema_file.write_text(json.dumps(schema))
    output.unlink(missing_ok=True)
    command = [executable, 'exec', '--cd', str(work), '--sandbox', 'read-only', '--ignore-user-config', '--ignore-rules',
               '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps', '--disable', 'multi_agent',
               '--disable', 'skill_search', '--enable', 'skip_host_skill_discovery',
               '-c', 'suppress_unstable_features_warning=true', '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"',
               '-c', 'approval_policy="never"', '--skip-git-repo-check', '--ephemeral', '--json', '--color', 'never',
               '--output-schema', str(schema_file), '--output-last-message', str(output), '-']
    checked_exit(*run_cli(command, stdin_text=prompt, cwd=work, forward=True))
    if output.is_symlink() or not output.is_file() or output.stat().st_size > 32 * 1024:
        raise ModelFailure('invalid', 'returned no bounded answer')
    return parse_json_object(output.read_text())


def call_claude(executable, work, schema, prompt):
    place = work / 'claude'
    place.mkdir(exist_ok=True)
    command = [executable, '-p', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
               '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json', '--json-schema', json.dumps(schema)]
    status, stdout, stderr = run_cli(command, stdin_text=prompt, cwd=place)
    checked_exit(status, stdout, stderr)
    return structured_output(stdout)


def agy_workspace(work):
    """An empty workspace whose only contents deny every tool. Rebuilt each call, so nothing a past run left applies."""
    place = work / 'agy'
    shutil.rmtree(place, ignore_errors=True)
    (place / '.agents').mkdir(parents=True)
    (place / '.agents/hook.py').write_text(DENY_HOOK)
    hook = {'type': 'command', 'command': shlex.join([sys.executable, '-I', 'hook.py']), 'timeout': 5}
    (place / '.agents/hooks.json').write_text(json.dumps({'reader-deny-tools': {'PreToolUse': [{'matcher': '*', 'hooks': [hook]}]}}))
    return place


def workspace_files(place):
    return sorted(p.relative_to(place).as_posix() for p in place.rglob('*') if p.is_file())


def call_agy(executable, work, schema, prompt):
    place = agy_workspace(work)
    before = workspace_files(place)
    schema_file = work / 'schema.json'
    schema_file.write_text(json.dumps(schema))
    command = [executable, '-p', prompt, '--output-format', 'json', '--json-schema', str(schema_file),
               '--print-timeout', f'{CALL_TIMEOUT - 10}s']
    status, stdout, stderr = run_cli(command, stdin_text='', cwd=place)
    if workspace_files(place) != before:
        raise ModelFailure('invalid', 'changed its workspace, so its answer was discarded')
    checked_exit(status, stdout, stderr)
    return structured_output(stdout)


class Chain:
    """One worker's walk down the order. It remembers who cannot answer, so later documents do not retry them."""

    def __init__(self, root, runtime, run_id, *, codex=None, environ=None, gpu=None, client=None, cli=None, on_step=lambda: None):
        self.root, self.runtime, self.run_id = Path(root), Path(runtime), run_id
        self.environ = os.environ if environ is None else environ
        self.codex, self.gpu, self.client, self.cli, self.on_step = codex, gpu, client, cli, on_step
        self.unusable, self.attempts, self.logs, self.calls = {}, [], [], 0
        self.current = None

    # Reporting -----------------------------------------------------------

    def label(self, name):
        return LABELS[name]

    def sentence(self, name):
        """A label opening a sentence; agy's name stays lowercase."""
        return 'The local model' if name == 'local' else LABELS[name]

    def say(self, text, **fields):
        """A line in the live transcript and the inbox status. It names providers and reasons, never source text."""
        record = {'at': datetime.now(timezone.utc).isoformat(), 'message': text, **fields}
        self.attempts = (self.attempts + [record])[-MAX_ATTEMPTS_KEPT:]
        atomic(self.runtime / STATE, {'schema_version': 1, 'run_id': self.run_id, 'order': self.order, 'current': self.current,
                                      'steps': self.attempts}, limit=1024 ** 2)
        print(json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': text}}), flush=True)
        self.on_step()

    def next_after(self, name):
        rest = self.order[self.order.index(name) + 1:]
        return next((n for n in rest if n not in self.unusable), None)

    # Providers -----------------------------------------------------------

    def call(self, name, schema, prompt, work):
        if name == 'local':
            return self.call_local(schema, prompt)
        executable = find_cli(name, self.environ, self.codex if name == 'codex' else None)
        if not executable:
            raise ModelFailure('missing')
        return {'codex': call_codex, 'claude': call_claude, 'agy': call_agy}[name](executable, work, schema, prompt)

    def local_client(self):
        if self.client:
            return self.client
        from .local_model import provider_client
        return provider_client(self.root)

    def local_model_name(self, client, local):
        """The chosen model, else the first text model the server lists. Embedding models cannot answer."""
        if local['model']:
            return local['model']
        names = [m for m in client.models() if not re.search(r'embed|bge|minilm|e5-', m, re.I)]
        if not names:
            raise ModelFailure('unavailable', 'lists no text model')
        return names[0]

    def loaded(self, client):
        rows = client.native_models()
        return None if rows is None else [m['id'] for m in rows if m.get('state') == 'loaded']

    def start_local(self, client, local):
        """Reach the server, starting it the configured way. Never a shell: the command is the saved argv."""
        try:
            client.models()
            reachable = True
        except (OSError, ValueError):
            reachable = False
        missing = bool(local['model'] and reachable and local['model'] not in (self.loaded(client) or [local['model']]))
        if reachable and not missing:
            return
        how = local['start']
        if how == 'off':
            if reachable:
                return  # LM Studio can load a listed model on request.
            raise ModelFailure('off')
        if how == 'command':
            self.say('Starting the local model with ' + os.path.basename(local['command'][0]) + '…', provider='local', state='starting')
            directories = [str(Path.home() / '.lmstudio/bin'), *(os.path.expanduser(d) for d in DIRECTORIES), self.environ.get('PATH', '')]
            done = subprocess.run([os.path.expanduser(local['command'][0]), *local['command'][1:]], stdin=subprocess.DEVNULL, capture_output=True,
                                  timeout=START_TIMEOUT, env=dict(self.environ, PATH=':'.join(p for p in directories if p)))
            sys.stderr.buffer.write(done.stderr[-8192:])
            sys.stderr.buffer.flush()
            if done.returncode:
                raise ModelFailure('unavailable', f'start command exited with status {done.returncode}')
        else:
            if not getattr(client, 'lmstudio', False):
                raise ModelFailure('off', 'is not running, and Reader only starts LM Studio itself')
            from .local_model import CLI, find_lms
            cli = self.cli or (CLI(find_lms()) if find_lms() else None)
            if not cli:
                raise ModelFailure('missing', 'needs the lms command, which is not installed')
            self.say('Starting the local model…', provider='local', state='starting')
            if not reachable:
                cli.server_start(urlsplit(client.base).port or 1234)
            if local['model']:
                cli.load(local['model'])
        deadline = time.monotonic() + SERVER_WAIT
        while True:
            try:
                client.models()
                return
            except (OSError, ValueError):
                if time.monotonic() > deadline:
                    raise ModelFailure('unavailable', 'did not come up after starting') from None
                time.sleep(1)

    def call_local(self, schema, prompt):
        request = prompt + '\n\nAnswer with one JSON object and nothing else, matching this JSON Schema:\n' + json.dumps(schema)
        if len(request) > LOCAL_PROMPT_CHARS:
            raise ModelFailure('too-large')
        from .local_model import GPULock
        local = read_config(self.root)['local']
        client = self.local_client()
        self.start_local(client, local)
        model = self.local_model_name(client, local)
        self.say(f'Asking the local model ({model})…', provider='local', state='asking', model=model)
        lock = self.gpu or GPULock(self.root)
        with lock('Reader inbox classification'):
            answer = client.chat(model, [{'role': 'user', 'content': request}], timeout=CALL_TIMEOUT,
                                 max_output=LOCAL_OUTPUT_TOKENS, reasoning=LOCAL_REASONING_TOKENS)
        return parse_json_object(answer['text'])

    # The walk ------------------------------------------------------------

    def decide(self, prompt, schema, validate, work, role=None):
        """(validated value, provider). Raises ValueError, naming each provider's reason, when none can answer.

        With role='librarian', any other provider is told it is a stand-in and never handed the librarian's identity."""
        self.order = read_config(self.root)['order']
        self.calls += 1
        log = self.open_log(prompt)
        failures = []
        for name in self.order:
            label = self.label(name)
            if name in self.unusable:
                failures.append(f'{label} {self.unusable[name]}')
                continue
            self.current = name
            standing_in = role == 'librarian' and name != LIBRARIAN
            if standing_in:
                self.say(f'Codex, the librarian, is away. {self.sentence(name)} is standing in.', provider=name, state='stand-in')
            if name != 'local':
                self.say(f'Asking {label}…', provider=name, state='asking')
            started = time.monotonic()
            try:
                value = validate(self.call(name, schema, STAND_IN + prompt if standing_in else prompt, work))
            except ModelFailure as exc:
                reason, text = exc.reason, str(exc)
            except subprocess.TimeoutExpired:
                reason, text = 'timeout', FAILURES['timeout']
            except (ValueError, KeyError, TypeError):
                # A validator's message can quote model output, so only the kind of failure is shown.
                reason, text = 'invalid', FAILURES['invalid']
            except Exception as exc:
                reason, text = 'unavailable', FAILURES['unavailable']
                print(f'Reader model chain: {label}: {type(exc).__name__}', file=sys.stderr, flush=True)
            else:
                self.current = None
                self.say(f'{self.sentence(name)} answered.', provider=name, state='answered', seconds=round(time.monotonic() - started, 1))
                self.close_log(log, 'done', provider=name, output=value, stand_in=standing_in)
                return value, name
            if reason in STICKY:
                self.unusable[name] = text
            failures.append(f'{label} {text}')
            following = self.next_after(name)
            then = f' Trying {self.label(following)} next.' if following else ''
            self.say(f'{self.sentence(name)} {text}.{then}', provider=name, state='failed', reason=reason)
        self.current = None
        self.close_log(log, 'failed')
        if not failures:
            raise ValueError('No model is enabled for intake.')
        raise ValueError('No model could classify this arrival: ' + '; '.join(failures) + '. It stays safely queued; retry when one is available.')

    # The permanent archive -----------------------------------------------

    def open_log(self, prompt):
        from . import llm_logs
        try:
            log = llm_logs.RunLog(self.root, 'inbox', f'{self.run_id}-{self.calls:03d}', {'order': self.order})
            log.write('prompt.txt', prompt)
            return log
        except OSError as exc:
            raise ValueError('The LLM log could not be written, so no model was called: ' + type(exc).__name__) from exc

    def close_log(self, log, status, provider=None, output=None, stand_in=False):
        log.write('steps.json', json.dumps(self.attempts, ensure_ascii=False, indent=2))
        if output is not None:
            log.write('output.json', json.dumps(output, ensure_ascii=False, indent=2))
        self.logs.append(log.finish(status, provider=provider, stand_in=stand_in))

    def commit_logs(self):
        """Commit this run's archives on their own. A failure is reported; it never undoes filed work."""
        from . import llm_logs
        if not self.logs:
            return
        kept, self.logs = self.logs, []
        done = llm_logs.commit(self.root, kept, f'Log inbox model calls ({len(kept)})', [('Reader-Log', llm_logs.trailer(p)) for p in kept])
        if done['status'] not in ('committed', 'unchanged'):
            print('Reader model chain: logs not committed: ' + done.get('error', done['status']), file=sys.stderr, flush=True)
