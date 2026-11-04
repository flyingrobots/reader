# Deterministic inbox processing

The `reader inbox` executable is the entry point. It starts the deterministic
script without requiring a skill or an agent session. Reader's **You got mail**
and Obsidian's **Process inbox** call the same supervisor; the optional
`you-got-mail` skill is a convenience adapter. Delivery alone does not start filing.
The workflow requires an existing Reader environment, an
initialized vault Git repository with a configured commit identity, git-locks,
and at least one usable model: see [the model order](#the-model-order). Install the pinned wide-md companion for
reading derivatives; formatter refusals remain visible in the report. Existing
library documents must already have valid catalog metadata; intake reports any
required catalog migration before moving its first arrival.

The script owns inventory, preservation, filing, validation and commits. A model
supplies bounded editorial decisions through a JSON schema. It runs without tools,
the operator's MCP/app configuration, subagents, web search or project instructions.
Existing legacy permission arguments remain accepted for older clients, but do not
grant the editorial model write access.

## The model order

Each decision walks a prescribed order: Codex, then Claude, then agy, then the
local model. Any failure moves to the next provider: not installed, out of usage,
not signed in, timed out, unreachable, or an answer that fails validation. A
provider found missing, out of usage or signed out is not asked again in that run.
Stopping a run stops the walk. If every provider fails, the run fails with each
reason, its queue is kept, and retrying resumes it.

Every step appears as it happens, naming the provider and the reason but never
source text: as a line in the Activity transcript, and under `model_chain` in
`GET /api/inbox`. The provider that decided each arrival is recorded as
`editorial_models` in the batch evidence, because the quality of a title or
description depends on it. Each decision's prompt, steps and answer are archived
under `logs/llm/inbox/` and committed on their own at the end of the run.

| Provider | How it is confined |
| --- | --- |
| Codex | `--sandbox read-only`, ignoring user configuration, with its tool features disabled |
| Claude | `--tools ""`, no setting sources, no MCP servers, no session persistence |
| agy | An empty scratch workspace whose `PreToolUse` hook denies every tool except `finish`. agy has no flag that removes its tools: `--mode plan` and `--sandbox` still allowed reads and writes when tested. An answer is discarded if the workspace changed. agy keeps its own conversation history under `~/.gemini`, so excerpts are retained there |
| Local | The Reader Admin provider, over HTTP, under the workstation GPU lock. No tools exist. A prompt over about 24,000 tokens is refused rather than truncated |

Codex, Claude and agy send excerpts to their vendors. Remove a provider from the
order to prevent that. Local-model decisions pass the same validation but have not
been shown to match the others' editorial quality.

Filing is librarian work, and Codex is the librarian. Any other provider is told in
its prompt that the librarian is out of office and that it is a stand-in for this one
task, not to adopt the librarian's persona, voice or name. The transcript says who is
standing in, and the archive's `meta.json` records `stand_in`.

The chain otherwise serves decisions that belong to no one. Voice turns and coding jobs do
not use it: an answer under one voice's name written by another provider would
forge that voice, and coding jobs run with write access.

**Settings** are per machine, in the ignored `.reader/model-chain.json`, edited on
Reader Admin's Models page (*Filing models*), and served by `GET` and
`POST /api/model-chain`:

```json
{"order": ["codex", "claude", "agy", "local"],
 "local": {"start": "lmstudio", "command": [], "model": ""}}
```

`local.start` says what to do when the local model is not ready: `off` fails over
with that reason; `lmstudio` (the default) runs `lms server start` and loads
`local.model`; `command` runs `local.command`. The command is an argument list with
an absolute program path, run without a shell, with a 5-minute limit. Only a browser
on the vault machine can see or change it, since it names a program to run there.
Shell aliases are not available: name the script itself. An empty `local.model` uses
the first text model the server lists. `READER_MODEL_CHAIN=codex,claude` overrides
the order for one process.

## Entry points

From the installed code checkout, invoke the executable directly:

```sh
.venv/bin/reader --root /path/to/vault inbox status
.venv/bin/reader --root /path/to/vault inbox start
.venv/bin/reader --root /path/to/vault inbox status
.venv/bin/reader --root /path/to/vault inbox stop
```

With `reader` on PATH, omit `.venv/bin/`. `READER_ROOT` can supply the vault path.
The executable dispatches to the supervisor, which invokes the intake script;
the intake script invokes the LLM and resumes deterministic processing afterward.
Neither script loads the optional ingress skill.
`start` returns the run identity without waiting. Inspect `status` for completion
and the report; use `stop` for explicit cancellation. These commands never push
or publish. A successful launch is not a completed import.

Only one supervisor runs per vault. Existing Upkeep intake claims and active
voice-chat turns block admission. Finish or reconcile those owners before
starting. A starting, running or interrupted inbox job blocks new Upkeep claims.

## Selection and editorial work

The runner freezes the selected file inventory, including substantive hidden
attachments. It rejects symlinks, embedded Git metadata, non-regular entries,
changing sources and invalid delivery receipts. It hashes every source before
classification. Receipts must have a canonical UUID, fit the delivery store's
128 KiB lookup limit, and uniquely identify their arrival. Later arrivals are
outside this queue.

The delivery's declared primary document gets excerpt priority over attachments.
The catalog planner checks incoming sources before filing. Unsupported wrapper
filenames containing `[]|#` and incompatible source metadata are deferred with a
diagnostic, preserving their original names and bytes. Identical raw bundles remain
distinct arrivals, with destinations bound to both arrival identity and content.
Before moving a fresh batch, the script checks aggregate catalog file capacity,
reserving catalog notes, collection indexes, possible reading copies and local
image assets. This count is conservative when formatting changes nothing or
several image references share one asset.
Byte admission also reserves the journal's existing 128 MiB generated-output
budget, so generated files cannot push an admitted batch over catalog capacity.

The script automatically partitions the queue into sequential commit batches,
keeping every original delivery bundle intact. It also partitions oversized
editorial context, including oversized provenance, into bounded calls and
combines their structured observations.
These are internal work boundaries: the user does not split deliveries or choose
chunk sizes. Completed model responses are cached by context hash in the journal
so an interrupted classification can resume without repeating those calls.

Context contains receipt provenance, the file inventory, existing collections,
and at most 96 KiB of textual excerpts, with at most 16 KiB from one file. Coverage
is explicit; a filename or truncated excerpt is not full reading. A model returns
the source key and snapshot hash, a file/defer decision, collection, slug, title,
source-stated author, bounded description and defer reason. Unknown authorship
stays empty. Invalid output or stale identity cannot authorize filing. Original
writing namespaces belonging to Reader librarian, Agy and Claude are reserved,
as are directory names excluded by Browse, such as `assets`, `reading` and `evidence`.

## Filing and verification

Each destination is `library/<collection>/<slug>-<arrival-identity-prefix>/`. The whole
bundle moves into `originals/`; raw single files use the same layout. Receipts
and original bytes remain unchanged. Catalog metadata uses independent sidecars
for these originals, including supplied frontmatter that is invalid or already
contains identity fields. Sibling reading copies retain their relative link
base. [Portable link repairs](portable-links.md) run on originals and derivatives.
The frozen paths of all arrivals in a commit batch map to their preserved
destinations, so absolute inbox links to attachments or other arrivals in that
batch keep working after filing. Repair records retain that mapping for later
repair passes without changing the source URLs.
Browse and curation associate a receipt beneath `originals/` with the outer
catalog, retaining its identity, primary document, provenance and arrival time.

The script acquires the vault's shared repository locks before mutation. It
refuses unrelated dirty catalog/navigation outputs. Every generated write has a
write-ahead hash and prepared bytes; retry accepts only its expected before/after
state. It verifies payload hashes, receipt integrity, catalog SQL consistency and
opted-in browse navigation, then commits exact owned files with normal Git hooks.
Another participant's staged files and later arrivals are excluded.

Canonical batch evidence lives in `activity/intake/<batch-id>.json`. Mechanical
filing does not mark independent reading, advance curation receipts or generate
quota-driven reaction essays. Search indexing remains a separate explicit action.

## Recovery and limits

Ignored `.reader/inbox-runner/` retains the frozen queue, pending batch journal,
prepared output blobs, model context, schema, structured responses, state, logs
and final result. A failed or stopped run keeps its queue and journal. Resolve
the reported cause, then explicitly retry `start`, including when the inbox is
empty because the batch already moved. Retries reconcile recorded destinations
and bytes; they never infer completion from an empty inbox.

A hook refusal remains an uncommitted batch. Repair the hook's reported cause;
do not bypass it. The built-in whitespace check covers generated outputs, not
preserved payloads. A vault hook that rejects original source whitespace requires
an explicit hook-policy decision; never edit preserved source bytes to appease it. Changed source bytes or edits to a journal-owned output require
reconciliation. Preserve both versions and the journal rather than deleting
records to force a restart. A previously existing destination is a conflict.

If the supervisor disappears, status becomes interrupted. Verify the recorded
supervisor and owned process groups, stop only processes confirmed to belong to
that run, then remove only stale `state.json` to permit a retry. Keep `queue.json`,
`pending.json` and prepared blobs. A lock left by a forcibly killed worker retains
its recorded lease; never steal another owner's acquisition.

The supervisor allows at most 30 minutes without script-owned progress. A completed
snapshot, a step down the model order, validated model response, recorded decision,
entry into filing, or committed batch renews that deadline. Model output streaming alone does not. Each
filing stage remains bounded to 30 minutes, within its 40-minute repository lease.
A finite frozen queue can span several such stages without manual restarts.
Cancellation allows up to 35 seconds for cleanup, including the 30-second lock
release call, before forcefully terminating remaining descendants.

The supervisor retains its 50 GiB host free-space reserve,
4 GiB runtime-data and process-memory bounds, 16 MiB aggregate output budget and
8 MiB per-stream cap. It tracks descendant process groups and terminates them on
cancellation or monitoring failure. The existing bounded-tmpfs exception applies
in test workers. These process controls are not filesystem quotas. Inputs remain
subject to the existing inbox/catalog capacity guards. Editorial calls have a
10-minute timeout and bounded input/output; automatic partitioning handles call
size, while invalid responses and exhausted resource budgets remain explicit
failures with recovery evidence.

Prepared generated output is capped at 128 MiB per commit batch. Queue/journal
JSON is capped at 8 MiB. Superseded prepared blobs are reclaimed only after their
replacement journal record is durable; blobs still referenced by another output
remain available for replay. Local image imports and link records have their own
[documented limits](portable-links.md). No heavy build or arbitrary source command
is part of intake. Each provider's account and authentication state is managed by
that provider outside Reader's disposable runtime output.

## Verification

Use the repository's guarded Python runner for `tests/test_intake.py`,
`tests/test_inbox_runner.py`, `tests/test_inbox_view.py`, and
`tests/test_portable_links.py`; then run the full checks before landing. Synthetic
fixtures exercise preservation, hidden attachments, context partitioning, later
arrivals, invalid decisions, source mutation, write interruption, hook failure,
retry ownership and child-process cancellation. A real authenticated model trial
and installed entry-point check are separate acceptance evidence.
