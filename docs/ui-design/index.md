# Reader page design sheets

Reader Admin's pages have their sheets in [admin-design/](../admin-design/index.md). This folder covers the rest of Reader. Each page built from shadcn components gets a sheet stating its focused activity, layout, composition through the [atomic tiers](../web.md#component-system), states and test hooks. `node tests/web_page_review.cjs [page …]` reviews these pages the way `web_admin_review.cjs` reviews Admin.

## Surfaces

| Surface | Source | Status |
| --- | --- | --- |
| Search | `web/src/search-page.tsx` | shadcn: [search.md](search.md) |
| Reading queue | `web/src/queue-panel.tsx` | shadcn: [queue.md](queue.md) |
| Theme Editor | `web/src/theme/theme-editor.tsx` | shadcn: [theme-editor.md](theme-editor.md) |
| Chat with the voices | `web/src/chat/` | shadcn: [chat.md](chat.md) |
| Article prompt card | `web/src/jobs/prompt-card.tsx` | shadcn: [prompt-card.md](prompt-card.md) |
| Quiz | `web/src/quiz.tsx` | shadcn: [quiz.md](quiz.md) |
| Writing prompt | `web/src/writing-prompt.tsx` | shadcn: [writing-prompt.md](writing-prompt.md) |
