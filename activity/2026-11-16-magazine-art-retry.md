# Magazine art refusal recovery verification

[PR #262](https://github.com/flyingrobots/reader/pull/262) fixes [#149](https://github.com/flyingrobots/reader/issues/149): a refused magazine cover-art commission reports its reason and restores the same button for a retry without reloading. The accepted issue body has SHA-256 `280586eb7e9a2a08432e0deb96227c5dabda26cd7e0d6c4231a35219ab112982`. The initial plan commit was `66f8f42`, based on main `ad2ba43`.

## Decision

`commissionArt` already caught API errors and displayed a toast, but its caller could not distinguish a refusal from a queued job. `MakeArt` set its local pending flag before calling the action and never cleared it. The button therefore remained disabled after a refusal even though no job existed.

The action now returns whether it queued a job (`src/reader_mcp/web_ui/app.mjs:347`). `MakeArt` awaits that outcome and clears its pending state when no job was queued (`web/src/magazine/magazine.tsx:69`). An accepted commission keeps the pending label and disabled state. Existing article callers can ignore the result; the action retains its error reporting. This leaves ownership and generation policy unchanged and avoids replacing the issue or forcing a reload merely to recover one control.

## RED and GREEN

All four cases in `tests/web_magazine_art_retry.cjs` failed on unchanged production code at `66f8f42`: the refusal toast appeared, but the button never became enabled. After the fix, all four passed:

- Synthetic HTTP 400, 409 and 429 refusals each restore the original button and its **Make cover art** label, then accept a real successful retry.
- The real synthetic fixture's art-owner refusal returns HTTP 409 and restores the control after its reason appears.

Each case creates a separate synthetic fixture and browser context. Successful retries reach the real server and fake voice; the test holds the job-poll response at queued only until it checks the pending button, then waits for the real job to finish. The test uses observable conditions, without arbitrary sleeps.

```sh
python3 scripts/test_jail.py --timeout 90 -- node --test tests/web_magazine_art_retry.cjs
python3 scripts/test_jail.py --timeout 120 -- node tests/web_art.cjs
python3 scripts/test_jail.py --timeout 120 -- node tests/web_art_owner.cjs
python3 scripts/test_jail.py --timeout 120 -- node tests/web_magazine.cjs
python3 scripts/test_jail.py --timeout 60 -- .venv/bin/python -m pytest -q tests/test_controls_bundle.py tests/test_ui_debt.py tests/test_jail_guard.py
npm --prefix web run check
npm --prefix web run build
```

The existing art, art-owner and magazine browser suites passed. The bundle, UI debt and jail-guard selection passed all nine tests. Type checking and the normal frontend build passed; the generated JavaScript grew by 45 bytes and its source/hash manifest was regenerated.

Three temporary production mutations calibrated the additional assertions: reporting a successful submission as unqueued failed the disabled-state assertion; replacing the button failed the element-identity assertion; changing the restored label failed the label assertion. Source and generated bundle hashes were restored exactly afterward.

Ten further runs passed all four cases, in parallel pairs with randomized test ordering. Seeds were 14901–14909 and the externally generated seed 22857733. A replay command is:

```sh
python3 scripts/test_jail.py --timeout 90 -- node --test --test-randomize --test-random-seed=22857733 tests/web_magazine_art_retry.cjs
```

These checks used Node v26.13.1, Python 3.14.7, installed Chrome and the macOS test sandbox. They used synthetic files and did not deploy Reader or access a private vault. Browser cases run through the local browser runner; the existing CI workflow separately checks Python, contracts, Node and the frontend build. Exact-head CI and review remain live PR gates. The documentation is agent-written and has not received human editorial review.
