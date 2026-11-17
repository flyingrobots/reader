# Retire the test group when its jail is interrupted

[Issue #267](https://github.com/flyingrobots/reader/issues/267) addresses a supervisor that could exit while its separately sessioned test process continued running. Work started from main `629e99a`. The accepted issue body SHA-256 is `7e09eeea007b7e096eb0acb48d012a6954051c7772323dd3f1adf8dd7b88a588`.

## Behavior and custody

The jail records SIGINT and SIGTERM without raising during launch. Shutdown sends TERM, allows a short grace period, then sends KILL to remaining group members. It keeps its leader unreaped until a bounded process-table query confirms no live group members. Normal command exit codes are preserved; interruptions return 130/143 and the deadline returns 125. Leftover same-group descendants are retired on normal completion too.

The process table must positively contain the pinned leader with its expected PID, process-group ID and parent ID. Each numeric group signal first verifies direct-child custody. ECHILD is a refusal, not evidence that the group is safe to signal. A nondefault SIGCHLD disposition is refused before launch because it can auto-reap children. Older macOS Python versions without `waitid` use a bounded positive process-table observation. The supported Python floor is unchanged.

Unknown cleanup returns an error and preserves the run directory. The scope is the owned process group. Uncatchable SIGKILL, children that deliberately leave that group, concurrent external child reapers and production service supervision are outside this change. The supervisor is a standalone main-thread runner. The existing macOS sandbox profile and Linux container admission policy remain unchanged.

## RED, review and GREEN

The initial container regression demonstrated both failures: SIGTERM left the test process alive; SIGINT left its TERM-ignoring descendant alive. Three normal/deadline controls passed. The first repaired set passed eight cases; portability and unreadable-query controls expanded it to ten.

Independent source review found two custody gaps in that first implementation. An injected ECHILD still allowed numeric group signals, and an incomplete process table could omit the supposedly pinned leader while reporting clean removal. Separate executable regressions captured both RED results. After repair, the affected set passed twelve cases. A further preflight control covers nondefault SIGCHLD before run preparation. The reviewer read the repair delta and found no further concrete issue; that source review is distinct from the executed tests.

Nine deliberate source faults challenged omitted cleanup, omitted KILL escalation, incorrect signal exit status, both normal exit outcomes, an incorrect deadline result, a broken older-Python observation, discarded uncertain evidence and unsafe SIGCHLD admission. Every fault failed its intended assertion, and exact source bytes were restored. Ten seeded shuffled repetitions of the ten changed/new cases then passed: **100 case executions**, seed 267. The final campaign completed in 77.13 seconds, excluding worker preparation.

The process schedules use explicit readiness pipes. An unrelated process remains alive during the signal/deadline checks. The harness retires its deliberately orphaned group even after a failing assertion. These are controlled synthetic schedules, not a live PID-reuse experiment or a proof over all kernel interleavings.

## Reproduction and retained evidence

Run the affected modules in the repository's bounded container, under its worker lock and resource admission check:

```sh
python3 scripts/check_container.py python tests/test_jail_lifecycle.py tests/test_test_jail.py
```

The lifecycle oracle needs a process-table query. A preliminary macOS sandbox run refused `/bin/ps`; that run is not counted as behavioral RED and left no synthetic process running. Lifecycle assertions therefore have a documented Darwin skip and execute inside the bounded container. Existing refusal tests still run on both supported environments. This does not relax sandbox permissions.

Local evidence is retained outside the repository in the session's `reader267-*` artifacts, including original REDs, custody RED/GREEN, fault/repetition output and resource receipts. Each worker was removed and its exclusive lock released. The final worker used 438,516 KiB under `/work` and zero KiB under `/tmp`. An initial campaign invocation refused unsupported argument syntax before starting a worker; the successful invocation passed pytest flags after `--`.

The temporary calibration driver was preserved outside the checkout after byte/hash verification and is not shipped. No live vault, service, model or foreign process participated. The maintained procedure is updated in `docs/testing.md`; complete hosted CI and final PR review remain merge gates.

This agent-written activity record has not received human editorial review.
