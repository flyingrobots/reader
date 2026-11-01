# Deterministic inbox and portable links: unfinished draft

This is a local checkpoint, not a completed feature or an installable release.
The existing inbox supervisor still launches the previous agent-led workflow.
The new `intake.py` worker is not wired into that supervisor. The portable-link
CLI, web endpoint and rendering plugin are prototypes. No library-wide backfill,
service activation, skill installation or publication has been performed.

The intended outcome is a script-owned, snapshot-bound intake workflow. A model
returns a validated editorial decision; deterministic code owns moves, source
preservation, reading copies, portable references, catalogs, checks and commits.
Existing source bytes and annotation coordinates must remain unchanged.

## Checks actually run

- Python AST parsing passed for `intake.py`, `portable_links.py`, `cli.py` and
  `web.py`.
- `node --check` passed for `portable-links.mjs` and `app.mjs`.
- `git diff --check` passed before this checkpoint.

These checks establish syntax only. No functional, integration, browser, model
invocation or recovery validation has been completed for this draft.

## Required work before activation

1. Finish portable-reference validation and synthetic tests. Validate malformed
   and stale records, source hashes, frontmatter exclusion, parser parity,
   reference-style links, code literals, image limits and symlink ancestry.
   Confirm local asset routing in the browser and report unresolved references
   explicitly. A local Git object check does not establish remote availability.
2. Bind the worker to the supervisor's frozen inventory. Never rescan for later
   arrivals, and allow recovery of an interrupted plan even with an empty inbox.
   Validate the journal, its bounds and all destinations before resuming.
3. Make recovery ownership exact. Shared files changed by someone else after an
   interruption must never be staged or committed as this batch's work. Preserve
   raw drops as well as receipted originals: catalog migration must use sidecars
   instead of rewriting their metadata. Recheck preserved payload hashes after
   all migrations and before commit.
4. Preserve cancellation and resource accounting across every descendant,
   including model and git-locks child process groups. Fail closed when required
   coordination is unavailable. An exit code alone must never mean verified
   intake: the supervisor must validate the result against its run identity.
5. Exercise a real structured model response, invalid output, deferral, stale
   input, hidden attachments, interrupted moves, hook failure and retry using
   synthetic sources. Add the thin skill and installer routing, then update the
   current operational documentation to describe only verified behavior.
6. Run the repository's relevant guarded checks. Audit the full library without
   mutation, then apply only source-bound repairs supported by actual remotes or
   explicit source provenance. Record the remaining exceptions. Verify the
   deployed reader before claiming existing articles are repaired.

The design proposal was delivered separately to the configured Reader inbox.
That delivery does not authorize this worker to file its own proposal.
