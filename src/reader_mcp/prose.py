"""Optional prose-role coloring through an external Colorful Language CLI.

Reader never links or vendors Colorful. It runs ``colorful ir -`` (explicit argv,
no shell) on visible prose the browser already projected, admits the
``colorful.syntax/v1`` artifact with checks ported from Colorful's reference
consumer (``consumers/graft-projection.mjs``), and returns UTF-16 token spans
per segment. Nothing half-valid is ever returned: one failed check rejects the
whole artifact.
"""
from collections import OrderedDict
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading

CONTRACT_VERSION = 'colorful.syntax/v1'
# Hashes of the colorful.syntax/v1 SDL (descriptions stripped, as colorful-ir does)
# and of the colorful.vocabulary/v1 manifest, identical in v0.3.0 and v0.4.0.
# ROLES below mirrors that manifest's classRoles, so a different vocabulary is refused.
SCHEMA_HASHES = frozenset({'sha256:4404256591b2fbaaf4a7a3fb2ae03fd4256afb4557b605a19c0b966ee287e122'})
VOCABULARY_HASHES = frozenset({'sha256:c4f1a36f839ba6e56955c60c8fa45f8d6692685fd137eed2a084416f52531461'})
MIN_VERSION = (0, 3, 0)
MAX_REQUEST_TEXT = 512 * 1024
MAX_DOCUMENT_TEXT = 4 * 1024**2
MAX_SEGMENT_TEXT = 128 * 1024
MAX_SEGMENTS = 2000
MAX_OUTPUT = 16 * 1024**2
TIMEOUT = 10
SEPARATOR = '\n\n'
INSTALL = 'cargo install --path crates/colorful-cli --locked'  # in a colorful-language checkout
ROLES = ('function', 'proper', 'quote', 'number', 'punct', 'noun', 'verb', 'adjective', 'adverb')
TOKEN_KINDS = {'WORD', 'NUMBER', 'PUNCTUATION', 'QUOTE'}
LEXICAL = {'FUNCTION', 'CONTENT', 'PROPER_NOUN_CANDIDATE'}
FUNCTION_KINDS = {'ARTICLE', 'PREPOSITION', 'CONJUNCTION', 'PRONOUN', 'AUXILIARY', 'DETERMINER', 'NEGATOR'}
OPEN_KINDS = {'NOUN', 'VERB', 'ADJECTIVE', 'ADVERB'}
OUTLINE = {'PARAGRAPH', 'SENTENCE'}
SEVERITIES = {'ERROR', 'WARNING', 'INFO'}
I32 = (-2**31, 2**31 - 1)
SEGMENT_ID = re.compile(r'[A-Za-z0-9_-]{1,40}')


class ProseUnavailable(ValueError):
    """Colorful is missing or too old; the message tells the reader what to do."""


class AdmissionError(ValueError):
    """A Colorful artifact failed admission; nothing from it is used."""

    def __init__(self, code, message):
        super().__init__(f'Colorful output rejected: {message} ({code})')
        self.code = code


def role(token):
    """Reader role for an admitted token, or None for unstyled content."""
    kind = token['tokenKind']
    if kind == 'NUMBER':
        return 'number'
    if kind == 'PUNCTUATION':
        return 'punct'
    if kind == 'QUOTE':
        return 'quote'
    lexical = token.get('lexicalClass')
    if lexical == 'FUNCTION':
        return 'function'
    if lexical == 'PROPER_NOUN_CANDIDATE':
        return 'proper'
    open_kind = token.get('openClassKind')
    return open_kind.lower() if open_kind else None


def _fail(code, message):
    raise AdmissionError(code, message)


def _shape(value, fields, label):
    """Exact field set with primitive types; ``fields`` maps name -> (types, nullable)."""
    if not isinstance(value, dict):
        _fail('E_ARTIFACT_SHAPE', f'{label} must be an object')
    unknown = set(value) - set(fields)
    if unknown:
        _fail('E_ARTIFACT_SHAPE', f'unknown field {label}.{sorted(unknown)[0]}')
    for name, (types, nullable) in fields.items():
        if name not in value:
            if nullable:
                continue
            _fail('E_ARTIFACT_SHAPE', f'{label} is missing {name}')
        item = value[name]
        if item is None and nullable:
            continue
        if types is int:
            if type(item) is not int or not I32[0] <= item <= I32[1]:
                _fail('E_ARTIFACT_SHAPE', f'{label}.{name} must be a 32-bit integer')
        elif not isinstance(item, types) or isinstance(item, bool):
            _fail('E_ARTIFACT_SHAPE', f'{label}.{name} has the wrong type')


