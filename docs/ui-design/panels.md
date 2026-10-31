# Design sheet: Side panels (Discussions, Versions, Lists)

Source: `web/src/panel-sheet.tsx`. Each panel is a non-modal shadcn `Sheet` (`modal={false}`, no overlay, kept mounted) around its existing `<aside>` from `index.html`: `#thread-panel` (In the margins), `#versions-panel`, `#list-panel`.

## Focused activity

**Keep a panel beside the reading.** The margins panel lists and opens discussion threads. Versions holds the timeline ([versions-timeline.md](versions-timeline.md)). Lists shows locations, marks and registers. The page stays interactive; on wide screens an open panel docks as a column beside it.

## Composition

| Tier | Parts |
| --- | --- |
| Organisms (shadcn) | `Sheet` with `SheetContent` (`side="right"`; `showOverlay` and `keepMounted` were added as passthroughs) |

The asides are still driven by plain JavaScript, and the Sheet adapts to them rather than taking over:

- **Open and closed.** `app.mjs`, `versions.mjs` and `lists.mjs` open and close a panel with the aside's `hidden` attribute, which `reading.mjs` (status modes) and `dock.mjs` (docking) watch. The Sheet stays open, and `styles.css` shows its popup exactly while the aside is not hidden. A panel the app unhides can therefore take focus in the same moment, which a state update could not guarantee.
- **Escape, clicks outside, focus.** These stay with the app. The Sheet cancels Base UI's own close and allows the Escape key to propagate (a cancelled close still stops propagation otherwise). `pageEscape` in `app.mjs` handles Escape inside these Sheets while still leaving other Sheets (What changed, chat) to themselves.
- **Role.** The popup has `role="none"`. The aside keeps its own semantics, and `typing()` would otherwise treat every key inside a panel as typing.
- **Geometry.** It lives on the popup (`[data-panel-sheet]` in `web/src/styles.css`): above the status line (32 px, 38 px under 700 px, none in a split pane), 410 px wide (Versions 440 px), a column at `--dock-width` when docked, and Versions as a bottom sheet under 640 px. The aside keeps its padding and scrolling.

## Test hooks

`#thread-panel`, `#versions-panel` and `#list-panel` with their `hidden` state; `[data-panel-sheet=<id>]` for the surface (`web_dock` measures it).
