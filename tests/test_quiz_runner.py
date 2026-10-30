"""Article tasks use the real supervised queue, with synthetic voice CLI output."""
import gzip
import hashlib
from http.client import HTTPConnection
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from chat_vault import calls, default_voices, make_vault
from test_quizzes import TEXT, proposed
from reader_mcp.voice_tasks import strict_json
from reader_mcp.web import WebLibrary, WebServer

PATH = 'library/thought.md'


@pytest.fixture
def library(tmp_path):
    root = make_vault(tmp_path / 'vault')
    (root / PATH).write_text(TEXT)
    raw = proposed()
    raw[-1].update(type='short', rubric='Names purple, the color in the fifth sentence.')
    settings = json.loads((root / 'voices.json').read_text())
    for voice in settings['voices']:
        if voice.get('cli'):
            voice['argv'] += ['--quiz-json', json.dumps({'questions': raw}),
                              '--quiz-review-json', json.dumps({'verdict': 'right', 'comment': 'Your answer names purple, as the fifth sentence states.'})]
    (root / 'voices.json').write_text(json.dumps(settings))
    app = WebLibrary(root, chat_options={'git_locks': False})
    yield app
    app.close()


def settle(app, task, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        job = app.voice_tasks.read(task['id'])
        with app.conversations.runner.lock:
            pending = any(t.get('task_id') == task['id'] for t in app.conversations.runner.turns.values())
        if job['state'] in ('done', 'failed', 'cancelled', 'timeout') and not pending:
            return app.voice_tasks.read(task['id'])
        time.sleep(.025)
    raise AssertionError('Article task did not settle: ' + json.dumps(app.voice_tasks.read(task['id'])))


def generate(app, **extra):
    return app.quizzes.dispatch(dict(action='generate', path=PATH, voice='Claude', request_id=str(uuid4()), **extra), 'Reader')['task']


def test_generation_uses_shared_runner_and_commits_only_quiz_and_logs(library):
    root = library.root
    (root / 'unrelated.md').write_text('Do not stage me.\n')
    job = settle(library, generate(library))
    assert job['state'] == 'done', job
    assert job['attempts'] == 1 and job['commit']['status'] == 'committed'
    quiz = library.quizzes.get(PATH)
    assert len(quiz['questions']) == 5 and quiz['runtime']['model'] == 'fake-model-1'
    paths = subprocess.check_output(['git', 'show', '--format=', '--name-only', job['commit']['commit']], cwd=root, text=True).splitlines()
    assert paths and all(p.startswith(('quizzes/', 'logs/llm/quiz/')) for p in paths if p)
    message = subprocess.check_output(['git', 'log', '-1', '--format=%B'], cwd=root, text=True)
    assert 'Reader-Quiz: ' + job['id'] in message and 'Reader-Voice: Claude' in message
    assert not list((root / 'chats').glob('*.json'))
    assert library.quizzes.dispatch(dict(action='generate', path=PATH), 'Reader')['quiz']['id'] == quiz['id']


def test_difficulty_steers_the_prompt_and_is_saved_with_the_quiz(library):
    job = settle(library, generate(library, difficulty=4))
    assert job['state'] == 'done', job
    quiz = library.quizzes.get(PATH)
    assert quiz['difficulty'] == 4
    prompts = [gzip.decompress(p.read_bytes()).decode() for p in (library.root / 'logs/llm/quiz').rglob('prompt.txt.gz')]
    assert prompts and all('Difficulty 4 of 5. Analyze:' in prompt for prompt in prompts)


@pytest.mark.parametrize('value', [0, 6, '3', 2.5, True, None])
def test_difficulty_must_be_an_integer_from_one_to_five(library, value):
    with pytest.raises(ValueError, match='difficulty must be an integer from 1 to 5'):
        generate(library, difficulty=value)


def test_quiz_without_difficulty_keeps_the_earlier_shape(library):
    assert settle(library, generate(library))['state'] == 'done'
    assert 'difficulty' not in library.quizzes.get(PATH)


def test_plain_text_voice_preserves_compact_json_generation_and_review(library):
    file = library.root / 'voices.json'
    settings = json.loads(file.read_text())
    voice = next(v for v in settings['voices'] if v['name'] == 'Claude')
    voice['stream'] = 'text'
    voice['argv'][voice['argv'].index('--style') + 1] = 'text'
    file.write_text(json.dumps(settings))
    job = settle(library, generate(library))
    assert job['state'] == 'done', 'compact JSON from a text voice must remain its response'
    quiz = library.quizzes.get(PATH)
    task = library.quizzes.dispatch(dict(action='review', path=PATH, voice='Claude', request_id=str(uuid4()),
        edition=quiz['document_sha256'], quiz_id=quiz['id'], question_id='q5', answer='Purple.'), 'Reader')['task']
    assert settle(library, task)['result']['verdict'] == 'right'


def test_invalid_first_generation_retries_once_and_preserves_both_logs(library):
    file = library.root / 'voices.json'
    settings = json.loads(file.read_text())
    for voice in settings['voices']:
        if voice['name'] == 'Claude':
            voice['argv'] += ['--quiz-first', json.dumps({'questions': proposed()[:2]})]
    file.write_text(json.dumps(settings))
    job = settle(library, generate(library))
    assert job['state'] == 'done' and job['attempts'] == 2, job
    assert len(job['rejected']) == 1 and len(job['runs']) == 2
    assert all((library.root / run['log'] / 'meta.json').is_file() for run in job['runs'])
    assert library.quizzes.get(PATH)['attempts'] == 2


def test_unreliable_output_stops_after_two_attempts(library):
    file = library.root / 'voices.json'
    settings = json.loads(file.read_text())
    for voice in settings['voices']:
        if voice['name'] == 'Claude':
            at = voice['argv'].index('--quiz-json')
            voice['argv'][at + 1] = json.dumps({'questions': proposed()[:2]})
    file.write_text(json.dumps(settings))
    job = settle(library, generate(library))
    assert job['state'] == 'failed' and job['attempts'] == 2, job
    assert len(job['rejected']) == 2 and len(job['runs']) == 2
    assert library.quizzes.get(PATH) is None
    assert job['commit']['status'] == 'committed'  # Failed raw output is retained too.


def test_short_answer_review_is_participant_and_edition_bound(library):
    settle(library, generate(library))
    quiz = library.quizzes.get(PATH)
    request = dict(action='review', path=PATH, edition=quiz['document_sha256'], quiz_id=quiz['id'],
                   question_id='q5', answer='Purple.', voice='Claude', request_id=str(uuid4()))
    job = settle(library, library.quizzes.dispatch(request, 'Reader')['task'])
    assert job['state'] == 'done', job
    assert job['result']['verdict'] == 'right'
    args = dict(path=PATH, edition=quiz['document_sha256'], quiz_id=quiz['id'],
                expected_sha256=quiz['current_sha256'], answers={'q1': 0, 'q2': 0, 'q3': 0, 'q4': 0}, reviews={'q5': job['id']})
    assert library.quizzes.result(**args, participant='Reader')['score'] == 5
    with pytest.raises(ValueError, match='Unknown'):
        library.quizzes.result(**args, participant='Another reader')
    assert library.readers(PATH, 'Reader')['quiz_results'][0]['score'] == 5
    assert library.engagement.attention('Reader', PATH)['items'][0]['read'] is False


def test_review_poll_returns_the_reviewed_quiz_after_another_generation(library):
    settle(library, generate(library))
    original = library.quizzes.get(PATH)
    newer = library.quizzes.save(PATH, 'Claude', original['questions'], expected_sha256=original['document_sha256'])
    assert newer['id'] != original['id']
    with library.conversations.runner.lock:
        task = library.quizzes.dispatch(dict(action='review', path=PATH, voice='Claude', request_id=str(uuid4()),
            edition=original['document_sha256'], quiz_id=original['id'], question_id='q5', answer='Purple.'), 'Reader')['task']
        assert library.quiz(PATH, 'Reader', task['id'])['quiz']['id'] == original['id']


def test_task_request_is_idempotent_and_rejects_changed_input(library):
    request_id = str(uuid4())
    tasks = library.voice_tasks
    first = tasks.submit('quiz', PATH, 'Claude', 'Reader', request_id=request_id)
    assert tasks.submit('quiz', PATH, 'Claude', 'Reader', request_id=request_id)['id'] == first['id']
    with pytest.raises(ValueError, match='different input'):
        tasks.submit('quiz', PATH, 'Agy', 'Reader', request_id=request_id)
    assert settle(library, first)['state'] == 'done'
    assert len(calls(library.root)) == 1


def test_public_task_errors_hide_host_paths_without_rewriting_job(library):
    task = generate(library)
    settle(library, task)
    with library.voice_tasks.locked():
        job = library.voice_tasks.read(task['id'])
        job['error'] = 'Synthetic failure in ' + str(library.root / 'library/thought.md')
        job['commit'] = {'status': 'failed', 'error': 'Synthetic git error at ' + str(library.root / '.git/index.lock')}
        library.voice_tasks.write(job)
    file = library.voice_tasks.file(task['id'])
    before = file.read_bytes()
    public = library.voice_tasks.public(job)
    assert str(library.root) not in json.dumps(public)
    assert '<vault>/.git/index.lock' in public['commit']['error']
    assert file.read_bytes() == before and str(library.root).encode() in before


def test_two_tabs_share_the_same_pending_generation(library):
    tasks = library.voice_tasks
    with tasks.runner.lock:
        first = tasks.submit('quiz', PATH, 'Claude', 'Reader', request_id=str(uuid4()))
        second = tasks.submit('quiz', PATH, 'Claude', 'Reader', request_id=str(uuid4()))
    assert first['id'] == second['id']
    assert settle(library, first)['state'] == 'done'
    assert len(calls(library.root)) == 1


def test_replaying_a_completed_request_does_not_require_the_cli_to_remain_enabled(library):
    tasks = library.voice_tasks
    request_id = str(uuid4())
    first = tasks.submit('quiz', PATH, 'Claude', 'Reader', request_id=request_id)
    assert settle(library, first)['state'] == 'done'
    file = library.root / 'voices.json'
    settings = json.loads(file.read_text())
    next(v for v in settings['voices'] if v['name'] == 'Claude')['enabled'] = False
    file.write_text(json.dumps(settings))
    assert tasks.submit('quiz', PATH, 'Claude', 'Reader', request_id=request_id)['state'] == 'done'


def test_queued_task_refuses_a_changed_source_before_starting_the_cli(library):
    runner = library.conversations.runner
    with runner.lock:
        task = generate(library)
        (library.root / PATH).write_text(TEXT + 'Changed while queued.\n')
    job = settle(library, task)
    assert job['state'] == 'failed' and 'Source changed' in job['error']
    assert not calls(library.root) and not library.quizzes.inventory()


def test_queued_task_can_be_cancelled_without_a_provider_call(library):
    runner = library.conversations.runner
    with runner.lock:
        task = generate(library)
        turn = runner.pending(task['id'])[0]
        runner.cancel(turn['id'])
    job = settle(library, task)
    assert job['state'] == 'cancelled' and not calls(library.root)


@pytest.mark.parametrize('prior_attempt', [False, True])
def test_queued_cancellation_does_not_block_the_active_writer(library, monkeypatch, prior_attempt):
    """Force quiet -> runner.lock against cancellation, with bounded actor waits."""
    from reader_mcp import llm_logs
    runner = library.conversations.runner
    active, publish, finished, cancelling = (threading.Event() for _ in range(4))
    progressed, errors = [], []

    def active_chat(turn):
        try:
            with runner.quiet:
                active.set()
                if not publish.wait(5):
                    return
                acquired = runner.lock.acquire(timeout=1)
                progressed.append(acquired)
                if acquired:
                    runner.lock.release()
            runner.complete(turn, 'done', body='The synthetic active writer finished.')
        finally:
            finished.set()

    monkeypatch.setattr(runner, 'run', active_chat)
    chat = library.conversations.create(PATH, 'Reader')['chat']
    library.conversations.send(chat['id'], 'A synthetic active chat.', 'Reader')
    assert active.wait(5)
    task = generate(library)
    turn = runner.pending(task['id'])[0]
    if prior_attempt:
        log = llm_logs.RunLog(library.root, 'quiz', str(uuid4()), {'document_path': PATH})
        log.write('stdout.jsonl', '{}\n')
        log.finish('failed', error='Synthetic insufficient first attempt')
        with library.voice_tasks.locked():
            job = library.voice_tasks.read(task['id'])
            job.update(attempts=1, runs=[{'turn_id': log.meta['run_id'], 'log': log.relative}])
            library.voice_tasks.write(job)
    finish_unrun = runner.finish_unrun

    def observed(turn, message):
        cancelling.set()
        return finish_unrun(turn, message)

    monkeypatch.setattr(runner, 'finish_unrun', observed)
    def cancel():
        try:
            runner.cancel(turn['id'])
        except Exception as exc:
            errors.append(exc)
    thread = threading.Thread(target=cancel, daemon=True)
    try:
        thread.start()
        assert cancelling.wait(5)
        publish.set()
        assert finished.wait(5)
        thread.join(5)
        assert not thread.is_alive() and not errors
        assert progressed == [True], 'cancellation must leave runner.lock available to the active writer'
        job = library.voice_tasks.read(task['id'])
        assert job['state'] == 'cancelled'
        assert job['commit']['status'] == ('committed' if prior_attempt else 'unchanged')
    finally:
        publish.set()
        thread.join(5)


def test_recovery_preserves_interrupted_task_logs_without_rerunning(library):
    from reader_mcp import llm_logs
    root = library.root
    library.close()
    job_id, turn_id = str(uuid4()), str(uuid4())
    log = llm_logs.RunLog(root, 'quiz', turn_id, {'document_path': PATH})
    log.write('prompt.txt', 'An interrupted synthetic quiz task.')
    with library.voice_tasks.locked():
        library.voice_tasks.write(dict(schema_version=1, id=job_id, kind='quiz', path=PATH,
            source_sha256=hashlib.sha256(TEXT.encode()).hexdigest(), voice='Claude', participant='Reader',
            payload={}, fingerprint='synthetic', state='running', attempts=1, rejected=[],
            runs=[{'turn_id': turn_id, 'log': log.relative}], created_at='2026-01-01T00:00:00+00:00'))
    runtime = root / '.reader/voice-runner'
    runtime.mkdir(exist_ok=True)
    (runtime / 'state.json').write_text(json.dumps({'turns': {turn_id: dict(id=turn_id, kind='quiz', task_id=job_id,
        chat_id=job_id, voice='Claude', state='running', log=log.relative)}}))
    recovered = WebLibrary(root, chat_options={'git_locks': False})
    try:
        job = recovered.voice_tasks.read(job_id)
        assert job['state'] == 'failed' and job['commit']['status'] == 'committed'
        assert json.loads((root / log.relative / 'meta.json').read_text())['status'] == 'interrupted'
        assert not calls(root)
    finally:
        recovered.close()


@pytest.mark.parametrize('kind', ['quiz', 'quiz-review'])
def test_recovery_uses_task_identity_from_real_saved_runner_state(library, kind):
    if kind == 'quiz-review':
        settle(library, generate(library))
        quiz = library.quizzes.get(PATH)
    runner = library.conversations.runner
    with runner.lock:
        if kind == 'quiz':
            task = generate(library)
        else:
            task = library.quizzes.dispatch(dict(action='review', path=PATH, voice='Claude',
                edition=quiz['document_sha256'], quiz_id=quiz['id'], question_id='q5',
                answer='Purple.', request_id=str(uuid4())), 'Reader')['task']
        runner.save(True)
        saved = json.loads((library.root / '.reader/voice-runner/state.json').read_text())
        library.close()  # Prevent the queued synthetic CLI from starting before restart.
    turn = next(t for t in saved['turns'].values() if t['kind'] == kind)
    assert turn.get('task_id') == task['id'], 'saved task turns must retain their task identity'
    recovered = WebLibrary(library.root, chat_options={'git_locks': False})
    try:
        job = recovered.voice_tasks.read(task['id'])
        assert job['state'] == 'failed' and 'retry explicitly' in job['error']
        assert not recovered.conversations.runner.pending(task['id'])
    finally:
        recovered.close()


@pytest.mark.parametrize('text', ['{"questions":[],"questions":[]}', '{"answer":NaN}', '```json\n{}\n```', '[]'])
def test_structured_output_is_strict_json(text):
    with pytest.raises(ValueError):
        strict_json(text)


def test_http_generation_and_result_require_token_and_report_reading_log(library):
    server = WebServer(('127.0.0.1', 0), library, participant='Reader')
    threading.Thread(target=server.serve_forever, daemon=True).start()
    connection = HTTPConnection(*server.server_address, timeout=20)
    try:
        connection.request('POST', '/api/quiz', json.dumps(dict(action='generate', path=PATH)), {'Content-Type': 'application/json'})
        response = connection.getresponse()
        assert response.status == 403
        response.read()
        connection.request('POST', '/api/quiz', json.dumps(dict(action='generate', path=PATH, voice='Claude', request_id=str(uuid4()))),
                           {'Content-Type': 'application/json', 'X-Reader-Token': server.token})
        response = connection.getresponse()
        assert response.status == 200
        task = json.loads(response.read())['task']
        assert settle(library, task)['state'] == 'done'
        connection.request('GET', '/api/quiz?path=' + PATH)
        response = connection.getresponse()
        data = json.loads(response.read())
        assert data['quiz']['id'] == task['id']
        assert any(v['name'] == 'Claude' and v['runnable'] for v in data['voices'])
    finally:
        connection.close()
        server.shutdown()
        server.server_close()
