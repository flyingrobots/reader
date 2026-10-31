# Indexes: technical reference

## Overview

Reader’s Indexes page is a maintenance console for derived views of a plain-file vault. It compares stored projections with current files, exposes their capacity and completeness, and starts explicit rebuilds. Original source documents remain authoritative. An index rebuild does not file inbox arrivals, rewrite an author’s prose, mark documents as read, perform a backup, or synchronize files between computers.

The dashboard occupies the left pane. This Markdown reference occupies the right pane. Info buttons select a heading in this reference without navigating away from the dashboard. The contents selector and in-document section links provide direct navigation. On desktop each pane scrolls independently; on small screens they stack. The documentation is built from this file into the same frontend release as the dashboard, so it does not require access to the private vault’s documentation directory.

There are four rebuildable projections and one capacity report:

| Surface | Stored material | Used by |
| --- | --- | --- |
| Search index | File records, extracted passages, keyword indexes, optional embedding vectors | Keyword, fuzzy, semantic and hybrid search; related-reading suggestions |
| Browse indexes | Generated Markdown, charts, coverage inventory and README dashboard | Plain-file browsing and the web work inventory |
| Catalog SQL mirror | Validated document metadata and source/metadata hashes | SQL queries and metadata integrity verification |
| Link graph | Known paths, parsed links and resolution results | Link previews and Linked from |
| Other inventories | Counts measured from existing collections | Visibility of bounded collection limits; no rebuild action |

Edition links are a separate bounded, read-only diagnostic. Recent runs report this server process’s maintenance jobs.

## Model use and determinism

Ordinary text extraction, passage construction, metadata parsing, SQL updates, navigation generation and link resolution use code. Indexing does not send a chat prompt asking a generative LLM to summarize documents or choose tags. Generative summaries and tag suggestions on the Models page are separate tasks with separate controls.

**Keywords only** updates keyword search without embedding inference. **Rebuild with embeddings** additionally uses a trained language model to encode passage text as numeric vectors. This is model inference, even though it does not produce sampled prose. A freshness check does not generate embeddings or launch a generative-model job.

Rule-based content is reproducible when source bytes, settings, software/parser versions and calendar inputs are fixed. This does not promise identical SQLite files: build timestamps, row allocation, transaction history and storage layout can differ. Browse views depend on the UTC calendar date as well as metadata. Concurrent file changes can cause a consistency refusal rather than a valid result for a fixed snapshot.

Embedding computation depends on model identity, model files, provider implementation and numerical runtime. Floating-point vectors are not promised to be bit-for-bit identical across hardware or backends. Cached vectors are reused only under the matching model-input/model-signature key. Semantic similarity is a retrieval heuristic, not a factual verification or reading receipt.

## Update policy and schedules

There is no recurring index-rebuild schedule or filesystem watcher. Changing a source file does not automatically enqueue Search, Browse or Catalog work. Filing procedures call for explicit metadata/catalog, search and browse maintenance after completed imports or edits; those procedures are not an always-running reconciliation service.

Opening Indexes calls the freshness-check logic once per page visit. If the first saved check timestamp is absent or older than two minutes, and no job/check is active, the client requests a full check. Overview reads existing status but does not start this check. **Check again** explicitly requests another full check. A rebuild normally triggers a follow-up freshness audit.

The link graph has one special trigger: the first document backlink request can start a quiet graph build when no graph is available. An existing graph can report that it is stale; that signal does not itself rebuild it. A failed initial build is surfaced rather than retried indefinitely through the same path.

The Reader application updater’s schedule updates software. It does not schedule library indexing. Content can therefore move ahead of all saved projections until their maintenance is explicitly performed. Keyword coverage and embedding coverage can also diverge when embeddings were not requested or a bounded build stopped early.

## Freshness checks

A check runs these probes sequentially: Search, Browse, Catalog, Links, then Other inventories. Each probe’s error is converted into that probe’s error state and message; other probes continue. Results are collected privately and published as one `checks` snapshot after the final probe, with per-probe `checked_at` timestamps. A first check after server restart has no previous values to display. During later checks, previous measurements can remain visible.

