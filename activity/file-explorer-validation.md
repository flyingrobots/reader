# File Explorer column — 2026-10-30

Replaced the Documents modal and folder tree with a nonmodal left column. The shared shadcn atoms compose article-row, filter and pagination molecules and a FileExplorer organism. The list filters the complete grouped library before paging, independent of the recent-files preference. Article loading retains the column and its state. Leader-e and Space-comma-e toggle it, `:files` opens it, and Escape closes it (after a nested Select, if one is open). A visible Search contents action opens the existing search page.

Layout reserves the explorer's width in continuous, two-page and split shells. Opening/closing dispatches a resize so reading geometry reflows; right-dock admission and outline-rail placement account for the left column. Existing dialog handling remains for the other dialogs. The old document-tree module is removed. Browser suites that used the old modal/tree selectors now address the column/article rows; the retired modal-search retry case is removed while the full search-page retry checks remain.

## Checks actually run

- `npm --prefix web run check` — passed.
- `npm --prefix web run build` — passed; checked-in JS/CSS, licenses and source/output hash register regenerated.
- `node tests/web_documents.cjs` — passed on the final candidate. Synthetic metadata adds 45 articles to exercise all three pages, filtering beyond the former recent cap, sorting, Read/Unread filters, empty results, preserved state, keyboard toggles, command opening, nested Select Escape, main-content loading and exact read-state refresh. Checks continuous/two-page column geometry, 390-pixel viewport bounds and the visible Search contents route. Screenshots are local under `.reader/web-dev/file-explorer-{desktop,mobile}.png`; visually inspected both layouts.
- Inline Node assertions against `web/src/explorer/model.ts` — passed: path-segment scope isolation, ascending/descending dates with missing dates last, author/status filtering and multiword metadata matching.
- `node tests/web_breadcrumbs.cjs` — passed after correcting an outline rail that initially intercepted explorer controls. Covers scoped filtering, All folders, keyboard navigation and mobile bounds.
- `node tests/web_focus.cjs` — passed.
- `node tests/web_controls.cjs` — passed. The initial popover assertion captured a reading estimate before page-turn animation settled; the assertion now compares the estimate after the hover opens. It still checks that the popover reports the current reading position.
- `node --check` for changed app, dock and outline modules, and `git diff --check` — passed.

The other updated browser suites were not run in this turn; full split-view and full-suite regression coverage remain unverified. No private vault contents were used as test fixtures or changed. Observer Upkeep reported eight pending arrivals and 328 unread discussions for this participant; none were filed or marked read.

## Delivery and resources

This is a local code change only. The current checkout is `main`, which differs from `origin/main`; the running Reader service uses a separate live worktree following `origin/main`. No push, remote merge or live-service update was performed.

Reused the checkout's frontend dependency location and the existing npm cache. `npm ci --ignore-scripts --no-audit --no-fund` restored missing locked packages after the first build found `shadcn/tailwind.css` absent. Host free space measured 570 GiB; frontend dependencies 280 MiB, shipped controls 5.4 MiB, existing browser evidence directory 30 MiB. No Docker worker, image, volume, target directory or background campaign was created. Short builds and focused browser checks used the existing local tools; no disk quota or workload-wide resource monitor was added, and no heavy campaign was launched.
