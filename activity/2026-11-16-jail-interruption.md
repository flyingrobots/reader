# Retire the test group when its jail is interrupted

[Issue #267](https://github.com/flyingrobots/reader/issues/267) addresses a supervisor that can exit on SIGTERM while its separately sessioned test process continues running. Start from main `629e99a`. The scope is the test jail's owned process group; uncatchable SIGKILL, escaped sessions and production service supervision are outside this change.

Create an executable synthetic-child regression with explicit readiness, signal only the jail, and demonstrate the surviving child before repair. Every test must retire its own processes even when the assertion fails. Verify SIGTERM and SIGINT, a child that ignores TERM, normal completion, the deadline outcome, and preservation of a process outside the owned group. Keep custody until termination is confirmed; report failure if it cannot be established. Calibrate the assertions and repeat the affected cases before complete CI and review.

The fixture probe defect is independent and tracked in #266 / PR #268. Do not pull that unmerged implementation into this branch. Use the existing bounded test environment and preserve its resource guards.

## First implementation checkpoint

The bounded container regression demonstrated both failures: SIGTERM left the test process alive; SIGINT left its TERM-ignoring descendant alive. Three normal/deadline controls passed. After repair, the full ten-case affected set passed, including older-macOS Python observation without `waitid` and failure with an unreadable process table. The owned worker was removed and its lock released after each run.

The repair records signals without raising during launch, keeps the leader unreaped until cleanup, escalates from TERM to KILL, and requires a bounded positive process-table observation before reporting clean termination. Unconfirmed cleanup retains its run directory. The older-Python path uses a zombie observation because Python only exposes `waitid` on macOS from 3.13 onward; the project's supported Python floor is unchanged.

A preliminary macOS sandbox run could not execute `/bin/ps`, so its result is not behavioral RED. It left no synthetic process running. Lifecycle assertions run in the repository's bounded container, with a documented Darwin skip rather than changing sandbox permissions. The original macOS profile and Linux container admission policy are unchanged.

Assertion calibration, repeated runs, independent review and complete hosted CI remain outstanding at this checkpoint. Local evidence is retained in the session's `reader267-*` artifacts. The accepted issue body SHA-256 is `7e09eeea007b7e096eb0acb48d012a6954051c7772323dd3f1adf8dd7b88a588`.

This agent-written activity record has not received human editorial review.
