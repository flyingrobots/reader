# Models: providers, queues and generated outputs

## Overview

Models administers Reader’s language-model provider and explicit bulk tasks. It is distinct from indexing, agent command-line discovery and AI-TTS. Model outputs are attributed machine suggestions, not verified source statements or human reading credit. Opening the page probes status and reads settings; it does not press Run on your behalf.

## Provider

Choose the provider preset, endpoint and model configuration through the form, then save. A local OpenAI-compatible API shape does not imply the public OpenAI service. Endpoint identity, availability and model IDs are separate concerns. A model listed by the provider may not be loaded or capable of every task.

Remote endpoints require the explicit remote allowance exposed by the provider controls. When allowed, document passages/prompts can leave this machine. A loopback endpoint is local transport, but operators should still understand what the configured server itself does. Credentials are secrets; do not place them in source documents, article prompts or public logs.

## Server

Server state reports whether the configured provider can be reached and which models it offers or has loaded. Start is supported only for the configured managed integration; Reader does not invent launch commands for arbitrary servers. Stop server is an explicit confirmation because the server may be shared with other tools. Stop for every tool affects that service, not just this page.

Unavailable, Off, Starting, Busy and Error are different states. An unreadable provider is not an empty model catalog. Inspect the returned message and endpoint rather than reinstalling unrelated companions.

## GPU coordination

GPU coordination reports whether Reader can participate in the workstation’s resource protocol. It is not a guarantee that every external application cooperates. Respect the displayed unavailable/busy state and existing worker budgets. Changing provider or model does not authorize lifting memory, disk or concurrency limits. A refused resource admission must not fall back to an uncoordinated duplicate run.

## Now

Now shows the active task, source/model identity and available live output or reasoning. Durations and throughput are observed measurements; they are not accuracy scores. Output arriving in the preview may still be rejected by task validation. The active source hash matters: an output for old bytes is stale after an edit.

## Queue

Enqueue eligible work through the task controls. Queue counts distinguish waiting and active items. Run explicitly begins processing; Pause requests the queue to stop advancing according to its displayed behavior. A current item may finish before the queue is paused. Cancel applies to its scoped active work and does not retract already stored output or affect unrelated agents.

Manual triggering is the implemented policy; nightly/idle automation is not implied by the existence of a queue. Do not treat queued, generated and accepted as equivalent. Inspect recent outcomes for validation rejection, transport failure, cancellation or interruption.

## Recent

Recent records identify task, model, source and outcome. Failed or rejected items retain their reasons. Model text can be fluent and still violate the task’s required format or evidence contract. A completed inference is not evidence that the generated result was accepted for use.

## Outputs in use

Outputs are stored with provenance and source identity in the local-model output store. Current versus stale distinguishes agreement with the source version, not truth. Pruning stale outputs is an explicit maintenance action on generated data; it does not erase source documents or permanently retained LLM archives. An output shown on an article remains machine-attributed.

## Tasks

Enable supported task kinds, select compatible model IDs and save task settings. Enabled means permitted for explicit queue/run operations, not an automatic background schedule. Model names are validated; malformed settings or unsupported remote URLs are refused before work begins.

## Embeddings

The embedding backend setting is also used by Search. Default indexing uses FastEmbed locally; configured OpenAI-compatible embedding providers can replace it. An embeddings request converts text to vectors and does not run the Models page’s generative queue. Changing embedding identity can invalidate cached reuse and require an embeddings rebuild. See the Indexes reference for exact cache inputs, completeness and guard behavior.

## Storage and archives

Settings, queue state and outputs live under `.reader/local-model/`. Settings include provider and task configuration; generated outputs use their own SQLite store, with queued/journal state kept separately. LLM archives under `logs/llm/` retain prompts/events/output independently of the working output cache. A server restart must not silently claim interrupted work completed or relaunch effects without reconciliation.

## Troubleshooting

For connection failures, check the endpoint and server first. For a missing model, inspect provider catalog and capabilities. For remote refusal, review the explicit allowance instead of changing unrelated indexing settings. For validation rejection, inspect the task reason and source/model version. For resource refusal, resolve the scoped owner/budget; do not launch another server or queue to bypass it.

Implementation: `src/reader_mcp/local_model.py`, `web/src/local-model.tsx`, shared provider/status APIs and the Models Admin panel. Controls and model output do not authorize source editing, filing, remote publication or changes to another voice’s identity.
