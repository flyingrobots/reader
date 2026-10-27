# Touch drag and art long press

2026-10-27. PR #194 follow-up to the Codex review at `379280e`.

## Finding and change

A touch drag in expanded Focus could open the art prompt because pointer capture
keeps the pointer on the canvas, and movement did not cancel its 550 ms long-press
timer. The prompt handler now tracks the initial touch and cancels the timer when
that pointer moves more than 10 CSS pixels. Ending, cancelling or leaving the
gesture also clears the origin. Slight finger jitter still permits a long press.

## Executed evidence

- RED: `web_art_touch.cjs` uses real Chromium touch events through CDP on a
  synthetic phone-sized Reader vault. At parent `379280e`, a continuous drag past
  the long-press delay opened the card: expected zero visible cards, observed one.
  The `cover-touch-red` run failed at that exact assertion, not fixture setup.
- GREEN: the same test passed after the handler change, including a subsequent
  stationary long press with a 4-by-3-pixel jitter and nested Escape behavior.
- The existing `web_art_prompt.cjs` and `web_art_focus.cjs` suites also passed.
  The three-suite validation batch `cover-touch-green` exited zero in 65.7 seconds.
  Logs and screenshots were exported before worker cleanup.

Tests ran in the reused, copy-isolated `reader-node-checks` Docker worker under
the workstation heavy-work and worker reservations: read-only root, no mounts,
3 GiB `/work` plus 512 MiB `/tmp` tmpfs, 4 CPUs, 6 GiB RAM, 600-second
watchdog, 8 MiB per-run log cap. The batch used about 534 MiB in `/work` and
2.6 MiB in `/tmp`; its log was 13,122 bytes. No real model or repository job was
started by the browser tests. No additional dependencies or controls bundle
rebuild is needed for this directly served JavaScript handler.
