# Open-tab token recovery validation

2026-10-27. Baseline: `b462c236324b67455824020130accecc81fa833c`.

## Diagnosis

The running Reader accepted a freshly fetched token on loopback and through its actual Tailscale endpoint. A diagnostic POST to a deliberately unknown route returned 404 after successful validation; the wrong token returned the user's exact 403 message. The probe did not start an inbox job or modify a library document.

The Python server ordinarily creates a new token at process startup. The browser previously retained the token from its initial library response without recovery after a restart. A synthetic browser with a previous-process token reproduced the visible failure (`inbox-token-red`). This establishes a restart failure matching the report; the original devices' request headers were not captured.

## Change

Only the token preflight emits `reader_token_expired`, before reading the body or dispatching an action. The shared browser transport refreshes through the identity-checked, uncached token endpoint and retries the unchanged JSON request once. Concurrent requests share the refresh. Other refusals, failed refreshes and uncertain network outcomes do not replay actions. Host/Origin checks and JSON/token requirements remain enforced.

## Completed checks

In bounded, copy-isolated Docker, the locked project environment passed 85 focused Python checks covering web routes, inbox behavior, API path privacy and development tooling. The 14 new token transport checks and nine inherited quiz controller checks passed. The language-neutral security contract passed all 19 cases, including token refresh, its error shape, rejected origins and non-JSON writes. The generated port inventory matched its source.

Earlier custom-environment attempts passed the route checks but could not start the separate API privacy fixture. A direct diagnostic exposed missing Pydantic in that child environment; the successful run used the project's locked virtual environment. These setup errors are not counted as application regressions or passes.

The first browser GREEN harness observed its state too early. After its wait was corrected, the application had already recovered through a background write and accepted the inbox start; an overly narrow assertion still expected that particular start to be rejected first. The final harness requires an observed stale-token rejection, exactly one shared refresh and exactly one accepted inbox start. It passed, followed by the complete existing inbox browser suite (`inbox-token-browser-verified`, 57.66 seconds for setup and both suites). Earlier failed harness runs are retained, not reported as passes.

The complete Python suite, current-head CI, independent PR review and live rollout have not run for this patch. No real model was invoked by the synthetic checks.

## Resource bounds

Checks reused the Reader Node worker and cached image under the workstation's heavy-work and worker locks. Its root was read-only, with no host mounts, four CPUs, 6 GiB memory, 3 GiB and 512 MiB capped temporary filesystems, an eight-MiB per-run log cap and a 600-second watchdog. The locked-environment phase used about 786 MiB in `/work` and 6 MiB in `/tmp`; host and Docker backing storage remained above 500 GiB free. Raw bounded logs retain each failed and passed phase under their `inbox-token-*` labels.
