# Design sheet: Admin › Indexes

Route `#admin/indexes`. The detailed operating reference is [Indexes](../topics/indexes.md). Source: `web/src/admin/pages/indexes.tsx`, `index-charts.tsx` and `web/src/admin/documentation.tsx`; the index catalogue remains in `web/src/backstage.tsx`.

## Focused activity

Inspect freshness, completeness and capacity, start an appropriate rebuild, and consult the relevant technical contract without leaving the page. The dashboard contains measurements, actions and current operational feedback. Explanatory prose belongs in the reference pane.

## Layout

The Indexes route uses the available Admin content width. The Markdown reference opens over it in a right-hand `Sheet` from the header's Docs button, or from an info button, which also focuses the target heading. The reference remains mounted while closed to preserve its position. All Admin routes use this shared workspace with their own topic. On phones the Sheet fills the screen.

The dashboard contains status/check controls, current/attention/timing summaries, a conditional search update action, D3 coverage/capacity charts, the health table, selected-index inspector, recent runs and edition diagnostics. Existing admission, error, demo and busy behavior remains in force. Inline indexing essays, the update-policy notice, repeated purpose descriptions and generic metric help popovers are removed.

The reference is a shadcn Sheet with a contents selector and a scrolling Markdown region. The source is `docs/topics/indexes.md`, imported as text at frontend build time and recorded in build metadata. It is rendered through the existing sanitized Markdown pipeline. There is no API that exposes arbitrary repository or vault files. Heading IDs are namespaced to avoid collisions with dashboard controls. In-document links and info icons scroll/focus the requested heading without changing the Admin route or the dashboard scroll position. Repository documentation links open outside the application.

## Atomic composition

Shadcn Card, Table, Badge, Button, NativeSelect, Field, Collapsible, Tooltip, Alert and the existing theme molecules compose the page. IndexDocHelp is a contextual reference-navigation button; it does not open an explanatory popup. Overview uses the same reference-navigation buttons. D3 continues to calculate geometry while React owns the SVG. Charts and exact-value tables remain interactive data views rather than documentation substitutes.

## Status and guarantees

Opening Indexes reads saved status without starting maintenance, including when observations are absent or old. Run full check starts an explicit audit, with current-stage progress and results published as each probe finishes. Rebuilds verify only affected projections and retain admission through verification. The backend keeps process-local job history and admits one running maintenance job. There is no watcher, durable queue or Git-based invalidation; saved observations keep their per-index checked timestamps. Source/index integrity contracts are unchanged.

Missing measurements stay unknown; errors preserve their messages. Previous measurements remain visible during an audit. Stale/partial/missing rebuildable states invoke the primary action when allowed. Current/error/capacity-only states remain badges. The reference’s description of the backend verification/admission interval must remain accurate until that implementation changes.

## Verification and hooks

`tests/web_indexes.cjs` covers measured chart geometry and capacities, shadcn composition, keyboard/click inspection without job starts, action dispatch to synthetic maintenance, unknown/over-budget/busy/error states, equal desktop columns, documentation anchors and contents navigation, independent scrolling, unchanged Admin route and mobile bounds.

Hooks: `#admin-workspace`, `#admin-dashboard-pane`, `#admin-reference-pane[data-doc-section]`, `#admin-doc-body`, `#admin-doc-contents`, `[data-admin-doc-link]`, `#maintenance-check`, `[data-index][data-state]`, `[data-job]`, `[data-index-chart]`, `#index-inspector`, `#recent-runs` and `#edition-links`.
