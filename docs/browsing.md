---
frontmatter_schema_version: 1
document_revision: 1
title: Markdown indexes and the README dashboard
author: Reader librarian
created: 2026-10-22
updated: 2026-10-22
type: reference
---

# Markdown indexes and the README dashboard

Reader’s `indexes/` directory offers Markdown views by topic, author, arrival week, project and document type. The README uses the same records for breakdowns, a document-type pie, daily arrivals, cumulative dated holdings, an eight-week timeline, new arrivals, latest dated work by author and descriptive records. SVG charts have labels and accessible descriptions; Markdown indexes retain the navigable data.

## Refresh and verify

```sh
python3 "${CODEX_HOME:-$HOME/.codex}/skills/reader/scripts/reader.py" browse
python3 "${CODEX_HOME:-$HOME/.codex}/skills/reader/scripts/reader.py" browse --check
```

`reader --root /path/to/vault browse` is equivalent. `--check` does not rewrite navigation and exits 1 for missing/stale output; it can create its runtime lock. Outputs use the refresh’s UTC calendar date, so “this week” needs a refresh when the calendar changes.

Librarian sessions refresh after completed intake, original-writing changes or metadata corrections, before committing the changed navigation. This is active-turn maintenance, not a watcher. The installed Upkeep skill retains the observer/librarian boundary; delivery couriers do not gain permission to rewrite the vault.

A refresh owns `indexes/index.md`, five `indexes/by-*.md` pages, four SVG charts under `indexes/assets/`, `indexes/coverage.json` and only the marked `reader-dashboard` block in `README.md`. Other README prose remains intact. Edit `indexes/settings.json` or source metadata rather than generated pages. Settings are never regenerated. The optional `navigation_author` setting (a one-line name, default `Reader librarian`) sets the `author` frontmatter of the generated pages.

## What one entry means

Each filed receipt counts once regardless of attachments. An attached nested receipt is not another arrival. A direct-drop book/package with a deeper catalog counts once; navigation above multiple deliveries does not add another work. Explicitly identified original writing can appear alongside a packet. Outside packages, standalone Markdown, TXT, PDF, HTML, EPUB and DOCX files are eligible. Existing metadata sidecars can describe standalone non-Markdown files.

Reading copies, navigation, ingestion records and archived source trees are not separate entries. Discovery skips operating-system metadata files (`.DS_Store`, `Thumbs.db`, `ehthumbs.db`, `desktop.ini` and AppleDouble `._*` files), hidden directories and `.git`, `node_modules`, `target`, `__pycache__`, `assets`, `fonts`, `originals`, `snapshot`, `evidence`, `reading`, `dist` and `build`. Their holdings remain accessible through the containing catalog. An uncataloged work only in a skipped directory needs a catalog or a normal standalone path to enter these views.

These are grouping rules, not proof that every intellectual boundary has been determined. `coverage.json` lists each entry’s identity, source/clickthrough path, attribution, date basis, representative primary-file bytes and metadata diagnostics. It is not a preservation manifest, read receipt or verification certificate. Distinct editions remain distinct entries.

## Classification and attribution

Editable topic/project rules match title, tags and shelf path, not full-text semantics. Declared topics remain visible. Declared project metadata takes precedence over inferred rules. Only configured project aliases normalize names. Topics, project groups and coauthors overlap; their totals need not sum to work count. The pie uses one document type per entry instead.

Delivered authorship uses receipt provenance, then explicit source-author/source header fields. Intake-worker authorship is not substituted for source authorship. The known catalog-writer role is also withheld for direct packages with no source attribution. Editable `author_aliases` map case-folded source labels to one or more display names. This combines equivalent names and can credit explicit coauthors separately; original `source_authors` remain in coverage records. Aliases are editorial classification, not authenticated identity resolution. Do not turn a courier’s “for” attribution into a claim of coauthorship. Unknown authors/types/projects are explicit.

## Dates, recency and records

Weeks are ISO Monday–Sunday. Receipt arrival uses UTC; direct works use explicit `added` or `metadata_created` filing metadata. Source publication, creation, update and filesystem modification times do not substitute for arrival. Unknown dates are excluded from date charts and dated author recency.

The growth chart accumulates today’s holdings by recorded arrivals, not historical inventory or publication history: it cannot reconstruct deletions or unrecorded arrivals. The timeline summarizes arrivals rather than inferred project milestones. Author recency uses exact UTC receipt time when supplied, otherwise filing date. Date-only ties have a deterministic display order, not an asserted within-day chronology.

All-time records describe indexed entries, not merit. “Longest primary text by file size” uses source bytes, not words or reading time. For direct packages, the largest immediate or `originals/` PDF/TXT is representative when available; otherwise the catalog is primary. This is not total package size or a complete page-count comparison. Author-label counts can include coauthored and qualified reports.

## Limits and recovery

Metadata discovery reads at most 32 MiB across headers, receipts and settings; permits 10,000 work entries and 100,000 visited discovery entries; and caps rendered output at 16 MiB. Headers use the existing safe bounded YAML codec. Binary attachment bodies are not loaded/hashed. This is a separate metadata navigation projection, not a full-file SQL/search catalog refresh; existing catalog limits/failures remain unchanged. Invalid headers receive diagnostics rather than fabricated metadata.

Discovery is checked again before rendering. Symlinked inputs/outputs, unsafe receipt paths, duplicate receipt identities, malformed README markers, changed discovery snapshots and limit breaches refuse publication. A limit failure does not publish a truncated “successful” index. Source integrity remains an intake check.

`.reader/browse.lock` serializes refreshes. Also use the repository `git-locks` authority for shared `indexes/` and `README.md` writes. After rendering/preflight, each file is replaced through a sibling temporary file. I/O failure or interruption can leave a mixed generation; this is not an all-files atomic transaction or power-loss guarantee. Generation identifiers and `browse --check` expose stale/mixed output. Rerun to reconcile; do not delete sources or participant records to repair navigation.
