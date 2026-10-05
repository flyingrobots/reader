# Versioned document metadata and SQL catalog

Plain files are authoritative. Catalog and search use one codec and one set of metadata field rules in `reader_mcp.metadata`. SQLite contains rebuildable projections. Validation and synchronization do not rewrite preserved originals or delivery receipts.

## Document contract

Newly authored documents use this frontmatter:

```yaml
---
frontmatter_schema_version: 1
document_revision: 1
title: Example design
type: design
depends_on: []
---
```

`frontmatter_schema_version` identifies the metadata contract. Only integer 1 is supported. `document_revision` is an integer from 1 through 9223372036854775807. It identifies the author's revision of the metadata-owning document. Neither field is a content hash, edition, receipt version, database schema version, or inferred history. Increase the revision for substantive changes. Validation checks its type and range, not historical monotonicity.

The required document fields are those four fields. Title and type are nonblank strings. Preserve source type taxonomies, including `Feature`, `Decision`, `Research`, `Investigation`, `handoff`, `design`, and `roadmap`. Optional fields are author (string or string list), source (string), added/created/updated (valid calendar date strings), and tags (string list). Dates use `YYYY-MM-DD`. YAML date scalars normalize to ISO strings. Omit unknown dates or use null; never invent source history.

Custom metadata stays as bounded JSON-compatible mappings, lists, strings, numbers, booleans, and nulls. Empty lists remain `[]`. Explicit canonical versioning requires block mappings, block nonempty lists, and unquoted property names. Flow mappings, including `{}`, are not an authoring form. YAML aliases and merge keys, duplicate/non-string keys, unsupported values, nonfinite numbers, and malformed UTF-8 headers produce diagnostics. Headers are limited to 16 KiB, normalized values to 10,000, and nesting to 20 levels. The header is decoded separately from the body.

`reader metadata-schema` exports the document JSON Schema. Calendar patterns and `date` formats are included; external JSON Schema validators must enable format checking. Python always checks real calendar dates. YAML style, syntax, and resource constraints are additional codec rules.

## Catalog identity and sidecars

Each regular file under `library/` has one catalog entity. Editable librarian Markdown can own its catalog metadata directly. Preserved originals, receipts, attachments, and other formats use separate Markdown metadata owners under `catalog/metadata/`. For example, `library/books/example/book.pdf` has a sidecar at `catalog/metadata/books/example/book.pdf.md`.

A catalog envelope extends the document contract with:

| Field | Meaning |
| --- | --- |
| `document_id` | UUID for the catalog entity; preserve it across a reconciled move |
| `document_path` | Normalized vault-relative target beginning with `library/` |
| `metadata_created` | Valid calendar date when the metadata owner was created |
| `kind` | Optional source qualifier |
| `schema_version` | Deprecated alias accepted only for legacy catalog compatibility |

The envelope preserves arbitrary document types and permits unknown filing dates. The stricter curated-note profile additionally requires `added` and a Reader kind: `report`, `note`, `reference`, `document`, or `book`. These profiles share the document field constraints; they are not independent schemas with competing version fields.

A sidecar revision describes the sidecar. It does not assign a revision to its unchanged target. SQL `metadata_path` identifies the owner. Search reports frontmatter from the source itself and does not silently inherit sidecar revisions, titles, or provenance. File-level catalog entities are not counts of intellectual works.

Each sidecar embeds its source using a full vault-relative Obsidian link and supplies a standard relative Markdown link. For example: `![[library/books/example/book.pdf]]`. Native Obsidian format support determines rendering. The embed is not a conversion. Paths containing wiki-link delimiters require explicit disposition. [Placeholder navigation](../catalog/index.md) links the records.

## Legacy compatibility

Existing catalog envelopes can declare `schema_version: 1` without canonical version/revision fields. Catalog synchronization accepts them through the shared legacy profile. It retains their alias and declared fields; it does not invent canonical values. Both SQLite projections use NULL for missing canonical versions and revisions. `catalog` reports `legacy_metadata`; search exposes `metadata_status: legacy` with diagnostics. Unknown aliases, unknown canonical versions, or partially supplied canonical fields refuse validation.

Ordinary unversioned originals can use their own metadata taxonomy or no frontmatter. Search preserves safe source metadata without imposing Reader identity fields. Invalid headers remain discoverable by path and receive diagnostics; malformed UTF-8 can prevent text extraction. New incoming payloads remain byte-for-byte intact. Delivery does not require frontmatter.

`validate-metadata` rejects invalid and legacy metadata by default. `--allow-legacy` explicitly enables a compatibility audit. Use `--profile document` or `--profile catalog` when automatic classification cannot identify an intended authored note. Automatic classification recognizes versioned documents, catalog envelopes, receipt wrappers, and notes with a filing date and Reader kind. A missing header on an unrelated source is not an error.

For a deliberate note revision, add the canonical version and an author-selected revision, validate, then synchronize. Existing legacy aliases may remain for compatibility; new records omit them. Do not mass rewrite originals to make their fields match an index. Existing `created`/`updated` values that do not meet calendar-date rules require explicit disposition; do not silently coerce source precision.

## SQL projections

