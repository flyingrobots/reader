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
- Web typecheck and build passed (`inbox-contrast-build`, 12.59 seconds).
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
