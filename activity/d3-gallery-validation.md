# D3 gallery integration — 2026-10-28

Reviewed the D3 gallery list and the calendar, stacked horizontal bar, and
zoomable icicle source examples. Chose those three for existing Reader Library
panels: day-based arrival retrieval, contextual reading backlog, and drill-down
shelf navigation. The [chart guide](../docs/library-charts.md) records the choices,
encodings, limitations, and deferred gallery alternatives.

The implementation uses existing library data, locally shipped D3, theme tokens,
and chart-to-editions selection. It replaces the packed-circle atlas and unread-only
bars, adds a calendar toggle to arrivals, and paginates the complete selected set.
Dashboard summary read totals now follow current in-session work records, matching
the chart segments after a document open.

## Validation

- `node --test tests/library-charts.test.mjs tests/dashboard.test.mjs tests/web_logic.test.mjs`:
  20 checks passed. Coverage includes date boundaries, localized arrival days,
  grouped-work membership, topic remainders, duplicate titles, missing labels, and
  existing source-coordinate behavior.
- `node tests/web_library_charts.cjs`: passed on a synthetic vault. Daily selection,
  topic/status intersections, all-results pagination, keyboard shelf navigation,
  real source opening and durable read status, matching summary totals, mobile
  width, empty inventory, untrusted labels, and browser error collection.
- `node tests/web_dashboard.cjs`: passed. Twelve live panels, selection/reset,
  browse-first picker, fuzzy filtering, Escape, paired theme toggles, mobile width,
  and text/button contrast across 22 built-in themes.
- `python -B -m pytest -q -p no:cacheprovider tests/test_no_absolute_paths.py`:
  10 checks passed. New guide links resolve and its development heading exists.
- Desktop and mobile synthetic screenshots inspected. Shelf labels use the existing
  page surface behind text; calendar counts and names remain explicit.

Browser checks reused installed Chrome, pinned Playwright, and the existing Python
environment, serialized under the workstation's `host/services/reader-web-qa/` key.
The native monitored runner enforced a 300-second deadline, 1.5 GiB process-tree RSS
limit, 4 GiB aggregate runtime-data budget, 16 MiB log cap and 50 GiB free-space floor.
Earlier combined dashboard cases hit the RSS guard. Running the independent theme,
picker and mobile cases in serial fresh browsers passed within the same bound;
no limit was raised and no cases were skipped. The successful regression peak was
about 1.43 GiB; successful chart acceptance was about 1.30 GiB. Aggregate measured
runtime data stayed around 1.70 GiB, with over 594 GiB host free. No build caches or
Docker workers were created. Test fixtures were synthetic; no private source
content belongs in this record.

The new charts are plain shipped modules/styles and need no controls-bundle build.
No server routes or Python implementation changed. This is focused acceptance,
not a full Python suite, full accessibility audit, external publication, or deployment.
The private-vault inventory grouping check is recorded only in the task report.
