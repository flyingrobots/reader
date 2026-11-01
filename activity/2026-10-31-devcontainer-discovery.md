# Container runner discovery foundation

PR #205 merged into main at `c29a799e8b81d5361a3f28d0b1b6c3b6273b8006` after exact-head independent review, Docker verification and passing CI. The Coding Jobs migration continues separately on `feature/coding-devcontainers`.

Added an internal read-only discovery helper and GitHub revision/tree adapter operations. Discovery pins a commit once and traverses supported root/default/named configuration locations by immutable tree identities. Complete absence is distinct from transport/authentication failures, incomplete inventories, malformed identities, symlink locations and explicit inventory limits. A missing result requires inference consent; it does not provide it.

Validation: bounded Docker worker using the reusable Python 3.12 / Node 24 toolchain, read-only root, no host source mounts, capped tmpfs, CPU/memory/PID/log limits and the shared worker lock. `tests/test_devcontainer_discovery.py` and `tests/test_github.py` passed all 24 checks in 0.63 seconds. The worker was removed and its lease released; no host clone or credentials were copied. No live agent execution or publication test is claimed.

The helper is not yet connected to registration or execution. The existing host runner remains unchanged. Outstanding migration work includes configuration selection and consent persistence, container preparation and authentication, Git/agent/verification execution, cancellation and restart reconciliation, bounded durable work recovery, Admin controls and full synthetic flow validation.