def _enum(value, allowed, label, nullable=False):
    if value is None and nullable:
        return
    if value not in allowed:
        _fail('E_ARTIFACT_SHAPE', f'{label} is not a known value')


def _range(value, label, data):
    _shape(value, {'startUtf8': (int, False), 'endUtf8': (int, False)}, label)
    start, end = value['startUtf8'], value['endUtf8']
    if start < 0 or end < 0:
        _fail('E_ARTIFACT_SHAPE', f'{label} must not be negative')
    if start > end:
        _fail('E_BYTE_RANGE_ORDER', f'{label} start exceeds its end')
    if end > len(data):
        _fail('E_BYTE_RANGE_BOUNDS', f'{label} ends past the source')
    for offset in (start, end):
        if 0 < offset < len(data) and data[offset] & 0xC0 == 0x80:
            _fail('E_BYTE_RANGE_BOUNDARY', f'{label} is not on a UTF-8 character boundary')
    return start, end


def _axes(token):
    kind, lexical, function, open_kind = token['tokenKind'], token.get('lexicalClass'), token.get('functionKind'), token.get('openClassKind')
    if kind == 'WORD':
        if lexical is None:
            return 'a WORD token must carry a lexicalClass'
        if lexical == 'FUNCTION':
            if function is None:
                return 'a FUNCTION word must carry a functionKind'
            return 'only a CONTENT word may carry an openClassKind' if open_kind is not None else None
        if function is not None:
            return 'only a FUNCTION word may carry a functionKind'
        if lexical == 'PROPER_NOUN_CANDIDATE' and open_kind is not None:
            return 'only a CONTENT word may carry an openClassKind'
        return None
    if lexical is not None or function is not None or open_kind is not None:
        return 'a non-word token must not carry word axes'
    return None


def admit(data, artifact):
    """The reference consumer's admission gate, cheapest checks first, hashes last."""
    _shape(artifact, {'contractVersion': (str, False), 'schemaHash': (str, False), 'vocabularyHash': (str, False),
                      'source': (dict, False), 'tokens': (list, False), 'structure': (list, False),
                      'diagnostics': (list, False), 'derivation': (list, False)}, 'artifact')
    source = artifact['source']
    _shape(source, {'unitId': (str, False), 'contentHash': (str, False), 'utf8ByteLength': (int, False)}, 'source')
    for index, token in enumerate(artifact['tokens']):
        _shape(token, {'occurrenceId': (int, False), 'byteRange': (dict, False), 'tokenKind': (str, False),
                       'lexicalClass': (str, True), 'functionKind': (str, True), 'openClassKind': (str, True)}, f'tokens[{index}]')
        _enum(token['tokenKind'], TOKEN_KINDS, f'tokens[{index}].tokenKind')
        _enum(token.get('lexicalClass'), LEXICAL, f'tokens[{index}].lexicalClass', True)
        _enum(token.get('functionKind'), FUNCTION_KINDS, f'tokens[{index}].functionKind', True)
        _enum(token.get('openClassKind'), OPEN_KINDS, f'tokens[{index}].openClassKind', True)
    for index, node in enumerate(artifact['structure']):
        _shape(node, {'nodeId': (int, False), 'kind': (str, False), 'byteRange': (dict, False), 'depth': (int, False),
                      'childNodeIds': (list, False)}, f'structure[{index}]')
        _enum(node['kind'], OUTLINE, f'structure[{index}].kind')
        if any(type(child) is not int for child in node['childNodeIds']):
            _fail('E_ARTIFACT_SHAPE', f'structure[{index}].childNodeIds must be integers')
    for index, diagnostic in enumerate(artifact['diagnostics']):
        _shape(diagnostic, {'byteRange': (dict, False), 'severity': (str, False), 'code': (str, False), 'message': (str, False)}, f'diagnostics[{index}]')
        _enum(diagnostic['severity'], SEVERITIES, f'diagnostics[{index}].severity')
    for index, step in enumerate(artifact['derivation']):
        _shape(step, {'passId': (str, False), 'ruleId': (str, False), 'sourceRanges': (list, False), 'compilerBuildHash': (str, False)}, f'derivation[{index}]')
    if artifact['contractVersion'] != CONTRACT_VERSION:
        _fail('E_CONTRACT_VERSION', f'contract {artifact["contractVersion"]!r} is not {CONTRACT_VERSION}')
    if source['utf8ByteLength'] != len(data):
        _fail('E_BYTE_LENGTH', 'source.utf8ByteLength does not match the text sent')
    try:
        data.decode('utf-8')
    except UnicodeDecodeError:
        _fail('E_SOURCE_UTF8', 'source is not valid UTF-8')
    previous_start = previous_end = None
    seen = set()
    for index, token in enumerate(artifact['tokens']):
        start, end = _range(token['byteRange'], f'tokens[{index}].byteRange', data)
        if start == end:
            _fail('E_TOKEN_EMPTY', f'tokens[{index}] is empty')
        if previous_start is not None and start < previous_start:
            _fail('E_TOKEN_UNSORTED', f'tokens[{index}] starts before its predecessor')
        if previous_end is not None and start < previous_end:
            _fail('E_TOKEN_OVERLAP', f'tokens[{index}] overlaps its predecessor')
        previous_start, previous_end = start, end
        if token['occurrenceId'] in seen:
            _fail('E_DUPLICATE_OCCURRENCE_ID', f'tokens[{index}] reuses an occurrenceId')
        seen.add(token['occurrenceId'])
        violation = _axes(token)
        if violation:
            _fail('E_TOKEN_AXES', f'tokens[{index}]: {violation}')
    _structure(artifact['structure'], data)
    for index, diagnostic in enumerate(artifact['diagnostics']):
        _range(diagnostic['byteRange'], f'diagnostics[{index}].byteRange', data)
    if not artifact['derivation']:
        _fail('E_EMPTY_DERIVATION', 'derivation is empty')
    passes = set()
    for index, step in enumerate(artifact['derivation']):
        for number, item in enumerate(step['sourceRanges']):
            _range(item, f'derivation[{index}].sourceRanges[{number}]', data)
        if not step['passId'] or not step['ruleId']:
            _fail('E_MISSING_DERIVATION_IDENTITY', f'derivation[{index}] has an empty passId or ruleId')
        if step['passId'] in passes:
            _fail('E_DUPLICATE_DERIVATION_PASS_ID', f'derivation repeats passId {step["passId"]!r}')
        passes.add(step['passId'])
    if artifact['schemaHash'] not in SCHEMA_HASHES:
        _fail('E_SCHEMA_HASH', 'schemaHash is not the colorful.syntax/v1 contract Reader knows')
    if artifact['vocabularyHash'] not in VOCABULARY_HASHES:
        _fail('E_VOCABULARY_HASH', 'vocabularyHash is not the colorful.vocabulary/v1 manifest Reader maps')
    if source['contentHash'] != 'sha256:' + hashlib.sha256(data).hexdigest():
        _fail('E_CONTENT_HASH', 'contentHash does not match the text sent')


