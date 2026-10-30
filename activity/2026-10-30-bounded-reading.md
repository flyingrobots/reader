# Bounded reading validation

Implemented finite, vault-only autonomous reading and separate acquisition authorization in the Reader, Reflective Reading and Upkeep skills. Added an installed, standalone `read_session.py` runner and operational documentation. Demo selection is excluded by root markers, labels and path validation; demo material remains separate.

Validation: seven synthetic standard-library tests pass for source confinement/demo rejection, process timeout, output limit, failed-child propagation and termination of a process ignoring SIGTERM. Three edited skills pass Skill Creator frontmatter validation. Actual host sandbox preflight accepts an existing source read and notes write, while refusing vault writes, symlink writes, outside-notes writes, protected-file hardlink creation and a network connection. No model reading run was started. Initial tests exposed macOS alias-path comparison and exited-process reaping issues; both were fixed before the passing run.

Reproduce unit tests with `python3 -m unittest discover -s tests -p test_read_session.py`. On a configured installation, use `python3 ~/.codex/skills/reflective-reading/scripts/read_session.py --check library/collection/work.md` for actual permission probes without model inference. The source is not modified. The helper fails closed when its Codex profile/flags or enforced sandbox are unavailable.

The runner's deadline and 64 MiB notes monitor are polling/process controls, not disk quotas. Account/runtime state is managed by Codex. An existing unrestricted session is not retroactively sandboxed; future unattended reading must use the restricted runner. No deployment/service change, external tracker action, push or merge.
