# Token recovery on the Admin Inbox

2026-10-27. PR #192 integration follow-up.

## Integration change

The stale-tab browser test now opens `#admin/inbox`, matching the current Admin
Inbox route and the existing Inbox suite. Its old `#backstage` URL opens Overview
after the Admin dashboard merge and timed out waiting for the Inbox button.
The token retry implementation is unchanged. The generated port inventory was
refreshed after integrating the footer theme picker.

## Executed checks and evidence boundaries

- Full Python run: 1007 passed, 2 skipped. Request/quiz controller tests: 23
  passed. Other root Node tests: 107 passed.
- The first API contract run passed 147 and failed 2: the copy-isolated Docker
  fixture had a Git index but no commit, so health and service returned a null
  commit. The fixture import root was `/work/project`; the initial reviewer
  attribution to site-packages was incorrect. Creating a synthetic fixture
  commit corrected that harness defect; no production service code changed.
- Corrected rerun: all 149 API contracts passed. Generated inventory check,
  plugin typecheck/24 tests/build, server typecheck/9 tests/build, and web
  typecheck/build passed.
- That rerun then exposed the outdated browser route above. After correcting
  it, both `web_inbox_token.cjs` and `web_inbox.cjs` passed. The former verifies
  an actually rejected stale-token preflight, one shared refresh, and exactly
  one successful synthetic Inbox start. The latter covers the Admin Inbox,
  transcript, stop and held-claim behavior, access setting and phone width.

Raw receipts are retained locally as `reader-land-token-full`,
`reader-land-token-tail`, and `token-admin-browser`; failed attempts remain
recorded. Tests used the reused copy-isolated Docker worker, synthetic vaults
and fake agents. No production Inbox, coding job or model API was started.
The worker uses a read-only root, no mounts, 3 GiB work and 512 MiB temporary
tmpfs quotas, 4 CPUs, 6 GiB RAM, a 600-second watchdog and an 8 MiB run log cap.
Browser rerun source differs from the earlier full run only by main integration,
the browser route and documentation; current-head CI remains a separate gate.
