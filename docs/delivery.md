# Delivery integration

Reader accepts reports from other local projects through a reusable skill, delivery MCP tools, or a command-line helper. All routes use the same ingestion implementation. Delivery puts material in the inbox; it does not classify it or wake a librarian agent.

## Use it

In another project, ask **“Use $reader to write your report to Reader”** or **“Add this document to Reader.”** The skill records known provenance, delivers the document with its attachments, and returns a clickable document path and receipt ID. If MCP is unavailable in that session, the skill uses its local command helper.

For a new installation, start a fresh Codex session if the skill or tools do not appear. This is a local stdio integration: it does not make the library available to hosted chats or agents on another machine.

Say “you got mail” in Reader when you want the librarian to file the delivered material. A successful submission reports `awaiting_filing` and `integrity: intact`; that is receipt of the material, not editorial review or cataloging.

## Setup and dependencies

Supported execution environment: macOS or Linux, Python 3.11+, `uv`, and a local Codex installation for the provided installer. The reader-facing Markdown vault has no runtime dependency. Delivery uses Pydantic 2 and the official MCP Python SDK v1 maintenance line (`mcp>=1.28,<2`); `uv.lock` fixes the resolved environment.

From the Reader checkout:

```sh
uv sync --locked
python3 scripts/install.py
uv run --locked pytest -q
uv run --locked python scripts/verify_installation.py
```

The installer registers `reader` through `codex mcp add` using this checkout's absolute virtual-environment interpreter and an explicit vault root. It symlinks `skills/reader` into `$CODEX_HOME/skills/reader`, falling back to `~/.codex/skills/reader`. Runtime machine paths are generated during installation, not embedded in source. It refuses to overwrite an unrelated skill or an MCP entry with a different launch command. An identical installation is safe to repeat. The environment must already exist; the installer does not install packages or alter shell configuration.

The symlink keeps the installed skill current with the checked-out source. Keep this checkout available. Run `uv sync --locked` after dependency changes. If the checkout moves, remove the old Reader registration and skill symlink using the uninstall procedure, recreate the virtual environment at the new path, and reinstall.

For clients other than Codex, configure a stdio server whose executable is the Reader checkout's `.venv/bin/python` and whose arguments are `-m reader_mcp.cli --root /absolute/path/to/reader serve`. MCP does not need a network port, daemon, API key, or LM Studio model.

## Tools and request schema

`reader_ingest` takes one `submission` object. `reader_status` takes a `request_id` UUID. The CLI accepts the same submission object without a wrapper.

| Field | Contract |
| --- | --- |
| `request_id` | Required UUID; generate once per delivery and retain for retries |
| `title` | Required nonblank title, at most 500 characters |
| `filename` | Relative document destination; defaults to `report.md` |
| `document_path` | Absolute path to an existing regular local file; copies its bytes |
| `markdown` | Inline Markdown alternative; encoded as UTF-8 |
| `attachments` | Optional list of `{source_path, path}`; source is absolute, destination is bundle-relative |
| `provenance` | Optional known `project`, `source`, `author`, `report_date`, and `commit` strings |

Provide exactly one of `document_path` or `markdown`. Use an appropriate filename and extension for PDFs and other binary originals. Source dates are distinct from the server's UTC receipt timestamp. Unknown provenance is omitted rather than inferred. The service does not extract metadata from document contents or fetch source URLs.

Example submission JSON (replace the example UUID for a new delivery and use actual source paths):

```json
{
  "request_id": "76a45b24-ad61-4b4b-8bb9-c3dc883aebc9",
  "title": "Project audit report",
  "filename": "report.md",
  "document_path": "/absolute/path/to/report.md",
  "attachments": [
    {"source_path": "/absolute/path/to/chart.png", "path": "assets/chart.png"}
  ],
  "provenance": {"project": "example-project"}
}
```

For a report referencing `assets/chart.png`, the attachment destination above preserves the link. If the document is nested, destinations are still relative to the bundle root; account for the document's own directory. The service preserves paths but does not discover attachments or rewrite links. `receipt.json` and `index.md` are reserved at the bundle root; source documents with those names may be placed under `original/` with corresponding attachment paths.

Paths reject traversal, absolute destinations, hidden components, backslashes, control characters, and several cross-platform filename hazards. Case-insensitive and Unicode-normalized duplicate destinations and file/directory collisions are rejected. Limits are 64 files total, 32 MiB per file, and 64 MiB total payload; inline Markdown additionally has an 8,388,608-character limit. Sources are explicitly selected local files; directories are not recursively imported. A source changing size or modification time during its read is rejected. Callers should finish writing before delivery; this is not a general snapshot of concurrently modified source trees.

## CLI fallback

From Reader:

```sh
uv run --locked reader --root "$READER_ROOT" ingest /absolute/path/to/submission.json
uv run --locked reader --root "$READER_ROOT" status RECEIPT_UUID
```

From any project, using the installed skill's location (adjust for a custom `CODEX_HOME`):

```sh
python3 "$HOME/.codex/skills/reader/scripts/reader.py" ingest /absolute/path/to/submission.json
python3 "$HOME/.codex/skills/reader/scripts/reader.py" status RECEIPT_UUID
```

