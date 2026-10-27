// Cross-language flock interop: the TypeScript adapter and Python's fcntl.flock exclude
// each other on one lock file, a SIGKILLed holder frees the lock, and concurrent
// increments from both languages lose nothing. Every assertion can only fail when locking
// is wrong; no step waits on a sleep. Synthetic temp dirs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LockTimeoutError, defaultLockAdapter, helperLockAdapter } from '../dist/lock.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const python = process.env.READER_PYTHON || 'python3';
const locks = defaultLockAdapter();

// Every child is killed when its test ends, so a locking failure fails fast instead of hanging.
const live = new Set();
test.afterEach(() => {
  for (const child of live) child.kill('SIGKILL');
  live.clear();
});

function run(command, args) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  live.add(child);
  child.once('exit', () => live.delete(child));
  const lines = [];
  const waiters = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return {
    child,
    exited,
    line: () => (lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve) => waiters.push(resolve))),
  };
}
const py = (...args) => run(python, [join(fixtures, 'py_lock.py'), ...args]);
const ts = (...args) => run(process.execPath, [join(fixtures, 'ts_lock.mjs'), ...args]);
const tracked = (promise) => {
  const state = { settled: false, promise };
  promise.then(() => (state.settled = true), () => (state.settled = true));
  return state;
};

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'reader-lock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { lock: join(dir, 'annotations.lock'), log: join(dir, 'order.log'), counter: join(dir, 'counter') };
}
const order = async (log) => (await readFile(log, 'utf8')).trim().split('\n');

test('Python holds: TypeScript refuses a try, and a blocking acquire waits for the release', async (t) => {
  const { lock, log } = await scratch(t);
  const holder = py('hold', lock, log);
  assert.equal(await holder.line(), 'locked');
  const waiting = tracked(locks.acquireExclusive(lock));
  await assert.rejects(locks.acquireExclusive(lock, { timeoutMs: 0 }), LockTimeoutError);
  assert.equal(waiting.settled, false, 'acquired while Python held the lock');
  holder.child.stdin.end('release\n');
  const held = await waiting.promise;
  await writeFile(log, 'ts-acquired\n', { flag: 'a' });
  await held.release();
  assert.deepEqual(await order(log), ['py-release', 'ts-acquired']);
  assert.deepEqual(await holder.exited, { code: 0, signal: null });
});

test('TypeScript holds: Python refuses a try, and a blocking flock waits for the release', async (t) => {
  const { lock, log } = await scratch(t);
  const held = await locks.acquireExclusive(lock);
  const probe = py('try', lock);
  assert.equal(await probe.line(), 'busy');
  const waiter = py('wait', lock, log);
  assert.equal(await waiter.line(), 'waiting');
  const acquired = tracked(waiter.line());
  assert.equal((await py('try', lock).line()), 'busy');
  assert.equal(acquired.settled, false, 'Python acquired while TypeScript held the lock');
  await writeFile(log, 'ts-release\n', { flag: 'a' });
  await held.release();
  await held.release(); // idempotent
  assert.equal(await acquired.promise, 'locked');
  assert.deepEqual(await order(log), ['ts-release', 'py-acquired']);
});

test('a SIGKILLed Python holder frees the lock for TypeScript', async (t) => {
  const { lock, log } = await scratch(t);
  const holder = py('hold', lock, log);
  assert.equal(await holder.line(), 'locked');
  const waiting = tracked(locks.acquireExclusive(lock));
  await assert.rejects(locks.acquireExclusive(lock, { timeoutMs: 0 }), LockTimeoutError);
  assert.equal(waiting.settled, false);
  holder.child.kill('SIGKILL');
  assert.equal((await holder.exited).signal, 'SIGKILL');
  const held = await waiting.promise;
  await held.release();
  assert.ok((await stat(lock)).isFile(), 'the lock file must survive (never unlinked)');
});

test('a SIGKILLed TypeScript holder frees the lock for Python', async (t) => {
  const { lock, log } = await scratch(t);
  const holder = ts('hold', lock);
  assert.equal(await holder.line(), 'locked');
  assert.equal(await py('try', lock).line(), 'busy');
  const waiter = py('wait', lock, log);
  assert.equal(await waiter.line(), 'waiting');
  const acquired = tracked(waiter.line());
  assert.equal(await py('try', lock).line(), 'busy');
  assert.equal(acquired.settled, false, 'Python acquired while the TypeScript holder lived');
  holder.child.kill('SIGKILL');
  assert.equal((await holder.exited).signal, 'SIGKILL');
  assert.equal(await acquired.promise, 'locked');
  assert.deepEqual(await waiter.exited, { code: 0, signal: null });
});

test('concurrent increments from both languages lose no updates', async (t) => {
  const { lock, counter } = await scratch(t);
  await writeFile(counter, '0');
  const each = 40;
  const workers = [py('count', lock, counter, String(each)), py('count', lock, counter, String(each)),
    ts('count', lock, counter, String(each)), ts('count', lock, counter, String(each))];
  for (const worker of workers) assert.equal(await worker.line(), 'done');
  for (const worker of workers) assert.deepEqual(await worker.exited, { code: 0, signal: null });
  assert.equal(Number(await readFile(counter, 'utf8')), workers.length * each);
});

test('a bounded wait times out on the injected clock and leaves nothing held', async (t) => {
  const { lock, log } = await scratch(t);
  let fire;
  let armed;
  const timerArmed = new Promise((resolve) => (armed = resolve));
  const timers = { set: (callback, ms) => { fire = callback; armed(ms); return 1; }, clear: () => { fire = undefined; } };
  const holder = py('hold', lock, log);
  assert.equal(await holder.line(), 'locked');
  const attempt = helperLockAdapter({ timers }).acquireExclusive(lock, { timeoutMs: 5000 });
  assert.equal(await timerArmed, 5000);
  fire();
  const error = await attempt.then(() => assert.fail('acquired a held lock'), (e) => e);
  assert.ok(error instanceof LockTimeoutError);
  assert.equal(error.timeoutMs, 5000);
  holder.child.stdin.end('release\n');
  await holder.exited;
  // Nothing of the timed-out attempt lingers: Python takes the lock without waiting.
  assert.equal(await py('try', lock).line(), 'locked');
});

test('a successful bounded acquire clears its timer', async (t) => {
  const { lock } = await scratch(t);
  let cleared = 0;
  const timers = { set: () => 7, clear: (handle) => { assert.equal(handle, 7); cleared++; } };
  const held = await helperLockAdapter({ timers }).acquireExclusive(lock, { timeoutMs: 1000 });
  assert.equal(cleared, 1);
  await held.release();
});

test('invalid timeouts and a missing helper are reported', async (t) => {
  const { lock } = await scratch(t);
  await assert.rejects(locks.acquireExclusive(lock, { timeoutMs: -1 }), RangeError);
  await assert.rejects(locks.acquireExclusive(lock, { timeoutMs: Number.NaN }), RangeError);
  const missing = helperLockAdapter({ helper: { command: join(fixtures, 'no-such-helper'), args: () => ['3'], busyStatuses: [] } });
  await assert.rejects(missing.acquireExclusive(lock), /cannot run the flock helper/);
  assert.equal(await py('try', lock).line(), 'locked');
});
