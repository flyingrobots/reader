# Unwrapped Markdown reading copies

Reader uses [wide-md](https://github.com/flyingrobots/wide-md) during librarian filing to remove artificial prose line breaks. The original stays unchanged. A separate labelled reading copy records the source path, source SHA-256, formatter revision, and executable SHA-256. Delivery itself still stores the submitted bytes exactly; it does not invoke the formatter or delay receipt publication.

## Setup

From this checkout, with Python 3.11+, Git, and a Rust toolchain supporting edition 2024 available:

```sh
python3 scripts/install_wide_md.py
```

The installer builds the pinned revision `c167101b32bbe37954429e9de5db33efcdc0a16c` with its Cargo lockfile. It installs only under ignored `.reader/tooling/`, reuses the existing Cargo registry/Git caches, and does not modify shell or global Cargo configuration. The source checkout, stable target directory, binary, logs, and installation receipt remain available for reuse. A modified source checkout is refused rather than reset.

Builds hold `.reader/tooling/setup.lock`, use two build jobs with incremental compilation disabled, and monitor once per second. Limits are 20 GiB aggregate build/cache accounting, 4 GiB `.reader/` data, 16 MiB setup log, 4 GiB process-group RSS, 600 seconds per command, and 50 GiB minimum host free space. Child processes inherit CPU and per-file output limits. `.reader/tooling/launch.json` records paths, limits, measurements, and the process group. Monitoring failure or a breached limit terminates that group. Monitoring is not a filesystem quota and brief overshoot is possible. Shared Cargo caches are counted conservatively in full; do not delete other projects' caches to satisfy a refusal.

## Filing procedure

After moving a Markdown original into its final library location, run:

```sh
uv run --locked reader --root "$READER_ROOT" reading-copy library/example/report.md
```

Apply this step to incoming `.md` and `.markdown` reading documents, including receipted Markdown payloads, before completing the import batch. Do not apply it to receipts, generated metadata placeholders, source-code snapshots, MDX, or existing reading derivatives. For TXT/PDF sources, retain their existing reading procedure; this formatter is for Markdown, not text extraction or OCR.

The JSON result reports `created`, `existing`, or `unchanged`. Changed prose produces `report.reading.md` beside `report.md`. An unchanged source produces no extra file. Link a created copy from its catalog as the convenient reading edition, retaining a clear original link. Include the derivative in the import commit, then run normal metadata/catalog and search refresh checks. The helper creates valid independent catalog metadata; it does not rewrite catalog indexes or refresh databases itself.

Copies share the original's parent directory. Relative images, attachments, and document links therefore retain their base path. Internal links still require the ordinary intake checks, and cross-document links may lead to original editions. Frontmatter in the derivative has its own identity and revision; known source metadata is retained separately under `original_metadata`, with source authorship distinct from the formatting operation. The original header remains available unchanged in the original file.

The sidebar recognizes `kind: reading-copy` with its explicit `reading_source` path, so librarian relationships remain discoverable from the derivative. This is an association, not a merger of source and derivative identities.

## Formatting contract and limits

wide-md runs as a stdin/stdout filter with no width setting. Reader supplies a private nearest configuration so an ancestor's `.wide-md.toml` cannot introduce new hard wrapping. Parser-identified soft breaks are removed; supported code blocks, tables, headings, explicit hard breaks, and other structural syntax are preserved by the formatter. Unknown dialect behavior is not guaranteed. Known unsupported constructs, including `:::` directives, are refused by wide-md; MDX paths are rejected before invocation. Reader also requires a valid bounded YAML header when one is present.

Each original and formatted payload is limited to 4 MiB. Formatter calls have a 15-second timeout, ten-second CPU limit, and 16 MiB per-file temporary-output limit. Temporary files live under `.reader/reading-runtime/` and are removed after each call. No original is passed in write mode. UTF-8 is required. Existing reading-copy destinations are never overwritten; identical source/tool/body repeats reuse the existing copy, while changed or edited copies require explicit reconciliation. A changed source detected during formatting is rejected.

## Recovery and verification

If installation is missing or the executable hash differs from its receipt, rerun the installer. Inspect `setup.log` after a failed build; preserve modified tool checkout work and resolve resource limits before retrying. Do not remove library files to recover tool caches.

If formatting is refused, retain the readable original and record the reason in the intake activity. Do not use ad hoc newline removal as a fallback. An existing conflicting derivative needs a new explicit edition or reviewed reconciliation, not forced replacement. A crash can leave a hidden `.reader-reading-*` temporary file beside the source; inspect and remove only that abandoned temporary after checking whether the complete destination was published.

Run `uv run --locked pytest -q tests/test_reading.py tests/test_delivery.py`. The reading tests use the installed real formatter; without setup they skip explicitly. They exercise the CLI with a delivered-and-filed bundle, original and receipt preservation, structure and relative-link preservation, idempotence, changed-source conflicts, unsupported dialect refusal, unsafe paths, and isolation from ancestor width settings. Inspect actual Obsidian rendering for unfamiliar documents before claiming visual fidelity.
