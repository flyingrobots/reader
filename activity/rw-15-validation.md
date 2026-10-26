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

## Integrated validation recovery

Main at `5d5a513d35ebaedc8335bd6faf3a76c9facae7c8` was merged normally, retaining its dock layout, calendar clock and focus fixes. The merged TypeScript source passed checking and was rebuilt in Docker.

The first complete Python run reported 665 passing tests, two skips, 18 failures and 99 setup errors. Its failures exposed missing package/fixture inputs in the copied test environment, fake companion installs consulting a small tmpfs as though it were a real install destination, and test-created servers accumulating background workers until the container's 256-process limit was exhausted. The validation archive now includes the required source inputs and omits published screenshots within its unchanged 24 MiB limit. Synthetic install tests inject their capacity input locally; production disk guards remain unchanged. An automatic test fixture closes both WebLibrary instances and directly constructed voice runners. An intermediate run with incomplete teardown was stopped, and its partial log was retained. A complete rerun is required; the failed runs are not green evidence.

## Review fixes

Codex found that real runner serialization omitted `task_id`, although a manually constructed recovery fixture supplied it. New regressions created queued quiz and review state through `VoiceRunner.save()` and both failed at the missing task identity on source head `9400967`. Preserving that field made both cases pass, including restart disposition. The relevant quiz queue and supervisor suites then passed 26 tests in Docker. Raw RED/GREEN logs are retained locally as `quiz-recovery-red` and `quiz-recovery-green`.

The cross-tab review regression failed in both the controller and HTTP response: a newer quiz replaced the question set being reviewed. Polling now returns that review's saved quiz, and the controller retains its attempt and checks the result's quiz identity. The controller regression and all 18 quiz-runner tests passed in Docker (`quiz-review-identity-red` / `quiz-review-identity-green`). The controller suite is included in the container Node check.

The close/reopen regression reproduced a permanently busy dialog when a result request finished after closing and the reopened quiz had no participant-owned generation task. Closing now clears transient busy state while retaining the attempt; reopening restores any real pending task from the server. Both controller race tests passed in Docker (`quiz-busy-red` / `quiz-busy-green`).

Two bounded actor regressions reproduced the cancellation lock inversion, with and without a prior attempt's log. Queued finalization now runs outside the caller's state lock; artifact-free tasks skip the quiet wait, while retries retain and commit their earlier logs. Both actors could progress after the fix, and 29 quiz-runner/supervisor tests passed in Docker (`quiz-cancel-order-red` / `quiz-cancel-order-green`).

The integration-parent record was corrected against the actual second parent of merge `9501969`. The complete suite at source head `9400967` passed 782 tests with two optional skips in 244.57 seconds; both CI checks on that head passed. These historical results do not substitute for validation after the review fixes.

The plain-text transport regression reproduced a valid compact JSON reply being discarded as an unknown event. Text streams now preserve every nonempty line literally. Generation and short-answer review passed through that transport, and the quiz queue plus existing chat suite passed 70 tests with one optional sample skipped in Docker (`quiz-text-red` / `quiz-text-green`).

The admission regression showed quiz GETs entering the ordinary read pool. They now use the existing expensive pool; saturation refuses the quiz request before inventory work while health and ordinary reads remain available. Both affected HTTP admission tests passed in Docker (`quiz-admission-red` / `quiz-admission-green`).

A dotfile regression reproduced the whole quiz store refusing discovery because of operating-system/editor metadata. Discovery now skips hidden entries without deleting them and retains checks on visible records. All 17 quiz storage tests passed in Docker (`quiz-dotfiles-red` / `quiz-dotfiles-green`).

Two public-metadata regressions reproduced host paths in runtime versions and nested task errors. Public responses now use the existing display redaction without rewriting canonical artifacts. A first verification command named a nonexistent test module and ran no tests; the corrected quiz-store/runner command passed all 40 tests in Docker (`quiz-public-red` / `quiz-public-green-r2`).

A later Codex review reproduced a short-answer request losing its accepted task ID when the dialog closed before its POST returned. Closing now invalidates rendering while retaining the accepted task for its originating context; another submission or document context supersedes it. The two close/reopen regressions failed before the fix, and all five controller tests, including context isolation, passed afterward in Docker (`quiz-delayed-review-red` / `quiz-delayed-review-context-green`).

A further regression reproduced generation being discarded in the same transition when a previous review task remained selected. Generation and review now share accepted-response handling, including invalidation of earlier listing requests. Both regeneration timings were RED; all nine controller tests passed after the fix, including out-of-order listing and cached-response cases (`quiz-generation-retention-red` / `quiz-generation-final-green`).

## Current-main integration

Main advanced to `5bd536ba77d082df56f524cd9c8056740b7a657a` during review. Normal merge `1890e04` retained both changelog entries and the incoming shown-position, smoother-refresh and page-edge changes. Quiz passage navigation continues through the shared `moveToRange` path. The quiz, outline, content-visibility and dock browser flows passed on that merge (`quiz-scroll-integration`, 105.58 seconds). The earlier dock failure remains historical and unexplained; this later success does not establish its cause.

The complete backend suite passed 791 tests with two optional skips at `1c599a5`; subsequent changes leave Python source identical. At `b45defe`, both web/plugin builds, 24 plugin tests and quiz/focus/chat browser flows passed. The current controller changes passed their nine-test suite separately. Current-head CI and an updated independent review remain the merge gates; prior approvals do not cover the new merge or controller fix.
