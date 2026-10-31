# Design sheet: Reading log

The line under a document's title. Source: `web/src/reading-log.tsx`; the model is `readingLogModel` in `src/reader_mcp/web_ui/reading-log.mjs`, and `app.mjs` renders it into the article's `.reading-log` slot with `renderReadingLog`.

## Focused activity

**See at a glance who has read this edition, and open the full list when it matters.** One collapsed line names up to four readers (voices, you, agents), with ◉ for this edition and ◐ for an earlier one, then *+N more*. Opening it lists readers by edition, newest first, with thread counts that open those threads. Task agents that read fewer documents than the threshold are folded into their own disclosure. Quiz results and your writing about the document follow the line.

## Composition

| Tier | Parts |
| --- | --- |
| Atoms (shadcn) | `Button` (thread counts, writing links), `Collapsible` (the line and the folded agents) |
| Molecules (shadcn) | `Item` rows in an `ItemGroup` |

Both disclosures keep their content mounted (`keepMounted`), as `<details>` did, so the change view's `[data-against]` hooks on earlier-edition rows exist while the log is closed. Opening either one asks the app to measure scroll progress and margin pins again. The root re-renders in place, so an open log stays open when your own read arrives.

## States

Loading (the slot reserves one line), empty (*Not yet read by anyone. You’ll be first.*), unavailable, collapsed and open.

## Test hooks

`[data-reading-log-toggle]`, `[data-reading-log-entry]`, `[data-reading-log-more]`, `[data-reading-log-body]`, `[data-reading-log-group=current|earlier]`, `[data-reading-log-row]` (with `data-state`, `data-group`, `data-against`), `[data-reading-log-name]`, `[data-reading-log-mark]`, `[data-reading-log-agents]`, `[data-reading-log-agents-toggle]`, `[data-reading-log-quizzes]`, `[data-reading-log-writing]`, `[data-reading-log-empty]`, `[data-reader-threads]`.
