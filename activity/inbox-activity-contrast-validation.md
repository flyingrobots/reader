# Inbox activity hierarchy and one elapsed counter

2026-10-27. Visual refinement of Reader Admin's Inbox and its shared activity transcript.

## Change

The transcript header owns elapsed time once it is available. The outer Inbox
counter remains as a loading fallback. Host access remains visible. The run,
message and command surfaces have clearer separation. Running work uses a blue
tone, filed/completed indicators use green, and failures use the theme's warning
tone with stronger text contrast. Existing labels and icons still carry state.
Tokens derive from the current palette; no theme is replaced and no dependency
or backend behavior changes.

## Executed evidence

- Final Inbox and coding-job transcript browser suites passed together
  (`inbox-contrast-verified`, 61.71 seconds). The single-clock and
  distinct-color assertions pass. Paper and Ink running screenshots were
  exported, alongside the existing all-theme transcript screenshots.

- A Docker Chromium regression against the original built controls counted two
  elapsed labels and failed at the intended assertion, expected one, observed two
  (`inbox-contrast-red`, 18.56 seconds).
- Web typecheck and build passed (`inbox-contrast-build`, 14.96 seconds; rebuilt after the timer review).
  The three changed controls artifacts were copied out of the bounded worker.
- The Inbox and expired-token browser suites passed (`inbox-contrast-green`,
  47.2 seconds). The Inbox suite requires 4.5:1 for sampled prose, ordinary trace,
  error trace, terminal, notice and checkpoint text across the built-in themes,
  and covers phone width, keyboard navigation, Stop, receipts and the report.
- A subsequent Inbox run passed with the additional assertion that running,
  filed and failed indicators have distinct computed colors, plus a dark running
  screenshot. The wider Admin suite failed its existing return-scroll bookmark
  assertion: one saved block's fraction changed after returning from Admin.
- The same Admin assertion fails on unchanged main `da03328` under the identical
  Docker harness (`inbox-admin-baseline`, 51.8 seconds). Its other seven checks
  pass. This is a retained baseline limitation, not a claimed repair in this
  visual change. Failed receipts remain preserved.

All browser tests use synthetic vaults and fake agents. No real model, inbox or
repository job is started. The reused worker has a read-only root, no mounts,
3 GiB work and 512 MiB temporary tmpfs quotas, 4 CPUs, 6 GiB memory, a 600-second
watchdog and an 8 MiB log cap. Raw logs and screenshots remain local; they contain
synthetic data. Current-head CI and reviewer approval are separate merge gates.

The generated port inventory remains current. All 94 controls source hashes and
159 shipped output hashes match the rebuilt metadata. The final browser run used
547644 KiB in the bounded work tmpfs; retained run logs stay within
the declared cap. The reusable worker is stopped after exporting evidence.

## Timer review follow-up

CodeRabbit identified that counting the words “Elapsed” and “Running for” misses
the live-usage header, where the clock is shown beside token totals. The counters
now use semantic HTML `time` elements. The browser check counts their rendered
locations and exercises both the no-usage and live-usage states. A fixture-only
zero-usage event is emitted while the fake agent is paused, leaving its final
token totals unchanged. No extra polling loop or timer is introduced.

A separately delayed event-response check also passed with the published runtime;
no extra runtime change was needed for that hypothesis. The failed first attempt
was test-route cleanup, not a product regression, and remains recorded.

The review follow-up web build and typecheck pass. The Inbox, coding-job and
stale-token browser suites pass together with the semantic timer checks
(`inbox-semantic-clock-verified`, 54.39 seconds), including the
live zero-usage header. Both timer locations carry ISO duration metadata.
