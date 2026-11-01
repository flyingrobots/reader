# Repositories

## Overview

The registry connects an article’s GitHub owner/repository name to a pinned devcontainer environment and execution policy. It lives at `.reader/repositories.json` in the configured vault. Article content cannot select local folders, commands, images or remotes. Registration and removal require a write-authorized local request. The default runner does not execute or inspect registered host checkouts.

## Register a repository

Discover the repository’s configuration at a pinned GitHub revision, select a supported configuration or explicitly approve an inferred proposal, and approve the immutable local managed image identity. Registration stores the base branch, supported agents, container executable choices, bounded execution policy and verification argv. It requires no host checkout or worktree folder.

POST `/api/repositories` supports `discover-container`, `select-container` and `infer-container` actions. Discovery distinguishes complete absence from API/authentication errors or truncated inventories. Selection verifies the selected Git blob’s identity and source digest. Inference requires `consent: true` and a full commit identity, refuses an existing configuration and records the Node/Python manifest evidence and assumptions. Inference does not build an image, authenticate a tool or prove dependency compatibility.

The `register` action accepts an entry with an `environment` object of kind `devcontainer`. Its approval includes the revision, selected path/blob/source digest or exact inferred proposal digest and consent, normalized configuration, full local image ID, shared workstation git-locks store and total runtime timeout. Choose at least one supported agent and an in-container verification command. The runtime deadline must reserve at least 600 seconds beyond the agent and verification limits for setup/publication. The registry permits at most 64 repositories and 256 KiB total.

Prepare the fixed managed image with the explicit local `reader container-image --lock-store …` command before approving its returned image identity. Image preparation is separate from registration. The Admin form discovers GitHub configurations, previews a selected configuration, or asks for explicit inference consent after a missing inventory. Changing the repository or base invalidates the previous preview. Registration requires that preview, the full prepared image identity, workstation lock store, enabled agents and literal verification argv. A configured environment is not presented as ready merely because its fields validate. See the [runtime contract](../container-runtime.md) and [configuration preview contract](../devcontainer-discovery.md).

## Verification

Verification is structured argv without an implicit shell and runs inside the same devcontainer workspace as the coding agent. Its executable is resolved there. Host verification lock stores and host executables are not imported. Reader already owns the concrete worker’s workstation lease. A project command that requires an unavailable Docker socket or other host capability fails rather than switching to a host process.

Reader independently checks the assigned branch, clean committed changes, pinned base ancestry, verification exit status and unchanged head before publication. A zero exit status proves only what the selected checks actually exercise. Never bypass Git hooks or weaken the project’s required checks to obtain a publication result.

## Agents

Codex and Claude Code use the existing fixed argv adapters inside the managed container. Container executable choices and permission modes are registry policy, never article metadata. An unavailable container executable or missing container sign-in blocks the job; Reader does not discover a host executable as a substitute. Version and sign-in probes execute before the task itself.

The workspace and tools/credentials created inside it are retained in the repository’s labelled Docker volume. Host source, host credentials and the Docker socket are not mounted. The container’s resource guards are described in the runtime reference; this does not claim that a credential-bearing agent cannot make its own network requests.

## Readiness and check again

Checking the registry reads configuration and reports legacy entries or unverified container readiness without launching a worker. It does not clone, install tools or sign in. Default views do not inspect old checkout paths or invoke host Git/agent discovery. Use the explicit local `reader container exec` and `reader container check` commands to prepare and inspect tooling/sign-in; see [terminal setup](../container-runtime.md#explicit-terminal-setup). Static validation is not execution readiness. The browser never starts setup just by viewing a registration.

Job preflight rechecks GitHub publication access, the approved configuration source, local image identity, resource admission and remote base. If the base changed after approval, setup must be refreshed rather than silently reusing approval for another revision. Missing or refused prerequisites remain explicit blocked/error states.

## Remove

Remove unregisters future prompt execution. It does not remove the persistent workspace volume, legacy checkout/worktree files, branches, PRs or run archives. Do not remove registration as a substitute for stopping and reconciling active work. Unique recovery work must be inspected before any separate cleanup decision.

## Storage and recovery

The registry holds execution policy and non-secret configuration. Container credentials are established independently in the container’s home directory; they are not copied from the host. Do not put secrets in article prompts, argv or public configuration. Server-side issue/PR operations retain Reader’s configured GitHub adapter and its own authentication.

Creation intent, lease identity and container identity are recorded before execution proceeds. Restart recovery proves ownership, resumes or reacquires the correct resource admission, stops the old worker and retains the workspace volume. A replaced lease, foreign worker or unconfirmed stop requires reconciliation and is not reported as a clean recovery. An agent is never silently relaunched.

Implementation: `repositories.py`, `container_registry.py`, `coding_api.py`, `coding_container.py`, the container runtime/recovery modules and the Repositories Admin page. The backend is container-only. Admin handles configuration approval; tool installation and independent sign-in use the explicit terminal setup command. The installed image command and terminal setup handle local preparation. Real Docker workflow validation uses synthetic agent/GitHub services; live provider tasks and external publication are separate operational checks.
