# Retire the test group when its jail is interrupted

[Issue #267](https://github.com/flyingrobots/reader/issues/267) addresses a supervisor that can exit on SIGTERM while its separately sessioned test process continues running. Start from main `629e99a`. The scope is the test jail's owned process group; uncatchable SIGKILL, escaped sessions and production service supervision are outside this change.

Create an executable synthetic-child regression with explicit readiness, signal only the jail, and demonstrate the surviving child before repair. Every test must retire its own processes even when the assertion fails. Verify SIGTERM and SIGINT, a child that ignores TERM, normal completion, the deadline outcome, and preservation of a process outside the owned group. Keep custody until termination is confirmed; report failure if it cannot be established. Calibrate the assertions and repeat the affected cases before complete CI and review.

The fixture probe defect is independent and tracked in #266 / PR #268. Do not pull that unmerged implementation into this branch. Use the existing bounded test environment and preserve its resource guards.

This agent-written plan has not received human editorial review.
