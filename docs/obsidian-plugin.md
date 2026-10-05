# Reader sidebar

The optional desktop plugin adds **Reader** to Obsidian's right sidebar. It follows the open document and shows librarian notes, documents cited together in connection notes, and links from an associated catalog. Each result has **Why this appears**, with the recorded citation and a link to its evidence. Co-citation does not establish compatibility or a stronger relationship.

## Install and update

Use Node 22.18 or later. From this checkout:

```sh
npm --prefix plugins/reader ci
npm --prefix plugins/reader run check
npm --prefix plugins/reader test
npm --prefix plugins/reader run build
npm --prefix plugins/reader run install:vault
```

The installer copies `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/reader/`. It preserves plugin settings and other plugins. An optional path argument to `node plugins/reader/install.mjs /path/to/vault` selects another existing vault. That vault must have the same Reader library layout for relationship features.

Restart Obsidian if it has not discovered the plugin. Enable **Reader** under **Settings → Community plugins**. It opens once on first enablement. Use **Reader: Open sidebar** to reopen it after closing. Updates require rebuilding, installing, and reloading the plugin or restarting Obsidian. Obsidian 1.7.2 or later is declared; validate against your actual app version. Mobile is unsupported.

## Dates and filtering

Each relationship section groups documents by date and sorts timestamps ascending. **Settings → Reader → Group and sort by date** selects:

- **Ingestion date** (default): receipt `received_at` for delivered bundles, otherwise the recorded filing `added` date, including an unambiguous metadata owner. Reading copies use their explicitly linked original when its date is available.
- **Document date**: `report_date`, `created`, `date`, then `added`, with ingestion as a fallback.
- **Last modified**: the current file's filesystem modification timestamp.

Full timestamps use UTC for both grouping and display. Day-only records retain their known day and appear after timed entries on that day; their time is shown as unrecorded. Undated records appear last. Titles and paths break ties. Historical imports that only recorded a day do not gain an invented ingestion time.

Typing in the search field filters all relationship results by title and path, including results behind **Show all**. Each space-separated word must occur, ignoring case. Clear the field to restore the lists.

Press Enter or **Search library** to use the existing local search engine. Choose hybrid, semantic, fuzzy, or keyword search. The separate **Library matches** list shows up to 30 results in relevance order, matching channels, expanded passages with highlighted literal matches, index time, and freshness warnings. If no literal query word occurs in a semantic result, the returned passage is highlighted as passage-level semantic evidence. These matches are retrieval suggestions, not new recorded connections. Markdown results open at the returned line; PDF results use physical-page links.

Library search requires the checkout's `.venv/bin/reader` (`.venv/Scripts/reader.exe` on Windows), installed with `uv sync --locked`, and an index created with `reader index`. See [search setup](search.md). The sidebar invokes the CLI with argument arrays, no shell, a 60-second timeout, and a 2 MiB output limit. It never indexes or downloads models automatically. Changing the query, changing search mode, closing the view, or unloading the plugin cancels a pending search. The relationship view and name filter work without Python or embeddings.

## Sidebar tabs

- **Library** contains name filtering, library search, related documents, librarian links, document status, and read-aloud.
- **Discussion** contains highlights, warnings, comments, and unread discussion across the library. Its tab count is the number of unread threads.
- **Inbox** contains pending arrivals, Process inbox, progress, stop, and run reports. Its tab count is the number of pending arrivals; an empty inbox has an explicit empty state.

Highlight and warning icons open the Discussion tab directly. Switching tabs preserves search text/results and reply drafts during the sidebar session. Tabs support arrow keys, Home/End, and labelled tab/tabpanel roles. Selecting a tab alone does not acknowledge collapsed threads. A previously expanded thread shown by selecting Discussion is acknowledged. The Library tab is the default on plugin reload.

## Inbox and Read/Unread state

When arrivals are present, the sidebar shows a high-emphasis **Process inbox** action and count. Clicking it launches a Codex librarian job; it does not merely open a terminal or copy a prompt. Progress, stop, and run details remain available across plugin reloads. See [runner setup, judgment boundaries, and recovery](inbox-runner.md).

Read/Unread is shared and participant-specific. The current document and each highlight, comment, and thread show who has acknowledged that exact version. New replies make the thread unread again; opening a document or thread in Obsidian automatically marks the opened content read and clears its unread badges. Agent/CLI/MCP fetches do not mark content read. Explicit mark-unread controls remain available. An unread-discussion list links pending threads across the library. See [receipt semantics, older local flags, limits, and agent Upkeep](engagement.md).

