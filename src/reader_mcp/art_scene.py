"""Reader scene descriptions (RW-43): parse and validate the declarative art DSL.

A model never writes code that Reader runs. It writes a *scene description*: JSON in the
versioned DSL defined by `web_ui/art-scene.v1.json`. This module interprets that schema
generically (the browser's `web_ui/art-scene.mjs` interprets the same file the same way),
then runs the semantic checks the schema cannot express: unique ids, references to
materials and objects, acyclic follow/orbit chains, face indices, and the budgets for
nodes, nesting, animations, instances, particles and triangles. Both validators produce the
same error paths, checked against the shared fixtures in `tests/fixtures/art/`."""
import json
import math
from pathlib import Path
import re

SCHEMA_FILE = Path(__file__).with_name('web_ui') / 'art-scene.v1.json'
SCHEMA = json.loads(SCHEMA_FILE.read_text())
LIMITS = SCHEMA['limits']
TOKENS = SCHEMA['tokens']
DEFAULTS = SCHEMA['geometry_defaults']
VERSION = SCHEMA['version']
POLYHEDRA = {'icosahedron': 20, 'octahedron': 8, 'dodecahedron': 36, 'tetrahedron': 4}


class SceneError(ValueError):
    """A scene that does not validate; `errors` lists up to LIMITS['errors'] messages."""

    def __init__(self, errors):
        self.errors = list(errors)[:LIMITS['errors']]
        super().__init__('; '.join(self.errors[:3]) + (f' (and {len(self.errors) - 3} more)' if len(self.errors) > 3 else ''))


