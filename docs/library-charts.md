# Library charts

Open **Reader Admin → Library** for the statistics dashboard. Its charts select
actual catalog works in the editions list below. **Show more works** adds eight
results at a time; **Clear selection** restores latest additions. Selecting the
same chart choice again also clears it. Reading and arrival views use the same
existing library response; they add no server endpoints or dependencies.

## Arrival calendar: find a day you remember

In **Arrivals over time**, choose **Calendar** to switch the weekly chart to a
Monday-first day grid covering the same twelve calendar weeks, through today.
Darker cells mean more arrivals, and nonzero cells show counts (99+ above 99;
tooltips and accessible names retain the exact count). Select an occupied day to
list its works. **Weekly** switches back. Empty days are not keyboard stops.

The [D3 calendar](https://observablehq.com/@d3/calendar/2) fits a common retrieval
question: “What arrived around that Friday?” Weekly totals answer volume questions;
the calendar exposes particular days without another dashboard panel.

These are arrival/filing dates, not publication dates. Arrival instants are grouped
in the reader’s local time zone; plain catalog dates remain plain dates. Undated
works are excluded, and future days are not drawn. Date calculations use UTC
arithmetic on already-localized plain dates so daylight saving changes cannot
shift a cell to another weekday. The calendar is a recent-arrival view, not an
all-history date picker or a reading streak tracker.

## Reading by topic: put the backlog in context

**Reading by topic** replaces the unread-only topic bars. Each horizontal bar
stacks current-edition Read and Unread counts. Select either segment to list that
intersection, or select the topic label for both. The key names both series;
accessible names and tooltips include the topic, status, and exact count.

The [D3 stacked horizontal bar chart](https://observablehq.com/@d3/stacked-horizontal-bar-chart/2)
fits better than a separate backlog ranking: twenty unread works has a different
meaning on a shelf of twenty than on a shelf of two hundred. A shared baseline
shows total shelf size and its opened/unopened split together.

Only the first topic counts, so totals do not double count multi-topic works.
The largest topics are retained, with remaining topics grouped as **Other topics**.
Missing topic metadata stays explicit. An opened edition is not proof of completed
study, reading duration, or curator review. Summary totals and chart segments
share the same current work records, including in-session opens.

## Shelf atlas: navigate from an overview to a document

**A map of the stacks** uses a [zoomable icicle](https://observablehq.com/@d3/zoomable-icicle)
with the hierarchy **first topic → first project → work**. Each grouped work has
weight one; attachments and source bytes do not make a work larger. These are
catalog classifications, not filesystem folders or inferred conceptual links.
Missing topics and projects have explicit unspecified shelves.

Select a shelf to zoom in. Select a work to open its primary source. Breadcrumbs
return to an ancestor; **Reset** returns to all shelves and clears the editions
selection. **Browse … works on this shelf** selects its descendants for the
editions list. The native **Open a shelf or work** picker always lists every
immediate child, even when its chart cell is too small to draw legibly. Cells have
keyboard activation and labelled roles; the picker also supports native keyboard
and touch interaction. Settings → **Library atlas** turns this panel off.

Rectangles leave room for horizontal document titles, and ancestry remains visible
while drilling. That makes this a stronger fit for reading navigation than a
sunburst with rotated labels or a treemap optimized primarily for comparing areas.
The view has no decorative motion and honors Reader’s existing theme tokens.

## Other gallery candidates

- **Treemap / circle packing:** useful alternative shelf overviews, but they
  duplicate the atlas and give less consistent space to long titles.
- **Arc diagram / force-directed graph:** promising for a focused set of explicit
  citations or edition relationships. The current chart response has classifications,
  not a typed document-edge dataset. Drawing topic similarity as a citation link
  would misrepresent the evidence.
- **Brushable scatterplot:** potentially useful for date versus source size, but
  source bytes are not reading time. It adds less to choosing a work than the
  arrival calendar and direct shelf navigation.
- **Sankey / sequences sunburst:** need a meaningful flow or ordered event history.
  Current read marks do not reconstruct a reading journey.

## Implementation and checks

The data helpers (`arrivalCalendar`, `readingTopics`, `shelfHierarchy`) are pure
functions in `web/src/admin/pages/gallery-model.ts`. `library-charts.ts` draws the
calendar and reading-by-topic marks with D3; `shelves.tsx` is the shelves component:
a shadcn Breadcrumb trail, a NativeSelect listing every child shelf or work, and the
D3 icicle. The Library page (`library.tsx`) connects their selections to the editions
list, and `dashboard.mjs`'s `libraryModel` supplies the panels. D3 is shipped locally. No gallery
iframe, CDN fetch, automatic catalog rebuild, or source-file mutation is needed.
Names enter SVG and picker labels as text, not trusted HTML. The reusable data
helpers accept catalog works, preserving grouped-work and first-label counting.

Run the focused checks with the repository’s existing Python environment,
Playwright dependency, and installed Chrome, as described in [web verification](web.md#development-and-validation):

```sh
node --test tests/library-charts.test.mjs tests/dashboard.test.mjs tests/web_logic.test.mjs
node tests/web_library_charts.cjs
node tests/web_dashboard.cjs
```

The browser suite uses a synthetic vault and exercises chart selection, pagination,
keyboard drill-down, source opening, durable read status, mobile width, empty
inventory, and untrusted labels. Unit checks include leap-day/year boundaries,
local arrival days, remainder grouping, and preservation of distinct works with
identical titles. These checks do not establish source-claim correctness or a
complete accessibility audit.
