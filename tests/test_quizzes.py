"""Synthetic source and receipt contracts for article quizzes; no provider calls."""
import copy
import hashlib
import json
from uuid import uuid4

import pytest

from reader_mcp.engagement import Engagement
from reader_mcp.learning import evidence
from reader_mcp.quizzes import Quizzes, UnreliableQuiz, questions

PATH = 'library/example.md'
TEXT = '🧭\nThe first color is red.\nThe second color is blue.\nThe third color is green.\nThe fourth color is gold.\nThe fifth color is purple.\n'
QUOTES = ['The first color is red.', 'The second color is blue.', 'The third color is green.',
          'The fourth color is gold.', 'The fifth color is purple.']


def proposed():
    return [dict(type='choice', prompt='Which color is named in sentence ' + str(i + 1) + '?',
                 options=[color, 'orange', 'white', 'black'], answer=0,
                 explanation='The sentence names ' + color + '.',
                 evidence=dict(quote=quote, start=999999, end=-10), unknown='discard me')
            for i, (quote, color) in enumerate(zip(QUOTES, ['red', 'blue', 'green', 'gold', 'purple']))]


@pytest.fixture
def store(tmp_path):
    (tmp_path / 'library').mkdir()
    (tmp_path / PATH).write_text(TEXT)

    def documents(path, inline=False):
        assert path == PATH
        text = (tmp_path / path).read_text()
        return dict(path=path, text=text if inline else None, title='Colors', sha256=hashlib.sha256(text.encode()).hexdigest())

    return Quizzes(tmp_path, documents, Engagement(tmp_path))


def save(store, raw=None, request_id=None):
    digest = hashlib.sha256((store.root / PATH).read_bytes()).hexdigest()
    return store.save(PATH, 'A test voice', raw or proposed(), expected_sha256=digest, request_id=request_id)


def test_untrusted_offsets_recomputed_as_unicode_code_points():
    anchor = evidence(TEXT, {'quote': QUOTES[0], 'start': 700, 'end': 800})
    assert anchor['start'] == 2
    assert TEXT[anchor['start']:anchor['end']] == QUOTES[0]
    assert anchor['source_sha256'] == hashlib.sha256(TEXT.encode()).hexdigest()


def test_ambiguous_quote_rejected_even_with_plausible_model_offset():
    with pytest.raises(ValueError, match='ambiguous'):
        evidence('Same. Same.', dict(quote='Same.', start=0, end=5))
    assert evidence('Same. Same.', dict(quote='Same.', prefix='Same. '))['start'] == 6


def test_invented_quote_rejected_and_unknown_fields_discarded():
    raw = proposed()
    raw[0]['evidence']['quote'] = 'The first color is pink.'
    accepted, rejected = questions(TEXT, raw)
    assert len(accepted) == 4 and rejected == [{'question': 1, 'reason': 'Evidence quote is orphaned'}]
    assert 'unknown' not in accepted[0]
    assert accepted[0]['evidence']['start'] == TEXT.index(QUOTES[1])


def test_too_few_supported_questions_has_actionable_rejections():
    raw = proposed()
    for question in raw[:2]:
        question['evidence']['quote'] = 'Invented sentence.'
    with pytest.raises(UnreliableQuiz) as failure:
        questions(TEXT, raw)
    assert len(failure.value.rejected) == 2


@pytest.mark.parametrize('field,value', [('answer', True), ('answer', 4), ('options', ['a', 'a', 'b', 'c']),
                                        ('prompt', 'x' * 301), ('type', 'script')])
def test_schema_failures_drop_only_the_bad_question(field, value):
    raw = proposed()
    raw[0][field] = value
    accepted, rejected = questions(TEXT, raw)
    assert len(accepted) == 4 and len(rejected) == 1


def test_duplicate_evidence_and_excess_short_answers_rejected():
    raw = proposed()
    raw.append(copy.deepcopy(raw[0]))
    accepted, rejected = questions(TEXT, raw)
    assert len(accepted) == 5 and rejected[0]['reason'] == 'Duplicate evidence quote'
    raw = proposed()
    for question in raw[:3]:
        question.update(type='short', rubric='Names the color stated in the sentence.')
    accepted, rejected = questions(TEXT, raw)
    assert len(accepted) == 4 and sum(q['type'] == 'short' for q in accepted) == 2
    assert rejected[0]['reason'] == 'At most two short-answer questions'


