"""A tiny stand-in for the Colorful CLI that emits colorful.syntax/v1 artifacts.

Usage: fake_colorful.py [--mode MODE] (--version | ir -). Modes corrupt the artifact
or the process so tests can exercise admission, time and output limits without the
real binary. Words are classified from small fixed lists, never a model.
"""
import hashlib
import json
import re
import sys
import time

SCHEMA = 'sha256:4404256591b2fbaaf4a7a3fb2ae03fd4256afb4557b605a19c0b966ee287e122'
VOCABULARY = 'sha256:c4f1a36f839ba6e56955c60c8fa45f8d6692685fd137eed2a084416f52531461'
FUNCTION = {'a': 'ARTICLE', 'an': 'ARTICLE', 'the': 'ARTICLE', 'and': 'CONJUNCTION', 'but': 'CONJUNCTION', 'or': 'CONJUNCTION',
            'of': 'PREPOSITION', 'in': 'PREPOSITION', 'for': 'PREPOSITION', 'to': 'PREPOSITION', 'with': 'PREPOSITION', 'here': 'DETERMINER',
            'it': 'PRONOUN', 'this': 'DETERMINER', 'each': 'DETERMINER', 'is': 'AUXILIARY', 'was': 'AUXILIARY', 'not': 'NEGATOR'}
OPEN = {'library': 'NOUN', 'passage': 'NOUN', 'room': 'NOUN', 'thought': 'NOUN', 'observation': 'NOUN', 'holds': 'VERB', 'carries': 'VERB',
        'waits': 'VERB', 'quiet': 'ADJECTIVE', 'careful': 'ADJECTIVE', 'precise': 'ADJECTIVE', 'different': 'ADJECTIVE', 'quickly': 'ADVERB'}
TOKEN = re.compile(r"(?P<word>[^\W\d_](?:[^\W\d_]|['’](?=[^\W\d_]))*)|(?P<number>\d+(?:[.,]\d+)*)|(?P<quote>[\"“”])|(?P<punct>[^\w\s])", re.U)


def analyze(text):
    data = text.encode()
    offsets, position = [], 0
    for char in text:
        offsets.append(position)
        position += len(char.encode())
    offsets.append(position)
    tokens, initial = [], True
    for match in TOKEN.finditer(text):
        start, end = offsets[match.start()], offsets[match.end()]
        token = {'byteRange': {'endUtf8': end, 'startUtf8': start}, 'functionKind': None, 'lexicalClass': None,
                 'occurrenceId': len(tokens), 'openClassKind': None, 'tokenKind': 'WORD'}
        if match.group('word'):
            word = match.group('word')
            if word.lower() in FUNCTION:
                token.update(lexicalClass='FUNCTION', functionKind=FUNCTION[word.lower()])
            elif word[0].isupper() and not initial:
                token.update(lexicalClass='PROPER_NOUN_CANDIDATE')
            else:
                token.update(lexicalClass='CONTENT', openClassKind=OPEN.get(word.lower()))
            initial = False
        elif match.group('number'):
            token['tokenKind'] = 'NUMBER'
            initial = False
        elif match.group('quote'):
            token['tokenKind'] = 'QUOTE'
        else:
            token['tokenKind'] = 'PUNCTUATION'
            initial = match.group() in '.!?'
        tokens.append(token)
    structure = []
    for block in re.finditer(r'[^\n]+(?:\n(?!\n)[^\n]*)*', text):
        start, end = offsets[block.start()], offsets[block.end()]
        node = len(structure)
        structure.append({'byteRange': {'endUtf8': end, 'startUtf8': start}, 'childNodeIds': [node + 1], 'depth': 0, 'kind': 'PARAGRAPH', 'nodeId': node})
        structure.append({'byteRange': {'endUtf8': end, 'startUtf8': start}, 'childNodeIds': [], 'depth': 1, 'kind': 'SENTENCE', 'nodeId': node + 1})
    whole = [{'endUtf8': len(data), 'startUtf8': 0}]
    return {'contractVersion': 'colorful.syntax/v1',
            'derivation': [{'compilerBuildHash': 'fake@0.4.0', 'passId': 'segment', 'ruleId': 'fake-segmenter', 'sourceRanges': whole},
                           {'compilerBuildHash': 'fake@0.4.0', 'passId': 'classify', 'ruleId': 'fake-annotator', 'sourceRanges': whole}],
            'diagnostics': [], 'schemaHash': SCHEMA,
            'source': {'contentHash': 'sha256:' + hashlib.sha256(data).hexdigest(), 'unitId': 'stdin', 'utf8ByteLength': len(data)},
            'structure': structure, 'tokens': tokens, 'vocabularyHash': VOCABULARY}


def main():
    args = sys.argv[1:]
    mode = 'ok'
    if args[:1] == ['--mode']:
        mode, args = args[1], args[2:]
    if args == ['--version']:
        print('colorful 0.2.1' if mode == 'old' else 'colorful 0.4.0')
        return 0
    if args != ['ir', '-']:
        print('usage: colorful ir -', file=sys.stderr)
        return 2
    text = sys.stdin.buffer.read().decode('utf-8')
    if mode == 'count':
        with open(__file__ + '.calls', 'a') as log:
            log.write(str(len(text.encode())) + '\n')
    if mode == 'fail':
        print('colorful: synthetic failure', file=sys.stderr)
        return 3
    if mode == 'sleep':
        time.sleep(30)
    if mode == 'flood':
        sys.stdout.write('x' * (17 * 1024**2))
        return 0
    artifact = analyze(text)
    tokens = artifact['tokens']
    if mode == 'reverse' and tokens:
        r = tokens[0]['byteRange']
        r['startUtf8'], r['endUtf8'] = r['endUtf8'], r['startUtf8']
    elif mode == 'overlap' and len(tokens) > 1:
        tokens[1]['byteRange']['startUtf8'] = tokens[0]['byteRange']['endUtf8'] - 1
    elif mode == 'bounds' and tokens:
        tokens[-1]['byteRange']['endUtf8'] = len(text.encode()) + 4
    elif mode == 'version':
        artifact['contractVersion'] = 'colorful.syntax/v2'
    elif mode == 'midchar':
        data = text.encode()
        for token in tokens:
            r = token['byteRange']
            if data[r['endUtf8'] - 1] >= 0x80:
                r['endUtf8'] -= 1
                break
    elif mode == 'axes' and tokens:
        tokens[0]['functionKind'] = 'ARTICLE'
        tokens[0]['lexicalClass'] = 'CONTENT'
    elif mode == 'hash':
        artifact['source']['contentHash'] = 'sha256:' + '0' * 64
    elif mode == 'vocabulary':
        artifact['vocabularyHash'] = 'sha256:' + '1' * 64
    elif mode == 'cycle' and len(artifact['structure']) > 1:
        artifact['structure'][1]['childNodeIds'] = [0]
    sys.stdout.write(json.dumps(artifact, separators=(',', ':'), sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
