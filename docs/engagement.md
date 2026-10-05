# Shared read receipts and Upkeep

Reader stores participant-specific document and discussion receipts in `engagement/`. Each participant has one JSON file named by SHA-256 of their label. Source documents and `annotations/` threads are unchanged. Commit or back up receipts with the vault; `.reader/` is still disposable runtime storage. Labels are not authenticated identities. Use **You** for the default human participant and **Reader librarian** for librarian agents; other agents can use stable distinct labels. Renaming a participant selects a separate identity; it does not transfer receipts.

## What read means

A receipt records acknowledgement of an exact content version. In Obsidian, opening a library document automatically acknowledges that document for the configured participant. Opening a thread or its highlight/warning icon acknowledges the displayed quote, comments, and thread version and clears their unread badges. These UI receipts mean opened, not proof of comprehension, agreement, approval, or full reading. CLI/MCP retrieval, search, and agent discovery still never mark content read; agents acknowledge only material actually read.

- **Document:** SHA-256 of the exact file bytes. Editing a document makes its receipt stale. Originals, reading copies, and catalog wrappers have separate receipts; reading one does not claim reading the others.
- **Highlight or warning:** fingerprint of its stored source anchor. Source changes do not erase that historical quote's receipt.
- **Comment:** fingerprint of that attributed comment, including its parent reference. A later reply does not erase receipts for earlier comments.
- **Thread:** fingerprint of the complete current thread, including resolved state and revision. A new reply or resolve/reopen makes the thread unread again.

In the Reader sidebar, the current document shows **Seen by …**, **Mark read**, or **Mark unread**. Read state loads asynchronously; unavailable status is labelled and cannot be changed until loaded. Relationship/search rows show unread badges when that file's state has been checked during this plugin session. They do not claim that unchecked files have been read. In the **Discussion** tab, the **Unread discussions** disclosure lists pending threads across the library (first 100; subsequent threads become visible as earlier ones are acknowledged). It refreshes on vault events and every ten seconds. Opening a listed thread navigates to its source.

Opening a discussion acknowledges its currently displayed revision, including the quote and comments. A reply that arrives later remains unread until the updated discussion is reopened. Background sidebar rerenders alone do not acknowledge content. Explicit **Mark unread** overrides remain available and persist until content is reopened. Inside a discussion, the quote and each comment show **Unread** and **Seen by …** where applicable. **Mark seen** acknowledges one item. **Mark discussion read** acknowledges the currently displayed complete discussion, including its highlight and comments. **Mark discussion unread** clears that participant's receipts for those items. Document acknowledgement is separate. Receipts for other participants are never cleared by these controls. **Not marked seen yet** means there is no current receipt; it does not prove the person has never looked at it.

Older plugin `data.json` read flags remain intact but are not imported as content-verified receipts: they have no source hash or named participant. New shared receipts replace those flags for current UI behavior. Path changes require rereading or an explicit future migration; no move-stable receipt identity is inferred.

## Agent and CLI contract

`reader_attention(participant, path)` returns that document's versioned items, full highlight/comment bodies, aggregate thread revisions, read booleans, and `seen_by` labels/timestamps. Warning passage items use `kind: "warning"` with the same `highlight:<thread-id>` receipt key namespace. `reader_threads(path)` supplies complete thread context and anchor status. Without `path`, attention returns unread discussion summaries with `total`, `next_offset`, and `pending`; use `offset` and `limit` (1–100) to paginate. A summary is not sufficient evidence to mark a thread read. Global document-reading backlogs are not enumerated.

`reader_mark_seen(participant, items, read=true)` takes 1–2,000 exact `{key, version}` pairs from the material actually inspected. Set `read=false` to clear only this participant's receipts. A stale item rejects the whole batch without partial writes. Do not replace a rejected version with the newest token without reading its content. Whole-document receipts require full reading; excerpts and partial coverage belong in existing reading records.

CLI equivalents use `reader annotate request.json` or `reader annotate -` with stdin JSON:

```json
{"operation":"attention","participant":"Reader librarian"}
```

```json
{"operation":"attention","participant":"Reader librarian","path":"library/example/report.md"}
```

```json
{"operation":"seen","participant":"Reader librarian","items":[{"key":"document:library/example/report.md","version":"the exact returned SHA-256"}]}
```

Clients whose MCP tool list predates these tools need to reconnect. Both read and write operations are local; they do not send notifications externally.

## Upkeep operation

The repository [Upkeep skill](../skills/upkeep/SKILL.md) is installed through a symlink in the agent skill directory. The global agent instructions apply it at main-agent turn start and end across projects when installed; Reader’s `AGENTS.md` also links it locally. Delegated workers are exempt from recursive checks. Its read-only `scripts/check.py` resolves this checkout from its own installed path and reports inbox bundles, runner state, and unread discussion summaries. By default it does not claim, ingest, reply, or mark anything read. Explicit `--claim <UUID> inbox/path ...` atomically assigns arrivals to a coordinator; `--release <UUID>` clears only that owner after workers stop. Claims live in `.reader/upkeep-claims.json`. Confirm an owner is no longer working before manually releasing an abandoned claim; age alone is not evidence. There is no background daemon or scheduler; checks run only during an active agent turn.

Delegate 1–10 ready arrivals to one intake worker; above that, use up to three workers with disjoint whole bundles. The coordinator serializes shared catalog, metadata/search writes, staging, and import commits. Claim admission and inbox-runner startup share `.reader/upkeep.lock`; active claims refuse a runner launch, and starting/running/interrupted runner state refuses new claims. Do not overlap an existing runner or active intake owner. Intake workers do not recursively run upkeep. Incomplete/in-flight bundles remain in the inbox. If delegation is unavailable, use one bounded local batch and report the remainder.

Agents inspect new discussion before recording their own receipts and reply only when useful. They review recent intake and current task context for substantive, source-grounded connections; there is no quota for replies or recommendations. No material is marked read merely to clear a backlog.

## Limits, recovery, and verification

Receipt updates share `.reader/annotations.lock` with annotation mutations, then atomically replace one participant file. Current limits are 100 participants, 8 MiB per participant file, 5,000 threads, and 256 MiB per document hashed for a receipt. The per-document attention response includes all its discussion and may exceed the plugin's 8 MiB bridge limit; preserve the records and report the error instead of marking an incomplete response read. Receipts retain one version per item, not a complete reading history. Local file writers are trusted; no authentication or cross-device conflict merger is provided.

On receipt corruption, preserve the JSON and restore from Git/backups. Do not delete receipts as a search-index repair. Failed reads leave the UI status unavailable; retry with Reader refresh after recovery. A process crash can leave `.receipt-*` temporary files; inspect before removing. Atomic replacement does not promise a multi-file or power-loss transaction.

Run `uv run --locked pytest -q tests/test_engagement.py tests/test_annotations.py tests/test_delivery.py`, plus the plugin checks. The live macOS context-menu regression can be run from the vault root with Obsidian open: `python3 plugins/reader/tests/live/context-menu.py`. It creates and removes a temporary note, preserves clipboard formats, and verifies a trusted right-click, Copy/Look Up presence, actual Copy, and the Reader dialog. It does not validate the operating system's dictionary content.
