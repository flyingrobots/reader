# Repositories

## Overview

The registry connects an article’s exact GitHub owner/repository name to an existing local checkout and an execution policy. It lives at `.reader/repositories.json` in the configured vault. Article content cannot select arbitrary checkout folders, commands or remotes. Registration and removal require a write-authorized request from this Mac.

## Register a repository

Enter owner/name, checkout folder, remote name and base branch. The checkout must already exist and be a Git repository whose selected remote identifies that GitHub repository. Reader does not clone it. The worktree folder must exist outside both checkout and vault. Every run creates a new branch and worktree there; existing uncommitted checkout work is preserved.

Choose at least one supported agent. The registry supports Codex and Claude Code, their permission modes, optional explicit executable paths and agent timeouts. Registration validates fields and repository identity; it does not install agents or authenticate them. The form exposes the common fields; additional policy settings belong to the validated local registry contract.

## Verification

Enter one argument per line. The server runs structured argv without an implicit shell in the job’s worktree. Set a bounded timeout. Use the project’s guarded runner when required. Optional git-locks store and keys coordinate the configured verification with other users of the same resource. A refused lock or missing tool blocks execution rather than running unguarded.

Reader checks branch/base identity, clean committed changes and source ancestry before publication. A verification exit status of zero cannot prove every property of the code. Choose a command that actually exercises the relevant acceptance checks.

## Agents

The current coding agent runs on the host in its assigned local worktree under its selected permission mode. Worktrees isolate Git changes, not the filesystem, shared caches or credentials. A verification command that uses Docker does not move development itself into a dev container. Container-only development without a host clone is not currently supported by this registry/runner.

## Readiness and check again

Check again rereads configuration and inspects local Git identities. Ready means those checks found no reported problem; it does not prove GitHub push access, agent authentication or the final verification command will succeed. Job preflight checks those execution prerequisites. API or registry failure remains distinct from an empty list. A registry permits at most 64 repositories and is bounded to 256 KiB.

## Remove

Remove unregisters future prompt execution after confirmation. It does not delete the checkout, worktrees, branches, PRs or retained run evidence. Do not remove a registration as a substitute for stopping and reconciling active work. Preserve unique recovery files when cleaning up manually.

## Storage and recovery

The registry stores policies, not credentials. GitHub access uses the configured `gh` authentication. Agent authentication follows the selected CLI’s own setup. Never put secrets in an article prompt, argv field or public repository configuration. Preserve existing run archives when changing a registry entry. Inspect the exact repository, base, worktree and verification output before rerunning a failed task.

Implementation: `repositories.py`, `coding_api.py`, `coding_workflow.py` and `web/src/admin/pages/repositories.tsx`. The registry’s local-checkout requirement is a current implementation boundary.
