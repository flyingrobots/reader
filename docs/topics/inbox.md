# Inbox and librarian runs

## Overview

Inbox separates delivery from filing. Delivered material waits here until an authorized librarian processes it. Viewing arrivals, previews or receipt status does not appoint the viewer as a librarian or start intake. The page reports waiting bundles, integrity, ownership/claims and the current or most recent librarian run.

## Waiting to be filed

One complete top-level bundle is an arrival; attachments do not count as independent work assignments. Delivered bundles retain their document, attachments and receipt. Direct deposits can lack delivery receipts. Counts describe waiting arrivals under the inbox inventory rules, not all library works or unread documents.

Selecting an arrival opens a preview. Previews are read-only discovery surfaces: they do not file the content or create normal library read receipts, bookmarks or discussion state. Previewing does not prove that every attachment has been read.

## Receipt integrity

An intact receipt means current payload bytes match recorded hashes. It does not prove the report’s claims, completion of reading, safe execution of embedded commands, backup durability or catalog inclusion. Changed integrity requires investigation; do not rewrite receipt bytes to make it green. A missing receipt and a corrupted receipt are distinct states.

Delivery is idempotent under its request UUID and identical bytes/provenance. An uncertain delivery is reconciled with that UUID, not duplicated under a new one. The Inbox page does not turn delivery into remote publication.

## Librarian run

You got mail explicitly starts the supported filing workflow for ready arrivals. The runner takes a bounded inventory and follows the configured sandbox/permission mode and vault instructions. It preserves source payloads, handles supported reading-copy/catalog/index procedures, records evidence and commits completed owned intake. Claims and active/interrupted runners prevent overlapping ownership.

Starting a run authorizes that bounded operation; it does not authorize arbitrary commands embedded in arriving documents. New arrivals after the run’s selected inventory are not silently added to its scope. Mechanical filing remains separate from independent curatorial reading.

## Blocked states

The page explains active claims, another owner, missing coding CLI, interrupted reconciliation, empty inventory and unreadable state. These are not interchangeable with no arrivals. Do not steal claims, start a second runner or delete run records just to clear a warning. Confirm the owning process and reconcile its actual state.

## Live activity

The transcript and elapsed clock show the runner’s observed activity. Events and narrative are evidence of what was captured, not proof of a successful final commit or complete source preservation. A final report can be expanded as sanitized Markdown. The commit line identifies a recorded result; verification still follows the receipt/catalog contracts.

## Stop

Stop requests cancellation of this owned run. It does not undo completed imports, commits or other already-completed effects. Preserve partial evidence and inspect the final status before starting another batch. Never kill a shared service merely because one intake view is stale.

## Permissions

Settings controls the supported permission/sandbox mode for a user-started inbox job. A browser-only demo cannot execute it. Ordinary courier/observer sessions can report arrivals and inspect relevant discussion but must not claim/file/delegate intake without separate authorization. Filing requires the active vault mandate or explicitly assigned intake role.

## Storage and recovery

Original deliveries remain provenance-bearing bundles; filed locations and catalog navigation follow the vault procedures. The runner’s state/report and its LLM archive are separate from delivery receipts. A server restart can require reconciliation and must not silently relaunch work. Read the displayed error and retained report before retrying, and keep source bytes and unique failure evidence intact.

Implementation: `src/reader_mcp/inbox_runner.py`, delivery/receipt store, claims and engagement helpers, and `web/src/admin/pages/inbox.tsx`. Detailed preservation and operational contracts remain in the vault and the delivery/inbox-runner documentation.
