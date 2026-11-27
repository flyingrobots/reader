# Models: providers, queues and generated outputs

## Overview

Models administers Reader’s language-model provider and explicit bulk tasks. It is distinct from indexing, agent command-line discovery and AI-TTS. Model outputs are attributed machine suggestions, not verified source statements or human reading credit. Opening the page probes status and reads settings; it does not press Run on your behalf.

## Provider

Choose the provider preset, endpoint and model configuration through the form, then save. A local OpenAI-compatible API shape does not imply the public OpenAI service. Endpoint identity, availability and model IDs are separate concerns. A model listed by the provider may not be loaded or capable of every task.

Remote endpoints require the explicit remote allowance exposed by the provider controls. When allowed, document passages/prompts can leave this machine. A loopback endpoint is local transport, but operators should still understand what the configured server itself does. Credentials are secrets; do not place them in source documents, article prompts or public logs.

## Server

Server state reports whether the configured provider can be reached and which models it offers or has loaded. Start is supported only for the configured managed integration; Reader does not invent launch commands for arbitrary servers. Stop server is an explicit confirmation because the server may be shared with other tools. Stop for every tool affects that service, not just this page.

Unavailable, Off, Starting, Busy and Error are different states. An unreadable provider is not an empty model catalog. Inspect the returned message and endpoint rather than reinstalling unrelated companions.

## LLM Sanity Check

Save the provider and model above, then use **LLM Sanity Check** to send a short message directly to that selection.
The panel shows replies, streamed reasoning when supplied, and startup diagnostics. Startup command output appears
when the command finishes. This check has no document access or tools and never falls through to another provider.
New chat clears the browser conversation; changing provider/model also starts a new conversation.

When a loopback server or selected LM Studio model is unavailable, the check uses the separate startup settings in
**Filing models**: LM Studio, a saved executable with arguments, or no startup. Custom commands run without a shell;
use the executable behind a shell alias. Only a browser on the vault machine can edit that command. Remote endpoints
are never started by local commands. Startup and inference share the existing GPU admission mechanism.

`POST /api/llm-check` accepts `id` (a fresh UUID), `model`, `base_url`, and alternating `messages` with `role` and
`content`, ending in a user message. The provider and model must match saved settings. It returns `state`, `text`,
`reasoning`, `output`, and `error`. `GET /api/llm-check?id=…` returns the current request's bounded preview; another id
returns `idle`. The API uses Reader's normal HTTP access and POST-token checks. Only one check runs at a time.
The last check stays in server memory until replaced or restarted; no transcript is written to the vault.
Limits are seven prior exchanges, 24,000 input characters, 2,048 output tokens and 90 seconds for inference, plus
the existing startup and GPU admission deadlines. A failed attempt preserves the draft for retry.

Article-chat mentions are configured separately in `voices.json`; see [the LLM voice command](voices.md#llm-voice).

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