The checks have different evidence contracts:

- Search and Links compare file inventory metadata with saved index records. Size/mtime agreement is not a cryptographic source-integrity proof.
- Browse performs check-mode generation and compares the bytes that would be published with current generated output.
- Catalog inventories and hashes sources, parses metadata, and compares expected SQL records with the mirror.
- Capacity measurements count bounded collections and inspect configured resource usage.

A check can be expensive without running a model. Browse still constructs its navigation output in check mode, and Catalog streams source bytes for hashing and validates metadata. The same library may be walked by several probes. Native file locks can add waiting time. There is no general per-phase progress/deadline mechanism around the entire freshness audit.

The client polls maintenance status every 1.5 seconds while maintenance, verification or the local-model summary reports activity, and every 15 seconds otherwise while visible. Polling latency is additional to probe execution time. A failed refresh preserves the last snapshot with a warning; it must not appear as zero usage or proof of freshness.

### Checked versus built

**Last checked** means when drift or capacity was measured. **Built** means when a projection was last published, as recorded by that subsystem. A fresh check of an old projection can correctly say Needs rebuild. The latest full-check duration comes from completed `check` jobs in the current server process; it is not an estimate of the next rebuild’s duration.

## Status and action semantics

| State | Meaning | Appropriate action |
| --- | --- | --- |
| Current | The probe’s currentness/completeness criteria are satisfied | Inspect if needed; no automatic repair implied |
| Needs rebuild | Known source/output drift | Activate the status button or the explicit rebuild control |
| Partial | Search stopped early or text passages still lack embeddings | Inspect the message, then resume with embeddings if appropriate |
| Not built | Required stored projection is absent | Build it using the primary action |
| Not configured | Browse maintenance settings are absent | Configure browse settings; rebuilding alone is not configuration |
| Error | A probe or consistency check failed | Read the error before choosing a repair |
| Within limits | Known inventory counts are below warning thresholds | No rebuild action |
| Near a limit | At least one known count is at or above 80% of its limit | Inspect usage and the subsystem’s operating contract |
| Over a limit | A known count exceeds its limit | Resolve capacity/scope; a rebuild does not raise the limit |

For rebuildable indexes, stale/partial/missing status is a Button in both the health table and inspector. It starts the primary action: embeddings search, browse refresh, catalog sync or graph refresh. Search also has a prominent rebuild action above the charts. Current/error/capacity-only states remain badges; rebuilding is not a universal repair.

Actions are disabled while the page knows maintenance or post-rebuild checking is active, when status is unavailable, or when running in the static demo. Info buttons and reference navigation remain usable. A status button is an action, not an acknowledgement that a repair has happened.

## Search index

### Search storage and schema

The active format is `.reader/search.v2.sqlite3`. Format 1 at `.reader/search.sqlite3` is retired and is not used for search. The active database contains settings, `docs`, `passages`, `chunks`, FTS5 `terms` and FTS5 `names`.

`docs` associates a relative source path with its digest, metadata, extraction status, size/mtime, schema/revision values and diagnostics. `passages` stores unique passage text and optional vector blobs. `chunks` maps source locations to passages, including PDF page or line coordinates. Multiple source locations can point to the same passage. `terms` indexes passage text with SQLite’s `unicode61` tokenizer; `names` indexes paths. A file count, passage count and chunk count consequently measure different things.

The source inventory is rooted in `library/`. Hidden directories, hidden filenames, operating-system junk and directory symlinks are excluded by the search freshness walker. Inventory rules differ from Catalog and edition diagnostics; differing counts do not by themselves indicate lost content.

### Extraction and passage construction

Supported text/PDF extraction and the selected `content_types` determine whether a source contributes searchable passages. Markdown frontmatter and common presentation markup are handled through the search text-extraction rules, with location mappings retained. Long text is bounded into passages rather than sent to a model as an unbounded file. PDF text is extracted from its text layer; there is no OCR step that invents text for image-only pages.

Machine-oriented text files outside selected content formats can remain searchable by path only. Unsupported files or files without extractable text also have path-only status. Path-only coverage is useful but does not mean their contents can be found semantically.

