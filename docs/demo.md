# Demo vault

`reader demo` gives you a working example library in about a second, so you can try every part of
Reader before pointing it at your own documents.

```sh
uv run --locked reader demo --open
```

It builds the vault, indexes it, prints the URL and serves the web reader until you press Ctrl-C.

## Options

| Option | Effect |
| --- | --- |
| `--dir PATH` | Where to build the vault. Default: `~/Reader Demo`. |
| `--open` | Open the reader in your default browser once it is listening. |
| `--port N` | Web port. Default 8780, or any free port when 8780 is taken; `--port 0` always picks a free port. An explicit port that is taken is an error. |
| `--keep` | Serve an existing demo vault as it is instead of rebuilding it (chats and notes you added stay). Builds one if there is none. |
| `--no-serve` | Build and index the vault, then exit. |
| `--semantic` | Allow downloading the embedding model (BAAI/bge-small-en-v1.5, about 130 MB, once) into the vault's `.reader/models` to enable semantic search. |

`reader demo` ignores `--root` and `READER_ROOT`: it never opens your own vault.

| `--export-static DIR` | Write the demo as a static website into `DIR` instead of serving it; see [Static web demo](#static-web-demo). |
| `--base-path PATH` | With `--export-static`: the URL path the site is served under, such as `/reader/`. Default `/`. |
| `--site-url URL` | With `--export-static`: the public `https://` URL ending in `/`, for social previews and the canonical link. |

## Safety: the marker

The builder writes only into a path that does not exist yet, an empty directory, or a directory
whose `.reader-demo-vault` file is a valid demo marker (JSON with `"kind": "reader-demo-vault"`).
It refuses a symlink, a file, and any non-empty directory without the marker, before printing or
writing anything, and exits with status 1.

A demo vault is disposable. Each run without `--keep` refreshes it: everything except the marker and
`.reader/models` is deleted and rebuilt, so the magazine always shows "this week". Do not keep your
own documents in it.

## What it contains

- **Public-domain texts** from Project Gutenberg: Thoreau, Emerson, Montaigne (tr. Charles Cotton),
  Bacon, Woolf, Darwin, Babbage and Lovelace, each with its eBook number and URL in its
  frontmatter, plus Darwin's diagram from Wikimedia Commons.
  [`src/reader_mcp/demo/content/NOTICE.md`](../src/reader_mcp/demo/content/NOTICE.md) lists every
  source and license; the vault carries a copy as `NOTICE.md`.
- **Fictional material**: the Lantern project and its people, a design proposal in two drafts and a
  `v2` edition, an ADR, a journal, research notes, a PDF field report and a log, essays and asides by
  the voices, and a weekly newsletter. Each document says
  `rights: "Fictional: invented for the Reader demo"`.
- **Reading state**: read receipts for you and the voices (current and earlier editions),
  highlights, comment threads and warnings, bookmarks, history, a reading queue with suggestions
  from voices, one finished chat with a raised hand and a chime-in, and three uncommitted inbox
  arrivals (two receipt bundles and a loose note).
- **Git history**: about fifteen commits by fictional authors, dated over the two weeks before the
  build day, so Versions, What changed and the reading log have history to show.
- **Indexes**: browse pages (`indexes/`, navigation author `Reader demo`), the catalog, the keyword
  and fuzzy search index and the link graph. Semantic search is added only when the embedding model
  is already in `.reader/models` (it is kept across refreshes) or you pass `--semantic`. The demo
  sets `HF_HUB_OFFLINE=1` otherwise, so nothing is downloaded silently.

All dates are relative to the build day: the sources' "Monday" is five days before today, the
newsletter covers the current ISO week, and no timestamp is later than the build.

## Voices

`voices.json` lists three scripted voices (Archivist, Architect and Plain Reader) and one manual
voice (Wren). The scripted voices run `bin/demo-voice`, a small shell wrapper around
`bin/demo-voice.py` that picks a canned reply from `bin/replies.json` by keywords and prints it in
the Claude Code or Codex stream format. It never calls a model, needs no account, and labels every
reply `demo-voice 1.0 (scripted replies)` with the model `scripted demo voice (no AI)`. Wren has no
CLI: use **Paste Wren's reply** in the chat composer.

To talk to a real model, edit the demo's `voices.json` (or copy
[`templates/voices.json`](../templates/voices.json)) and point a voice's `cli` and `argv` at an
installed, signed-in agent CLI such as `claude` or `codex`; see the
[voice registry](web.md#voice-registry). A real voice runs with its normal authority in the demo
vault.

## Not included

The inbox runner (**You got mail**) needs a signed-in `codex`, the Local model card needs LM Studio,
Read aloud needs an AI-TTS daemon and Prose colors needs Colorful Language. The demo shows their
controls but does not fake them; see [optional connections](../README.md#optional-connections).

## Static web demo

`reader demo --export-static DIR [--base-path /reader/] [--site-url https://…/reader/]` writes the demo
as a folder that any static file server can host (GitHub Pages, a CDN, `python3 -m http.server`).
Nothing in it calls a Reader server.

How it is made:

1. It builds and indexes a fresh demo vault in a temporary folder (or in `--dir`; with `--keep`, an
   existing demo vault is exported as it is).
2. It serves that vault with the real web server on a loopback port and requests every GET route the
   reader needs for it: the library, each document and edition, margins, readers, editions and
   history, every recorded version, What changed against you, each reader and the newer edition,
   Read next, the link graph, standfirsts, article shapes, each document's art (and every version of
   art that has more than one), the queue, history, the inbox, chats and every magazine issue window. Each distinct answer is stored once under `data/r/`, and
   `data/manifest.json` maps each request (route plus sorted query, without the UTC offset `tz`) to
   its answer and status.
3. It writes `data/search.json` (the passages of the vault's keyword index), `data/resolve.json`
   (each document's link targets, resolved by the server), `data/paths.json`, `data/chat.json` (the
   scripted voices' `bin/replies.json` table and the runtime they report; a vault without
   `bin/replies.json` gets none, and chat stays off), copies of `library/`
   and `inbox/` under `files/`, and the web UI under `assets/`, with root-absolute `/assets/` and
   `/?pane=1` URLs rewritten for the base path.
4. `index.html` is the normal page plus a `<meta name="reader-static-demo">` flag (`base`,
   `format`, `exported_at`, and `chat`: whether `data/chat.json` was written), a
   Content-Security-Policy that allows only the site itself, social-preview tags, and
   `assets/static-demo.js` loaded before the app.

**The shim** (`src/reader_mcp/web_ui/static-demo.js`) does nothing unless that flag is present, so
the normal server, which never loads it, is unaffected. With the flag it replaces `fetch` and
`EventSource` for same-origin `/api/*` requests:

| Request | Static answer |
| --- | --- |
| Recorded GETs | The exported answer; a different or missing `participant` falls back to the demo reader |
| `/api/search` (fuzzy, keyword), `/api/search/page` | Searched in the browser over `data/search.json` and the work list; semantic and meaning modes say they need Reader locally and show word matches |
| `/api/resolve`, `/api/resolve-batch` | `data/resolve.json`, else a relative path that exists in the export |
| `/api/file?path=…`, image `src` | The copy under `files/` |
| `POST /api/annotations` (create, reply, resolve), `/api/bookmark`, `/api/seen`, `/api/history` | Kept in this browser's `localStorage` (`reader.static-demo.v1`) and merged into margins and bookmarks |
| `POST /api/chat` (create, send, paste, cancel, retry, settings), `/api/chats`, `/api/chat`, `/api/chat/raw` | Answered in the browser by the scripted voices (see **Scripted chat** below) and kept in `localStorage`; raised hands are refused with a note |
| The queue, themes, maintenance, inbox runner, local model, service, speech, prose colors, comparing two arbitrary versions | A JSON error with `unavailable: true` that says to run Reader locally (status 501, or 503 for machine routes) |
| `/api/art` | The exported scene, Artist's note and versions, drawn by Reader's own renderer in the browser; still images and running jobs are not exported (without WebGL the Artist's note shows instead) |
| `/api/art/prompt` | Exported for each version of the demo's art: the pieces are handcrafted, so the prompt card says so and no model prompt is exported |
| `/api/art/jobs`, `POST /api/art` | No jobs and one producer, so the placeholder explains how art is made; **Generate art** is disabled (see below) and a commission answers with a note that making art needs Reader on your computer; a still upload is accepted and dropped |
| `/api/chat/stream` | The shim's own chat events: `hello` (revision and pending turns) and a `state` snapshot, then `posted`, `state`, `started`, `delta` and `done` as the scripted turns run, and `ping` every 15 s |

A dismissible note says that changes stay in this browser and links to the local demo, with
**Reset this demo** to clear them.

**The UI knows it is static** (#107). The shim publishes `window.readerStaticDemo`
(`{base, exportedAt, serves, reset}`); the controls bundle reads it through `needsReader(feature)` in
`web/src/static-demo.ts`, which the vanilla modules import as `needsReader` and `NEEDS_READER` from
the bundle. That object is the only signal: a normal server never loads the shim, so nothing changes
there. With it:

- Reader Admin starts nothing: no automatic freshness check, and no polling of the local model
  or companions. The index cards read **Not checked** and the header says checks need Reader on your
  computer.
- Controls that would write to a server are disabled and carry the tooltip **Needs Reader on your
  computer** (they keep pointer events, so the tooltip shows): **Check again**, each rebuild and
  **Remove** for the legacy index, **You got mail**, the Theme Editor's save and delete, **Generate
  art** (placeholder and issue), the issue's queue buttons, the queue panel's add, remove and clear,
  and the chat's chime-in setting.
- The **Service**, **Companions** and **Local model** sections are left out, with one note saying
  they live on your computer; a companion prompt becomes a plain note.
- Keyboard paths to the same writes (`q`, `Space g` then Generate) show an info toast instead of an
  error.
- Reading preferences still save in this browser.

`serves` lists server features the shim answers itself. `serves.chat` is the export's `chat` flag:
with it, `needsReader('chat')` is false and the composer, **Send** and the manual voice's paste are on;
`needsReader('chime-ins')` stays true.

**Scripted chat** (#108). With `data/chat.json`, the shim answers chat the way `reader demo`'s
`bin/demo-voice` does, without a server or a model:

- Routing follows the server: `@mentions` choose the voices (up to three, each answering in turn), a
  reply without a mention goes to the voice you answer, and a message with neither goes to one
  runnable voice chosen at random. The voice registry is the export's recorded `/api/chats` answer.
- The reply is the first entry in that voice's `replies` list whose every keyword group (`a|b|c`)
  appears in the message answered, else its default, with `{title}` replaced by the document title
  (the same picker as `demo-voice.py`).
- Each turn runs through the panel's real stream path: the `POST` answers with the queued turn, then
  the stream emits `state` (running), `started`, `delta` pieces of six words about 60 ms apart and
  `done` with the stored message. Turns run one at a time. A new stream gets `hello` and a `state`
  snapshot, as on a server, so the first message of a new chat is not `posted` to it.
- **Paste Wren's reply** stores the pasted text as the manual voice, labelled "pasted by hand".
  Cancel and Retry work on running and cancelled turns. Raised hands and chime-ins do not happen.
- Every message the visitor's browser writes carries `local: true`, which the panel shows as **only
  in this browser**; the composer's note says replies are scripted and nothing is sent anywhere.
  Chats live under `chats` in `reader.static-demo.v1`; a recorded chat is copied there on its first
  new message, so its exported history stays. **Reset this demo** clears them. A reply still being
  typed when the page reloads is lost; the message it answers is kept.

**Safety and limits.** The output folder must be new, empty, or an earlier export (it carries a
`.reader-static-demo` marker; a refresh replaces everything else). Exported answers drop
`absolute_path`, `token` and `codex` fields, and the export refuses to finish if any text file
contains the vault's absolute path or the home folder. The routes that describe the machine (local
model, service, health, prose colors, speech, art jobs and the voices that can make art, art still
images) are never exported. The budget is 5,000 files and
64 MiB; the demo is about 12 MiB in under 1,000 files, of which the UI (`assets/`, mostly PDF.js
fonts and maps, Three.js and KaTeX) is about 9 MiB. Issue windows, queue views and history are
snapshots of the export day; history is grouped in UTC.

**GitHub Pages.** `.github/workflows/pages-demo.yml` exports with the repository name as the base
path on every push to `main`, weekly on Mondays (so the magazine has a current issue) and by hand.
It does nothing until a maintainer selects **GitHub Actions** as the Pages source and sets the
Actions variable `READER_PAGES_DEMO` to `true`.

To try an export locally:

```sh
uv run --locked reader demo --export-static /tmp/reader-site/reader --base-path /reader/
python3 -m http.server 8000 --bind 127.0.0.1 --directory /tmp/reader-site
# open http://127.0.0.1:8000/reader/
```

## Source layout and tests

- `src/reader_mcp/demo/__init__.py`: the command (arguments, indexing, server).
- `src/reader_mcp/demo/build.py`: `check`, `prepare` and `build(root, today=None, now=None)`.
- `src/reader_mcp/demo/static.py`: `export(root, out, base='/', site_url=None)` for `--export-static`,
  with `src/reader_mcp/web_ui/static-demo.js` as its browser shim.
- `src/reader_mcp/demo/content/`: `texts/` (public-domain excerpts), `library/` (fictional
  documents with `@@MON±N@@` and `@@WEEKSTART@@` date placeholders), `assets/` (the image, the PDF
  and its HTML source), `voice/` (the scripted voice and its replies) and `NOTICE.md`.

```sh
PYTHONPATH=src .venv/bin/python -m pytest -q tests/test_demo.py
READER_PYTHON=.venv/bin/python PYTHONPATH=src node tests/web_demo.cjs
PYTHONPATH=src .venv/bin/python -m pytest -q tests/test_static_demo.py
READER_PYTHON=.venv/bin/python PYTHONPATH=src node tests/web_static_demo.cjs
READER_PYTHON=.venv/bin/python PYTHONPATH=src node tests/web_static_demo_ui.cjs
READER_PYTHON=.venv/bin/python PYTHONPATH=src node tests/web_static_chat.cjs
```

`tests/test_demo.py` covers marker safety, a byte-identical refresh for a fixed clock, preserved
models, and dates relative to the build day. `tests/web_demo.cjs` runs the real command into a
temporary folder with `--port 0`, then checks the magazine cover, a document's highlights, the
seeded chat, a scripted reply and the manual voice's paste label. `tests/test_static_demo.py`
covers the export's folder safety, lookup keys, base paths, scrubbing, the privacy guard and a full
export. `tests/web_static_demo.cjs` exports under `/reader/`, serves the folder with a plain static
file server, and checks the magazine, margins, outline, Read next, the link graph, editions, What
changed, an image, a PDF, keyword and fuzzy search, a theme, a local-only highlight across a reload,
the labelled server-only features and an inert shim on a page without the flag, while asserting
that no request reaches `/api/*`, leaves the base path or leaves the origin.
`tests/web_static_demo_ui.cjs` exports the same way and checks that visiting Reader Admin asks
for no job and shows no toast, that each server-only control is disabled with the **Needs Reader on
your computer** tooltip under the pointer, that the machine-only sections are left out, that `q`
explains instead of failing, and that nothing logs an error.
`tests/web_static_chat.cjs` exports the same way and chats: a mention, two mentions answered in
order, a random pick, a pasted reply and a message in the seeded chat get their scripted replies
through `started`, `delta`, `posted` and `done`, the deltas spell the reply, every message is
labelled only in this browser, the chats survive a reload and Reset clears them, and every request
the page made is a GET of an exported file.