## Highlights and comments

Select Markdown text and run **Reader: Highlight selection and comment**, or right-click selected text and choose **Highlight and comment in Reader** in the editor or reading view. The context-menu action appears only for selected text in Markdown library documents. Reading view retains Copy and macOS Look Up alongside Reader; specialized menus already handled by Obsidian are left intact. Save a highlight with an optional comment, or choose **Warning** in the annotation-type selector and supply a required explanation. Warnings render with a red wavy underline, warning icon, and labelled thread. Hover shows its owner; the inline comment icon opens an attributed discussion with replies and resolve/reopen controls. Your annotation name is configurable in Reader settings. See [anchors, participants, agent tools, and current rendering limits](annotations.md).

## Read aloud

When AI-TTS responds, Reader shows **Read aloud** and a voice dropdown. It checks availability every ten seconds while the view is open. It reads selected editor text when available, otherwise the current Markdown or TXT document. Markdown frontmatter is omitted and the daemon receives Markdown format. Unsaved editor text is used when available. PDF and other binary narration are not supported. Text is limited to 1 MiB and rejected above that limit without silent truncation.

The dropdown lists the daemon's current voices. **Assigned voice** uses its existing assignment; choosing a voice and clicking **Read aloud** assigns that voice to the dedicated `obsidian-reader` client. Other clients' assignments and the daemon's global engine settings are not changed. The choice lasts for the view session; the daemon retains its own assignment.

Speech uses the AI-TTS Unix socket: `AI_TTS_SOCKET`, otherwise `AI_TTS_HOME/ai-tts.sock`, otherwise `~/Library/Application Support/ai-tts/ai-tts.sock`. Environment overrides must be available to the Obsidian process. The plugin neither starts the daemon nor bypasses its shared queue. Requests are confidential. Held, interrupted, or unavailable admission disables reading; status is checked again before submission. **Queued** means accepted, not completed playback. Playback controls remain in AI-TTS. If availability checks fail, controls disappear. Request failures appear inline; check `ai-tts status` and the daemon's own setup/recovery procedures.

## Relationship sources and limits

The resolver uses exact vault paths, valid metadata-owner UUIDs, delivery receipt primary-document associations, recognized catalog original links, and explicitly labelled reading-copy originals, including the `reading_source` metadata produced by [wide-md intake](reading-copies.md). It does not combine distinct editions or apply a primary document's relationships to every attachment. Conflicting identities fall back to exact-file context and display the conflicting records.

Only connection and reaction notes in their designated library folders with Reader librarian authorship count as librarian notes. Related documents come from connection co-citations; reaction citations do not manufacture document pairs. Catalog links remain a separate collapsed section. Collection navigation is excluded. Missing citation targets retain visible evidence without an active document button. Reactions disclose recorded reading scope, or its absence.

The plugin reads Obsidian's metadata/link cache and local library files; it does not modify source documents, receipts, or catalog metadata. It updates after changes and follows the active document without rescanning on each tab switch. **Refresh Reader links** rebuilds the projection. Unreadable files and metadata conflicts are visible. Shared Markdown highlights and attributed replies are supported through the sidebar and [annotation CLI/MCP contract](annotations.md). Typed relationships and PDF annotations remain later scope.

## Verification and recovery

Run the check, test, and build commands above. Model tests cover identity conflicts, catalog/source separation, connection evidence, changes/deletions, dates, and filtering. Socket tests cover admission holds, split responses, rejection, and shutdown. For installed acceptance, open Markdown, PDF, catalog and metadata-placeholder examples; follow related links and evidence, change date settings, filter beyond the first five results, perform a semantic search, and test read-aloud with a short note. Confirm a single sidebar, deliberate-close behavior, and intact source hashes.

If the view is missing, enable the plugin and run **Reader: Open sidebar**. If relationships seem stale, refresh; inspect the displayed unreadable/conflicting files. Search failures require repairing the separate search setup, not modifying sources. Disable Reader to stop its background checks. Reinstall the three build artifacts if needed; retain `data.json` for settings, or remove only that file while the plugin is disabled to restore defaults.

## Code and vault locations

This reference describes the configured private vault unless a code checkout is explicitly named. See [separate-vault installation](separate-vault.md). Run software setup/build commands in the code checkout and pass the private vault explicitly to CLI commands and the plugin installer. `$READER_ROOT` is the private vault path. Source documents, runtime stores, and reading activity stay in the vault.
