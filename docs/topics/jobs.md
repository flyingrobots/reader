# Coding Jobs

## Overview

Coding Jobs turns an explicitly selected article prompt into an observable repository task. Reading a prompt, opening a job or viewing this reference starts no coding work. A run pins the source edition, prompt block, submitted prompt, repository and chosen agent. The successful publication outcome is PR opened, not merged or proven correct for every input.

## Job list

Filter by repository, state or source article. The list is paginated, newest first. Refresh reads state; it does not rerun a job. A row links to the exact run and, when available, its verified GitHub result. No-match, unavailable and read-only-owner states remain distinct from an empty history.

## Job details

The detail view exposes the source prompt identity, agent, branch/base/head, worktree, verification result, timestamps, predecessor and archive. Current activity belongs to that run ID. A rerun is a new run linked to its predecessor, not a mutation that erases the older attempt.

## Development environment

The current runner requires an existing registered local checkout and creates a separate Git worktree for each run. The agent runs on the host using the registered CLI and permission mode. A worktree isolates branch changes; it does not isolate credentials, build output, shared caches or the host filesystem. The configured verification command may invoke the repository’s guarded container runner, but that does not put the coding agent itself in a dev container.

Repository setup currently requires checkout and worktree folders. Container-only development without a host clone is not yet implemented. Do not interpret a registered repository or a passing container verification as evidence that the agent developed inside a container.

## Prompt and admission

An article block names an exact GitHub repository and optional issue, with a stable block ID. Admission rereads the current source bytes and validates the source hash, prompt block and registry. The exact original and edited prompt are archived before work begins. Request UUIDs provide idempotent admission; reusing an ID with different content is a conflict. A changed article requires a fresh preview/admission.

## Agent

The selected coding agent receives repository instructions, pinned source/branch context, required verification and a bounded prompt. It investigates, edits and commits within its assigned environment. Its final structured result is a claim that Reader validates. It may report implemented, already fixed or blocked; a fluent success narrative cannot substitute for commits and passing checks.

## Verification

Reader checks branch/base identity, committed changes, source ancestry and the configured verification command’s actual exit status. Verification follows repository guards, locks and resource budgets. A missing executable, failed guard, dirty worktree, changed branch or failed command blocks publication. Never bypass Git hooks or replace a Docker-only verification with a host process.

## Publication

Reader owns issue linkage, create-only branch publication, PR creation and remote readback. A remote timeout is uncertain rather than an invitation to create another artifact. The workflow reconciles by durable marker, branch and returned repository/head identity. It does not merge automatically. Completed remote effects remain recorded after cancellation or later failure.

## Commits

The commit list pins exact SHAs and subjects. Source paths and head/base ancestry are inspected independently of the agent’s report. A nonempty commit list is not a substitute for meaningful acceptance checks. Already-fixed work can correctly produce no new commit or PR.

## Stop

Stop is available only for active work owned by this server. It requests termination of the owned process group or runtime and preserves completed effects and evidence. It does not delete a pushed branch, created issue or PR. After interruption, reconcile recorded state rather than blindly restarting another writer.

## Archive

Prompt, system instructions, stdout/events, stderr, final result, verification and Git/publication evidence are retained with the run. Previews are bounded; a preview is not the full artifact. LLM logs are retained independently of ephemeral work/runtime files. Archive exhaustion/write failure must stop owned work rather than silently drop evidence and continue publication.

## Outcomes and recovery

PR opened, already fixed, blocked, failed, cancelled, interrupted and needs reconciliation have distinct meanings. A server restart reconciles owned processes and remote effects; it must not silently relaunch an agent. Inspect phase, exact source/head, retained logs and GitHub readback before retrying. Do not discard a workspace containing unique uncommitted recovery work.

Implementation: `coding_jobs.py`, `coding_workflow.py`, `coding_store.py`, `coding_agents.py`, the GitHub adapter and `web/src/admin/pages/jobs.tsx`. The current registry and runner use local checkouts; container discovery and execution require a separate implementation.
