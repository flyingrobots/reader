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
| Reading log | `web/src/reading-log.tsx` | shadcn: [reading-log.md](reading-log.md) |
| Link previews | `web/src/link-preview.tsx` | shadcn: [link-preview.md](link-preview.md) |
| Versions timeline | `web/src/versions-timeline.tsx` | shadcn: [versions-timeline.md](versions-timeline.md) |
| Documents picker, Keyboard help, diagram viewer, annotation, Speak menu, Scratch Save | `web/src/shell-dialog.tsx` | shadcn: [shell-dialog.md](shell-dialog.md) |
| Find bar | `web/src/find-bar.tsx` | shadcn `InputGroup` and `ButtonGroup`; `app.mjs` drives it by id |
| Article art: prompt card, focus view | `web/src/art-prompt-card.tsx`, `web/src/art-focus-chrome.tsx` | shadcn: [art.md](art.md) |

## React surfaces with their own theming layer

The activity transcript (`web/src/activity/transcript.tsx`, shared by Inbox, Coding jobs and the prompt card) is composed from Trace, Message, HoverCard, CodeBlock and Badge. Its trace status colours come from contrast-checked tokens (`--activity-running`, `--activity-done`, `--activity-error`, `--activity-secondary`) that `tests/web_inbox.cjs` verifies in every theme. That is a deliberate theming layer, applied through those variables and the `.activity` rules in `web/src/styles.css`. Its quiet notes, labels, command line, stack errors and change labels are utilities and Badges.

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
| Discussions, Versions, Lists panels | `index.html`, `app.mjs`, `versions.mjs`, `lists.mjs` | Vanilla panel shells with bridged Buttons and Kbd; the versions timeline inside is shadcn. Moving the shells to shadcn `Sheet`s ([#200](https://github.com/flyingrobots/reader/issues/200)). |
| Scratch pad | `scratch.mjs` | A CodeMirror editor with bridged chrome. |
| Outline entries | `web/src/outline.tsx`, `outline.mjs` | A deliberate custom navigation list, shared by the React popover and sheet and the vanilla rail. |
