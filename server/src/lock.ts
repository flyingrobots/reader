// Exclusive vault locks that interoperate with Python's `fcntl.flock`.
//
// Python takes `.reader/annotations.lock` (and the other `.reader/*.lock` files) with
// `open(path, 'a')` followed by `fcntl.flock(fd, LOCK_EX)`. A flock belongs to the open
// file description, so the kernel drops it when the last descriptor closes, including when
// the holder is killed. This module gives TypeScript the same lock: Node opens the file
// itself, and a short-lived system helper (`lockf(1)` on macOS and FreeBSD, `flock(1)` on
// Linux) receives that descriptor as fd 3, calls flock(2) on it and exits. The lock then
// stays with Node's descriptor until `release()` closes it or the process dies. Waiting
// happens in the helper, so the event loop never blocks. See docs/port/server-package.md.
import { spawn } from 'node:child_process';
import { open, type FileHandle } from 'node:fs/promises';

export interface HeldLock {
  readonly path: string;
  /** Drops the lock by closing the descriptor. Safe to call more than once. */
  release(): Promise<void>;
}

export interface LockOptions {
  /**
   * Omitted: wait until the lock is free, like Python's blocking `fcntl.flock`.
   * 0: try once and fail at once if another process holds it (`LOCK_NB`).
   * Positive: wait at most this many milliseconds.
   */
  timeoutMs?: number;
}

/** The small surface the server depends on, so the mechanism stays replaceable. */
export interface LockAdapter {
  readonly mechanism: string;
  acquireExclusive(path: string, options?: LockOptions): Promise<HeldLock>;
}

export class LockTimeoutError extends Error {
  readonly code = 'LOCK_TIMEOUT';
  constructor(readonly path: string, readonly timeoutMs: number) {
    super(timeoutMs === 0 ? `lock is held by another process: ${path}` : `timed out after ${timeoutMs} ms waiting for lock: ${path}`);
    this.name = 'LockTimeoutError';
  }
}

/** Timers are injected so tests control time instead of sleeping. */
export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const systemTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A program that flocks the descriptor it inherits as fd 3, then exits. */
export interface FlockHelper {
  readonly command: string;
  /** Arguments for a blocking (`wait`) or non-blocking (`try`) exclusive lock on fd 3. */
  args(mode: 'wait' | 'try'): readonly string[];
  /** Exit statuses that mean "held by someone else" in `try` mode. */
  readonly busyStatuses: readonly number[];
}

export function platformFlockHelper(platform: NodeJS.Platform = process.platform): FlockHelper {
  if (platform === 'darwin' || platform === 'freebsd') {
    // BSD lockf(1) with a bare descriptor flocks it and exits; -t 0 fails with EX_TEMPFAIL.
    return { command: '/usr/bin/lockf', args: (mode) => (mode === 'try' ? ['-s', '-t', '0', '3'] : ['-s', '3']), busyStatuses: [75] };
  }
  if (platform === 'linux') {
    // util-linux flock(1) with a bare descriptor; -n fails with status 1.
    return { command: 'flock', args: (mode) => (mode === 'try' ? ['-x', '-n', '3'] : ['-x', '3']), busyStatuses: [1] };
  }
  throw new Error(`no flock helper is known for platform ${platform}`);
}

interface HelperOptions {
  helper?: FlockHelper;
  timers?: Timers;
}

export function helperLockAdapter(options: HelperOptions = {}): LockAdapter {
  const helper = options.helper ?? platformFlockHelper();
  const timers = options.timers ?? systemTimers;
  return {
    mechanism: `flock(2) via ${helper.command}`,
    async acquireExclusive(path, lockOptions = {}) {
      const { timeoutMs } = lockOptions;
      if (timeoutMs !== undefined && !(Number.isFinite(timeoutMs) && timeoutMs >= 0)) {
        throw new RangeError('timeoutMs must be a finite number >= 0');
      }
      // Same open mode as Python's `open(path, 'a')`: create if missing, never truncate.
      const handle = await open(path, 'a');
      try {
        await flockDescriptor(handle, path, helper, timers, timeoutMs);
      } catch (error) {
        // Closing also drops a lock the helper may have taken just before a timeout.
        await handle.close();
        throw error;
      }
      let released: Promise<void> | undefined;
      return { path, release: () => (released ??= handle.close()) };
    },
  };
}

function flockDescriptor(handle: FileHandle, path: string, helper: FlockHelper, timers: Timers, timeoutMs: number | undefined): Promise<void> {
  const mode = timeoutMs === 0 ? 'try' : 'wait';
  return new Promise((resolve, reject) => {
    const child = spawn(helper.command, helper.args(mode), { stdio: ['ignore', 'ignore', 'pipe', handle.fd] });
    let stderr = '';
    let timedOut = false;
    let timer: unknown;
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk;
    });
    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = timers.set(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
    }
    child.once('error', (error) => {
      if (timer !== undefined) timers.clear(timer);
      reject(new Error(`cannot run the flock helper ${helper.command}: ${error.message}`, { cause: error }));
    });
    // `close` fires after the helper has exited and its copy of the descriptor is gone.
    child.once('close', (status) => {
      if (timer !== undefined) timers.clear(timer);
      if (timedOut) reject(new LockTimeoutError(path, timeoutMs ?? 0));
      else if (status === 0) resolve();
      else if (mode === 'try' && status !== null && helper.busyStatuses.includes(status)) reject(new LockTimeoutError(path, 0));
      else reject(new Error(`flock helper ${helper.command} failed with status ${status}: ${stderr.trim()}`));
    });
  });
}

/** The adapter the server uses unless a test or platform supplies another. */
export function defaultLockAdapter(): LockAdapter {
  return helperLockAdapter();
}