def _structure(nodes, data):
    index_of, parents = {}, {}
    for index, node in enumerate(nodes):
        _range(node['byteRange'], f'structure[{index}].byteRange', data)
        if node['nodeId'] in index_of:
            _fail('E_DUPLICATE_NODE_ID', f'structure[{index}] reuses a nodeId')
        index_of[node['nodeId']] = index
        if node['depth'] != (0 if node['kind'] == 'PARAGRAPH' else 1):
            _fail('E_OUTLINE_DEPTH', f'structure[{index}] has an invalid depth')
    for index, node in enumerate(nodes):
        for child in node['childNodeIds']:
            if child not in index_of:
                _fail('E_DANGLING_CHILD_REF', f'structure[{index}] references a missing child')
            if parents.setdefault(child, node['nodeId']) != node['nodeId']:
                _fail('E_MULTIPLE_STRUCTURE_PARENTS', f'structure[{index}] gives a child a second parent')
            inner, outer = nodes[index_of[child]]['byteRange'], node['byteRange']
            if inner['startUtf8'] < outer['startUtf8'] or inner['endUtf8'] > outer['endUtf8']:
                _fail('E_CHILD_RANGE', f'structure[{index}] has a child outside its range')
    colors = [0] * len(nodes)
    for root in range(len(nodes)):
        if colors[root]:
            continue
        colors[root] = 1
        stack = [(root, 0)]
        while stack:
            current, edge = stack[-1]
            children = nodes[current]['childNodeIds']
            if edge == len(children):
                colors[current] = 2
                stack.pop()
                continue
            stack[-1] = (current, edge + 1)
            child = index_of[children[edge]]
            if colors[child] == 1:
                _fail('E_STRUCTURE_CYCLE', f'structure[{current}] closes a cycle')
            if colors[child] == 0:
                colors[child] = 1
                stack.append((child, 0))


