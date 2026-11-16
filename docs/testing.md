# Running tests in the sandbox

Every test command runs through `scripts/test_jail.py`, which starts it inside a sandbox the operating system
enforces. Fixtures already use synthetic vaults and fake model CLIs, but that is a convention a test can break by
mistake. The sandbox makes it impossible: no test, and no process a test starts, can read or change a live Reader on
the same machine.

```sh
python3 scripts/test_jail.py -- .venv/bin/python -m pytest -q
python3 scripts/test_jail.py -- .venv/bin/python -m pytest -q tests/test_web.py
python3 scripts/test_jail.py -- node --test tests/*.test.mjs
python3 scripts/test_jail.py -- python3 scripts/run_browser_suites.py
python3 scripts/test_jail.py -- npm run test:contract
python3 scripts/test_jail.py -- npm run test:server
```

Run the installs (`uv sync`, `npm ci`, `npm run build` in `web/`, `npm --prefix server ci`, and `python3 scripts/fetch_private_bridge.py`)
outside the sandbox first; they write caches in your home folder or need the network, which the sandbox refuses. The
last one downloads the private shelf's pinned packages into `.reader/npm-cache`, so `tests/web_private.cjs` installs
the real encrypted storage with `npm ci` offline; npm checks each package against the bridge's lockfile.

Tests refuse to run any other way. Every entry point loads a guard first (`tests/jail_guard.py` through
`tests/conftest.py`, `tests/web_fixture.py` and `scripts/run_browser_suites.py`; `tests/jail_guard.cjs` at the top of
every browser suite, Node test, contract harness, `server/` test and Obsidian plugin test), and exits with the command
to use instead. Setting the runner's variables by hand does not get past it: the guard writes to the runner's probe
directory, which only the sandbox refuses, so a successful write means no sandbox. `tests/test_jail_guard.py` finds
every entry file the way the runners do and fails when one lacks the guard, so a new suite cannot skip it.

## What the sandbox allows

On macOS the runner writes a `sandbox-exec` profile for each run. Child processes inherit it.

| | Allowed | Refused |
| - | - | - |
| Writes | this checkout; a fresh run directory under `/tmp` (outside any checkout, so temporary vaults never sit inside a Git repository); `/dev`; the per-user system temporary folders | everything else, including your real home folder |
| Reads | everything not refused | the live vault and live service checkout (from the Reader service record, `~/Library/Application Support/Reader/service.json`, and `READER_ROOT`); Reader's service state and logs; the speech daemon's folder; `~/.ssh`; Codex, Claude, Gemini and agy configuration; `~/.config/gh`; the git-locks store (from `GIT_LOCKS_STORE` and the service record) |
| Network | loopback | every other host; the live Reader port (from the service record, default 8766); LM Studio (1234) and Ollama (11434); the speech daemon socket |
| Programs | everything not refused | the real `claude`, `codex`, `agy`, `lms`, `ollama`, `gemini` and `git-locks`; tests use fakes |

The run directory becomes `HOME`, `TMPDIR`, `READER_HOME` and `READER_TEST_SOCKET_ROOT`. Playwright keeps using its installed browsers
(`PLAYWRIGHT_BROWSERS_PATH`), and `node`, `npm` and `python3` resolve to real binaries, because version-manager shims
cannot find their configuration once `HOME` moves. `READER_ROOT` is removed.

The runner refuses to start when the checkout overlaps a protected path, or when the service record exists but cannot
be read: the live vault would then be unknown.

## Limits

- The run directory is removed afterwards (`--keep` keeps it) and the run is stopped if it grows past 4 GiB.
  `--timeout SECONDS` stops the whole run, with its children, after a deadline.
- `--protect PATH` and `--deny-port N` add to what is refused; `--print-profile` shows the profile without running.
- macOS cannot nest sandboxes. Code that is already inside the test sandbox, such as the service updater's smoke step
  when the service tests run it, detects that (the process is sandboxed and the sandbox's probe refuses a write) and
  relies on the outer sandbox.
- Linux: the runner only accepts a container marked `READER_TEST_JAIL=container` with `/.dockerenv` or
  `/run/.containerenv`, and runs the command unchanged there. CI's workers (`scripts/check_container.py`) run in such
  containers, with no host mounts, and set the marker.
- The Obsidian plugin's `plugins/reader/tests/live/` scripts are not tests: they are manual acceptance checks, run from a
  real vault against a running Obsidian, and are outside the guard by design.

## The service updater's smoke step

Before deploying a commit, `scripts/reader_service.py` smoke-tests it in a temporary worktree. Both the candidate's
`tests/test_web.py` and its fixture server run inside this sandbox, built from the updater's own copy of
`scripts/test_jail.py`, so an older candidate commit is sandboxed as well. The smoke result records it as the first step
(`{"step": "sandbox", "detail": "sandbox-exec"}`), which also appears in `~/Library/Logs/Reader/updates.jsonl`.

## Checking the sandbox

`tests/test_jail_canaries.py` and `tests/jail_canary.test.mjs` try each refused action and require a permission error,
not some other failure: a refused connection or a missing file would also fail, and would pass without the sandbox.
Positive controls show loopback and the run directory still work. `tests/test_test_jail.py` covers the runner's
refusals. Outside the sandbox the guard stops them before they run.

To show a rule matters, build a profile without it and run the canaries; exactly the matching canary fails. Do this
from a scratch script that calls `prepare()` and `command_for()`; the runner has no option to weaken itself.

## When a test is refused

`Operation not permitted` from a test usually means it reached for something outside its fixture: a path in your real
home folder, a fixed port, or an installed CLI. Fix the test to use its temporary directory, port 0 or a fake. Add a
path to the profile only when the test legitimately needs a read-only system resource, and say why in the change.