Default content formats are `.md`, `.txt`, `.pdf`, `.html`, `.tex`, `.rst`, `.edict` and `.bib`. Broader text-decodable formats exist, but content indexing remains governed by settings. Read the extraction diagnostics before interpreting a partial result as a missing file.

### Incremental publication and completeness

The indexer checks existing source records, updates changed work, removes deleted records, and reuses content/model cache entries where valid. Work is published in transactions of up to 64 files, with a savepoint around each file. A failing file rolls back its own work rather than publishing half its records. SQLite WAL allows concurrent search reads. `updated_at` records batch publication, while `complete` becomes true only when the run reaches completion and handles removals. Work is published in bounded batches; a worker deadline or capacity refusal is not permission to continue in an unbounded process. Completed work can remain saved when a later file or batch fails. A stopped rebuild reports its partial status and can be resumed.

Initial completed builds are validated before normal use. A validation failure marks the candidate incomplete and produces a clear error rather than declaring success. Do not infer that every build is one atomic replacement of the entire library: the implementation deliberately retains completed batches.

Search freshness compares current inventory with indexed size/mtime records and reports counts of new, changed and removed files. It also checks completion and missing embeddings. An unfinished build takes precedence as Partial; otherwise drift produces Needs rebuild, and missing embeddings on an otherwise current inventory produce Partial.

### Retrieval after indexing

Keyword retrieval uses the stored FTS5 tables and BM25 ranking; fuzzy retrieval adds spelling/path similarity. Semantic retrieval embeds a query and compares it with saved passage vectors. Query embedding is another inference operation, distinct from rebuilding the index; keyword/fuzzy lookup does not require it. The web search page ranks passage candidates from word/path and meaning channels with reciprocal-rank fusion and groups them into work results. Meaning candidates are bounded and filtered by similarity rules. Missing model/vector availability is reported; where the passage search path falls back to word matches, that fallback is explicit rather than pretending it performed semantic retrieval.

Returned source references are current paths and hashes. Search validates the returned source bytes, omits stale/deleted excerpts and can ask for a refresh. It cannot discover a new unindexed source merely because an old index can still answer queries. Ranking scores and edition preferences are retrieval decisions, not stable document identities or proof of source truth.

### Search actions

**Rebuild with embeddings** starts the `search` maintenance job. It updates text/path retrieval and generates missing vectors through the configured embedder, reusing matching cached results. First-time default-model setup may download model files.

**Keywords only** starts `search-keyword`. It avoids model inference and does not generate missing embeddings. It can therefore complete keyword indexing while semantic coverage remains incomplete. A configured model change can require a full embeddings rebuild; keyword-only operation is not a way to bypass a signature/model mismatch.

Both actions use the guarded search worker. They do not invoke the Models page’s generative queue and do not authorize source editing.

## Embedding model and privacy

The default backend is FastEmbed with `BAAI/bge-small-en-v1.5`, using the CPU execution provider on this machine. Model files are kept under `.reader/models`. The configured backend may instead use an OpenAI-compatible embeddings endpoint through the Models provider settings. The `openai:` prefix identifies that API shape; it does not by itself mean the public OpenAI service is being used. The older `lmstudio:` spelling also routes through the provider adapter.

The provider adapter calls an embeddings endpoint with text inputs, not a chat-completions prompt. Model/provider settings live separately from index capacity settings. Remote-provider use requires the provider’s explicit configuration/allowance; a permitted remote embedding service receives passage text and its relative-path context. Do not assume every configuration is local merely because the default is local. Inspect Models settings before enabling a different provider.

`.reader/embedding-cache.sqlite3` stores float32 vector results under a hash of the model signature, a separator and the full embedding input. Search builds that input as the relative source path, a newline and passage text. Reuse therefore requires a matching input, not merely a similar paragraph. The active index also deduplicates passage text in its passage table; that is a separate mechanism from persistent input-cache lookup. A model/signature change invalidates the corresponding reuse relationship. The default backend fingerprints its local model artifacts and runtime identity. A configured provider signature identifies its endpoint/model configuration; it does not independently prove that a server kept the same weights behind an unchanged model name. Cache capacity is separate from search database capacity. Reusing a vector does not mark a document read or make its claims true.

