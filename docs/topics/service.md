# Reader service and companion tools

## Overview

Service & tools administers the Reader web service and optional companion integrations. It does not schedule index rebuilds or automatically install every program it discovers. Service status, companion discovery and feature availability have separate meanings.

## Reader service

The service card reports the running commit, configured source, most recent update/check, next scheduled software check and reachable addresses. A running service can serve older JavaScript to an already-open tab until it is reloaded. Compare the exact running commit and assets when diagnosing deployment differences.

Update now asks the existing updater to fetch/resolve its configured source and run the smoke gate before activation. A successful update changes the live software checkout and restarts the service. A failed gate retains the current release and records the failed candidate. It is not a request to push a branch, merge a PR or rebuild library indexes.

## Restart

Restart is a service lifecycle action. Reader coordinates activation around known active operations; do not assume restarting is a safe substitute for diagnosing a long-running job. Process-local maintenance history and check snapshots can be lost at restart. Persisted run archives and source documents have separate durability contracts.

## Update schedule

Pause updates changes the application updater’s behavior. An explicit update request can have different admission semantics from a scheduled check. The displayed next-check time concerns software maintenance, not semantic indexing, catalog sync, inbox filing or model generation. The updater’s stored configuration preserves explicitly saved companion environment overrides during supported reinstalls.

## Companions

Companions are separate projects: AI-TTS, Colorful Language, wide-md and git-locks. Check again refreshes discovery/status; it does not install them. Found, installed, too old, not running and error states distinguish executable availability, version requirements and daemon readiness.

Install/Update/Start is shown only where Reader implements that integration. Review the displayed plan before execution. Setup links and copyable commands are documentation, not a claim Reader ran them. Installation logs are bounded operational evidence, not the full LLM archive. Companion maintenance uses the shared maintenance lane and can block index job admission while active.

## AI-TTS

Reader sends article/selection text to the local AI-TTS daemon; the daemon owns synthesis, playback, holds and serialized queueing. Reader does not directly play an audio file to bypass it. Start is offered for supported installed-but-stopped configurations; Reader does not silently install the signed application.

Default reading voice is a vault-specific choice in `.reader/speech.json`. The catalog comes from the running engine. Automatic uses AI-TTS’s existing Reader source behavior. An explicit reading voice retains Reader origin without reassigning another agent’s voice. The Speak popup can override one reading without saving that override. Missing/stale voice choices are rejected before submission. Changing the default does not change already queued audio.

## Colorful Language

Colorful Language supplies prose grammar classifications used by the reading UI’s color modes. Reader discovers a compatible binary, including explicit saved paths/environment overrides. Install builds the pinned supported release into the vault tooling area when available. A missing integration should not be described as an ordinary palette setting failure. Discovery errors and unsupported versions stay visible.

## wide-md

wide-md supports the separate reading-copy workflow that removes artificial source wrapping. It does not authorize replacing preserved originals. A reading-copy request has provenance and formatter-refusal boundaries; finding the binary does not imply every file has been reformatted. Install/reinstall follows the exposed plan.

## git-locks

git-locks coordinates named shared resources among cooperating local tools. A lock is advisory coordination, not filesystem enforcement or a disk quota. The configured store and exact resource names must agree with other participants. Discovery/status does not grant ownership. Reader must honor refusals and must not silently run a configured locked verification unguarded.

## Paths and logs

Set path changes a supported companion override; Clear removes that override so discovery can fall back to its normal locations. Paths must pass backend validation. Inspect status and the install log after changes. No credentials should be copied into path fields. A check cannot prove that an executable’s downstream network use or all external clients obey the same resource protocol.

## Troubleshooting

When a feature disappears after service work, compare the running commit, saved environment and discovered executable/daemon state before reinstalling. For stale UI, reload and verify served asset identity. For a failed update, read the smoke result. For a stopped daemon, start the named integration rather than killing shared Reader infrastructure. Source files and unique evidence should be preserved during recovery.

Implementation: `scripts/reader_service.py`, `src/reader_mcp/service.py`, `companions.py`, `speech.py`, `web/src/server-card.tsx` and `companions.tsx`.