def spans(texts, data, tokens):
    """Per-segment [start, end, role] in UTF-16 code units, from admitted byte ranges."""
    out = [[] for _ in texts]
    bounds, byte = [], 0
    for text in texts:
        size = len(text.encode())
        bounds.append((byte, byte + size))
        byte += size + len(SEPARATOR)
    # One pass over each segment maps the byte offsets tokens use to UTF-16 offsets.
    segment = 0
    table = {}
    for index, text in enumerate(texts):
        byte, unit = bounds[index][0], 0
        table[byte] = 0
        for char in text:
            byte += 1 if char < '\x80' else len(char.encode())
            unit += 2 if char > '\uffff' else 1
            table[byte] = unit
    for token in tokens:
        name = role(token)
        if not name:
            continue
        start, end = token['byteRange']['startUtf8'], token['byteRange']['endUtf8']
        while segment < len(bounds) and start >= bounds[segment][1]:
            segment += 1
        if segment == len(bounds) or start < bounds[segment][0] or end > bounds[segment][1]:
            continue  # Separator punctuation or a token across segments: leave unstyled.
        out[segment].append([table[start], table[end], name])
    return out


def _version(text):
    match = re.search(r'(\d+)\.(\d+)\.(\d+)', text or '')
    return tuple(int(part) for part in match.groups()) if match else None


