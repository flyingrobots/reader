// An idle chat stream sends a `ping` every `interval` seconds (announced in `hello`) with the
// chat's revision and pending turn ids, so a client can notice a dead server. Its own file so the
// wait (15 s on the reference server) overlaps the rest of the suite.
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertShape, makeVault, startServer} from './harness.mjs';

let vault, server;

before(async () => {
  vault = makeVault();
  server = await startServer(vault);
});

after(async () => {
  await server?.stop();
  vault?.cleanup();
});

test('GET /api/chat/stream: an idle stream pings with revision, pending and interval', async () => {
  const chat = (await server.post('/api/chat', {action: 'create', path: 'library/walden/thoreau/solitude.md', request_id: randomUUID()})).json.chat;
  const stream = await server.stream('/api/chat/stream', {id: chat.id});
  try {
    const hello = await stream.next('hello');
    const interval = hello.json.interval;
    assert.ok(interval > 0 && interval <= 60, `interval ${interval}`);
    const opened = Date.now();
    const ping = await stream.next('ping', (interval + 10) * 1000);
    const waited = (Date.now() - opened) / 1000;
    assert.ok(waited >= interval * 0.8, `pinged after ${waited} s, expected about ${interval} s`);
    assert.deepEqual(ping.json, {revision: chat.revision, pending: [], interval});
    assertShape('sse-ping', ping.json);
  } finally {
    stream.close();
  }
});
