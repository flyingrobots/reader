# Article quiz validation

## Scope

The RW-15 implementation adds edition-bound quizzes through the existing supervised voice queue. Writing prompts are separate work. The checks below ran in copy-isolated Docker workers; no host tests or writable host repository mounts were used.

## Checks on 2026-10-26

The focused backend suite passed 101 tests with one optional transcript test skipped because `READER_AGY_SAMPLE` was not supplied. Coverage included quiz validation and editions, participant receipts, supervised generation and retry, interrupted recovery, chat compatibility, LLM logs, HTTP access and the source policy against deployment-specific voice names.

The web controls passed TypeScript checking and a production build. The browser test in `tests/web_quiz.cjs` passed generation, immediate grading, formatted-source passage highlighting, optional short-answer review, saved reading-log scores, retakes, a 390-pixel viewport, Escape focus return and both reading layouts. It also compared rasterized pixels with and without the named quiz highlight. These checks used synthetic source material and fake voice output.

A separate live check used Claude Code 2.1.292, which reported `claude-sonnet-5-5`, on a complete library document with SHA-256 `e876162bf91f9eab5400964ce879b1f23e76873729f5c45fbee1d771adf8eb95`. Seven questions were proposed. Six were accepted, and one was rejected because its evidence context exceeded 64 characters. No retry was required. The task finished and committed its quiz and logs inside a disposable test vault. The six accepted questions and explanations were inspected against their source passages; this is one observed sample, not a general guarantee of semantic correctness. The source and raw output remain private and are excluded from this repository.

The feature worker used a read-only root, no host mounts, a 3 GiB `/work` tmpfs and a 512 MiB `/tmp` tmpfs, four CPUs, 6 GiB of memory and a 600-second watchdog. The final browser run used approximately 768 MiB in `/work` and 3 MiB in `/tmp`; its log was 17,480 bytes. Host and Docker backing filesystems each had over 500 GiB free. The live check temporarily used approximately 897 MiB in `/work`. Temporary provider credentials and copied private input were removed after the check.

## Remaining gates

These results precede integration with the latest main branch. Complete-suite validation, an independent current-head Code Lawyer review and current-head CI are still required before merge.