class Prose:
    def __init__(self, binary=None, environ=None):
        self.environ = os.environ if environ is None else environ
        self.binary = binary
        self.lock = threading.Lock()
        self.running = threading.BoundedSemaphore(2)
        self.cache = OrderedDict()
        self.cache_bytes = 0
        self.budgets = OrderedDict()
        self.probe = None
        # Set by the web library: [(origin, path)] from Settings and Reader's tooling folder, tried first.
        self.configured = lambda: []

    def forget(self):
        """Probe again on the next status (after an install or a path change)."""
        with self.lock:
            self.probe = None

    def candidates(self):
        configured = self.binary or self.environ.get('READER_COLORFUL')
        if configured:
            return [('READER_COLORFUL', Path(configured).expanduser())]
        found = shutil.which('colorful', path=self.environ.get('PATH'))
        home = Path(self.environ.get('HOME') or Path.home())
        options = [(origin, Path(path)) for origin, path in self.configured()]
        options += [('PATH', Path(found))] if found else []
        return options + [('cargo', home / '.cargo/bin/colorful'), ('install-local', home / '.colorful-language/bin/colorful')]

    def status(self):
        """Discovery and version floor, cached per binary identity."""
        for origin, path in self.candidates():
            try:
                info = path.stat()
            except OSError:
                if origin == 'READER_COLORFUL':
                    return self._missing(f'READER_COLORFUL points to {path}, which does not exist.')
                continue
            if not path.is_file() or not os.access(path, os.X_OK):
                if origin == 'READER_COLORFUL':
                    return self._missing(f'READER_COLORFUL points to {path}, which is not an executable file.')
                continue
            identity = (str(path), info.st_ino, info.st_mtime_ns, info.st_size)
            with self.lock:
                if self.probe and self.probe[0] == identity:
                    return self.probe[1]
            try:
                result = subprocess.run([str(path), '--version'], stdin=subprocess.DEVNULL, capture_output=True, timeout=5, check=False)
                version = _version(result.stdout.decode('utf-8', 'replace')) if result.returncode == 0 else None
            except (OSError, subprocess.TimeoutExpired):
                version = None
            if version is None:
                status = self._missing(f'{path} did not report a Colorful version; Reader needs Colorful 0.3.0 or newer.')
            elif version < MIN_VERSION:
                status = self._missing(f'Colorful {".".join(map(str, version))} at {path} is too old; Reader needs 0.3.0 or newer.')
            else:
                status = {'available': True, 'version': '.'.join(map(str, version)), 'path': str(path), 'origin': origin, 'message': None, 'install': INSTALL}
            with self.lock:
                self.probe = (identity, status)
            return status
        return self._missing("Colorful Language isn't installed.")

    @staticmethod
    def _missing(message):
        return {'available': False, 'version': None, 'path': None, 'origin': None,
                'message': message + ' Install it from Behind the scenes, Companions, or build it with'
                f' `{INSTALL}` in a colorful-language checkout and set its path there.', 'install': INSTALL}

    def colorize(self, document, segments):
        """``document`` is (path, sha256) of the open edition; segments are [{id, text}]."""
        if not isinstance(segments, list) or not 0 < len(segments) <= MAX_SEGMENTS:
            raise ValueError(f'Expected 1–{MAX_SEGMENTS} segments')
        ids, texts, size = set(), [], 0
        for segment in segments:
            if not isinstance(segment, dict) or set(segment) != {'id', 'text'} or not isinstance(segment['id'], str) or not isinstance(segment['text'], str):
                raise ValueError('Each segment is {id, text}')
            if not SEGMENT_ID.fullmatch(segment['id']) or segment['id'] in ids:
                raise ValueError('Segment ids are unique and use letters, digits, - or _')
            ids.add(segment['id'])
            # Length-preserving: line breaks would merge or split Colorful paragraphs.
            text = segment['text'].replace('\r', ' ').replace('\n', ' ')
            try:
                encoded = len(text.encode())
            except UnicodeEncodeError:
                raise ValueError('Segments must be valid Unicode text') from None
            if encoded > MAX_SEGMENT_TEXT:
                raise ValueError('A prose segment exceeds 128 KiB')
            size += encoded
            texts.append(text)
        if size > MAX_REQUEST_TEXT:
            raise ValueError('A prose request exceeds 512 KiB of text')
        status = self.status()
        if not status['available']:
            raise ProseUnavailable(status['message'])
        keys = [(status['version'], status['path'], hashlib.sha256(text.encode()).digest()) for text in texts]
        results, missing = {}, []
        with self.lock:
            for index, key in enumerate(keys):
                if key in self.cache:
                    self.cache.move_to_end(key)
                    results[index] = self.cache[key]
                elif texts[index].strip():
                    missing.append(index)
                else:
                    results[index] = []
            fresh = sum(len(texts[i].encode()) for i in missing)
            used = self.budgets.get(document, 0)
            if used + fresh > MAX_DOCUMENT_TEXT:
                raise ValueError('Prose colors stop at 4 MiB of text per document edition')
            self.budgets[document] = used + fresh
            self.budgets.move_to_end(document)
            while len(self.budgets) > 256:
                self.budgets.popitem(last=False)
        if missing:
            chunk = [texts[i] for i in missing]
            for index, value in zip(missing, self.run(status['path'], chunk)):
                results[index] = value
                with self.lock:
                    self.cache[keys[index]] = value
                    self.cache_bytes += 16 + 12 * len(value)
                    while self.cache_bytes > 64 * 1024**2 and self.cache:
                        _, old = self.cache.popitem(last=False)
                        self.cache_bytes -= 16 + 12 * len(old)
        return {'segments': {segment['id']: results[index] for index, segment in enumerate(segments)},
                'version': status['version'], 'roles': list(ROLES)}

    def run(self, binary, texts):
        """``colorful ir -`` with bounded time and output, then admission and projection."""
        data = SEPARATOR.join(texts).encode()
        if not self.running.acquire(timeout=15):
            raise BlockingIOError('Colorful is busy; try again shortly')
        try:
            process = subprocess.Popen([binary, 'ir', '-'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as exc:
            self.running.release()
            raise ProseUnavailable(f'Colorful could not start: {exc}') from None
        try:
            output, errors, overflow = bytearray(), bytearray(), threading.Event()

            def feed():
                try:
                    process.stdin.write(data)
                except (BrokenPipeError, OSError):
                    pass
                finally:
                    try:
                        process.stdin.close()
                    except OSError:
                        pass

            def drain(stream, target, limit):
                while chunk := stream.read(65536):
                    if len(target) + len(chunk) > limit:
                        overflow.set()
                        process.kill()
                        return
                    target.extend(chunk)

            workers = [threading.Thread(target=feed, daemon=True),
                       threading.Thread(target=drain, args=(process.stdout, output, MAX_OUTPUT), daemon=True),
                       threading.Thread(target=drain, args=(process.stderr, errors, 64 * 1024), daemon=True)]
            for worker in workers:
                worker.start()
            try:
                code = process.wait(timeout=TIMEOUT)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise ValueError(f'Colorful took longer than {TIMEOUT} s; prose colors stopped') from None
            for worker in workers:
                worker.join(timeout=2)
            if overflow.is_set():
                raise ValueError('Colorful output exceeded 16 MiB; prose colors stopped')
            if code != 0:
                detail = errors.decode('utf-8', 'replace').strip().splitlines()
                raise ValueError('Colorful failed' + (f': {detail[-1][:300]}' if detail else f' with exit status {code}'))
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            self.running.release()
        try:
            artifact = json.loads(bytes(output))
        except ValueError:
            raise AdmissionError('E_ARTIFACT_SHAPE', 'output is not JSON') from None
        admit(data, artifact)
        return spans(texts, data, artifact['tokens'])
