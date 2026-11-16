// Canaries for the enforced test sandbox (scripts/test_jail.py, #247), from Node: a protected path cannot be read,
// the live Reader port cannot be reached, and loopback still works. Refusals must be permission errors; a refused
// connection or a missing file would pass even without the sandbox.
import './jail_guard.cjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closeSync, openSync} from 'node:fs';
import {createConnection, createServer} from 'node:net';

const jailed = process.env.READER_TEST_JAIL === 'sandbox-exec';
const listed = (name) => JSON.parse(process.env['READER_TEST_JAIL_' + name] || '[]');
const REFUSED = new Set(['EPERM', 'EACCES']);

function connect(port) {
  return new Promise((resolve) => {
    const socket = createConnection({host: '127.0.0.1', port});
    socket.once('connect', () => { socket.destroy(); resolve('connected'); });
    socket.once('error', (error) => resolve(error.code));
  });
}

test('protected paths cannot be read from Node', {skip: !jailed}, () => {
  // The runner records which protected paths exist; inside the sandbox even that check is refused.
  const existing = listed('PROTECTED_EXISTING');
  assert.ok(existing.length > 0, 'no protected path exists on this machine; nothing was checked');
  // Opening read-only works for files and directories alike.
  for (const path of existing) assert.throws(() => closeSync(openSync(path, 'r')), (error) => REFUSED.has(error.code), path);
});

test('the live Reader port cannot be reached from Node', {skip: !jailed}, async () => {
  assert.ok(listed('PORTS').includes(8766));
  for (const port of listed('PORTS')) assert.ok(REFUSED.has(await connect(port)), `port ${port}`);
});

test('loopback still works from Node', {skip: !jailed}, async () => {
  const server = createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(await connect(server.address().port), 'connected');
  } finally {
    server.close();
  }
});
