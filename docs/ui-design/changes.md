# Design sheet: What changed

Opens with `Space d`, or from the article's *Changed since you read it* banner. Source: `web/src/changes-panel.tsx`.

## Focused activity

**See exactly what changed since you (or another reader) read this edition, then jump to it.** The panel lists every reworded, added and removed paragraph in order, with word-level changes, and says what happened to your highlights. Selecting a change scrolls the article to it. *Mark as caught up* records the read.

## Composition

| Tier | Parts |
| --- | --- |
| Atoms (shadcn) | `Sheet` (right on wide screens with no backdrop, bottom on phones), `Badge` (Reworded = secondary, Added = default, Removed = destructive), `Button` |
| Molecules | change `Item` (an outline button: kind Badge, then the text with `del`/`ins` word marks as content styles), separator `Marker` for runs of unchanged paragraphs, `Notice` (your margins; unavailable changes) |
| Organisms | the change list (`ItemGroup`) |

## Test hooks

`#changes-panel`, `[data-changes-hunks] > [data-op]`, `button[data-op=replace|insert|delete][data-start]`, `.change-hunk`, `[data-change-text]`, `[data-changes-annotations]`, `#changes-caught-up`.
