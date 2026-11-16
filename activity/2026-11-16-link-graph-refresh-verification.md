# Link graph refresh verification

[Issue #230](https://github.com/flyingrobots/reader/issues/230) has one remaining assertion gap: the refresh result check accepted **10 documents read** when the synthetic fixture required zero. [PR #263](https://github.com/flyingrobots/reader/pull/263) makes the toast's result description an exact comparison. Production behavior and the other browser checks are unchanged.

This verification began at main `9eda839` with plan commit `6a7ab4d` on 2026-11-16. The accepted issue body has SHA-256 `4f5407eb54d97e71c69254d32311eb2c875f9a21a153e8ef51b2cbf2796ec0ed`. The original concatenated card-text assertion had already been replaced by `71f0041`, and `48b8648` subsequently made the inspector's link count exact.

## Observed failure and repair

The complete `tests/web_links.cjs` suite passed on current main, reaching its final Link graph refresh. That alone did not establish the issue's negative-control requirement. A temporary route at `/api/maintenance` fetched the real response and changed only the completed, non-quiet Link graph job's `result.parsed` from 0 to 10. The whole suite still passed: its unanchored `/0 documents read, 20 links, 1 unresolved/` matched the trailing zero of `10 documents read`. The expected-rejection check therefore failed.

The repaired assertion at `tests/web_links.cjs:125` compares only the toast's `[data-description]` text with `0 documents read, 20 links, 1 unresolved.`. The same wrong response now fails with the explicit expected/actual count difference. The real response passes. This retains the separate card identity, current state, inspector count, usable Refresh and successful-completion checks, without matching the card's entire presentation string.

## Acceptance calibration

Each temporary control ran through the complete suite with synthetic files. Changes were restored byte-for-byte after each run.

| Deliberate fault | Observed failure after the repair |
| --- | --- |
| Remove the Refresh button before clicking | The `[data-job=links]` click cannot find the control. |
| Disable the Refresh button before clicking | The click waits for an enabled control and fails. |
| Change the completed job to failed with an error | No **Link graph finished** toast arrives. |
| Change documents read to 10 | Exact result assertion reports 10 versus 0. |
| Change links to 21 | Exact result assertion reports 21 versus 20. |
| Change unresolved to 2 | Exact result assertion reports 2 versus 1. |

The count and job-state controls modified the real HTTP response at the browser boundary; the two control-availability cases changed the rendered DOM. They did not change an expected value to manufacture a failure. The fixture remains `tests/web_fixture.py:224`; no production UI or fixture changes were needed.

```sh
python3 scripts/test_jail.py --timeout 120 -- node tests/web_links.cjs
```

The complete normal suite passed after the assertion repair, including navigation, previews, fragments, layout, local-resource checks and the final refresh result. It also exercises the article/footer placement discussed in #166. Tests used Node v26.13.1, Python 3.14.7, installed Chrome and the macOS test sandbox. No private vault was accessed and no deployment occurred. Browser validation is local; the existing CI separately checks Python, contracts, Node and the frontend build. Exact-head CI and review remain live PR gates.

Ten further complete-suite runs passed in parallel pairs. This imperative browser script has no test-runner ordering interface, so its internal order was unchanged; the repetitions were not shuffled. Each run used its own sandbox and synthetic fixture.

System documentation requires no update because this change strengthens an existing test oracle. This verification record is agent-written and has not received human editorial review.