`.reader/catalog.sqlite3` has one row per catalog entity. `documents` contains typed fields, full `frontmatter_json`, `metadata_path`, `source_sha256`, and `metadata_sha256`. Compound author/tags values use JSON columns. Missing values use NULL; default tags use an empty JSON array. Full JSON retains declared custom metadata without fabricating omitted canonical fields.

Catalog SQL version 2 adds the canonical version/revision columns and allows a nullable legacy alias. `catalog sync` rebuilds the old version 1 projection transactionally from existing metadata; it does not migrate those files. `catalog check` requires the new column layout and verifies exact values and hashes. An invalid record leaves the previous SQL snapshot intact. Stop old catalog writers before upgrading. Old catalog commands refuse SQL version 2; use updated commands.

The search database keeps layout version 1 for existing read-only MCP processes. A separate `metadata_index_version: 1` marker identifies its complete metadata projection. It adds canonical version/revision, status, profile, and diagnostics columns alongside full metadata JSON. Updated readers require the marker and columns. Older read-only readers can continue to search. Stop old index writers: their positional inserts cannot use the added columns.

`reader index --no-semantic` adds and refreshes search metadata without loading an embedding model. Unchanged sources keep chunks and stored vectors. The metadata refresh shares the index transaction. Failed refreshes do not publish partial metadata rows; additive columns can remain and the next refresh can resume. Restart a read-only MCP process only when it needs the new diagnostic fields.

The exported contracts are [document JSON Schema](../schemas/document-frontmatter-v1.json), [catalog envelope JSON Schema](../schemas/catalog-envelope-v1.json), and [catalog SQL version 2](../schemas/catalog-v2.sql). The earlier [catalog SQL version 1](../schemas/catalog-v1.sql) describes the accepted upgrade input.

## Commands

```sh
reader metadata-schema --profile document
reader metadata-schema --profile catalog
reader --root /path/to/reader catalog schema
reader --root /path/to/reader validate-metadata library/project/document.md
reader --root /path/to/reader validate-metadata --allow-legacy
reader --root /path/to/reader catalog plan
reader --root /path/to/reader catalog sync
reader --root /path/to/reader catalog check
reader --root /path/to/reader index --no-semantic
```

For an implementation upgrade of an already cataloged library, use `catalog sync`, `catalog check`, and `index --no-semantic`. No source migration, dependency installation, model download, or embedding regeneration is required. Schema export needs no vault; catalog commands need the configured vault. Validation is read-only and defaults to library Markdown, including uppercase `.MD` files. Explicit paths remain confined to `library/`.

For newly filed uncataloged files, inspect `catalog plan`, then explicitly run `catalog migrate`. Migration creates required direct metadata or sidecars and preserves protected originals. Receipt/checksum hashes, `originals/`, and `snapshot/` protect originals. Unrecognized Markdown receives a sidecar. Direct migration is limited to unprotected librarian metadata/editorial notes and indexes. It preserves body bytes and backs up changed notes under `.reader/catalog-migration-backup/<sha256>`. Exact proposed headers validate before any source write. New sidecars receive revision 1 and retain any source version fields under `original_frontmatter`. Direct cataloging retains an existing canonical source revision. Existing legacy catalog records keep their identities and bytes.

After editing metadata, use `catalog sync`, `catalog check`, and a search refresh. General prose-link and Obsidian rendering checks remain separate. Commands are explicit; there is no watcher. Catalog operations also maintain derived placeholder navigation. Move a cataloged file only with its identity, path, sidecar embed, and links reconciled. Orphan sidecars and duplicate owners refuse instead of guessing.

## Recovery and resource limits

Catalog operations use `.reader/catalog.lock` and detect observed concurrent changes. They cannot exclude an uncooperative editor. Stop concurrent writers before a migration. Interrupted source migration can leave a valid partial population; inspect and rerun to complete coverage without replacing identities. Restore individual backups only after checking for later edits.

A missing catalog database is rebuilt with `catalog sync`. Preserve a corrupt database for inspection, remove only its disposable SQLite files, then synchronize and check. Never delete library sources or metadata owners to repair an index. Search recovery follows [search operations](search.md). Source-code rollback alone does not undo either SQL upgrade; old writers require a restored prior database or an approved rebuild.

Catalog input is bounded to 10,000 files and 256 MiB source bytes. Header parsing is limited to 16 KiB; sidecar files to 512 KiB; aggregate sidecar inventory and generated migration writes to 32 MiB each. Catalog SQL requires 4096-byte pages and uses at most 32,768 pages, or 128 MiB. Migration and synchronization reserve database and rollback-journal space under the shared 4 GiB state budget and requires 50 GiB free host space. These bounds do not constitute a filesystem quota. Search uses its existing guarded runner and resource limits. Metadata operations do not need models, network access, or Docker.

Tests in `test_metadata.py`, `test_catalog.py`, `test_metadata_integration.py`, `test_search.py`, and `test_delivery.py` exercise schema enforcement, source preservation, shared constraints, SQL upgrade, sidecar ownership, and delivery integrity.

Receipt-protected originals can contain headers that fail the Reader document schema. Catalog migration preserves those bytes and creates an independent sidecar with `original_metadata_status` and `original_metadata_diagnostics`. A source-owned `document_id` is not adopted as Reader's catalog identity. Invalid editable catalog headers still refuse migration. Search continues to report the original's validation status; a valid sidecar does not repair or validate the source header.
