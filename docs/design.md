# Design and conventions

## Purpose and implementation

Reader is a Git-backed document library intended to be opened directly in Obsidian. Plain files and agent operating instructions remain its reading and cataloging interface. An optional Python delivery layer provides local stdio MCP tools, a CLI, and a reusable agent skill. Reading does not require running it. There is no required Obsidian plugin, scheduled job, or background filing service.

The optional desktop sidebar in `plugins/reader/` projects recorded relationships through Obsidian’s public APIs. It uses the existing CLI for library search and the AI-TTS Unix socket for queued speech. Neither integration replaces or edits original documents. The sidebar also launches explicit [Codex intake jobs](inbox-runner.md), stores shared participant receipts in `engagement/`, and projects separate [shared annotation records](annotations.md). See the [plugin contract](obsidian-plugin.md).

Plain files are the canonical record. Obsidian supplies browsing and search; Git can supply version history once changes are committed. Optional search uses a rebuildable local SQLite FTS5/embedding index; it never replaces the plain sources.

## Structure

| Path | Responsibility |
| --- | --- |
| `README.md` | Vault entry point and reader navigation |
| `AGENTS.md` | Standing librarian responsibilities |
| `inbox/` | Unprocessed arrivals; its README is permanent |
| `library/index.md` | Top-level catalog |
| `library/<collection>/` | Documents grouped by subject or project |
| `library/<collection>/index.md` | Collection catalog, created with its first document |
| `library/connections/` | Librarian-authored cross-project and conceptual synthesis, linked to source reports |
| `library/reflections/` | Dated librarian session-end reflections, separate from activity records and document reactions |
| `library/reactions/` | Librarian opinions, explicitly labeled and linked to their source basis |
| `library/<collection>/assets/` | Supporting files and original non-Markdown documents when needed |
| `docs/` | System architecture, contracts, capabilities, and operating procedures |
| `planning/roadmap.md` | Outstanding system work, acceptance conditions, and deferred options |
| `engagement/` | Durable participant-specific exact-version read receipts |
| `skills/reflective-reading/` | Section-based reflective reading, exact-quote annotation helper, and editorial synthesis |
| `skills/upkeep/` | Turn-boundary intake coordination, discussion checks, and relevant connections |
| `annotations/` | Durable per-thread JSON for source-preserving Markdown highlights and attributed discussion |
| `activity/` | Dated intake, reading, maintenance, decision, and validation records |
| `src/reader_mcp/` | Ingestion, receipt lookup, search/read engine and indexing guard, CLI, and MCP adapter |
| `skills/reader/` | Versioned agent delivery skill and checkout-resolving command helper |
| `scripts/` | Local installation and installed-boundary verification |
| `tests/` | Preservation, failure, concurrency, and MCP boundary checks |
| `catalog/metadata/` | Versioned metadata placeholders with embeds for preserved originals |
| `schemas/` | Versioned document JSON Schema and matching SQL table definition |
| `.reader/` | Ignored staging, locks, rebuildable metadata/search indexes, model cache, and bounded worker runtime; not canonical storage |

Create collections from actual material rather than predicting a taxonomy. Use short lowercase hyphenated names for new folders and curated document filenames. A document normally lives at `library/<collection>/<descriptive-title>.md`. Resolve collisions with a meaningful qualifier, such as a known source date or version; never overwrite another document. Keep a stable path after filing unless a move provides a clear organizational benefit.

MCP/CLI deliveries arrive as `inbox/<receipt-uuid>/` bundles. Their original payloads and `receipt.json` travel together when filed into `library/<collection>/<descriptive-name>/`. A librarian-created `index.md` catalog note holds curated frontmatter and links to the unchanged originals. This preserves receipt checksums and original relative attachment links. Direct-drop Markdown can still use frontmatter added to the source as described below.

## Documentation, plans, and activity

`docs/` explains the system's present behavior and how to use or maintain it. Keep intake narratives, reading progress, completed-work lists, session summaries, collection counts, and recorded test runs outside this directory. Update documentation when behavior, contracts, structure, or procedures change; a routine import does not by itself require a documentation edit.

`planning/roadmap.md` contains only outstanding work and conditional options, with scope, prerequisites, and completion conditions. Record completed outcomes in `activity/changelog.md` and remove them from the active roadmap. Historical snapshots under `activity/` preserve prior accounts without making them current instructions. Per-document receipts, manifests, and reading records remain with their library material.

## Metadata

Every regular file under `library/` has one versioned metadata record and one SQL catalog row. Editable librarian Markdown carries the frontmatter directly. Preserved originals, snapshots, receipts, attachments, and other formats use frontmatter-bearing placeholder notes under `catalog/metadata/`; each embeds its unchanged source using Obsidian syntax and supplies a standard relative link.

The shared document schema declares `frontmatter_schema_version`, `document_revision`, `title`, and `type`. A catalog envelope adds `document_id`, `document_path`, and `metadata_created`. Catalog and search use the same bounded codec. Legacy `schema_version` records remain supported without invented document revisions. Unknown historical filing dates use explicit null. Existing custom metadata is retained. Source edition/version fields are separate from the Reader schema version. The complete contract, SQL mapping, migration, validation, and recovery procedures are in [Versioned metadata](metadata.md).

Plain frontmatter remains authoritative. `.reader/catalog.sqlite3` is a disposable mirror with typed columns for the declared fields and complete JSON for custom properties. `reader catalog check` verifies every library file, metadata owner, identity, and SQL value. Metadata completeness does not establish source truth or count each attachment as a separate intellectual work.

