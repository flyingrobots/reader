# Admin Overview

## Overview

Admin Overview is a read-only triage page. It combines the most recent status of maintenance, the inbox runner, local-model tasks and active Coding Jobs. Opening this page starts no index audit, rebuild, filing run, model generation or coding job. Its action links take you to the owning page.

## Attention needed

Attention combines known stale, partial, missing, near-limit, over-limit and error index states; recent maintenance failures; blocked or failed inbox work; and unreadable status sources. An item is an explanation and navigation link, not an automatic repair. A failed historical run can remain visible even after a newer run succeeds; inspect its timestamps and current state before acting.

Failures to read status remain visible as Unavailable. Empty or healthy messages require the relevant sources to have answered; a network failure must not become zero work or proof of health. Follow an item to Indexes, Inbox or the corresponding job before starting anything.

## Active work

Maintenance, the local-model queue, the librarian and Coding Jobs have distinct runners and ownership. Seeing several kinds of activity does not mean they share one scheduler or can safely ignore common resource budgets. Maintenance has one admitted running job; other runners expose their own busy/read-only states. A reader can continue browsing during work.

Started times indicate when work began, not an estimated completion time. A spinner is an activity signal. Inspect the owning page for logs, progress, verification and termination controls. Overview provides no blanket Stop operation.

## Inbox

The arrival count reports material waiting to be filed. Receipt integrity means recorded delivery bytes agree with their hashes, not that the content is correct or already read. Filing requires an explicitly authorized librarian run. An arrival can be intact while blocked by an active claim, missing coding CLI or interrupted intake. Open Inbox to inspect the reason.

## Index health

Index status is a saved freshness snapshot. Overview does not refresh it simply by being viewed. Open Indexes for an explicit audit and contextual rebuild actions. A checked timestamp and a built timestamp mean different things. Library works, physical files, passages and edition families use different denominators.

## Refresh and navigation

Maintenance/inbox status comes from the existing shared polling machinery; active Coding Jobs are read on their own bounded polling loop. A failed refresh preserves previous known information with a warning. Links navigate to the owning Admin section and preserve the library return route. Back to Library returns to the prior reading/search/split context rather than treating the Overview as a source document.

## Documentation

The right pane is the canonical Markdown reference for this section. Hide documentation expands the operational area; the visibility preference is shared across Admin on this browser. Each section preserves its own reference heading and scroll position for this browsing session. Info buttons reopen hidden documentation at the relevant section. On narrow screens the panes stack.

## Troubleshooting

If the page looks quiet but another tool is speaking or working, inspect the correct runner rather than assuming Overview is a system-wide process monitor. If an activity appears interrupted, use that subsystem’s reconciliation procedure; do not start a duplicate merely because its UI stopped polling. If status is unavailable, diagnose access/server health before interpreting counters.

Implementation: `web/src/admin/overview.tsx`, the Admin section registry, shared maintenance/inbox polls and Coding Jobs list endpoints. This page writes no source files, GitHub artifacts or reading receipts.
