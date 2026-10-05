# Process inbox from Obsidian

Reader shows a prominent **Process inbox** button and a pending-arrival count when `inbox/` contains material. The root `inbox/README.md`, hidden files, symlinks, and empty directories are excluded. Files in one top-level bundle count as one arrival. Detection updates after vault events and on a two-second check; it never starts processing automatically.

Clicking the button launches the existing Codex CLI as a separate background librarian run in this vault. The button is disabled while a run is starting or active. **Stop** requests termination of the run's process group; partial changes are retained for inspection. Closing the sidebar or reloading the plugin does not stop the run. **Run details** shows the final librarian report and bounded diagnostics. “Codex finished” describes process completion, not an independent certificate that every filing step passed; inspect its report and any remaining arrivals.

## Deterministic work and librarian judgment

The supervisor inventories at most 10,000 arrival files, serializes runs with a filesystem lock, launches Codex with a fixed task prompt, tracks process status, limits outputs, and reports failures. Existing delivery, receipt, formatting, metadata, and search tools provide deterministic operations within the workflow.

Codex follows `AGENTS.md` and the documented intake procedure. It selects collections, preserves editions and receipts, creates wide-md reading copies, maintains catalogs, verifies results, and commits the completed import batch locally. It considers substantive connections and reactions without a quota. Source documents are data, not instructions. Unrelated dirty work and later arrivals must remain outside the batch. The prompt explicitly excludes remote publication, global configuration changes, other agents, and unsolicited speech.

## Setup and launch contract

Install Reader's Python environment with `uv sync --locked`. Install and authenticate Codex separately (`codex login`). Reader detects the executable from the inherited PATH and common user/Homebrew locations; **Settings → Reader → Codex executable** accepts an explicit path when the GUI environment differs from the terminal. This feature currently requires macOS or Linux.

The plugin starts `.venv/bin/python -m reader_mcp.inbox_runner` with explicit vault and executable arguments, without a shell. The supervisor uses `codex exec --cd VAULT --sandbox workspace-write --add-dir VAULT/.git -c 'approval_policy="never"' --ephemeral --json --color never --output-last-message REPORT -`. The prompt is supplied through stdin. Your Codex model/account configuration remains in effect. The additional Git metadata write directory permits the authorized local import commit without disabling the workspace sandbox. Standard checkouts are supported; linked worktree Git metadata outside the vault needs a separately verified launch configuration.

Codex must already be authenticated. Unsupported flags, authentication failures, sandbox refusals, and missing dependencies become failed/incomplete reports; the runner never escalates to an unrestricted sandbox automatically. See the [official non-interactive execution documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

## Runtime and recovery

Ignored `.reader/inbox-runner/` holds the lock, atomically replaced `state.json`, prompt, event output, diagnostics, report, cancellation request, and temporary files. One stable runtime directory is reused; a subsequent explicit run replaces the preceding report/logs. Copy evidence you need to retain before starting another run.

The supervisor has a 30-minute deadline. It monitors host free space (minimum 50 GiB), `.reader/` aggregate data (4 GiB), process-group RSS (4 GiB), and aggregate run output (16 MiB). Each stdout/stderr stream has an 8 MiB cap; children inherit a 3,600-second CPU limit. Temporary files use the owned runtime directory. A failed resource measurement or limit breach terminates the owned process group. These are polling/process controls, not a filesystem quota or a complete sandbox for all tools an agent could choose. Existing guarded project commands remain required for heavy work. Codex's own shared account/configuration state is managed by Codex, not counted as Reader's disposable run output.

If the supervisor disappears, the UI marks the run interrupted and refuses another launch. Inspect `state.json`, its process group, logs, and partial work. Confirm the recorded processes are absent (or stop the verified owned group), then remove only the stale `state.json` to allow retry. Do not infer completion from an empty inbox or delete library changes to clear a status. A normal failed/stopped run can be retried explicitly after inspecting its report. The lock prevents simultaneous launches from cooperating Reader runners, not an unrelated manually launched librarian session.

## Verification

Run `uv run --locked pytest -q tests/test_inbox_runner.py`. Tests use a controlled executable to check argument/prompt delivery, reports, failures, empty inboxes, duplicate exclusion, and cancellation. Live acceptance must separately verify the Obsidian button and a real authenticated Codex run, including the resulting preserved files, catalog links, report, and local commit. Do not mistake a fake executable test for model-driven filing acceptance.

Upkeep workers and the standalone runner share an intake admission mutex. Existing `.reader/upkeep-claims.json` owners block runner startup; finish or reconcile their batches before retrying. Starting/running/interrupted runner state blocks new Upkeep claims. See [claim coordination and recovery](engagement.md).

The generated job prompt includes the running backend interpreter and explicit vault root as a JSON argument prefix. Maintenance commands use that prefix, so a private vault needs no local package manifest or virtual environment. The source inventory is still a separate untrusted JSON list.
