# Portable local references

Reader can display prepared replacements for Markdown `file:` links and images
without rewriting source bytes or shifting annotation coordinates. The repair
command and deterministic inbox workflow prepare the records. Opening an article
only reads its current record; it never probes an arbitrary host path or invokes
Git.

```sh
reader --root /path/to/vault repair-links --all
reader --root /path/to/vault repair-links --all --apply
reader --root /path/to/vault repair-links library/reports/source.md --apply
```

The default is a dry run. `--all` scans regular, non-hidden library Markdown files; explicit paths narrow a
run. `--git-root` selects the directory containing local checkouts (default
`~/git`). Images may be copied only from the vault or Git root by default. An
explicit `--image-root /path/to/images` adds a directory for a manual repair run;
intake never accepts additional roots from source text. Review the returned resolved/unresolved counts and reasons. A document
failure makes the CLI exit nonzero. An unresolved reference is a recorded
exception, not an invented working destination. Coordinate bulk writes with the
vault's `link-repairs/` and affected `library/` repository locks, then verify and
commit only owned records and copied assets.

## Resolution

- Existing library targets become library-relative addresses.
- GitHub URLs come from actual repository remotes, including SSH remotes. A
  directory name alone is not a repository identity.
- Files and directories use a full commit and verified local Git blob/tree.
  Source-stated revisions are preferred; checkout-HEAD fallback is recorded.
  Valid commit labels resolve to full commit URLs.
- Deleted worktrees require source-stated GitHub evidence corroborated by a
  retained repository remote and object. Ambiguous or missing evidence remains
  unresolved. Local object verification does not prove public remote availability.
- Explicit local images are copied to a sibling `assets/` directory under a
  content-derived filename. Identical assets are reused, conflicting bytes and
  symlinks are refused. The original's URL and bytes remain unchanged.

Markdown tokens drive discovery and rendering. Inline/reference-style links and
images are supported; code examples remain literal. A repaired original and its
reading derivative each have their own hash-bound record. The stored projection
is Reader-specific: it does not rewrite Markdown in other viewers.

Records live at `link-repairs/<sha256-of-library-path>.json`, with schema version,
source path, source SHA-256 and dispositions keyed by URL, label and link/image
kind. The public projection also supplies a hashed URL/kind fallback when every
label for that URL has the same disposition and target; this tolerates label
decoration differences between Markdown parsers without confusing distinct commit
labels. Resolved targets are restricted to GitHub HTTPS or library-relative paths.
Stale or malformed records fail closed. Unresolved links show their readable label
and an explanation; unavailable images show a textual fallback.

## Bounds and recovery

Markdown sources are limited to 4 MiB, with at most 2,048 local references per
document. Records are limited to 512 KiB each and 64 MiB per command. Images are
limited to 32 MiB each and 64 MiB per command. PNG, JPEG, GIF, WebP, SVG, AVIF and
BMP extensions are supported. Missing, unsafe and unsupported targets are
reported without reading arbitrary targets during rendering.

After a source changes, rerun preparation for that path. Records are reproducible
from the current source and available repository evidence. Keep historical
originals and receipts unchanged. If preparation stops after copying an asset,
retry reuses its verified bytes; do not delete unrelated assets to clear a run.
The reader endpoint requires the caller's current source hash, so an earlier
record cannot silently apply to a changed edition.