The core CLI also accepts `READER_ROOT` instead of `--root`, and `ingest -` reads JSON from standard input. It does not infer the vault from the calling project's current directory. Successful output is JSON; CLI failures exit nonzero and describe the error on stderr. MCP failures are tool errors. Neither adapter executes source content.

## Receipts, retries, and filing

Each accepted request publishes `inbox/<uuid>/` containing its payloads and `receipt.json`. The receipt records a schema version, ID, title, document path relative to the bundle, optional provenance, UTC receipt time, per-file byte lengths and SHA-256 hashes, and a fingerprint of the submission's title, document path, provenance, and file descriptors. It is a content integrity record, not a cryptographic signature or proof that a report's claims are true.

The response adds `bundle_path` relative to the vault, an absolute `document_path` for clickable links, `status`, `integrity`, and per-file `issues`. A status lookup scans receipts in inbox and library and verifies current payloads. The states are:

| State | Meaning |
| --- | --- |
| `awaiting_filing` | Receipt located in the inbox |
| `filed` | Receipt located in the library |
| `not_found` | No matching receipt; disappearance is never treated as successful filing |
| `integrity: intact` | Every receipted payload matches its recorded bytes |
| `integrity: needs_attention` | A payload is changed, missing, or resolves outside its bundle |

Reusing an ID with the same title, provenance, destinations, and bytes returns the existing receipt, including after filing. Different input under that ID is rejected. An existing damaged delivery is not overwritten. When a reply is lost, query status first; retry the same request if needed. Retries using file paths need those sources still available. Two identical reports submitted under different UUIDs are separate deliveries; global deduplication is not implemented.

To file a receipted bundle, move the entire directory to `library/<collection>/<descriptive-name>/`, preserving receipt and payload bytes. Add an `index.md` catalog note with required Reader frontmatter, context, and relative links to the original document. During filing, apply the [wide-md reading-copy procedure](reading-copies.md) to Markdown reading documents and link created derivatives alongside their unchanged originals. Link this note from the collection catalog. Check the receipt again and require `filed` plus `intact`. Receipt lookup finds the new folder without an external database. If two copies of a receipt remain, lookup fails explicitly rather than choosing one. Do not change receipt fields to conceal changed payloads.

## Failure handling and recovery

Files are staged under ignored `.reader/staging/`. Cooperating processes serialize publication through `.reader/ingest.lock`. Payloads and the receipt are written before a single directory rename makes the complete bundle visible in the inbox. Ordinary failures clean their staging folder; a killed process can leave hidden staging residue. Complete bundles already published before a lost response remain discoverable by ID.

Before cleaning staging residue, stop active Reader server/client processes, inspect the leftover files, and check the corresponding receipt ID. Retain recoverable material until the original or a complete delivery is verified. Only remove the specific abandoned staging directory you have inspected. Never clear the inbox or library to recover from a failed submission. This design addresses process interruption and cooperating local writers; it is not a power-loss durability guarantee or protection against hostile filesystem mutation. Local receipts are not remote backups.

The MCP process has the operating-system access of its local caller and may read explicitly supplied paths, including resolved symlink sources. It exposes only local stdio, with no remote authentication layer. Do not expose this server as a remote service without a separately designed access boundary. Payload size limits apply after protocol decoding, so they are not a transport-level memory isolation mechanism.

## Verification and removal

`uv run --locked pytest -q` runs isolated functional tests. `scripts/verify_installation.py` additionally reads the actual Codex Reader registration, launches its stdio command from a temporary external project, delivers a Markdown document and binary attachment into the real inbox, checks status, and retries through the installed skill helper. It removes only its own verified temporary bundle. If that fixture has changed, it leaves it for inspection. It does not start a model session or verify automatic conversational skill selection.

The skill's frontmatter can be checked with the skill-creator package's `scripts/quick_validate.py` when available; that validator requires PyYAML. When validating installation, compare parsed Codex settings before and after to check that unrelated configuration is preserved. Record observed versions and results in `activity/`. Whole-library link validation, real Obsidian rendering, remote-client support, and automatic classification are not provided by these delivery checks. Search has its own [verification procedure](search.md#verification).

To uninstall, stop active clients, run `codex mcp remove reader`, and remove only the installed `reader` skill symlink after checking its target. The repository, inbox bundles, library, and receipts remain intact. The virtual environment can be recreated with `uv sync --locked`; it contains no canonical library documents.

Implementation references: [official MCP Python SDK v1](https://py.sdk.modelcontextprotocol.io/v1/) and [official Codex MCP configuration](https://developers.openai.com/codex/mcp).

The same server also exposes shared [highlight/thread tools](annotations.md), plus `reader_search` and `reader_read`; see [library search](search.md). Delivery does not refresh the search index, which covers filed library material only.

## Code and vault locations

This reference describes the configured private vault unless a code checkout is explicitly named. See [separate-vault installation](separate-vault.md). Run software setup/build commands in the code checkout and pass the private vault explicitly to CLI commands and the plugin installer. `$READER_ROOT` is the private vault path. Source documents, runtime stores, and reading activity stay in the vault.
