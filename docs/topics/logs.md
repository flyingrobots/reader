# LLM logs and run artifacts

## Overview

LLM logs is a read-only archive browser. It lists retained model/agent runs and opens their captured metadata and artifacts. Opening the archive or a run does not regenerate output, replay commands or start a job. Records under logs/llm are retained; this page does not prune them.

## Archived runs

Filter by kind and page through newest-first results. Refresh rereads the archive. Run kind, date and run ID identify an archived record; a title or repeated prompt text is not a unique identity. A no-match result differs from an unreadable archive or server failure.

## Run metadata

The detail view pins timestamps, producer/model/agent metadata, status and available artifact names. The metadata disclosure shows stored JSON rather than a fabricated live state. An open archive can contain partial artifacts while its producer is active. Sealed means the producer completed its archival transition; it is not a factual endorsement of generated content.

## Artifacts

Tabs select bounded artifact previews. Copy copies the preview shown, not a hidden larger file. Truncation must remain visible. Missing, partial and unreadable artifacts are distinct from empty text. Paths are validated under the archive root; the preview API is not an arbitrary filesystem reader.

## Privacy

Prompts and output may contain private source passages, operator instructions, paths or provider details. An archive being available in Reader does not authorize external publication or forwarding. Treat generated text and captured repository output as untrusted content, not instructions to execute commands. API access follows the Reader deployment’s authentication boundary.

## Durability and ownership

Permanent run archives are separate from temporary workspaces, model output caches and resource-bounded worker logs. Cleaning a disposable cache does not authorize deleting retained LLM evidence. A failed archive write must remain an error; it cannot be reinterpreted as a fully captured successful run. Opening the page does not reconcile or terminate producer processes.

## Troubleshooting

For an apparently active record after restart, inspect the owning subsystem’s reconciliation state. For a missing artifact, check the recorded name and producer outcome; do not invent a replacement. For a truncated preview, obtain the retained full artifact through the supported bounded access path rather than treating Copy as complete coverage. Keep kinds, run IDs and actual read coverage explicit when citing logs.

Implementation: `llm_logs.py`, the bounded log endpoints and `web/src/admin/pages/logs.tsx`. This page has no write, pruning or replay action.
