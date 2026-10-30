# Design sheet: Admin › Library (target; not yet rebuilt)

Route `#admin/library`. Source today: `src/reader_mcp/web_ui/dashboard.mjs` (vanilla HTML strings), mounted into the Admin page by `LibraryPanel` in `web/src/admin/panels.tsx`.

## Status

This page has not been rebuilt on shadcn components. The dashboard is shared with the standalone statistics route. It is built from HTML strings, imitates shadcn buttons with `data-button` attributes styled by `web/src/vanilla-buttons.ts`, and hosts the D3 gallery charts. Rebuilding it properly means porting the dashboard to React and mounting the charts there. That is its own change, kept out of the Admin redesign so each change stays one reviewable unit.

## Focused activity

**See what the library holds and what you have read, then jump to the works behind a number.** A total, a chart segment or a bar leads to the works it counts.

## Target composition

| Tier | Parts |
| --- | --- |
| Atoms (shadcn) | `Button`, `Badge`, `Kbd`, `Separator` |
| Molecules | `FactList` (the six totals, as buttons that select a slice), `Notice` (the footnote on undated works), `EmptyState` (no unread discussion) |
| Organisms | `StatusCard` per chart (title, the method line as its description, the chart as content, Reset in `CardAction`); an `ItemGroup` for Latest additions and for Unread discussion |
| Template | `AdminPage`, `CardGrid` for the charts |

## Acceptance for the port

The existing `tests/web_dashboard.cjs` and `tests/dashboard.test.mjs` checks pass; `node tests/web_admin_review.cjs library` passes on every profile; no `data-button` markup remains in the dashboard; and the standalone statistics route uses the same React page.