def fmt(value):
    """Numbers as JavaScript's String() writes them, so both validators word errors alike."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def resolve(value):
    if isinstance(value, str) and value.startswith('@'):
        if value == '@tokens':
            return TOKENS
        if value.startswith('@limits.'):
            return LIMITS[value[len('@limits.'):]]
    return value


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def kind_of(value):
    if isinstance(value, bool):
        return 'boolean'
    if number(value):
        return 'number'
    if isinstance(value, str):
        return 'string'
    if isinstance(value, list):
        return 'array'
    if isinstance(value, dict):
        return 'object'
    return 'other'


def join(path, key):
    return f'{path}.{key}' if path else str(key)


class Checker:
    def __init__(self):
        self.errors = []

    def fail(self, path, message):
        if len(self.errors) < LIMITS['errors']:
            self.errors.append(f'{path or "scene"}: {message}')

    def full(self):
        return len(self.errors) >= LIMITS['errors']

    def check(self, value, spec, path):
        if self.full():
            return
        if isinstance(spec, str):
            spec = SCHEMA['types'][spec]
        kind = spec['kind']
        getattr(self, 'check_' + kind)(value, spec, path)

    def check_number(self, value, spec, path):
        low, high = resolve(spec['min']), resolve(spec['max'])
        if not number(value) or not low <= value <= high:
            self.fail(path, f'expected a number from {fmt(low)} to {fmt(high)}')

    def check_integer(self, value, spec, path):
        low, high = resolve(spec['min']), resolve(spec['max'])
        if not number(value) or float(value) != math.floor(value) or not low <= value <= high:
            self.fail(path, f'expected a whole number from {fmt(low)} to {fmt(high)}')

    def check_string(self, value, spec, path):
        if not isinstance(value, str):
            self.fail(path, 'expected text'); return
        if 'pattern' in spec and not re.fullmatch(spec['pattern'].lstrip('^').rstrip('$'), value):
            self.fail(path, 'expected an id: a lowercase letter, then up to 31 lowercase letters, digits or dashes'); return
        low, high = spec.get('min', 0), spec.get('max', 10000)
        if not low <= len(value) <= high:
            self.fail(path, f'expected text of {low} to {high} characters')

    def check_enum(self, value, spec, path):
        values = resolve(spec['values'])
        if isinstance(value, bool) or not any(kind_of(value) == kind_of(v) and value == v for v in values):
            self.fail(path, 'expected one of: ' + ', '.join(fmt(v) for v in values))

    def check_boolean(self, value, spec, path):
        if not isinstance(value, bool):
            self.fail(path, 'expected true or false')

    def check_tuple(self, value, spec, path):
        if not isinstance(value, list) or len(value) != spec['length']:
            self.fail(path, f'expected a list of {spec["length"]} values'); return
        for index, item in enumerate(value):
            self.check(item, spec['item'], f'{path}[{index}]')

    def check_list(self, value, spec, path):
        low, high = resolve(spec.get('min', 0)), resolve(spec['max'])
        if not isinstance(value, list) or not low <= len(value) <= high:
            self.fail(path, f'expected a list of {fmt(low)} to {fmt(high)} items'); return
        for index, item in enumerate(value):
            self.check(item, spec['item'], f'{path}[{index}]')

    def check_map(self, value, spec, path):
        high = resolve(spec['max'])
        if not isinstance(value, dict) or len(value) > high:
            self.fail(path, f'expected an object of at most {fmt(high)} entries'); return
        for key, item in value.items():
            self.check(key, spec['key'], join(path, key))
            self.check(item, spec['value'], join(path, key))

    def fields(self, value, fields, path):
        for key in value:
            if key not in fields:
                self.fail(join(path, key), 'unknown field')
        for key, field in fields.items():
            if key in value:
                self.check(value[key], field['type'], join(path, key))
            elif field.get('required'):
                self.fail(join(path, key), 'required')

    def check_object(self, value, spec, path):
        if not isinstance(value, dict):
            self.fail(path, 'expected an object'); return
        self.fields(value, spec['fields'], path)
        if 'either' in spec and not any(all(k in value for k in group) for group in spec['either']):
            self.fail(path, 'expected ' + ' or '.join(' and '.join(group) for group in spec['either']))

    def check_tagged(self, value, spec, path):
        if not isinstance(value, dict):
            self.fail(path, 'expected an object'); return
        tag, variants = spec['tag'], spec['variants']
        if not isinstance(value.get(tag), str) or value[tag] not in variants:
            self.fail(join(path, tag), 'expected one of: ' + ', '.join(variants)); return
        fields = {tag: {'type': {'kind': 'string'}}} | spec.get('common', {}) | variants[value[tag]]['fields']
        self.fields(value, fields, path)

    def check_alternatives(self, value, spec, path):
        option = spec.get(kind_of(value))
        if option is None:
            names = {'string': 'a name', 'number': 'a number', 'array': 'a list', 'object': 'an object'}
            self.fail(path, 'expected ' + ' or '.join(names[k] for k in ('string', 'number', 'array', 'object') if k in spec)); return
        self.check(value, option, path)


def geometry_defaults(geometry):
    return DEFAULTS.get(geometry['type'], {}) | geometry


def triangles(geometry):
    """An upper estimate of a geometry's triangles; the browser counts the real ones too."""
    g = geometry_defaults(geometry)
    kind = g['type']
    if kind == 'box':
        return 12 * g['segments'] ** 2
    if kind == 'sphere':
        return 2 * g['widthSegments'] * g['heightSegments']
    if kind in POLYHEDRA:
        return POLYHEDRA[kind] * (g['detail'] + 1) ** 2
    if kind in ('torus', 'torusKnot'):
        return 2 * g['radialSegments'] * g['tubularSegments']
    if kind == 'cylinder':
        return 2 * g['radialSegments'] * g['heightSegments'] + (0 if g['openEnded'] else 2 * g['radialSegments'])
    if kind == 'cone':
        return 2 * g['radialSegments'] + (0 if g['openEnded'] else g['radialSegments'])
    if kind == 'capsule':
        return 2 * g['radialSegments'] * (2 * g['capSegments'] + 2)
    if kind == 'plane':
        return 2 * g['segments'][0] * g['segments'][1]
    if kind == 'circle':
        return g['segments']
    if kind == 'ring':
        return 2 * g['segments']
    if kind == 'lathe':
        return 2 * (len(g['points']) - 1) * g['segments']
    if kind == 'extrude':
        n = len(g['shape']) + sum(len(h) for h in g['holes'])
        return 2 * n * (7 if g['bevel'] > 0 else 1) + 2 * n
    if kind == 'tube':
        return 2 * g['tubularSegments'] * g['radialSegments']
    if kind == 'parametric':
        return 2 * g['slices'] * g['stacks']
    if kind == 'custom':
        return len(g['faces'])
    return 0


ANIMATION_TARGETS = {'orbit': 'around', 'follow': 'target', 'look': 'target', 'react': 'source'}


