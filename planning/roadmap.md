# Reader roadmap

This page contains outstanding system work and conditional options. No implementation is currently in progress. Routine filing, reading, reactions, and documentation upkeep follow the [operating procedures](../docs/operations.md); their outcomes belong in private-vault activity records.

## Planned: richer retrieval identity and context

Outcome: extend the implemented [path/content/fuzzy/semantic search and source reading](../docs/search.md) with durable identity and explicit catalog relationships.

Prerequisites: use the existing delivery identities, source hashes, versioned catalog UUIDs, and search result contract. Connect search references to the catalog identities of direct-drop documents and derived reading pages; search currently returns path plus content hash, while catalog moves require explicit path reconciliation.

Scope and acceptance:

- Return known parent-catalog and receipt provenance without attributing wrapper authorship to originals; distinguish originals, derivatives, drafts, proposals, editions, and editorial notes when explicitly recorded.
- Expose recorded duplicates, revisions, and specific later corrections without replacing historical sources or assuming the newest is authoritative.
- Retain named component roles and qualifications when expanding surrounding context; relevance does not establish compatibility, implementation status, or correctness.
- Verify reference resolution after filing and moving documents, including overlapping/revised works. Keep source files canonical and the index rebuildable.

The requested CLI/MCP search is usable independently. This remaining outcome does not authorize inferred relationships, automatic classification, additional plugin features or external tracker work.

## Remaining annotation extensions

The [shared Markdown annotation system](../docs/annotations.md) supports source-preserving highlights, replies, conflict-safe writes, and CLI/MCP access. Outstanding independently scoped outcomes:

- PDF selection and inline overlays with physical-page and source-hash anchors. Preserve originals and verify selection/page geometry before treating PDF anchors as supported.
- Reading-view decorations for formatted and multi-section quotes that currently require editor view for exact inline coverage. Verify repeated and overlapping passages without guessed attachments.
- Explicit reattachment and move recovery for path-bound or orphaned annotations, preserving the prior anchor as provenance.

## Pending: Obsidian navigation acceptance

Outcome: confirm that the existing catalog, Markdown navigation, explicit anchors, and PDF page links work in the intended viewer.

Prerequisite: an accessible Obsidian session with this vault open. Check representative document types and record observed behavior and limitations in the activity log. Filesystem link checks alone do not meet this acceptance condition. This is a viewer check, not a full visual proofread or source-claim audit.

## Deferred options

| Option | Revisit when | Required outcome if adopted |
| --- | --- | --- |
| Automated general prose-link validation | Manual link checks become repetitive or miss errors | Reproducible checks with actionable failures; versioned metadata and SQL checks are already provided by the catalog |
| Additional collection navigation | The catalog becomes difficult to browse | Documents remain reachable through concise, accurate indexes |
| git-cas or Keep storage | Attachments, duplicate payloads, or retention needs justify a storage layer | Evaluate the sibling repositories `../git-cas/` and `../keep/` relative to the Reader checkout; demonstrate Obsidian access, portability, preservation, and recovery before adoption |
| Automated inbox processing | The user needs unattended intake | Documented triggers, preservation guarantees, conflict handling, and recovery |

These options are not scheduled implementations or external tracker issues. Any adopted change must have one observable outcome, explicit exclusions, justified prerequisites, meaningful acceptance checks, and a working intermediate state.

A possible storage evaluation would keep Markdown directly readable and test attachment storage. It must explain how a fresh checkout obtains its content, how relative links keep working, and how content survives maintenance. No storage backend is selected. A watcher or local model is likewise only a possible component of future unattended intake.

When a planned outcome is complete, record its completion and validation in `activity/`, update the relevant system documentation, and remove it from the active roadmap. Preserve historical planning context in the activity archive when needed; do not accumulate completed-work sections here.
