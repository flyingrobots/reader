"""reader:prompt v1 (RW-44) on the server: the shared corpus and agreement with the browser parser.

`tests/fixtures/prompt-blocks/agreement.json` records what the browser's markdown-it (with Reader's
plugins) finds in 700 generated documents; the server parser must find exactly the same blocks, lines,
prompts and rejections. `tests/prompt_blocks.test.mjs` checks the browser side of both files."""
import json
from pathlib import Path

import pytest

from reader_mcp import prompt_blocks

FIXTURES = Path(__file__).parent / 'fixtures/prompt-blocks'
CORPUS = json.loads((FIXTURES / 'corpus.json').read_text())
AGREEMENT = json.loads((FIXTURES / 'agreement.json').read_text())


@pytest.mark.parametrize('entry', CORPUS, ids=[entry['name'] for entry in CORPUS])
def test_shared_corpus(entry):
    found = prompt_blocks.parse(entry['markdown'])
    assert [block['id'] for block in found['blocks']] == entry['blocks']
    assert [[row['line'], row['reason']] for row in found['rejected']] == entry['rejected']


def test_server_agrees_with_the_browser_on_every_generated_document():
    assert len(AGREEMENT) >= 700
    for index, expected in enumerate(AGREEMENT):
        found = prompt_blocks.parse(expected['markdown'])
        assert [[b['id'], b['line'], b['end_line'], b['prompt']] for b in found['blocks']] == expected['blocks'], (index, expected['markdown'])
        assert [[r['line'], r['reason']] for r in found['rejected']] == expected['rejected'], (index, expected['markdown'])


def test_the_authoring_example_round_trips_with_its_prompt_and_hash():
    entry = CORPUS[0]
    block = prompt_blocks.parse(entry['markdown'])['blocks'][0]
    assert block | {'prompt': None, 'prompt_sha256': None} == {
        'id': 'bound-parser-depth', 'title': 'Bound source parser nesting', 'repo': 'acme/widget', 'issue': 277,
        'prompt': None, 'prompt_sha256': None, 'line': 0, 'end_line': 13}
    assert block['prompt'].startswith('Check the current state of issue #277') and block['prompt'].endswith('publish the branch/PR.\n')
    # A whole document: front matter is skipped as the browser skips it, so lines are body-relative.
    text = '---\ntitle: Synthetic\n---\n' + entry['markdown']
    assert prompt_blocks.find(text, 'bound-parser-depth')['prompt_sha256'] == block['prompt_sha256']
    assert prompt_blocks.find(text, 'missing') is None


def test_size_bounds():
    head = '<!-- reader:prompt {"v":1,"id":"big","title":"Big","repo":"acme/widget","issue":null} -->\n```text\n'
    exact = head + 'x' * (prompt_blocks.MAX_PROMPT - 1) + '\n```\n<!-- /reader:prompt -->\n'
    assert [b['id'] for b in prompt_blocks.parse(exact)['blocks']] == ['big']
    over = exact.replace('x\n```', 'xx\n```')
    assert [r['reason'] for r in prompt_blocks.parse(over)['rejected']] == ['prompt-size']
    assert prompt_blocks.metadata('{"v":1,"pad":"' + 'p' * 2040 + '"}')[1] == 'metadata-size'


def test_strict_flat_json():
    assert prompt_blocks.flat_json(' {"a" : 1 , "b":null,"c":"\\u00e9"} ') == {'a': 1, 'b': None, 'c': 'é'}
    for bad in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":1.0}', '{"a":-1e2}', '{"a":true}', '{"a":{}}', '{"a":1,}', '{,}', '[]', '{"a":01}', '{"a":1} x'):
        assert prompt_blocks.flat_json(bad) is None, bad


def test_repository_names():
    for good in ('acme/widget', 'a/b', 'Acme-Co/widget.js', 'x' * 39 + '/r'):
        assert prompt_blocks.repository_name(good), good
    for bad in ('acme', 'acme/', '/widget', 'acme/widget/x', '-acme/w', 'acme-/w', 'x' * 40 + '/r', 'acme/..', 'acme/w.git', 'acme/w x', None, 7):
        assert not prompt_blocks.repository_name(bad), bad