def test_same_edition_reuses_immutable_quiz_and_rejects_id_collision(store):
    request_id = str(uuid4())
    first = save(store, request_id=request_id)
    target = store.file(first['document_sha256'], first['id'])
    original = target.read_bytes()
    assert save(store, request_id=request_id) == first
    changed = proposed()
    changed[0]['prompt'] = 'A different question?'
    with pytest.raises(ValueError, match='different input'):
        save(store, changed, request_id=request_id)
    assert target.read_bytes() == original
    assert store.get(PATH)['id'] == first['id']


def test_edition_change_relocates_survivors_and_hides_missing_questions(store):
    first = save(store)
    original = store.file(first['document_sha256'], first['id']).read_bytes()
    (store.root / PATH).write_text('New introduction.\n' + TEXT.replace(QUOTES[1], 'That sentence was removed.'))
    old = store.get(PATH)
    assert old['earlier'] and len(old['questions']) == 4 and old['hidden'][0]['id'] == 'q2'
    anchor = old['questions'][0]['evidence']
    assert anchor['start'] == 20 and anchor['source_sha256'] == old['current_sha256']
    assert store.file(first['document_sha256'], first['id']).read_bytes() == original
    second = save(store, [q for q in proposed() if q['evidence']['quote'] != QUOTES[1]])
    assert second['document_sha256'] != first['document_sha256']
    assert store.get(PATH)['id'] == second['id'] and not store.get(PATH)['earlier']


def test_mid_generation_source_change_refuses_publication(store):
    expected = hashlib.sha256(TEXT.encode()).hexdigest()
    (store.root / PATH).write_text(TEXT + 'Edited.\n')
    with pytest.raises(ValueError, match='Source changed'):
        store.save(PATH, 'A test voice', proposed(), expected_sha256=expected)
    assert not store.folder.exists()


def test_results_are_graded_from_saved_questions_and_do_not_mark_read(store):
    quiz = save(store)
    args = dict(path=PATH, edition=quiz['document_sha256'], quiz_id=quiz['id'],
                expected_sha256=quiz['document_sha256'])
    answers = {q['id']: 0 for q in quiz['questions']}
    result = store.result(**args, answers=answers | {'q3': 1}, participant='First reader')
    assert result['score'] == 4 and result['total'] == 5 and result['missed'] == ['q3']
    store.result(**args, answers=answers, participant='Second reader')
    assert {r['participant']: r['score'] for r in store.engagement.quiz_results(PATH)} == {'First reader': 4, 'Second reader': 5}
    receipts = store.engagement.receipts()
    assert all('document:' + PATH not in r['items'] for r in receipts)
    key = 'quiz:' + quiz['id']
    assert all(r['items'][key]['version'] == quiz['id'] for r in receipts)
    store.engagement.seen('First reader', [store.engagement.document(PATH)])
    assert len(store.engagement.quiz_results(PATH)) == 2


def test_result_requires_complete_valid_answers_and_current_source(store):
    quiz = save(store)
    args = dict(path=PATH, edition=quiz['document_sha256'], quiz_id=quiz['id'],
                expected_sha256=quiz['document_sha256'], participant='Reader')
    with pytest.raises(ValueError, match='Answer every'):
        store.result(**args, answers={'q1': 0})
    with pytest.raises(ValueError, match='option indexes'):
        store.result(**args, answers={q['id']: True for q in quiz['questions']})
    (store.root / PATH).write_text(TEXT + 'Edited.\n')
    with pytest.raises(ValueError, match='Source changed'):
        store.result(**args, answers={q['id']: 0 for q in quiz['questions']})
    assert not store.engagement.folder.exists()


def test_symlinked_edition_or_quiz_is_never_read_or_overwritten(store, tmp_path):
    first = save(store)
    target = store.file(first['document_sha256'], first['id'])
    elsewhere = tmp_path / 'outside.json'
    elsewhere.write_bytes(target.read_bytes())
    target.unlink()
    target.symlink_to(elsewhere)
    with pytest.raises(ValueError, match='symlink'):
        store.get(PATH)
    with pytest.raises(ValueError, match='symlink'):
        save(store, request_id=first['id'])
    assert json.loads(elsewhere.read_bytes())['id'] == first['id']
