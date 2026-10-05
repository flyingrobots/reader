# System capabilities and boundaries

## Reading and curation

Reader is a plain-file Markdown library intended for Obsidian. Its [catalog](../library/index.md) links documents, original attachments, and librarian-authored reading material. Reading requires no plugin, database, or running service.

Classification, cataloging, connection discovery, and editorial reading happen during librarian sessions. Depositing a file or delivering a bundle does not start that work automatically. The librarian preserves distinct source versions and uses catalog notes for metadata when originals must remain unchanged. See [design and conventions](design.md) and [operations](operations.md).

Markdown intake can produce labelled, unwrapped reading copies through the pinned wide-md integration, preserving original bytes and receipt hashes. See [setup and supported formatting](reading-copies.md).

## Local delivery

The delivery implementation provides `reader_ingest` and `reader_status` through a local stdio MCP server, plus a CLI and reusable agent skill. It copies explicitly selected documents and attachments into an inbox bundle, records provenance and checksums, and publishes the complete bundle with a directory rename. Reusing a request ID with identical input returns the existing receipt; conflicting input is rejected.

Receipt lookup locates bundles in the inbox or library and checks payload integrity. It distinguishes awaiting filing, filed, and not found. An intact receipt establishes agreement with recorded payload bytes; it does not establish the truth of the document, completed reading, or an external backup. See [delivery integration](delivery.md) for the request contract, limits, setup, and recovery.

## Search and retrieval

The CLI and local MCP server provide path/content keyword search, typo-tolerant fuzzy matching, local embedding similarity, and hybrid ranking through `reader_search`, plus bounded source reading through `reader_read`. The installed `$reader` agent skill guides search and reading through MCP or its CLI helper. Markdown, other supported UTF-8 text, and extractable PDF text are indexed; unsupported formats remain path-searchable. Explicit indexing maintains a disposable local SQLite index. See [search setup, contracts, and limits](search.md).

## Obsidian sidebar

The optional desktop [Reader plugin](obsidian-plugin.md) shows existing librarian links and evidence for the open document, groups by ingestion date by default, filters titles/paths, and invokes local hybrid, semantic, fuzzy, or keyword search. When AI-TTS is available, it can queue selected text or a Markdown/TXT document with voice selection. It also launches explicit Codex inbox jobs, groups Library, Discussion, and Inbox into separate tabs and tracks shared participant-specific Read/Unread receipts, automatically acknowledging opened documents and threads in Obsidian, and supports shared Markdown highlights, explained warning annotations with red wavy underlines, and comment threads through Obsidian and CLI/MCP. PDF narration and annotations remain unsupported.

## Verification boundaries

The test suite exercises delivery preservation, validation, retry/conflict behavior, concurrency, failure cleanup, and the MCP boundary. The installation verification script exercises the configured server and skill helper from outside the checkout. Commands and fixture behavior are documented in [delivery integration](delivery.md).

The versioned metadata catalog provides a full-file inventory and `reader catalog check` to verify metadata, source embeds, and exact SQL mirroring. General prose-link checks and archive preservation review remain part of filing. See [metadata contracts and recovery](metadata.md). Filesystem and PDF destination checks do not establish Obsidian rendering; selected text inspection does not establish full visual review or source-claim correctness.

## Operational limits

There is no automatic classifier, file watcher, scheduled librarian, or unattended curation service. The local embedding model supports retrieval, not generation or unattended curation. Search requires explicit index refresh; it does not infer edition/correction relationships or move-stable document identities.

The delivery server is local to its caller and has no hosted endpoint or remote authentication layer. Its publication protocol handles cooperating local writers and process interruption; it does not provide a power-loss durability guarantee or protection against hostile filesystem mutation.

Git provides history for committed content. Reader does not configure remote backup or synchronization, and uncommitted or ignored files have no Git recovery guarantee. git-cas and Keep are not integrated.

Document and catalog metadata share one bounded YAML codec and canonical `frontmatter_schema_version` and `document_revision` fields. Both SQLite projections retain these values and full custom metadata. Legacy records retain NULL canonical versions with explicit diagnostics; preserved source bytes do not change during synchronization. See [metadata](metadata.md).

Reader librarian turns use [Upkeep](engagement.md) to delegate pending intake, inspect new discussion, record actual reading, and surface relevant connections. This is turn-boundary agent work, not a scheduled service.

## Code and vault locations

This reference describes the configured private vault unless a code checkout is explicitly named. See [separate-vault installation](separate-vault.md). Run software setup/build commands in the code checkout and pass the private vault explicitly to CLI commands and the plugin installer. `$READER_ROOT` is the private vault path. Source documents, runtime stores, and reading activity stay in the vault.
