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
| What changed | `web/src/changes-panel.tsx` | shadcn: [changes.md](changes.md) |

## The plain-JavaScript surfaces

Much of the reading app is rendered by `src/reader_mcp/web_ui/*.mjs` from template strings, not by React. Those surfaces use real shadcn styling through the vanilla bridge in `web/src/vanilla-buttons.ts`, which applies the components' own classes and `data-slot` contracts:

- `data-button="<variant> <size>"` and `data-button-group` take `buttonVariants` and `buttonGroupVariants`;
- plain `<kbd>` in Reader's chrome takes Kbd's classes. Author content (`#article` and other prose), the compact status-line hints and the Theme Editor preview keep their own;
- close buttons render lucide's X icon, never a `×` glyph.

| Surface | Source | Verdict |
| --- | --- | --- |
| Home / weekly issue | `magazine.mjs`, `app.mjs` | Editorial layout (masthead, cover story, sections). This is content design, not component UI, and stays as it is. Its actions (Queue, Make cover art, issue navigation) are bridged Buttons. |
| Article | `reading.mjs`, `app.mjs` | Prose and its margins are content. The *Source* button and banners use bridged Buttons. The outline rail shares its entry list with the React outline popover and sheet, as one navigation design. |
| Status line | `index.html`, `status-priority.mjs` | A compact, priority-managed bar. Pagination, Progress, Popover, Select and Switch inside it are React shadcn. Its key hints stay compact on purpose. |
| Documents picker, Keyboard help, Speak menu, Annotation, Diagram viewer | `index.html`, `app.mjs`, `keys.mjs` | Native `<dialog>` shells holding bridged Buttons and Kbd. Moving them to shadcn `Dialog`/`Sheet` means taking their open/close, focus and key handling out of `app.mjs` one dialog at a time. That is tracked as follow-up work, not done in this sweep. |
| Discussions, Versions, Lists panels; Find bar | `index.html`, `app.mjs`, `versions.mjs`, `lists.mjs` | Vanilla panels with bridged Buttons and Kbd. Same follow-up as the dialogs (shadcn `Sheet`). |
| Scratch pad | `scratch.mjs` | A CodeMirror editor with bridged chrome. |
| Outline entries | `web/src/outline.tsx`, `outline.mjs` | A deliberate custom navigation list, shared by the React popover and sheet and the vanilla rail. |