### Embedding coverage

The coverage ring’s denominator is **indexed text documents**, not all library files or all catalog works. A document with at least one unembedded passage counts as Needs embeddings. Fully embedded is the indexed-text count minus that count. A path-only file is excluded from this measure.

The displayed percentage is rounded. It is not a “percent of the whole library understood” measurement, an indexing progress bar or a factual confidence score. A stale search inventory may omit new files even if its stored text documents have complete embeddings. Inspect freshness and completeness together.

## Browse indexes

Browse reads `indexes/settings.json`, gathers bounded metadata units, applies grouping and author aliases, and generates grouped Markdown navigation, chart assets, `indexes/coverage.json` and the marked README dashboard. The coverage inventory feeds the web application’s grouped work view; a work is not synonymous with one physical file.

`Browse.run(check=True)` constructs expected output and compares bytes, reporting how many navigation files would change. It does not publish them. Refresh uses the same generation path and writes changed generated outputs. It protects against symlinked output paths, malformed README markers and overwriting unrelated Markdown. Native `.reader/browse.lock` serializes cooperating browse operations.

Calendar-dependent pages use the current UTC date. Fixed source metadata can therefore produce a different date-dependent dashboard after a day boundary. This is an explicit input, not generative randomness.

The dashboard’s Works value counts grouped work entries; Files that would change counts generated output differences, not source-document edits. Without browse settings the state is Not configured. Browse refresh does not rebuild semantic search, update the SQL mirror, verify delivery payload integrity or grant reading credit. Generated navigation and README changes belong in the vault’s normal reviewed commit workflow.

## Catalog SQL mirror

The mirror is `.reader/catalog.sqlite3`. Authoritative metadata may be direct document frontmatter or an independently owned metadata record for preserved content. Catalog operations use `.reader/catalog.lock`; they reject unsafe symlinks, orphan metadata, duplicate identities/owners, schema problems and source changes that violate consistency checks.

A check streams source bytes into digests, reads metadata, constructs canonical expected rows and compares them with the stored SQL mirror. It is a deep validation, not a cheap read of the database timestamp. The source-byte measurement describes inventoried source content, not the size of the SQLite database.

**Sync** runs `catalog sync`: revalidate sources and metadata, check that inputs have not changed during preparation, and publish the derived SQL mirror and catalog navigation. It does not implicitly run a source migration. Metadata migration is a distinct, deliberately explicit workflow; a Sync button must not silently rewrite protected originals.

The state becomes Needs rebuild for expected SQL drift that requests a sync. Other catalog validation failures remain Error. A consistency refusal calls for diagnosis or retry after the writer finishes, not blindly increasing a limit.

## Link graph

The graph is `.reader/links.sqlite3`. Its inventory includes known paths; bounded Markdown files are parsed for links and metadata relevant to resolution. Oversized or beyond-parse-limit Markdown can remain path-only. Resolver behavior distinguishes resolved links from unresolved targets instead of inventing a destination.

Refresh reads only files whose size/mtime changed, removes obsolete source records and updates link resolution. Changes to the primary work inventory can also require re-resolution. A successful refresh publishes a new graph; a failure retains the previous usable graph. Link graph refresh has its own synchronization in addition to the maintenance admission lane.

Freshness compares current paths and size/mtime with stored records. The stale signal is cached for up to 30 seconds in the graph’s normal read path. “Documents read” means documents parsed by this graph builder, not documents read by a person. “Unresolved” means graph targets that did not resolve under the resolver’s current rules; it is not a license to repair sources automatically.

The initial backlink request can start a quiet build if no graph exists. Later stale flags do not automatically refresh an existing graph. **Refresh** explicitly starts the `links` job.

## Capacity limits

Limits protect shared disk, CPU, memory and bounded collection processing. They are independently enforced by subsystem code. A dashboard count is observability, not an override, quota or guarantee that every future operation fits. Keep the workstation’s resource instructions and native locks in force.

