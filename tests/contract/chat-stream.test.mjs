// Chat over Server-Sent Events: the event sequence for a voice turn, the four-stream slot limit,
// and that a closed stream frees its slot at once (#152). The demo's voices are scripted (no AI).
import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {assertShape, makeVault, readJson, sleep, startServer, until} from './harness.mjs';

const DOC = 'library/walden/thoreau/solitude.md';
let vault, server, chat;

before(async () => {
  vault = makeVault();
  server = await startServer(vault);
  const created = await server.post('/api/chat', {action: 'create', path: DOC, request_id: randomUUID()});
  assert.equal(created.status, 200, created.text);
  assertShape('chat-created', created.json);
  chat = created.json.chat;
});

after(async () => {
  await server?.stop();
  vault?.cleanup();
});

describe('chat state on disk', () => {
  test('POST /api/chat create writes chats/<id>.json', () => {
    const file = `chats/${chat.id}.json`;
    assert.ok(existsSync(join(vault.root, file)));
    const stored = readJson(vault.root, file);
    assert.equal(stored.document_path, DOC);
    assertShape('file-chat-new', stored);
  });
  test('POST /api/chat refuses an unknown action and an unknown chat', async () => {
    assert.equal((await server.post('/api/chat', {action: 'shout', id: chat.id})).status, 400);
    assert.equal((await server.post('/api/chat', {action: 'send', id: randomUUID(), body: 'Hello', request_id: randomUUID()})).status, 400);
  });
});

describe('GET /api/chat/stream', () => {
  test('a voice turn streams hello, then the posted message, deltas, the reply and done', async () => {
    const stream = await server.stream('/api/chat/stream', {id: chat.id});
    try {
      assert.equal(stream.status, 200);
      assert.match(stream.headers['content-type'], /^text\/event-stream/);
      assert.equal(stream.headers['cache-control'], 'no-store');
      const hello = await stream.next('hello');
      assert.equal(hello.json.chat_id, chat.id);
      assert.ok(Number.isInteger(hello.json.seq) && Number.isFinite(hello.json.interval));
      assertShape('sse-hello', hello.json);
      const sent = await server.post('/api/chat', {action: 'send', id: chat.id, body: '@archivist what does this chapter keep?', request_id: randomUUID()});
      assert.equal(sent.status, 200, sent.text);
      // The pending turn races the runner (queued or already running), so pin the chat and the top-level keys only.
      assertShape('chat-sent', {chat: sent.json.chat, keys: Object.keys(sent.json).sort()});
      const mine = await stream.next('posted');
      assert.equal(mine.json.message.author, 'You');
      assert.deepEqual(mine.json.message.routing.voices, ['Archivist']);
      const began = await stream.next('started', 30000);
      assert.equal(began.json.voice, 'Archivist');
      const done = await stream.next(e => e.event === 'done' && e.json?.turn_id === began.json.turn_id, 30000);
      assert.equal(done.json.message.author, 'Archivist');
      await stream.next(e => e.event === 'commit' && Number(e.id) > Number(done.id), 30000);
      const kinds = stream.events.map(e => e.event);
      const at = kind => kinds.indexOf(kind);
      assert.ok(at('posted') < at('started') && at('started') < at('delta') && at('delta') < at('done'), kinds.join(','));
      const seqs = stream.events.filter(e => e.id).map(e => Number(e.id));
      assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'event ids increase');
      for (const kind of ['posted', 'state', 'started', 'raw', 'delta', 'done', 'commit']) {
        assertShape('sse-' + kind, stream.events.find(e => e.event === kind).json);
      }
      // Listening voices may chime in; wait for every pending turn to finish before closing.
      await until(async () => (await server.get('/api/chat', {id: chat.id})).json.pending.length === 0, 30000, 200);
      // The finished turn is on disk.
      const stored = readJson(vault.root, `chats/${chat.id}.json`);
      assert.ok(stored.messages.some(m => m.author === 'Archivist'));
      assertShape('file-chat', stored);
    } finally {
      stream.close();
    }
  });
  test('an unknown chat id is a 400 and a foreign Host a 403', async () => {
    const unknown = await server.get('/api/chat/stream', {id: randomUUID()});
    assert.equal(unknown.status, 400);
    const foreign = await server.raw('GET', `/api/chat/stream?id=${chat.id}`, {headers: {Host: 'untrusted.example'}});
    assert.equal(foreign.status, 403);
  });
  test('at most four streams are open; a fifth is a 429 and a closed stream frees its slot at once (#152)', async () => {
    await sleep(600);  // let the server notice the earlier tests' streams hanging up
    const streams = [];
    try {
      for (let i = 0; i < 4; i++) {
        const s = await server.stream('/api/chat/stream', {id: chat.id});
        assert.equal(s.status, 200);
        await s.next('hello');
        streams.push(s);
      }
      const fifth = await server.get('/api/chat/stream', {id: chat.id});
      assert.equal(fifth.status, 429);
      assertShape('error', fifth.json);
      // Ordinary reads are outside the stream pool.
      assert.equal((await server.get('/api/chat', {id: chat.id})).status, 200);
      streams.shift().close();
      const started = Date.now();
      const reopened = await until(async () => {
        const s = await server.stream('/api/chat/stream', {id: chat.id});
        if (s.status === 200) return s;
        s.close();
        return null;
      }, 3000, 50);
      streams.push(reopened);
      assert.ok(Date.now() - started < 2000, `slot freed after ${Date.now() - started} ms, well before the heartbeat`);
    } finally {
      for (const s of streams) s.close();
    }
    await sleep(500);
  });
});
