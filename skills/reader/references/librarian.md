# Reader librarian reference

Librarian-only Reader work, reached from the Reader skill. An ordinary search, read, citation or delivery does not need this file. "Code checkout" means the Reader repository containing the Reader skill's real path (the parent of `skills/`), not the installed symlink's directory.

## Refresh maintained Markdown indexes

The README dashboard uses the `indexes/` records. An authorized librarian refreshes them with `python3 /path/to/this/skill/scripts/reader.py browse`; delivery couriers remain observer-only. See the code checkout's `docs/browsing.md` for counting and refresh rules.

## Curator discovery

`reader_curation(participant, key?, offset?, limit?, since?, expected_snapshot?)` discovers filed works awaiting this curator, or returns one work's exact member hashes. Pass the returned `snapshot_version` on later pages; a changed queue requires restarting at offset zero. `reader_curate(participant, key, expected_version, status, coverage, note?)` records explicit `scanned`/`studied` coverage or reopens `unscanned`. Coverage entries contain `path`, `sha256`, `scope`, and `full`. These are curator-owned assertions, not document-read flags, source verification, or permission for a courier to become its librarian. A changed version requires fresh inspection. The CLI helper accepts `curation list --participant LABEL` and `curation mark request.json` (or `-`). See the code checkout's `docs/curation.md`; the installed Upkeep skill uses this queue only in librarian mode.