### Search budgets

Search settings are under `search` in `indexes/settings.json`:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `max_passages` | 400,000 | Maximum unique passages |
| `max_database_mib` | 2,048 | Search database capacity in MiB |
| `max_cache_mib` | 1,024 | Embedding-cache capacity in MiB |
| `worker_timeout_minutes` | 60 | Guarded worker time allowance |
| `worker_threads` | 4 | Worker CPU/inference thread setting |

Accepted bounds are 1–5,000,000 passages; 16–3,072 MiB database; 16–2,048 MiB cache; 1–240 minutes; and 1–8 threads. Database/cache budgets must also fit the combined allocation rule, leaving room inside the overall generated-data budget. A setting’s individual range is not approval to consume that entire range on a shared workstation.

The current guard records a 4 GiB generated `.reader` data budget, a 16 MiB result/log allowance, a 20 GiB build-environment admission bound and a 4 GiB measured worker-group memory bound. Build-environment usage is checked before launch and recorded afterwards; data, logs, worker memory and free space are monitored while running. These sampled watchdog checks are not filesystem quotas and can detect a breach after it occurs. They do not authorize ignoring a stricter workstation policy. Its owned runtime directory redirects temporary/cache/bytecode outputs; it records a launch contract and final measurements. An internal clean deadline precedes the hard timeout so completed files can checkpoint before termination.

The guarded worker uses `.reader/search-run.lock` and the index’s native coordination, runs in an owned runtime location, enforces configured file/CPU/memory/time and generated-output protections, checks available space and saves bounded diagnostics. Timeout or capacity termination must stop owned child work. An idle web request must not silently launch an unrestricted replacement worker if admission fails.

### Other subsystem bounds

Catalog source inventory is bounded at 50,000 files and 2 GiB of source bytes. Browse is bounded at 10,000 grouped works, with additional metadata/output byte bounds. The link graph walks at most 100,000 files, parses at most 10,000 Markdown files, treats Markdown over 4 MiB as path-only, and bounds links/store size. These are different inventories with different definitions.

The Other inventories card measures grouped works, inbox files, participants and annotation threads. Its current collection limits are 10,000 works, 10,000 inbox files, 100 participants and 5,000 threads. Known counts at or above 80% produce Near a limit; counts greater than the limit produce Over a limit. Unknown counts remain unknown and are not silently treated as zero.

A capacity problem should be resolved by checking scope, retention and the applicable guard. Do not raise limits merely to silence a badge. A real budget increase is an explicit operational decision.

## Dashboard measurements

The health table compares the five surfaces. Selecting an index name changes the inspector; chart selection can do the same. Inspector values are from the last published check snapshot, even while another audit is running.

| Measurement | Interpretation |
| --- | --- |
| Built | Last publication timestamp/date for that projection |
| Library files | File inventory under that probe’s selection rules |
| Indexed | Search document records; includes path-only records |
| Passages | Unique searchable passage records, compared with their budget |
| Database | Measured active search database allocation against its configured capacity |
| Embedding cache | Cached vector database usage against its separate capacity |
| Machine files | Files indexed by path only under content-type policy |
| Text without embeddings | Indexed text documents with at least one missing passage vector |
| Works | Grouped browse entries, not physical source files |
| Files that would change | Browse output differences discovered by check-mode generation |
| Records | Catalog records under the metadata ownership contract |
| Sources | Catalog inventoried source bytes against the source-content budget |
| Documents read | Link-builder parsed documents, not human reading coverage |
| Links / Unresolved | Graph totals under the resolver’s current inventory |

Current-summary counts include checked surfaces in Current or Within limits. Needs attention includes known stale, partial, missing, near/over or error results. Not configured is distinct from a repairable stale projection. An unmeasured surface contributes no fabricated currentness or capacity value.

## Interactive charts

