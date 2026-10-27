// TypeScript side of the lock interop tests, run as its own process against the built adapter.
// usage: ts_lock.mjs hold LOCK                print 'locked', then wait until killed or stdin closes
//        ts_lock.mjs count LOCK COUNTER N     increment COUNTER N times, each under the lock
import { readFile, writeFile } from 'node:fs/promises';
import { defaultLockAdapter } from '../../dist/lock.js';

const [mode, lockPath, counter, times] = process.argv.slice(2);
const locks = defaultLockAdapter();
if (mode === 'hold') {
  await locks.acquireExclusive(lockPath);
  process.stdout.write('locked\n');
  process.stdin.resume();
} else if (mode === 'count') {
  for (let i = 0; i < Number(times); i++) {
    const held = await locks.acquireExclusive(lockPath);
    try {
      const value = Number(await readFile(counter, 'utf8'));
      await writeFile(counter, String(value + 1));
    } finally {
      await held.release();
    }
  }
  process.stdout.write('done\n');
} else {
  process.stderr.write(`unknown mode ${mode}\n`);
  process.exitCode = 2;
}