def semantics(scene, checker):
    """Ids, references, cycles, indices and budgets, after the structure is known to be right."""
    ids, nodes, refs = {}, [], []
    counts = {'nodes': 0, 'animations': 0, 'instances': 0, 'particles': 0, 'triangles': 0}
    materials = scene.get('materials') or {}

    def animations(owner, items, path):
        counts['animations'] += len(items)
        for index, item in enumerate(items):
            field = ANIMATION_TARGETS.get(item['kind'])
            if field and field in item:
                refs.append((owner, item[field], f'{path}[{index}].{field}', item['kind'] in ('follow', 'orbit')))

    def material(ref, path):
        if isinstance(ref, str) and ref not in materials:
            checker.fail(path, f'no material named "{ref}"')

    def geometry(g, path, copies=1):
        if g['type'] == 'custom':
            size = len(g['vertices'])
            for index, face in enumerate(g['faces']):
                if any(i >= size for i in face):
                    checker.fail(f'{path}.faces[{index}]', 'vertex index out of range'); break
        if g['type'] == 'ring' and 'inner' in g and g['inner'] >= g.get('outer', DEFAULTS['ring']['outer']):
            checker.fail(f'{path}.inner', 'must be smaller than outer')
        counts['triangles'] += copies * triangles(g)

    def visit(node, path, depth):
        counts['nodes'] += 1
        if depth > LIMITS['depth']:
            checker.fail(path, f'groups nest deeper than {LIMITS["depth"]}')
            return
        if 'id' in node:
            if node['id'] in ids:
                checker.fail(f'{path}.id', f'duplicate id "{node["id"]}"')
            ids[node['id']] = path
        nodes.append((node, path))
        animations(node.get('id'), node.get('animate') or [], f'{path}.animate')
        kind = node['type']
        if kind in ('mesh', 'instances'):
            material(node.get('material'), f'{path}.material')
            geometry(node['geometry'], f'{path}.geometry', node.get('count', 1))
        if kind == 'instances':
            counts['instances'] += node['count']
        if kind == 'particles':
            counts['particles'] += node['count']
        for index, child in enumerate(node.get('children') or []):
            visit(child, f'{path}.children[{index}]', depth + 1)

    for index, light in enumerate(scene.get('lights') or []):
        if 'id' in light:
            if light['id'] in ids:
                checker.fail(f'lights[{index}].id', f'duplicate id "{light["id"]}"')
            ids[light['id']] = f'lights[{index}]'
        animations(light.get('id'), light.get('animate') or [], f'lights[{index}].animate')
    for index, node in enumerate(scene['objects']):
        visit(node, f'objects[{index}]', 1)
    edges = {}
    for owner, target, path, chained in refs:
        if target not in ids:
            checker.fail(path, f'no object with id "{target}"')
        elif owner is not None and target == owner:
            checker.fail(path, 'an object cannot target itself')
        elif chained and owner is not None:
            edges.setdefault(owner, []).append(target)
    for index, link in enumerate(scene.get('links') or []):
        for end in ('from', 'to'):
            if link[end] not in ids:
                checker.fail(f'links[{index}].{end}', f'no object with id "{link[end]}"')
    # Follow and orbit-around chains are evaluated in order; a cycle has no order.
    state = {}

    def cycle(node):
        state[node] = 1
        for target in edges.get(node, ()):
            if state.get(target) == 1 or (state.get(target) is None and cycle(target)):
                return True
        state[node] = 2
        return False
    for owner in sorted(edges):
        if state.get(owner) is None and cycle(owner):
            checker.fail('objects', f'follow and orbit targets form a cycle through "{owner}"')
            break
    fog = scene.get('fog')
    if fog and 'near' in fog and 'far' in fog and fog['far'] <= fog['near']:
        checker.fail('fog.far', 'must be greater than near')
    for name in ('nodes', 'animations', 'instances', 'particles', 'triangles'):
        if counts[name] > LIMITS[name]:
            checker.fail('scene', f'{counts[name]} {name} exceed the budget of {LIMITS[name]}')
    return counts


def validate(scene):
    """Return (scene, counts) for a valid scene; raise SceneError listing what is wrong."""
    checker = Checker()
    checker.check(scene, SCHEMA['root'], '')
    if checker.errors:
        raise SceneError(checker.errors)
    counts = semantics(scene, checker)
    if checker.errors:
        raise SceneError(checker.errors)
    return scene, counts


def refuse_constant(name):
    raise ValueError(f'{name} is not a finite number')


def parse(text):
    """A scene from JSON text (at most LIMITS['bytes'] bytes), validated."""
    if isinstance(text, bytes):
        text = text.decode('utf-8')
    size = len(text.encode())
    if size > LIMITS['bytes']:
        raise SceneError([f'scene: {size} bytes exceed {LIMITS["bytes"]}'])
    try:
        value = json.loads(text, parse_constant=refuse_constant)
    except ValueError as exc:
        raise SceneError([f'scene: not valid JSON ({str(exc)[:200]})']) from exc
    return validate(value)


FENCE = re.compile(r'```(?:json)?[ \t]*\n(.*?)\n```', re.S)


def extract(text):
    """The scene JSON in a model's answer: a fenced ```json block, else the outermost braces."""
    for match in FENCE.finditer(text or ''):
        body = match.group(1).strip()
        if body.startswith('{'):
            return body
    start, end = (text or '').find('{'), (text or '').rfind('}')
    if start < 0 or end <= start:
        raise SceneError(['scene: the answer holds no JSON object'])
    return text[start:end + 1]