D3 computes SVG geometry and React renders it inside shadcn Cards. The coverage ring uses the indexed-text denominator described in [Embedding coverage](#embedding-coverage). Hover/focus highlights a segment; activating it selects Search in the inspector. Its legend exposes exact counts without requiring color recognition.

Capacity & headroom has Storage and Inventories tabs. Each bar’s denominator is its own configured limit, so percentages can compare otherwise unlike quantities. They must not be added as one global utilization rate. Catalog source bytes are a content-inventory budget, not catalog database disk usage.

Hover/focus exposes exact usage. Keyboard Enter/Space or pointer activation selects the related inspector. Bar geometry stops at its limit, but an over-budget percentage remains visible above 100%; missing values are omitted, not plotted as empty capacity. **View chart data** exposes plotted values in a Table. Resize handling preserves readable labels at narrow container widths and disconnects when unmounted.

Chart interaction does not start a rebuild, run a model or change source files. Charts show saved measurements, not a continuously streaming filesystem scan.

## Maintenance jobs and recent runs

The web server has one admitted maintenance `running` job. `Maintenance.start()` validates its kind and refuses a second simultaneous start with a busy response instead of queueing it. Search, Browse, Catalog, Links, legacy-index removal and supported companion install/start jobs share this lane. This is not a restriction that the HTTP server can only serve one request or that all model jobs use the same runner.

A job records its ID, kind, label, start/finish timestamps, state, elapsed seconds, result/error, quiet flag and optional progress text. Work runs in a background thread; exceptions become failed job results. History is an in-memory deque capped at 20; the dashboard shows at most 10 recent entries. A server restart loses that history and cached freshness checks. No durable queue, cancellation interface or per-phase audit trace is implemented here.

After a non-companion rebuild, the implementation records job completion, clears `running`, sets `checking`, and performs a full follow-up audit. That audit is outside the recorded rebuild elapsed time. The UI disables actions during it. Backend start admission currently tests `running` rather than `checking`, so another API client can start work during that verification interval; the UI’s restriction is stronger than the backend guarantee. Do not assume this is a complete resource scheduler.

A quiet initial graph build checks only the graph afterwards and suppresses ordinary job toasts. Companion operations do not force the full index audit. Other jobs normally trigger the full follow-up check. Starting and finishing a rebuild replaces the corresponding job toast; failures carry their bounded meaningful message. You may continue reading while work runs.

## Edition-link diagnostics

The Edition links card requests `/api/editions/diagnostics` independently of maintenance checks. It builds a bounded read-only interpretation of originals, reading copies and numbered versions from headers and filenames. It reports family count, inspected Markdown files, elapsed build time, coverage limits and unresolved references.

Bounds include 20,000 files, 8 KiB of header bytes per source, 16 MiB of aggregate header reading and 32 entries per returned family. A partial diagnostic must remain labeled Partial rather than claiming full library coverage. An unresolved `previous_version`, copy or original relation is shown with the path, field and value; Reader does not guess a repair or rewrite the document.

Edition families differ from grouped browse works, search documents and source files. They should not be compared as if their counts used the same unit. This card has no rebuild/repair button because it is a diagnostic, not an instruction to alter provenance.

## Retired search index

If `.reader/search.sqlite3` exists, Search exposes an explicit **Remove** action for the retired format-1 index. This is cleanup of the retired database and its known sidecars, not a rebuild of format 2 and not removal of source documents or the embedding cache.

Removal refuses while the search lock is held or SQLite indicates another process is using the legacy database. The operation is explicit and appears in Recent runs. If format 2 is missing, build it to restore active search; the old file is not silently treated as a valid fallback format.

## HTTP API and command line

The browser uses the existing authenticated, same-origin request conventions; state-changing calls require the Reader write token. Index documentation is bundled static text and exposes no arbitrary local-file read API.

| Request | Purpose |
| --- | --- |
| `GET /api/maintenance` | Read in-memory job/check snapshots plus a lightweight local-model activity summary |
| `POST /api/maintenance` with `{"action":"start","kind":"check"}` | Start the full freshness check |
| Same POST with `search` / `search-keyword` | Start guarded search indexing with / without embeddings |
| Same POST with `browse` / `catalog` / `links` | Start the corresponding refresh/sync |
| Same POST with `remove-legacy-search` | Explicit retired-index cleanup |
| `GET /api/editions/diagnostics` | Independent edition-reference diagnostic |

Unknown jobs or malformed bodies fail validation. Concurrent admission fails busy rather than becoming a queued job. Companion setup kinds are started through their companion API rather than bypassing that API via maintenance requests.

In web command mode, `:check` requests freshness checking; `:rebuild search`, `:rebuild keywords`, `:rebuild browse`, `:rebuild catalog` and `:rebuild links` start the matching maintenance job. Typing shows contextual suggestions. Selecting/filling a suggestion is not execution; Enter executes a complete selected or typed command.

For local operating procedures, use the installed Reader helper with the configured vault: `reader index` for semantic indexing, `reader index --no-semantic` for keyword-only indexing, `reader browse` / `reader browse --check` for navigation, and `reader catalog sync` / `reader catalog check` for the mirror. Follow the repository’s coordination and resource instructions. Do not substitute an unguarded process for a refused web rebuild.

## Troubleshooting and recovery

### Checking appears stuck

Inspect whether the page is measuring freshness or rebuilding. A full check includes navigation generation and source hashing, and results currently publish together. Previous measurements may still be displayed. Inspect the active job, native-writer contention and error results before restarting anything. A slow card does not prove the Tailnet connection is slow or that an LLM is generating text.

### Search is current but semantic coverage is low

Read the completion and missing-vector information together. Keyword-only work does not fill vectors. New text, a stopped build or a changed model can require an embeddings rebuild. Run the guarded embeddings action if appropriate; saved matching cache entries can avoid repeated inference.

### New content does not appear

Identify which saved projection the UI is using. Newly delivered inbox content is not a filed library holding. After filing or edits, refresh Browse for the work inventory and Search for retrieval; Catalog and Links have separate maintenance. A full check diagnoses drift but does not publish those updates.

### A job fails or remains unavailable

Read the retained error. Typical categories include missing settings/model/provider, invalid metadata, inconsistent source changes, unsafe symlinks, database locks, resource capacity or a guarded deadline. Correct the actual cause and retry within the existing limits. Preserve partial results and unique failure evidence. Do not delete source material, raise limits, skip locks or relaunch work without its guard to make a badge green.

### A capacity count is missing or differs from another card

A missing value is unknown. Different inventory rules and units explain many differences: files, grouped works, edition families, passage records and parsed link documents are not interchangeable. Check the definition in [Dashboard measurements](#dashboard-measurements) before treating a mismatch as data loss.

## Implementation map and verification

| Code | Responsibility |
| --- | --- |
| `web/src/admin/pages/indexes.tsx` | Dashboard state, actions and inspector |
| `web/src/admin/pages/index-docs.tsx` | Reference pane, Markdown rendering and section navigation |
| `web/src/admin/pages/index-charts.tsx` | D3 coverage/capacity geometry and interactions |
| `web/src/reader-controls.tsx` | Status polling, check age, job start and toasts |
| `src/reader_mcp/maintenance.py` | Job admission, background execution and probes |
| `src/reader_mcp/search.py` | Extraction, passages, schemas, vectors, cache and search |
| `src/reader_mcp/search_guard.py` | Guarded search worker and resource protection |
| `src/reader_mcp/browse.py` | Generated metadata navigation and check-mode comparison |
| `src/reader_mcp/catalog.py` | Source hashing, metadata ownership and SQL validation/publication |
| `src/reader_mcp/links.py` | Link inventory, resolution and incremental graph refresh |
| `src/reader_mcp/editions.py` | Bounded edition relationships and diagnostics |
| `src/reader_mcp/local_model.py` | Provider configuration and embedding adapter |

The focused Indexes browser checks cover chart values, statuses, action dispatch, busy/unknown/error behavior, reference navigation and responsive bounds. Backend maintenance/search/catalog/browse/link/edition suites cover their own contracts with synthetic fixtures. UI checks do not establish arbitrary crash safety, a cryptographic freshness proof for stat-based probes, or reproducible model output across all providers. Use each subsystem’s detailed operating documentation and guarded verification workflow when changing its implementation.
