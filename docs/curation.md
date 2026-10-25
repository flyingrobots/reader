# Filed-work curation queue

Reader separates delivery, filing, actual reading and curatorial review. A packet can be filed by another coordinator and still await a named curator. The queue covers authoritative files under `library/`, independently of inbox contents and the disposable search/SQL projections.

## Units and versions

- A Reader delivery receipt groups its explicitly declared payloads as one work, keyed `receipt:<UUID>`. Repeated deliveries remain distinct receipts even when their bytes match. The primary document and optional catalog are linked; attachments are members, not separate works.
- A deeper catalog `index.md` groups a direct-drop book/research packet, keyed by its catalog identity. Otherwise standalone reading documents use their own catalog identities. Top-level/collection navigation, reading copies and standard intake/reading records are excluded as separate works.
- Ungrouped unsupported attachments are reported with a count and up to 100 paths instead of being silently counted as intellectual works. File them under an appropriate work catalog when they need curation.

The version binds current source hashes, receipt/catalog-context bytes and owning metadata hashes. Changing any of these returns an earlier reviewed work as `changed`. Path reconciliation can change a version even when its stable catalog/receipt key survives. Missing/invalid catalog records, duplicate receipts, unsafe paths and a detected concurrent snapshot change refuse discovery explicitly; do not interpret an unavailable queue as empty. Finish catalog migration or reconcile the source before retrying. Discovery does not migrate files or require a fresh SQL/search projection.

The default list contains unscanned, explicitly reopened and changed works, newest receipt arrival/catalog date first. It includes historical unreviewed works on first use; there is no timestamp watermark that can skip material filed by other sessions. Pagination returns `total`, `pending`, `next_offset` and `snapshot_version`. Pass that token as `expected_snapshot` (CLI `--expected-snapshot`; Upkeep `--curation-snapshot`) on later pages. A concurrent insertion, source change or disposition change refuses the stale page and asks for offset zero, preventing silent offset skips. Omitting the token gives best-effort paging only.

## Dispositions and coverage

Each participant has an independent file under `curation/`, named by SHA-256 of its label. Labels are attribution, not authentication. Renaming does not transfer dispositions or another participant's read state.

| Status | Meaning |
| --- | --- |
| unscanned | No disposition for the current version, or explicitly reopened by this curator |
| scanned | The curator inspected the declared sources/sections; coverage is required |
| studied | Sustained study with at least one fully read source member; declared coverage still limits the work-level claim |
| changed | The previous disposition names an older source/context version; fresh inspection is needed |

`studied` cannot be recorded from only a catalog wrapper. Detail queries also list explicitly linked reading copies with their own hashes and whether their declared original hash matches the current source. Fully reading a current labelled reading copy can support study, with coverage naming that copy; a stale copy cannot stand in for the current original. This validates the recorded association, not independent formatter fidelity. It does not claim all attachments were read, a whole book was finished, source claims were independently verified, or code was accepted. The `full` flags apply only to their explicitly named files, not to every work member or the original behind a copy. No curation operation changes `engagement/` receipts or annotations. After actual whole-document/thread reading, record those exact versions separately through the existing engagement contract.

Writes require the current work token and matching source hashes. Coverage contains distinct current members with a bounded scope and a boolean full flag. Stale tokens/hashes reject without altering the previous disposition. Identical repeats retain their original timestamp. `unscanned` reopens only the caller's record.

## CLI and MCP

Use the installed Reader skill helper from any checkout:

```sh
python3 /path/to/installed/reader/scripts/reader.py curation list --participant "Reader librarian (curator)" --limit 10
python3 /path/to/installed/reader/scripts/reader.py curation list --participant "Reader librarian (curator)" --key receipt:UUID
python3 /path/to/installed/reader/scripts/reader.py curation mark request.json
```

An example mark request, using hashes returned by the detail query:

```json
{
  "participant": "Reader librarian (curator)",
  "key": "receipt:UUID",
  "expected_version": "CURRENT_WORK_HASH",
  "status": "scanned",
  "coverage": [
    {"path": "library/example/report.md", "sha256": "CURRENT_SOURCE_HASH",
     "scope": "Introduction and findings; supporting logs not read", "full": false}
  ],
  "note": "Source claims retained; runtime verification not performed"
}
```

MCP exposes `reader_curation(participant, key?, offset?, limit?, since?, expected_snapshot?)` and `reader_curate(participant, key, expected_version, status, coverage, note?)`. Reconnect clients with cached tool lists to discover the additions. The CLI is the fallback for an already-running client.

`since` is an optional timezone-aware ISO timestamp, filtering receipt arrival and catalog dates, not exact filing times. Receipt timestamps normalize to UTC. Date-only catalog entries are admitted conservatively at the boundary, with `time_filter_uncertain`; their creation date does not supply an exact filing instant. Ordinary Upkeep does not apply a time filter.

## Upkeep and role separation

Librarian mode includes a queue page in `curation` even when the inbox is empty. `--curation-offset` and `--curation-limit` control paging. If the backend cannot form a valid snapshot, the check reports `curation.status: unavailable` with its error, preserving inbox/discussion discovery. Observer mode returns `curation: null` and never treats a delivery as an intake or curation assignment.

## Limits and recovery

The source inventory uses the catalog's 50,000-file, 2 GiB streamed source and 256 MiB metadata limits; receipts are read individually, at most 128 KiB each. Queue pages contain 1–100 summaries; detail queries disclose exact sources/context. Coverage allows at most 1,000 entries with 2,000-character scopes and a 4,000-character note. Records allow 100 participants, 10,000 dispositions and 8 MiB per participant, with a 32 MiB aggregate publication/staging cap. Admission counts old records and abandoned temporary files before admitting replacement bytes; it does not assume cleanup has already happened. Inputs and canonical files are read locally; discovery is not a scheduled service.

Curator writes serialize through `.reader/curation.lock` and atomically replace one participant file after fsync. This does not lock a human editor's source files or promise a multi-file/power-loss transaction. A version inspected just before an uncooperative edit remains an old-version assertion and will be queued as changed on the next valid snapshot. A crash can leave `.curation-*` staging files; preserve/inspect the identified stage and ownership before cleanup. Their bytes count toward publication admission rather than becoming unbounded hidden output.

Commit/back up `curation/` with the private vault. Do not delete it as a disposable index repair. Preserve malformed or oversized records for investigation and restore an individually verified version from Git/backups. A lost/corrupt record must not silently mark works reviewed. Existing documents and other participants' records remain unchanged.

Run the curation, upkeep and MCP-delivery tests with the project's guarded Docker workflow. They cover empty-inbox discovery, grouping, participant independence, source/context changes, stale writes, explicit coverage, concurrent writers, pagination/timezones, corrupt state, CLI and MCP boundaries.
