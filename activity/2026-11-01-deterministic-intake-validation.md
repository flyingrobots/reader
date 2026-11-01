# Deterministic intake and portable reference validation

The scripted workflow now owns automatic queue/context partitioning, preserved
filing, source-bound repairs, recovery, verification and scoped local commits.
The installed skill and both inbox controls invoke that workflow. Model calls
return bounded structured editorial decisions under read-only execution.

Synthetic functional checks cover large inventories and provenance, a 102-bundle
queue, cached model responses, stale sources, malformed decisions, hidden
attachments, journal replay, hook refusal, lock contention and unrelated staged
work. They keep original bundles intact and never require a user-selected split.

Guarded plugin and frontend checks passed. Browser checks passed for inbox
completion/cancellation/retry, token refresh, annotations and portable links.
The portable-link browser fixture exercises preserved originals and reading
copies, Git remote resolution, pinned file revisions, reference-style links,
fragments, library navigation, copied SVG images, missing targets, unchanged
source hashes and annotation coordinates, and stale-record refusal.

A full guarded Python run after integrating current main passed 1,093 tests,
with two skips and seven subtests. An earlier run recorded one intermittent
failure in the existing chat-commit trailer test; that test passed both in a
focused rerun and the subsequent full run. A final process-group cleanup change
passed focused supervisor/intake checks: a permission error is accepted only
after confirming the group has no remaining members. Earlier draft/checkpoint
reports describe prior states.

Initial CI stopped before tests because the platform-specific formatter artifact
pushed the software input archive over its 24 MiB cap. The formatter build now
strips unused symbols; its recorded executable hash still covers the exact
exported binary. The real formatter and its reading-copy checks passed within
the unchanged input and worker limits. Final CI must pass on the submitted head.

Automated review identified six additional edge cases, each reproduced by a
failing synthetic regression: identical raw bundle destinations, replay of an
already committed tracked-source deletion, unsupported catalog filenames,
interruption while flushing a generated output, valid `.gitignore`/`.github`
source paths, and retained clones with different object coverage. Corrections
preserve distinct arrivals, retain only valid staging pathspecs, defer unsupported
names before moves, cover temporary creation/writes in cleanup, exclude only the
actual `.git` component, and inspect every corroborated clone. Additional checks
exercise interruption during prepared-blob and checkpoint publication.

Three further regressions reproduced receipt discovery losing identity under
`originals/`, incompatible legacy metadata blocking a moved batch, and `.git`
repository evidence failing retained-clone matching. The fixes preserve receipt
discovery and curation context, run incoming sources through the catalog planner
before filing, and normalize provenance URLs with the remote URL normalizer.

A genuine read-only Codex call also classified a synthetic delivery, followed by
script-owned filing, a verified local commit and intact receipt. It included
Git, library, image and unavailable references. This establishes the real model
boundary, not correctness for arbitrary editorial judgments or full reading of
unprovided source content. Private corpus backfill and deployment evidence remain
in the configured vault, outside this public software repository.

Reproduce with `python3 scripts/check_container.py python`, `node`, and `web`.
The existing pinned Linux formatter is required for the Python checks; prepare it
with the runner's `formatter` kind when absent. Browser suites are
`web_inbox.cjs`, `web_inbox_token.cjs`, `web_threads.cjs` and
`web_portable_links.cjs`, run through the bounded browser suite runner with a
configured local browser. Workers use read-only roots, capped temporary storage,
two CPUs, 4 GiB memory and deadlines; they retain bounded logs and remove their
containers. Existing toolchain images are reused.
