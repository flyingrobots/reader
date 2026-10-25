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

## Source layout and tests

- `src/reader_mcp/demo/__init__.py`: the command (arguments, indexing, server).
- `src/reader_mcp/demo/build.py`: `check`, `prepare` and `build(root, today=None, now=None)`.
- `src/reader_mcp/demo/content/`: `texts/` (public-domain excerpts), `library/` (fictional
  documents with `@@MON±N@@` and `@@WEEKSTART@@` date placeholders), `assets/` (the image, the PDF
  and its HTML source), `voice/` (the scripted voice and its replies) and `NOTICE.md`.

```sh
PYTHONPATH=src .venv/bin/python -m pytest -q tests/test_demo.py
READER_PYTHON=.venv/bin/python PYTHONPATH=src node tests/web_demo.cjs
```

`tests/test_demo.py` covers marker safety, a byte-identical refresh for a fixed clock, preserved
models, and dates relative to the build day. `tests/web_demo.cjs` runs the real command into a
temporary folder with `--port 0`, then checks the magazine cover, a document's highlights, the
seeded chat, a scripted reply and the manual voice's paste label.
