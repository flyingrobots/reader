import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpeechClient, speechAllowed } from '../src/tts.ts';
test('speech admission respects holds, interruptions, and unavailable admission', () => {
  assert(speechAllowed({ok:true,accepting_speech:true}));
  for (const state of [{playback_held:true},{interruption:{}},{accepting_speech:false}]) assert(!speechAllowed({ok:true,accepting_speech:true,...state}));
});
test('socket client handles split responses, daemon refusal, and shutdown', async () => {
  const dir = await mkdtemp(join(tmpdir(),'reader-tts-')), path = join(dir,'test.sock');
  const server = createServer(socket => socket.once('data', data => {
    const request = JSON.parse(data.toString());
    if (request.op === 'reject') socket.end('{"ok":false,"error":{"message":"held"}}\n');
    else { socket.write('{"ok":true,'); setTimeout(()=>socket.end('"voices":["test"]}\n'),5); }
  }));
  await new Promise<void>(resolve=>server.listen(path,resolve));
  const client = new SpeechClient(path);
  try {
    assert.deepEqual(await client.request({op:'voices'}),{ok:true,voices:['test']});
    await assert.rejects(client.request({op:'reject'}),/held/);
    client.dispose(); await assert.rejects(client.request({op:'status'}),/closed/);
  } finally { client.dispose(); await new Promise<void>(resolve=>server.close(()=>resolve())); await rm(dir,{recursive:true,force:true}); }
});
