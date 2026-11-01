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

A full guarded Python run recorded 1,082 passed, two skipped and one failure in
the existing chat-commit trailer test. That test passed in a subsequent focused
guarded run alongside the intake and portable-reference tests. The initial
failure remains evidence of intermittent chat test behavior; final CI must pass
on the submitted head. Earlier draft/checkpoint reports describe prior states.

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