## Navigation and preservation

Use relative Markdown links and descriptive link text. Every cataloged document must be reachable through the library index and its collection index. Each collection index lists its documents with short identifying descriptions. Avoid mandatory Obsidian-specific link syntax or plugins.

Keep attachments with their collection, using document-specific subfolders within `assets/` when filenames could collide. Check and repair local links when moving files, including incoming links elsewhere in the repository. Preserve original content, attribution, and meaningful version differences. Filing does not establish that a source's claims are correct.

The repository ignores machine-specific Obsidian workspace layouts, local trash, and operating-system clutter. Other Obsidian settings may be versioned deliberately if introduced; none are currently required.

## Books and reading editions

Reaction pieces use `type: note`, `kind: opinion`, and `author: Reader librarian`. They are editorial contributions, counted separately from source documents and connection notes. They may argue a position; they must make their evidence boundary visible. Source authors are not attributed the librarian's judgments.

Versioned multi-document design packages are kept together under their project collection. One frontmatter-bearing package index supplies provenance and links to the unchanged source documents in their intended order. Count the package and its component files explicitly rather than treating implementation task specifications as completed reports or executable Reader work.

`library/books/<title-and-edition>/index.md` catalogs a book as one work. Preserve supplied files in `originals/`, recording their hashes in `originals/SHA256SUMS`. For plain-text sources, clearly labeled derivatives in `reading/` can supply frontmatter, original-source links, and previous/next navigation. Preserve supplied ordering, including fractional chapter numbers. Do not infer an exact publication date from an edition year. Reading pages and source segments are not counted as separate books or reports.

Markdown filing uses the pinned wide-md formatter through `reader reading-copy` to produce labelled sibling derivatives with independent metadata and source/tool hashes. Sibling placement preserves relative link bases. See [reading-copy contracts](reading-copies.md).

Original formatting remains available; a text-preserving reading derivative is not a claim of visual or editorial restoration.

For sustained reading of a long PDF, an optional `reading-record.md` beside its catalog records part ranges, coverage, dated reactions, and questions carried forward. The original remains intact. Reading units and progress notes do not increase source-work or opinion-piece counts. A separately labeled reading-check note may retain runnable finite calculations and observed outputs supporting an opinion; it remains supporting librarian evidence, not a source work or installed tool.

## Delivery implementation

The shared `Store` validates inputs, reads explicitly selected local files, hashes their bytes, stages a complete bundle, and publishes it with one directory rename. Local processes coordinate through a file lock. A request UUID and content/provenance fingerprint make identical retries idempotent and conflicting retries explicit. Status derives filing state from the bundle's location and verifies payload checksums; disappearing receipts report `not_found`.

The implementation targets macOS/Linux with Python 3.11+, Pydantic 2, and the official MCP SDK's pinned v1 maintenance line. The lockfile fixes resolved versions. The SDK handles protocol lifecycle and schema generation; the adapters share all storage behavior. See [delivery documentation](delivery.md) for limits, setup, and recovery. Neither git-cas nor Keep is integrated.

## Research archives and repository packets

Research packages remain intact under `library/research/<original-package-name>/`, including hidden metadata, build definitions, licenses, and supplied outputs. Each gets a catalog wrapper and a librarian-generated hash inventory. Series numbering and release metadata belong to the source; discrepancies are documented separately. Source-only papers remain source-only unless an explicit derivative is produced.

Repository context packets remain canonical originals in their project collection. A `snapshot/` reading tree may reconstruct included files when byte counts and per-file hashes can be verified. Its parent catalog describes derivation, selection limits, and source-status discrepancies. Extracted source files do not gain frontmatter or have their links rewritten. They are supporting archival material, not executable Reader configuration or additional separately counted reports.

Coordinated governance suites live under `library/governance/<title-and-version>/` and count as one suite with explicit component counts. A shared catalog records each component's source-stated role and precedence. Combined reading editions and standalone components are preserved separately; overlap does not establish complete equivalence. Source normative language is cataloged without implying adoption by Reader or legal enforceability. When a missing companion arrives, update the current catalog and add dated context to existing editorial notes while preserving historical intake records.

## Search implementation

The shared `Search` engine indexes file paths and overlapping source passages into SQLite FTS5 and stores local FastEmbed vectors. RapidFuzz supplies typo matching; hybrid retrieval fuses document ranks. An explicit guarded CLI refresh hashes sources and updates the index transactionally. A separate bounded embedding cache checkpoints completed batches for retries; a model-byte fingerprint prevents combining vectors from different model states. Source hashes and line/page coordinates connect results to bounded reading. See [search](search.md) for dependencies, resource controls, extraction limits, freshness, and recovery.

Participant-specific exact-version read receipts and turn-boundary upkeep follow the [engagement contract](engagement.md). Receipt state is separate from source metadata, annotation authorship, and partial reading records.

The sidebar separates Library, Discussion, and Inbox into keyboard-accessible tabs. Obsidian opening events acknowledge the displayed document or discussion for its configured participant; background rendering and CLI/MCP retrieval do not. Agent reading receipts retain their actual-reading requirement.

## Code and vault locations

This reference describes the configured private vault unless a code checkout is explicitly named. See [separate-vault installation](separate-vault.md). Run software setup/build commands in the code checkout and pass the private vault explicitly to CLI commands and the plugin installer. `$READER_ROOT` is the private vault path. Source documents, runtime stores, and reading activity stay in the vault.
