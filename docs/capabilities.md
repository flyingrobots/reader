# System capabilities and boundaries

Reader’s Python backend and installed integrations currently require macOS or Linux (POSIX locks, signals, and resource limits). Windows and mobile backend operation are not supported. A Windows executable-path substitution alone is insufficient.

## Reading and curation

Reader is a plain-file Markdown library intended for Obsidian. Its [catalog](../library/index.md) links documents, original attachments, and librarian-authored reading material. Reading requires no plugin, database, or running service.

Classification, cataloging, connection discovery, and editorial reading happen during librarian sessions. Depositing a file or delivering a bundle does not start that work automatically. The librarian preserves distinct source versions and uses catalog notes for metadata when originals must remain unchanged. See [design and conventions](design.md) and [operations](operations.md).

Markdown intake can produce labelled, unwrapped reading copies through the pinned wide-md integration, preserving original bytes and receipt hashes. See [setup and supported formatting](reading-copies.md).

## Local delivery

The delivery implementation provides `reader_ingest` and `reader_status` through a local stdio MCP server, plus a CLI and reusable agent skill. It copies explicitly selected documents and attachments into an inbox bundle, records provenance and checksums, and publishes the complete bundle with a directory rename. Reusing a request ID with identical input returns the existing receipt; conflicting input is rejected.

Receipt lookup locates bundles in the inbox or library and checks payload integrity. It distinguishes awaiting filing, filed, and not found. An intact receipt establishes agreement with recorded payload bytes; it does not establish the truth of the document, completed reading, or an external backup. See [delivery integration](delivery.md) for the request contract, limits, setup, and recovery.

## Search and retrieval

The CLI and local MCP server provide path/content keyword search, typo-tolerant fuzzy matching, local embedding similarity, and hybrid ranking through `reader_search`, plus bounded source reading through `reader_read`. The installed `$reader` agent skill guides search and reading through MCP or its CLI helper. Reading material (Markdown, TXT, PDF, HTML, TeX, RST, Edict, BibTeX by default) is split into passages; machine files such as receipts, logs and source code, and unsupported formats, remain path-searchable, and `search.content_types` in `indexes/settings.json` widens the set. Explicit indexing maintains a disposable local SQLite index that stores identical passages once with float16 vectors. It publishes in batches, so a stopped rebuild keeps its work and resumes. Its budgets default to 400,000 passages, a 2 GiB database, a 1 GiB embedding cache and a 60-minute, four-thread worker, and are settings. See [search setup, contracts, and limits](search.md).

## Obsidian sidebar

The optional desktop [Reader plugin](obsidian-plugin.md) shows existing librarian links and evidence for the open document, groups by ingestion date by default, filters titles/paths, and invokes local hybrid, semantic, fuzzy, or keyword search. When AI-TTS is available, it can queue selected text or a Markdown/TXT document with voice selection. It also launches explicit Codex inbox jobs, groups Library, Discussion, and Inbox into separate tabs and tracks shared participant-specific Read/Unread receipts, automatically acknowledging opened documents and threads in Obsidian, and supports shared Markdown highlights, explained warning annotations with red wavy underlines, and comment threads through Obsidian and CLI/MCP. PDF narration and annotations remain unsupported.

## Local library website

The loopback-only web reader opens on this week's issue: a magazine cover with a
cover story, up to four features from different projects and an "In this issue"
contents list, chosen from the week's additions with unread pieces first,
newsletter picks and a spread across projects. On wide windows the issue fills the
window with more columns and a sticky rail rather than longer lines. Standfirsts come from a `standfirst` field, else a
current local-model standfirst marked with its model, else each source's opening prose.

