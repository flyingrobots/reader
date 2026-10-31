# Design sheet: Admin › Indexes

Route `#admin/indexes`. `web/src/admin/pages/indexes.tsx` composes the page; `index-charts.tsx` computes interactive SVG geometry with the existing vendored D3. Index titles, actions and measurements come from `web/src/backstage.tsx`.

## Focused activity

Inspect freshness, semantic completeness and resource headroom, then rebuild a selected projection. The page uses measured status snapshots. Opening it requests a full freshness check when the previous check is more than two minutes old; it does not automatically rebuild indexes.

## Layout and composition

A shadcn toolbar gives the last check time, a running freshness check’s elapsed time and Check again. An Alert explains the shared maintenance job slot when it is occupied. Three shadcn Cards summarize current checks, checks needing attention, and the latest completed audit duration.

Two chart Cards contain:

- Semantic coverage: a D3 pie/arc layout of indexed text documents, divided into Fully embedded and Needs embeddings. The latter includes documents with any unembedded chunks; path-only files are excluded. Segment labels retain exact counts, support keyboard/click selection and inspect Search.
- Capacity & headroom: a D3 linear scale renders usage against individual limits. Shadcn Tabs switch Storage and Inventories. Hover/focus exposes exact values; activation inspects the corresponding index. A shadcn Collapsible/Table provides all plotted values as text. Over-budget percentages remain visible above 100%, even though bar geometry stops at the limit. Unknown measurements are omitted instead of plotted as zero.

A shadcn Table compares index states and rebuild actions. Selecting an index changes the inspector Card below it, whose measurements use a shadcn Table. Recent runs and Edition links form the final responsive grid. Existing legacy-index removal remains in the Search inspector.

## Behavior and limits

D3 computes geometry and React owns the SVG; no second DOM renderer, animation loop, network chart library or new dependency is introduced. A ResizeObserver sizes capacity labels and bars to their container and disconnects on unmount. SVG controls have names, focus targets and Enter/Space support. Charts use the existing Reader theme/chart tokens. The coverage legend wraps below the ring on small screens. Tables scroll within their cards.

Cached measurements remain visible during audits. Initial missing status has no fabricated percentages. Unavailable status disables rebuilds; failed refreshes retain the previous snapshot with an explicit warning. The backend still checks the five domains sequentially and publishes results together, and still runs one admitted maintenance job at a time. The UI does not add job queueing, phase telemetry or parallel rebuilds.

## Verification

`tests/web_indexes.cjs` checks measured SVG values, shadcn composition, keyboard/click inspection without job starts, data tabs, unknown and over-budget usage, checking/unavailable states and mobile bounds. Existing hooks remain: `#maintenance-check`, `[data-index][data-state]`, `[data-job]`, `#recent-runs`, `#edition-links`. Added hooks: `[data-index-charts]`, `[data-index-chart]`, `[data-index-fleet]`, `#index-inspector` and `[data-inspected-index]`.
