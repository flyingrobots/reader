"""The prescribed model order, with fake CLIs and fake local servers: no real provider is ever called."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from reader_mcp import model_chain
from reader_mcp.model_chain import Chain, ModelFailure, checked_config, read_config, write_config

SCHEMA = {'type': 'object', 'properties': {'title': {'type': 'string'}}, 'required': ['title'], 'additionalProperties': False}
ANSWER = {'title': 'A title'}


def cli(path, body):
    path.write_text('#!' + sys.executable + '\nimport json, os, pathlib, sys\nargs = sys.argv\n' + body)
    path.chmod(0o755)
    return str(path)


def codex_ok(path):
    return cli(path, 'sys.stdin.read()\npathlib.Path(args[args.index("--output-last-message") + 1]).write_text(' + repr(json.dumps(ANSWER)) + ')\n')


def out_of_usage(path):
    return cli(path, 'sys.stdin.read()\nprint("You hit your usage limit", file=sys.stderr)\nsys.exit(1)\n')


def json_result(path, extra=''):
    result = json.dumps({'status': 'SUCCESS', 'structured_output': ANSWER})
    return cli(path, extra + '\nsys.stdin.read()\nprint(' + repr(result) + ')\n')


class FakeClient:
    lmstudio = True
    base = 'http://127.0.0.1:1234/v1'

    def __init__(self, text=json.dumps(ANSWER), up=True, loaded=()):
        self.text, self.up, self.loaded_models, self.asked = text, up, list(loaded), []

    def models(self, timeout=1.5):
        if not self.up:
            raise ConnectionError('down')
        return ['text-embedding-nomic', 'small-model']

    def native_models(self, timeout=1.5):
        return [{'id': m, 'state': 'loaded'} for m in self.loaded_models]

    def chat(self, model, messages, **options):
        self.asked.append((model, messages, options))
        return {'text': self.text}


class FakeCLI:
    def __init__(self, client):
        self.client, self.calls = client, []

    def server_start(self, port):
        self.calls.append(('start', port))
        self.client.up = True

    def load(self, key):
        self.calls.append(('load', key))


def nullgpu(note):
    from contextlib import nullcontext
    return nullcontext({})


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.delenv('READER_MODEL_CHAIN', raising=False)
    root = tmp_path / 'vault'
    runtime = root / '.reader/inbox-runner'
    runtime.mkdir(parents=True)
    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    environ = {'PATH': str(bin_dir), 'HOME': str(tmp_path)}
    monkeypatch.setattr(model_chain, 'DIRECTORIES', ())

    def make(**options):
        return Chain(root, runtime, 'run-1', environ=environ, gpu=nullgpu, **options)
    return root, runtime, bin_dir, make


def decide(chain, runtime):
    work = runtime / 'editorial'
    work.mkdir(exist_ok=True)
    return chain.decide('Classify.', SCHEMA, lambda value: value, work)


def states(runtime):
    return [(s.get('provider'), s.get('state')) for s in json.loads((runtime / model_chain.STATE).read_text())['steps']]


def test_codex_answers_first_and_nothing_else_runs(setup):
    root, runtime, bin_dir, make = setup
    codex_ok(bin_dir / 'codex')
    cli(bin_dir / 'claude', 'pathlib.Path(' + repr(str(bin_dir / 'claude-ran')) + ').write_text("")\n')
    assert decide(make(), runtime) == (ANSWER, 'codex')
    assert not (bin_dir / 'claude-ran').exists()
    assert states(runtime) == [('codex', 'asking'), ('codex', 'answered')]


def test_exhausted_codex_falls_to_claude_and_says_why_in_order(setup, capsys):
    root, runtime, bin_dir, make = setup
    out_of_usage(bin_dir / 'codex')
    json_result(bin_dir / 'claude')
    assert decide(make(), runtime) == (ANSWER, 'claude')
    steps = json.loads((runtime / model_chain.STATE).read_text())['steps']
    assert steps[1]['reason'] == 'quota'
    assert steps[1]['message'] == 'Codex is out of usage. Trying Claude Code next.'
    transcript = [json.loads(line)['item']['text'] for line in capsys.readouterr().out.splitlines()]
    assert transcript == ['Asking Codex…', 'Codex is out of usage. Trying Claude Code next.', 'Asking Claude Code…', 'Claude Code answered.']


def test_claude_runs_with_no_tools_or_operator_configuration(setup):
    root, runtime, bin_dir, make = setup
    write_config(root, {'order': ['claude']})
    json_result(bin_dir / 'claude', 'pathlib.Path(' + repr(str(bin_dir / 'args.json')) + ').write_text(json.dumps(args))')
    decide(make(), runtime)
    args = json.loads((bin_dir / 'args.json').read_text())
    assert args[args.index('--tools') + 1] == '' and args[args.index('--setting-sources') + 1] == ''
    assert '--strict-mcp-config' in args and '--no-session-persistence' in args
    assert not {'--dangerously-skip-permissions', '--allowedTools', '--add-dir'} & set(args)


def test_agy_runs_in_an_empty_workspace_that_denies_every_tool(setup):
    root, runtime, bin_dir, make = setup
    write_config(root, {'order': ['agy']})
    json_result(bin_dir / 'agy', 'pathlib.Path(' + repr(str(bin_dir / 'seen.json')) + ').write_text(json.dumps({"args": args, "cwd": os.getcwd(), "files": sorted(p.name for p in pathlib.Path(".").rglob("*") if p.is_file())}))')
    assert decide(make(), runtime) == (ANSWER, 'agy')
    seen = json.loads((bin_dir / 'seen.json').read_text())
    assert seen['files'] == ['hook.py', 'hooks.json']
    assert '--dangerously-skip-permissions' not in seen['args']
    place = Path(seen['cwd'])
    hooks = json.loads((place / '.agents/hooks.json').read_text())
    hook = hooks['reader-deny-tools']['PreToolUse'][0]
    assert hook['matcher'] == '*'
    for tool, decision in (('run_command', 'deny'), ('read_file', 'deny'), ('search_web', 'deny'), ('finish', 'allow')):
        done = subprocess.run([sys.executable, '-I', 'hook.py'], cwd=place / '.agents', input=json.dumps({'toolCall': {'name': tool}}),
                              capture_output=True, text=True, check=True)
        assert json.loads(done.stdout)['decision'] == decision


def test_agy_answer_is_discarded_if_it_changed_its_workspace(setup):
    root, runtime, bin_dir, make = setup
    write_config(root, {'order': ['agy']})
    json_result(bin_dir / 'agy', 'pathlib.Path("wrote.txt").write_text("hi")')
    with pytest.raises(ValueError, match='agy changed its workspace'):
        decide(make(), runtime)


def test_an_agy_run_with_no_structured_answer_falls_through(setup):
    root, runtime, bin_dir, make = setup
    write_config(root, {'order': ['agy', 'local']})
    cli(bin_dir / 'agy', 'sys.stdin.read()\nprint(json.dumps({"status": "SUCCESS", "structured_output": None}))\n')
    assert decide(make(client=FakeClient()), runtime) == (ANSWER, 'local')


def test_local_is_the_last_resort_and_skips_embedding_models(setup):
    root, runtime, bin_dir, make = setup
    client = FakeClient()
    assert decide(make(client=client), runtime) == (ANSWER, 'local')
    assert client.asked[0][0] == 'small-model'
    assert 'JSON Schema' in client.asked[0][1][0]['content']
    assert ('codex', 'failed') in states(runtime) and ('local', 'answered') in states(runtime)


def test_local_answer_tolerates_a_code_fence(setup):
    root, runtime, bin_dir, make = setup
    assert decide(make(client=FakeClient('```json\n' + json.dumps(ANSWER) + '\n```')), runtime)[0] == ANSWER


def test_reader_starts_lm_studio_when_it_is_down_and_loads_the_chosen_model(setup):
    root, runtime, bin_dir, make = setup
    write_config(root, {'order': ['local'], 'local': {'model': 'big-model'}})
    client = FakeClient(up=False)
    fake = FakeCLI(client)
    assert decide(make(client=client, cli=fake), runtime) == (ANSWER, 'local')
    assert fake.calls == [('start', 1234), ('load', 'big-model')]
    assert client.asked[0][0] == 'big-model'
    assert ('local', 'starting') in states(runtime)


def test_starting_off_refuses_and_says_so(setup):
    root, runtime, bin_dir, make = setup
    write_config(root, {'order': ['local'], 'local': {'start': 'off'}})
    client = FakeClient(up=False)
    with pytest.raises(ValueError, match='not running and starting it is turned off'):
        decide(make(client=client, cli=FakeCLI(client)), runtime)
    assert client.asked == []


def test_a_custom_start_command_runs_as_argv_without_a_shell(setup, tmp_path):
    root, runtime, bin_dir, make = setup
    marker = tmp_path / 'started'
    script = cli(tmp_path / 'start-model', 'pathlib.Path(' + repr(str(marker)) + ').write_text(json.dumps(args[1:]))\n')
    write_config(root, {'order': ['local'], 'local': {'start': 'command', 'command': [script, 'qwen; touch ' + str(tmp_path / 'injected')], 'model': 'big-model'}})
    client = FakeClient(up=False)
    original = subprocess.run

    def bring_up(*args, **kwargs):
        done = original(*args, **kwargs)
        client.up = True
        return done
    model_chain.subprocess.run = bring_up
    try:
        assert decide(make(client=client), runtime) == (ANSWER, 'local')
    finally:
        model_chain.subprocess.run = original
    assert json.loads(marker.read_text()) == ['qwen; touch ' + str(tmp_path / 'injected')]
    assert not (tmp_path / 'injected').exists()


def test_a_failing_start_command_falls_out_with_its_status(setup, tmp_path):
    root, runtime, bin_dir, make = setup
    script = cli(tmp_path / 'broken', 'sys.exit(3)\n')
    write_config(root, {'order': ['local'], 'local': {'start': 'command', 'command': [script]}})
    with pytest.raises(ValueError, match='start command exited with status 3'):
        decide(make(client=FakeClient(up=False)), runtime)


def test_an_oversized_prompt_never_reaches_the_local_model(setup):
    root, runtime, bin_dir, make = setup
    write_config(root, {'order': ['local']})
    client = FakeClient()
    chain = make(client=client)
    (runtime / 'editorial').mkdir()
    with pytest.raises(ValueError, match='cannot fit this document'):
        chain.decide('x' * (model_chain.LOCAL_PROMPT_CHARS + 1), SCHEMA, lambda value: value, runtime / 'editorial')
    assert client.asked == []


def test_an_invalid_answer_falls_through_and_never_quotes_the_model(setup):
    root, runtime, bin_dir, make = setup
    json_result(bin_dir / 'claude')

    def reject_claude(value, seen=[]):
        seen.append(value)
        if len(seen) == 1:
            raise ValueError('source text SECRET-EXCERPT')
        return value
    write_config(root, {'order': ['claude', 'local']})
    work = runtime / 'editorial'
    work.mkdir()
    assert make(client=FakeClient()).decide('Classify.', SCHEMA, reject_claude, work) == (ANSWER, 'local')
    assert 'SECRET-EXCERPT' not in (runtime / model_chain.STATE).read_text()


def test_a_provider_out_of_usage_is_not_retried_this_run_but_a_timeout_is(setup):
    root, runtime, bin_dir, make = setup
    counter = bin_dir / 'count'
    cli(bin_dir / 'codex', 'c = pathlib.Path(' + repr(str(counter)) + ')\nc.write_text(c.read_text() + "x" if c.exists() else "x")\nsys.stdin.read()\nprint("quota exceeded", file=sys.stderr)\nsys.exit(1)\n')
    json_result(bin_dir / 'claude')
    chain = make()
    decide(chain, runtime)
    decide(chain, runtime)
    assert counter.read_text() == 'x'


def test_every_provider_failing_keeps_the_work_and_names_each_reason(setup):
    root, runtime, bin_dir, make = setup
    out_of_usage(bin_dir / 'codex')
    write_config(root, {'order': ['codex', 'claude', 'local'], 'local': {'start': 'off'}})
    with pytest.raises(ValueError) as caught:
        decide(make(client=FakeClient(up=False)), runtime)
    text = str(caught.value)
    assert 'Codex is out of usage' in text and 'Claude Code is not installed' in text and 'not running' in text
    assert 'stays safely in the inbox' in text


def test_each_step_renews_the_supervisors_progress_deadline(setup):
    root, runtime, bin_dir, make = setup
    out_of_usage(bin_dir / 'codex')
    json_result(bin_dir / 'claude')
    ticks = []
    decide(make(on_step=lambda: ticks.append(1)), runtime)
    assert len(ticks) >= 4


def test_every_call_is_archived_with_its_prompt_and_provider(setup):
    root, runtime, bin_dir, make = setup
    codex_ok(bin_dir / 'codex')
    chain = make()
    decide(chain, runtime)
    meta = next((root / 'logs/llm/inbox').rglob('meta.json'))
    data = json.loads(meta.read_text())
    assert data['status'] == 'done' and data['provider'] == 'codex' and data['order'] == list(model_chain.ORDER)


@pytest.mark.parametrize('value', [
    {'order': ['gemini']}, {'order': ['codex', 'codex']}, {'order': []}, {'other': 1},
    {'local': {'start': 'shell'}}, {'local': {'start': 'command'}},
    {'local': {'command': ['relative/path']}}, {'local': {'command': 'start-model'}}, {'local': {'command': ['/a', 'b\0c']}}])
def test_settings_refuse_what_they_cannot_honor(value):
    with pytest.raises(ValueError):
        checked_config(value)


def test_settings_default_to_the_prescribed_order_and_a_damaged_file_is_an_error(tmp_path, monkeypatch):
    monkeypatch.delenv('READER_MODEL_CHAIN', raising=False)
    (tmp_path / '.reader').mkdir()
    assert read_config(tmp_path)['order'] == ['codex', 'claude', 'agy', 'local']
    assert read_config(tmp_path)['local']['start'] == 'lmstudio'
    (tmp_path / model_chain.CONFIG).write_text('{"order": ["nope"]}')
    with pytest.raises(ValueError):
        read_config(tmp_path)


def test_only_this_macs_browser_sees_or_sets_the_start_command(tmp_path, monkeypatch):
    monkeypatch.delenv('READER_MODEL_CHAIN', raising=False)
    (tmp_path / '.reader').mkdir()
    local, tailnet = {'via': 'local'}, {'via': 'tailscale', 'login': 'a@example.com'}
    saved = {'start': 'command', 'command': ['/usr/local/bin/start-model', 'qwen'], 'model': ''}
    assert model_chain.configure(tmp_path, {'local': saved}, local)['config']['local']['command'] == saved['command']
    seen = model_chain.settings_view(tmp_path, tailnet)
    assert 'command' not in seen['config']['local'] and seen['can_edit_command'] is False
    with pytest.raises(ValueError, match='browser on this Mac'):
        model_chain.configure(tmp_path, {'local': {'start': 'command', 'command': ['/bin/sh', '-c', 'anything']}}, tailnet)
    assert read_config(tmp_path)['local']['command'] == saved['command']
    model_chain.configure(tmp_path, {'order': ['claude', 'local'], 'local': {'start': 'off'}}, tailnet)
    kept = read_config(tmp_path)
    assert kept['order'] == ['claude', 'local'] and kept['local']['start'] == 'off' and kept['local']['command'] == saved['command']


def test_a_fallback_is_told_it_stands_in_and_codex_is_not(setup):
    root, runtime, bin_dir, make = setup
    seen = bin_dir / 'prompt.txt'
    cli(bin_dir / 'codex', 'pathlib.Path(' + repr(str(bin_dir / 'codex-prompt.txt')) + ').write_text(sys.stdin.read())\nprint("usage limit", file=sys.stderr)\nsys.exit(1)\n')
    cli(bin_dir / 'claude', 'pathlib.Path(' + repr(str(seen)) + ').write_text(sys.stdin.read())\nprint(' + repr(json.dumps({'structured_output': ANSWER})) + ')\n')
    work = runtime / 'editorial'
    work.mkdir()
    assert make().decide('Classify.', SCHEMA, lambda value: value, work, role='librarian') == (ANSWER, 'claude')
    assert (bin_dir / 'codex-prompt.txt').read_text() == 'Classify.'
    prompt = seen.read_text()
    assert prompt.startswith('Codex, the Reader librarian, is out of office') and 'You are not the librarian' in prompt and prompt.endswith('Classify.')
    assert ('claude', 'stand-in') in states(runtime)
    steps = json.loads((runtime / model_chain.STATE).read_text())['steps']
    assert 'Codex, the librarian, is away. Claude Code is standing in.' in [s['message'] for s in steps]
    assert json.loads(next((root / 'logs/llm/inbox').rglob('meta.json')).read_text())['stand_in'] is True


def test_no_role_means_no_stand_in_note(setup):
    root, runtime, bin_dir, make = setup
    seen = bin_dir / 'prompt.txt'
    cli(bin_dir / 'claude', 'pathlib.Path(' + repr(str(seen)) + ').write_text(sys.stdin.read())\nprint(' + repr(json.dumps({'structured_output': ANSWER})) + ')\n')
    write_config(root, {'order': ['claude']})
    decide(make(), runtime)
    assert seen.read_text() == 'Classify.'


def test_the_settings_page_shows_what_is_saved_not_a_process_override(tmp_path, monkeypatch):
    (tmp_path / '.reader').mkdir()
    monkeypatch.setenv('READER_MODEL_CHAIN', 'codex')
    assert model_chain.settings_view(tmp_path)['config']['order'] == list(model_chain.ORDER)
    assert read_config(tmp_path)['order'] == ['codex']


def test_only_limits_a_decision_to_the_named_providers(setup):
    root, runtime, bin_dir, make = setup
    json_result(bin_dir / 'claude', 'pathlib.Path(' + repr(str(bin_dir / 'claude-ran')) + ').write_text("")')
    work = runtime / 'editorial'
    work.mkdir()
    assert make(client=FakeClient()).decide('Classify.', SCHEMA, lambda value: value, work, only=('local',)) == (ANSWER, 'local')
    assert not (bin_dir / 'claude-ran').exists()
    write_config(root, {'order': ['claude']})
    with pytest.raises(ValueError, match='No permitted model'):
        make().decide('Classify.', SCHEMA, lambda value: value, work, only=('local',))


def test_a_local_null_for_a_string_field_becomes_empty_but_other_shapes_stay_wrong(setup):
    root, runtime, bin_dir, make = setup
    write_config(root, {'order': ['local']})
    schema = {'type': 'object', 'properties': {'title': {'type': 'string'}, 'reason': {'type': 'string'}}, 'required': ['title', 'reason']}
    work = runtime / 'editorial'
    work.mkdir()
    client = FakeClient(json.dumps({'title': 'T', 'reason': None}))
    assert make(client=client).decide('Classify.', schema, lambda value: value, work)[0] == {'title': 'T', 'reason': ''}
    assert 'never null' in client.asked[0][1][0]['content']
    assert make(client=FakeClient(json.dumps({'title': 7, 'reason': None}))).decide('Classify.', schema, lambda value: value, work)[0]['title'] == 7