Featured articles can carry bespoke art: a voice from `voices.json` (its own CLI and
subscription) or the local model reads the article, writes an art brief (shown as the
Artist's note, the art's text alternative) and composes a scene in Reader's declarative,
versioned scene language, which both the server and the page validate strictly (types,
ranges, references, budgets) before Reader's own Three.js interpreter draws it; no
model-written code runs in the page. Art shows on the cover story, as feature
thumbnails and as the hero an article opens on (full width above the title, or the whole first
spread in two-page reading; a setting turns it off); pieces without art show nothing
special, or a placeholder with Generate art. Commissions are background jobs (one at
a time per vault, with toasts, cancel, a timeout per stage and the chat-turn resource
guards), made on request or, by setting, automatically for each issue's cover story or
features. One web server per vault owns art (a lock in `.reader/art/`); any other
server shows its commissions read-only and refuses art actions. Each version is stored and committed beside its edition under `art/`, never
overwritten, with its brief, provenance (producer, model, prompts, time, tokens and
reported cost) and an optional still image; every run is archived under
`logs/llm/art/`, and hovering the art (or its Prompt button) shows the prompts that made it. A focus
view shows the art full screen (live and turnable where motion is allowed), and **Regenerate
this** queues a new version steered by the reader's own direction. Colors are theme roles, so art fits every theme; it is still under
reduced motion, pauses off-screen, runs at most 30 fps, turns
into a still when frames are slow, and without WebGL shows the stored still or the
note. A free-form mode (model-written Three.js in a sandboxed iframe) is not
implemented. The older passage-projection figure remains as a data view (`:shape`),
no longer as cover art.
It needs search-index embeddings for the full form and falls back to a term-only form. It also provides an interactive D3 dashboard, local GSAP
scrolling, Vim keys, fuzzy/content/semantic search, shared Markdown passage
discussion (selectable by mouse, touch or keyboard), a progress rail and a modal statusline whose items give way by declared priority on narrow screens. One keymap table drives
every page key and generates the help: VISUAL and VISUAL LINE select passages from the keyboard (word, sentence,
block and line motions, text objects, counts) to highlight, comment, warn, speak, yank with a citation or search for
more like them; a `:` command line with completion and per-device history runs 30 commands; registers, a
500-entry location list (`:grep`, `]q`), per-edition marks and a 100-place jump list (Ctrl-o / Ctrl-i) stay in the
browser's local storage and never reach the vault. Footnote, figure, link, thread and first-use motions round it
out. Continuous and facing-page
layouts share automatic participant-specific, source-version-bound bookmarks.
Obsidian callouts (types, aliases, titles, folding and nesting) render as
annotatable asides.
Obsidian embeds render live in place: whole notes, heading sections (`#A#B` nested),
block references (`#^id`), aliases, sized images, PDF pages, nested embeds to four
levels with cycle notes, and later embeds loading as you read. Annotations made in an
embed belong to the embedded file. Embeds in code stay text. See [Embeds](web.md#embeds).
Document URLs can carry a heading, so links to sections survive reload and sharing.
The window splits into up to four panes (`Ctrl-w v` / `s`, `Space W`, or `:vsplit` / `:split [doc]`), side by side or stacked, each a full reader with its own place, receipts and highlights; panes are same-origin iframes of the app in embedded mode, the layout survives reload in `#split=`, linked panes (`:set scrollbind` or the divider button) scroll together (across version hunks for two versions), and the Versions panel can compare two versions side by side. Splitting is refused below 700px.
A scratch pad (`Space w`, `#scratch=<id>`) edits Markdown with Vim keys (`Ctrl-r a` pastes a Reader register as a cited quote; `:enew` and `:e scratch` work from the page command line) beside a live preview from the document renderer (local images and embeds resolve from the notebook folder; a scratch pane survives `#split=` restore); drafts stay in the browser (IndexedDB) until "Save to vault" writes one `library/notebook/YYYY-MM-DD-<slug>.md` (never overwriting; revisions as `.vN.md`) and commits only that file. It does not file pieces into collection indexes.
PDFs have selectable text, page-based resume and bounded find/rendering;
PDF annotations are not implemented. Assets and fonts are served locally and are
never refused by the request limits; margins load regardless of a document's
catalog metadata, and secondary-request failures leave a rendered document open.
Mermaid diagrams in Markdown are drawn locally by Pele, recolor with the theme,
open full size, and appear on the two-page page turn. An invalid or over-limit
diagram (more than 64 KiB of source, or after the 64th in a document) shows its
source with the reason. TeX math (`$$…$$`, `\[…\]`, `\(…\)` and a conservative
`$…$` that leaves currency alone) is typeset locally by KaTeX after the document is
shown, keeping your place; rejected TeX stays visible with its reason, and copying a
formula copies its TeX.
Markdown rendering scales linearly with document size, and local images resolve in
batched requests.
See [web operation, privacy, limits and recovery](web.md).

`scripts/reader_service.py` runs the web reader as a macOS LaunchAgent from a
dedicated live worktree, restarted by launchd and advanced by a 10-minute updater
only to commits that pass a smoke test, with rollback when the restarted server is
unhealthy and a wait while inbox runs or rebuilds are active. `tailscale on`
publishes it on the user's own tailnet with `tailscale serve` (never Funnel); Reader
still binds to loopback and admits proxied requests only for allow-listed
Tailscale logins. No web API answer names a host folder: executables are reported as
installed or not, and paths that must be shown use `<vault>` and `~`. The app ships a web app manifest and icons for Add to Home
Screen. Linux service units and public exposure are not supported.

The dashboard presents catalog and participant statistics in an interactive chart
grid. The Documents browser groups results in a Collapsible/Button file tree,
dims exact-version read documents for the selected participant, and starts with
its filter hidden and focus on the tree;
`/` explicitly enables search. Ink/Paper, Orchid and Harvest provide paired
light/dark themes, with the supplied Harvest OKLCH ramps preserved. Two-page reading
turns single spreads with a Three.js 3D page curl, falling back to a slide without
WebGL, with reduced motion, or by preference. A Theme Editor
(Space , t, F10 or Behind the scenes) creates, edits, duplicates and deletes custom light/dark
themes over a standard token contract. They are stored in the vault's `themes/`.
It checks WCAG 2.x contrast and simulated color-vision separation, suggests fixes,
generates themes from a seed, and previews a sample article. Each heading level (H1–H6)
can take its own font and size in a theme. Fonts can be added from
Google Fonts. They are downloaded once into the vault on request and then served
locally. APCA contrast and non-latin font subsets are not included.

Search (Space /) is a full page over the search index: Best (words and meaning blended), Exact words and Meaning modes; results grouped by catalog work with up to three highlighted passages each; Project, Author, Type, date, read-state, folder and machine-file filters with work counts over the top 500 passages; linkable `#search=` URLs; `j`/`k`/`J`/`K` keys; and opening at the passage, with the query's words highlighted and steppable with `n`, in both reading layouts. It reads the format 2 index (with only the retired format 1 index present it asks for a rebuild), and never rebuilds it; and says when results are partial, stale or exact-word only.

Behind the scenes (Space p) shows the freshness of the search index, browse indexes,
catalog SQL mirror and link graph. It rebuilds any of them on demand, one job at a time, through
the existing guarded entry points, and announces each start, finish and failure with
toasts. Each card shows usage against its budget (search passages, database and
embedding cache; catalog files and source bytes), and an Other inventories card lists
works, inbox files, reading participants and annotation threads against their limits.
It also holds the library statistics dashboard and the reading settings. At the end of a document, **Read next**
suggests up to three related works, unread first and then latest. Relatedness comes
from the existing search-index embeddings and shared projects/topics. In two-page
reading it appears only when it fits the last spread. Its **Inbox** card lists waiting arrivals with
receipt titles, provenance and integrity, previews them without writing receipts or
bookmarks, and **You got mail** starts the same supervised librarian inbox runner as
the Obsidian plugin, with Stop, live status, the final report and its verified commit.
While it runs, an activity transcript shows Codex's JSON events as shadcn AI Elements:
messages with document citations, commands with terminal output and parsed
pytest/node results, file trees, the plan, searches, errors, the commit checkpoint
and token usage. Only the latest run's transcript is available, and the step
timeline is inferred when the agent writes no plan.
The supervisor's lock and Upkeep claims decide admission. An interrupted run must be
recovered by hand, and a run processes the whole inventory; arrivals cannot be selected.

Long Markdown documents and PDFs with an outline show a document outline: a rail beside the text in continuous
reading, a popover with page labels in two-page reading and a bottom sheet on phones,
with the active section and its progress, Space o to toggle and `]]`/`[[` to jump
between headings. It lists at most 500 entries.

The web app shows every date and time in the browser's local time zone and groups by
local days (version chip and timeline, reading log, History, dashboard activity, issue
weeks, search results and date range). Plain `YYYY-MM-DD` catalog dates are calendar
dates and stay as written; timestamps are converted. The issue signals request still
selects candidates by catalog (UTC) day.

Under each document's title, a reading log shows which participants have a read
receipt for this exact edition and which only for an earlier version of the same
path, with relative times; the expanded log lists both groups, folds one-off task
agents (fewer than 5 document receipts) into one entry, and links to each
participant's threads. Voices are the names the vault's `voices.json` lists; a vault
without one has no voices. Receipts for earlier members of the document's edition family
(an original, or a lower version) count as earlier editions.

**Send to AI-TTS** (Space s, the document footer or the selection toolbar's Speak)
queues the whole article, the text from the reading position, or a selected passage
with the local AI-TTS daemon, which owns playback, holds and voice assignment.
Markdown, plain text and PDF text layers are supported, up to 512 KiB of text per
submission; PDF selections and scanned PDFs without a text layer are not. A
status-line control shows segment progress and offers pause/resume, previous/next
segment and skip, only for Reader's own utterances while they are current. The
passage being spoken is not highlighted, because the daemon does not report
segment source spans. Reader never plays audio directly.

Hovering over (about 350 ms) or focusing a local link shows a plain-text preview of the
target: title, authors, project, an unread mark and about 300 characters from the
linked heading. External links show only their host. Each article ends with **Linked
from**, the documents that link to it, with link counts and the heading each link
sits under. Both rest on a link graph of the whole library in `.reader/links.sqlite3`:
a rebuildable cache that builds itself on first use and refreshes incrementally from
Behind the scenes. Links resolve exactly as a click resolves them. Wikilinks, embeds
and Markdown links are recorded; links inside code, links that leave `library/`, and
links in PDFs are not. The graph parses at most 10,000 Markdown files of 4 MiB each and
holds at most 500,000 links and 256 MiB.

Under a document's title, a version chip names the version being read (`v1 of 3`,
a reading copy, an original, or `Current · 7 revisions` for a file with git
history), says when a newer version exists and when you read it; a status-bar twin
(`v1/3`) mirrors it. Space v opens a version explorer (a bottom sheet at phone
width): a timeline of the edition family and, under each edition, the commits that
changed it (at most 50 per file, 200 per family, 2 s), with markers for where you
are, what you last read and the newest version. Any commit opens read-only and
linkably (`#read=<path>@<commit>`) without receipts, bookmarks or annotations, and
any two versions can be compared. Restoring an old version is not offered.
Families come from `reading_source`, `previous_version`, `.vN.md` names,
`original/` folders and catalog-note paths. They cover Markdown files, are
rebuilt in memory when files change (checked at most once a minute) and are never
written back. Unresolvable references are listed in Behind the scenes, not guessed.
Catalog notes are named but not opened, since the reader serves only `library/`.

When your receipt names an earlier edition of a Markdown or text document, a
banner says it changed since you read it. A panel shows a paragraph and word diff
against the bytes you read, recovered read-only from the vault's git history
(newest 200 commits, 2 s, blobs up to 4 MiB). It also says where each highlight
now sits. Such a document is marked read only by **Mark as caught up**. The same
panel compares against another participant's edition or the newer `.vN` version.
Editions that differ only in frontmatter or line wrapping are not offered as
changes.
Uncommitted older bytes, merges' own changes and PDFs are not covered.

Space m opens a chat with the voices about the open document. You choose who
answers with `@` mentions (one voice at random otherwise); the Reader librarian,
Agy and Claude run through their own CLIs as configured in the vault's
`voices.json`, with their normal authority, and manual voices' replies are pasted by
hand (the paste control names the registry's manual voice).
Replies stream into the panel; turns run one at a time per vault with timeouts,
cancel, resource guards and waiting for the inbox runner. Each chat is stored in
`chats/` and committed after every message. Panels in several tabs share a
document's first chat and stay in sync over the stream's heartbeat; a dead or
stalled server shows *Lost connection to Reader* with Retry. One web server per
vault owns chat (a lock in `.reader/voice-runner/`); any other server on the vault
shows chats read-only and refuses chat actions with *Another Reader server owns chat
for this vault*, and never rewrites the owner's runner state. Article identity, history and whatever
a voice reads go to that voice's provider. Each reply's footer names why a turn
failed (CLI error, unreadable output, timeout and so on), and a collapsed **Show raw
output** disclosure shows the turn's CLI events as readable steps or JSON lines,
with stderr and the prompt, live while it runs. Every turn's prompt, stdout, stderr
and metadata are archived permanently in the vault under `logs/llm/chat/`
(listening checks under `logs/llm/listen/`, shown compactly under the reply they
followed),
gzip-compressed on completion and committed with the chat; nothing prunes them, and
no new turn starts below the 50 GiB free-disk reserve. Spoken replies are not
implemented; the inbox runner does not use the LLM log archive yet.
**Reply to @Voice** (or `r` on a focused voice message) addresses your next message
to that voice and quotes the message you answer in its prompt. After an addressed
exchange, the other voices get short listening checks, one at a time, and may raise
a hand; per chat you turn this off, decide on each hand (the default), or let the
first hand speak freely. One chime-in at most follows each message, chime-ins never
start further checks, and a check that changes files is discarded with a warning.
Each check is a cold CLI start for that voice; there is no spending cap beyond the
90-second timeout. Threaded sub-conversations and voices starting chats are not
implemented.

Behind the scenes also supervises a local model on any OpenAI-compatible server:
LM Studio (the default), Ollama, llama.cpp's `llama-server`, or another server such
as vLLM, LocalAI or Jan, chosen by preset or base URL, with models discovered through
`GET /v1/models` and an optional API key that is kept out of git and never shown or
logged. For LM Studio only, it starts and stops the
loopback server and loads and unloads models through the `lms` CLI; other servers
are started by the user, and the page says how. It runs a queue of
standfirst and key-term tasks one item at a time under the workstation GPU lock (for loopback providers; without git-locks, a lock that coordinates only Reader's own processes),
with a streaming preview, per-run toasts, a recent-items log with rejection reasons,
and counts of current and stale outputs. Outputs are checked deterministically
against the source, cached by source hash, model and prompt version in
`.reader/local-model/`, labelled with their model wherever they appear, and never
written into vault files. Runs happen only on request; nightly or idle triggers,
connection triage and quiz drafting are not included. Search can optionally embed
through the provider's embedding model instead of the built-in bge-small, which
forces a full re-embed. Providers must be on loopback unless the user explicitly allows a server
on another machine; Reader then shows that document text leaves the machine. Every
batch of local-model work is archived permanently under `logs/llm/local-model/`
(request template, each item's request and response, and the provider's preset,
host and model, never its API key), committed on its own, and no batch starts below
the 50 GiB free-disk reserve. Embedding requests are not archived.

**Space c** highlights the grammar of Markdown prose and PDF text with the optional
local [Colorful Language](https://github.com/flyingrobots/colorful-language) CLI
(0.4.0 or newer, found through `READER_COLORFUL`, a path set in Behind the scenes, Reader's own build, `PATH` or `~/.cargo/bin`). Three
intensities: Subtle fades function words a little; Clear (the default) recedes function
words and punctuation to about 3:1 while content words hold 7:1 and names, numbers and
quotes take their own hues; Vivid gives every role a distinct saturated hue, underlines
names and washes quoted passages. The colors are CSS custom highlights over unchanged
text, derived per theme (colored roles at 4.5:1 on the page), and the page turn draws them. Code, math, diagrams and embedded documents
stay uncolored. Every Colorful artifact passes a port of its reference admission
checks before use. Open-class roles cover only Colorful's small seed lexicon, plain
text is not colored, and its lint diagnostics are not shown.

**Companions** in Behind the scenes reports the optional companion projects (AI-TTS,
Colorful Language, wide-md, git-locks) with their state, version and path, what each
adds and its repository, plus the `claude`, `codex` and `agy` command lines (status
only) and how GPU use is coordinated. A feature whose companion is missing (Space s,
Space c) shows a non-blocking prompt with setup and a per-feature Don't show again,
instead of an error. Reader can build the pinned Colorful Language release and wide-md
into the vault's `.reader/tooling` as background jobs with progress, toasts, bounded
logs and timeouts (Rust builds take `host/heavy-work` when git-locks is present), and
can start an installed AI-TTS daemon through its launch agent after confirmation.
AI-TTS and git-locks are not installed by Reader: their cards show the documented
commands with Copy. It never uses sudo or a user-supplied source; paths to an
executable can be set only from a browser on the Mac itself. Without git-locks, chat
and scratch pad commits, the local model's GPU lock, the inbox runner and the service
script fall back to locks that coordinate only Reader's own processes.

The reading queue (Space r) is a per-participant play queue in the side panel.
**Up next** shows Now reading, the documents you queued (in your order, reorderable)
and about ten suggestions with reasons: related to your five latest opens, newest
unread works, and one from another project; voice suggestions added with
`reader queue add --by … --reason …` are labelled and stay suggestions until you pin
them. `q` or **+ Queue** adds a document; Space n opens the next one; Read next leads
with **Next in your queue**. **History** lists your latest opens by day with
progress, a changed-edition mark and resume; removing a row hides it without
touching receipts or bookmarks. The queue (`queues/`) holds at most 500 items in
64 KiB; the open log (`history/`) is compacted past 5,000 lines and holds no text.
Inbox previews are never queued or logged.

Reading controls use local shadcn Base UI components: Progress and Popover on the
reading rail, Pagination in facing-page mode, Select and Switch in the Behind the scenes settings,
Card and Badge for index status, Sonner toasts, a paired light/dark Switch, Code Block for every fenced block (language label, exact-text copy with a toast, line numbers in documents, and lazily loaded local Shiki syntax colors painted as CSS highlights in theme colors, without changing the code text), and Skeleton
loading placeholders. The compiled assets ship with the Python package; rebuilding
these controls requires the separate `web/` Node toolchain.

## Demo vault

`reader demo` builds a disposable example vault (by default `~/Reader Demo`) from
public-domain texts and clearly fictional notes, initializes Git with backdated
commits, builds the browse, catalog, keyword and link indexes and serves the web
reader on it. It writes only into a new or empty directory or one carrying its
`.reader-demo-vault` marker, and every run rebuilds the vault from scratch so dates
stay relative to today; only downloaded embedding models survive a refresh.
Semantic search is on only when the embedding model is already in the vault or
`--semantic` explicitly allows the download. Chat uses scripted demo voices that
never call a model. See [demo vault](demo.md).

`reader demo --export-static DIR` writes the demo vault as a static website for any static host
(GitHub Pages included), under a configurable base path. It reads from pre-rendered answers, searches
by keyword in the browser, and keeps highlights, comments and reading positions only in the
visitor's browser. The demo's article art draws in the browser from exported scenes. Chat works with
the demo's scripted voices: a message gets a keyword-picked reply, streamed in the browser and kept
only in that browser; chime-ins and raised hands need Reader. Semantic search, the inbox runner, the local model, speech, prose colors, making new art, the queue,
themes and index maintenance need Reader running locally: their controls are disabled with a
"Needs Reader on your computer" tooltip, Behind the scenes starts no job, and the service, companions
and local-model sections are left out. See
[static web demo](demo.md#static-web-demo).

## Verification boundaries

The test suite exercises delivery preservation, validation, retry/conflict behavior, concurrency, failure cleanup, and the MCP boundary. The installation verification script exercises the configured server and skill helper from outside the checkout. Commands and fixture behavior are documented in [delivery integration](delivery.md).

The versioned metadata catalog provides a full-file inventory and `reader catalog check` to verify metadata, source embeds, and exact SQL mirroring. General prose-link checks and archive preservation review remain part of filing. See [metadata contracts and recovery](metadata.md). Filesystem and PDF destination checks do not establish Obsidian rendering; selected text inspection does not establish full visual review or source-claim correctness.

## Operational limits

There is no automatic classifier, file watcher, scheduled librarian, or unattended curation service. The local embedding model supports retrieval, not generation or unattended curation. Search requires explicit index refresh; it does not infer edition/correction relationships or move-stable document identities.

The delivery server is local to its caller and has no hosted endpoint. Other machines can deliver, and with a broader key scope search and read, only through a restricted SSH key whose forced command is the helper's gate; see [remote delivery](delivery.md#remote-delivery-over-ssh). Its publication protocol handles cooperating local writers and process interruption; it does not provide a power-loss durability guarantee or protection against hostile filesystem mutation.

Git provides history for committed content. Reader does not configure remote backup or synchronization, and uncommitted or ignored files have no Git recovery guarantee. git-cas and Keep are not integrated.

Document and catalog metadata share one bounded YAML codec and canonical `frontmatter_schema_version` and `document_revision` fields. Both SQLite projections retain these values and full custom metadata. Legacy records retain NULL canonical versions with explicit diagnostics; preserved source bytes do not change during synchronization. See [metadata](metadata.md).

Reader librarian turns use [Upkeep](engagement.md) to delegate pending intake, inspect new discussion, record actual reading, and surface relevant connections. This is turn-boundary agent work, not a scheduled service.

Ordinary project agents and delivery couriers use Upkeep's observer role. Only authorized Reader librarian/intake sessions use explicit librarian mode to claim or delegate filing. The helper rejects observer claim/release requests; role selection is a workflow guard, not authentication or a filesystem access boundary.

The [curation queue](curation.md) groups filed deliveries, direct-drop works and standalone reading documents for a named curator. CLI/MCP discovery reports unscanned or changed versions even with an empty inbox; explicit scanned/studied coverage is recorded separately from document/discussion read receipts. Librarian Upkeep includes this queue, while observer mode does not. This does not add an Obsidian tab, automatic reading or a background scheduler.

## Code and vault locations

This reference describes the configured private vault unless a code checkout is explicitly named. See [separate-vault installation](separate-vault.md). Run software setup/build commands in the code checkout and pass the private vault explicitly to CLI commands and the plugin installer. `$READER_ROOT` is the private vault path. Source documents, runtime stores, and reading activity stay in the vault.
