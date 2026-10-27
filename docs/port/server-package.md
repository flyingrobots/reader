# Server port: the TypeScript package

`server/` is the npm package that the TypeScript port grows into ([plan](plan.md)). Today it holds two
things: a `reader-ts --version` entry point that proves a packed install works, and the lock adapter that
TypeScript code will use to share vault locks with the Python server. Nothing runs it in production yet,
and the Python server, CLI and MCP are unchanged.

## Layout and commands

| Path | Contents |
| - | - |
| `server/src/` | TypeScript sources: `cli.ts` (the `reader-ts` bin) and `lock.ts` (the lock adapter) |
| `server/dist/` | Compiled JavaScript and `.d.ts` files. Ignored by Git; this, with `package.json`, is all the tarball ships |
| `server/test/` | `node:test` suites: `pack.test.mjs` and `lock.test.mjs`, with Python and Node fixtures in `fixtures/` |

```sh
npm run test:server              # from the repository root: npm ci, type-check, build, test
npm --prefix server run check    # tsc --noEmit with the strict tsconfig
npm --prefix server run build    # tsc to server/dist
npm --prefix server pack         # runs the build (prepack), then writes reader-library-<version>.tgz
```

CI runs the same check and tests in the Node worker of `scripts/check_container.py`
([bounded validation](../separate-vault.md#bounded-validation)).

## Packaging

- **Compiled output is what ships.** Node refuses to strip types from files under `node_modules`, and a
  published package should not depend on a runtime TypeScript feature, so the package publishes `dist/`
  built by `tsc` (TypeScript 7, `module: nodenext`, `strict` plus `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`). Development and tests run the compiled files too.
- **The packed artifact is tested.** `pack.test.mjs` runs `npm pack`, installs the tarball with
  `--offline --ignore-scripts` into a fresh directory under `TMPDIR` (asserted to be outside the checkout),
  runs `node_modules/.bin/reader-ts --version` there and imports `reader-library/lock`. It also pins the
  tarball's file list, so a stray source or test file fails the test.
- **Not publishable yet.** `package.json` is `"private": true` and the name `reader-library` is provisional
  (plan decision 5). The package has no runtime dependencies.
- **Node versions.** Node 26 is the target. `engines` says `>=24`, the types come from `@types/node` 24 so
  code cannot use newer APIs by accident, and CI runs the tests on Node 24 (`node:24.18.0`). The lock
  adapter needs nothing beyond Node 24.

## Locking

Python takes `.reader/annotations.lock` (and the other `.reader/*.lock` files) with `open(path, 'a')` and
`fcntl.flock(fd, LOCK_EX)`. A flock belongs to the open file description, so the kernel drops it when the
last descriptor closes, including when the holder is killed. TypeScript must take the same lock on the
same file.

`server/src/lock.ts` exposes a small interface, `LockAdapter.acquireExclusive(path, { timeoutMs })`, which
resolves to a `HeldLock` with an idempotent `release()`. Without `timeoutMs` it waits like Python's
blocking flock; `0` tries once (`LOCK_NB`); a positive value waits at most that long. A refused try or an
expired wait rejects with `LockTimeoutError` (`code: 'LOCK_TIMEOUT'`). Timers are injectable, so tests
expire a wait on a controlled clock.

The implementation opens the file in Node (mode `'a'`, as Python does) and passes that descriptor as fd 3
to a short-lived system helper, which calls flock(2) on it and exits:

| Platform | Helper | Blocking | Try once (busy status) |
| - | - | - | - |
| macOS, FreeBSD | `/usr/bin/lockf` (base system) | `lockf -s 3` | `lockf -s -t 0 3` (75) |
| Linux | `flock` from util-linux | `flock -x 3` | `flock -x -n 3` (1) |

The lock is then held by Node's own descriptor, exactly like Python's: `release()` closes it, and if the
Node process dies the kernel releases it. Waiting happens in the helper, so the event loop is never
blocked. On a timeout the helper is killed and the descriptor closed, which also drops a lock the helper
took just before the kill. If Node dies while a helper is still waiting, the helper takes the lock on a
descriptor only it holds and exits at once, so nothing stays locked. An uncontended acquire and release
costs about 1 to 3 ms (one process spawn), measured on Apple silicon.

Why not the alternatives:

- **`node:ffi` calling `flock` in libc:** experimental, documented as unsafe, missing from Node 24, and
  disabled under the permission model unless `--allow-ffi` is passed. A blocking `flock` would also block the
  event loop, so waiting would need `LOCK_NB` polling (sleeps, unfair under contention) or a worker thread.
- **`lockf(1)` or `flock(1)` holding the lock while running a child command:** the lock would belong to
  the helper process instead of Node, so releasing and crash cleanup would depend on pipe shutdown.
- **A bundled native helper (for example a small Rust `reader-lock`):** a per-platform binary to build
  and ship, for no gain while the system helpers exist. It stays the fallback if spawn cost shows up on a
  hot write path.

The adapter is replaceable: callers depend only on `LockAdapter`, and `helperLockAdapter({ helper })`
accepts any program with the same fd-3 contract.

`lock.test.mjs` runs the real Python `fcntl.flock` (stdlib only; `READER_PYTHON` overrides `python3`)
against the adapter. It covers each side refusing a try and waiting for the other's release, a SIGKILLed
Python holder and a SIGKILLed TypeScript holder each freeing the lock, and 160 increments of a shared
counter from two Python and two Node processes with none lost. Every check that waits does so on a
process line or the injected clock, never on a sleep.

**Limits:** Windows is unsupported (Python's `fcntl` is too). Linux needs util-linux `flock` on `PATH`,
which Debian, Ubuntu and Fedora install by default; minimal images may not. flock is unreliable on some
network filesystems, for Python as well.
