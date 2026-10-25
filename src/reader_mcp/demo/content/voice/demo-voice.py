#!/usr/bin/env python3
"""Scripted stand-in for a voice CLI in the Reader demo vault. It never contacts a model.

Replies come from replies.json next to this file, chosen by keywords in the message being answered.
Output imitates two stream formats Reader parses: --style claude (stream-json) or codex (exec --json).
Replace it with a real agent CLI in voices.json to talk to a model."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time

if len(sys.argv) > 1 and sys.argv[1] == '--version':
    print('demo-voice 1.0 (scripted replies)')
    raise SystemExit(0)
parser = argparse.ArgumentParser()
parser.add_argument('--style', default='claude')
parser.add_argument('--name', required=True)
parser.add_argument('--prompt')
parser.add_argument('--persona')
parser.add_argument('--delay', type=float, default=0.06)
args, rest = parser.parse_known_args()
prompt = args.prompt if args.prompt is not None else sys.stdin.read()
seen = prompt + '\n' + (args.persona or '')
table = json.loads((Path(__file__).with_name('replies.json')).read_text())


def matches(entry, text):
    return all(any(word.lower() in text.lower() for word in group.split('|')) for group in entry.get('match', []))


def asked_body():
    rid = re.search(r'Reply to message id: ([0-9a-f-]{36})', prompt)
    if not rid:
        return prompt
    found = re.search(r'--- [^\n]*· id ' + rid.group(1) + r'\n(.*?)(?=\n--- |\n<<<)', prompt, re.S)
    return found.group(1) if found else prompt


def art_reply():
    """Reader art commissions: a handcrafted brief or scene from art.json, chosen by the article's or artwork's title."""
    entries = json.loads((Path(__file__).with_name('art.json')).read_text())
    named = re.search(r'(?:Article title|Artwork title): (.*)', prompt)
    title = (named.group(1) if named else '').lower()
    entry = next((e for e in entries if any(word in title for word in e['match'])), None)
    entry = entry or next((e for e in entries if e['title'].lower() == title), None) or entries[sum(map(ord, title)) % len(entries)]
    if 'Reader art brief' in prompt:
        return 'TITLE: ' + entry['title'] + '\nBRIEF:\n' + entry['brief']
    return '```json\n' + json.dumps(entry['scene'], indent=1) + '\n```'


if 'Reader art brief' in prompt or 'Reader art scene' in prompt:
    reply = art_reply()
elif 'Reader listening check' in seen:
    exchange = prompt.split('READER-EXCHANGE', 1)[-1]
    hand = next((h for h in table.get('hands', {}).get(args.name, []) if matches(h, exchange)), None)
    reply = 'HAND: ' + hand['reason'] if hand else 'PASS'
    args.delay = 0
elif 'You are chiming in' in seen:
    reply = next((c['reply'] for c in table.get('chime', {}).get(args.name, []) if matches(c, prompt)),
                 'One small addition: keep the earlier edition one click away.')
else:
    body = asked_body()
    title = (re.search(r'Document title: (.*)', prompt) or [None, 'this piece'])[1]
    options = table.get('replies', {}).get(args.name, [])
    reply = next((o['reply'] for o in options if o.get('match') and matches(o, body)), None)
    if reply is None:
        reply = next((o['reply'] for o in options if not o.get('match')), f'I have read {title} and have little to add yet.')
    reply = reply.replace('{title}', title)


def emit(value, pause=None):
    print(json.dumps(value), flush=True)
    time.sleep(args.delay if pause is None else pause)


def pieces(text, size=6):
    words = text.split(' ')
    return [' '.join(words[i:i + size]) + (' ' if i + size < len(words) else '') for i in range(0, len(words), size)]


if args.style == 'codex':
    emit({'type': 'thread.started', 'thread_id': 'demo-' + os.urandom(4).hex()})
    emit({'type': 'item.completed', 'item': {'type': 'reasoning', 'text': 'Reading the passage and its provenance.'}})
    emit({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': reply}})
    for i, value in enumerate(rest):
        if value == '--output-last-message' and i + 1 < len(rest):
            Path(rest[i + 1]).write_text(reply)
    emit({'type': 'turn.completed', 'usage': {'input_tokens': 0, 'cached_input_tokens': 0, 'output_tokens': 0}}, 0)
else:
    model = 'demo-scripted'
    emit({'type': 'system', 'subtype': 'init', 'model': model, 'session_id': 'demo-' + os.urandom(4).hex()})
    emit({'type': 'stream_event', 'event': {'type': 'message_start', 'message': {'model': model}}})
    for piece in pieces(reply):
        emit({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': piece}}})
    emit({'type': 'stream_event', 'event': {'type': 'message_stop'}})
    emit({'type': 'assistant', 'message': {'model': model, 'content': [{'type': 'text', 'text': reply}]}})
    emit({'type': 'result', 'subtype': 'success', 'result': reply, 'session_id': 'demo'}, 0)
