"""A seeded corpus of mutated scenes for the art validators (RW-43).

`python tests/art_fuzz.py` rewrites tests/fixtures/art/fuzz.json: each case names a valid source scene
(tests/fixtures/art/valid/, the demo scenes) and one to three recorded mutations (wrong types, out-of-range numbers, missing or unknown fields,
duplicated items), and the errors the Python validator gives for it. tests/test_art.py checks the
Python validator still agrees with the file; tests/art_scene.test.mjs checks the browser validator
gives exactly the same errors. Shared, synthetic fixtures only."""
import copy
import json
from pathlib import Path
import random
import sys

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / 'src'))
from reader_mcp import art_scene  # noqa: E402

POOL = [None, -1e9, 1e9, 0, 0.5, -0.5, 3.7, 7, 'x', 'bg', 'chart-9', '', [], {}, [1, 2, 3], True, False, 2**31, 'a' * 100, [0, 0, 0], {'token': 'accent'}]
SOURCES = sorted((HERE / 'fixtures/art/valid').glob('*.json')) + sorted((HERE.parent / 'src/reader_mcp/demo/content/art').glob('*.json'))


def scenes():
    for file in SOURCES:
        data = json.loads(file.read_text())
        yield file.stem, data.get('scene', data)


def places(value, path=()):
    yield path, value
    if isinstance(value, dict):
        for key, item in value.items():
            yield from places(item, path + (key,))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from places(item, path + (index,))


def apply(scene, mutation):
    """One recorded mutation: {path, op: set | delete | add | dup, key?, value?} (tests/art_scene.test.mjs has the same)."""
    parent = scene
    for step in mutation['path'][:-1]:
        parent = parent[step]
    key = mutation['path'][-1]
    if mutation['op'] == 'set':
        parent[key] = copy.deepcopy(mutation['value'])
    elif mutation['op'] == 'delete':
        del parent[key]
    elif mutation['op'] == 'add':
        parent[mutation['key']] = copy.deepcopy(mutation['value'])
    else:
        parent.insert(key, copy.deepcopy(parent[key]))
    return scene


def mutation(scene, rng):
    candidates = [p for p in places(scene) if p[0]] if isinstance(scene, dict) else []
    if not candidates:  # every field already deleted
        return {'path': ['reader_scene'], 'op': 'set', 'value': 1}
    path, _ = rng.choice(candidates)
    parent = scene
    for step in path[:-1]:
        parent = parent[step]
    move = rng.randrange(5)
    if move == 1 and isinstance(parent, dict):
        return {'path': list(path), 'op': 'delete'}
    if move == 2 and isinstance(parent, dict):
        return {'path': list(path), 'op': 'add', 'key': 'zz_' + rng.choice(['code', 'script', 'extra', 'eval']), 'value': rng.choice(POOL)}
    if move == 3 and isinstance(parent, list):
        return {'path': list(path), 'op': 'dup'}
    return {'path': list(path), 'op': 'set', 'value': rng.choice(POOL)}


def mutated(sources, case):
    scene = copy.deepcopy(sources[case['source']])
    for item in case['mutations']:
        apply(scene, item)
    return scene


def errors(scene):
    try:
        art_scene.validate(scene)
        return []
    except art_scene.SceneError as exc:
        return exc.errors


def corpus(count=400, seed=4343):
    rng = random.Random(seed)
    sources = list(scenes())
    cases = []
    for index in range(count):
        name, scene = sources[index % len(sources)]
        scene, steps = copy.deepcopy(scene), []
        for _ in range(rng.randint(1, 3)):
            step = mutation(scene, rng)
            apply(scene, step)
            steps.append(step)
        cases.append({'source': name, 'mutations': steps, 'errors': errors(scene)})
    return cases


if __name__ == '__main__':
    cases = corpus()
    (HERE / 'fixtures/art/fuzz.json').write_text(json.dumps(cases, separators=(',', ':')) + '\n')
    print(f'{len(cases)} cases, {sum(1 for c in cases if not c["errors"])} still valid')
