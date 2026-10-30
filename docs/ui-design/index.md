# Reader page design sheets

Reader Admin's pages have their sheets in [admin-design/](../admin-design/index.md). This folder covers the rest of Reader. Each page built from shadcn components gets a sheet stating its focused activity, layout, composition through the [atomic tiers](../web.md#component-system), states and test hooks. `node tests/web_page_review.cjs [page …]` reviews these pages the way `web_admin_review.cjs` reviews Admin.

## Surfaces

| Surface | Source | Status |
| --- | --- | --- |
| Search | `web/src/search-page.tsx` | shadcn: [search.md](search.md) |
| Reading queue | `web/src/queue-panel.tsx` | shadcn: [queue.md](queue.md) |
