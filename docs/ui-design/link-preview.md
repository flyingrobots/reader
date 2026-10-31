# Design sheet: Link previews

A card for a link the document itself contains, on hover after a short pause, on focus at once, or with `K`. Source: `web/src/link-preview.tsx`, a shadcn HoverCard; `src/reader_mcp/web_ui/links.mjs` decides when it shows and loads its content.

## Focused activity

**Decide whether to follow a link without leaving your place.** The card says where the link goes (a library document with its project, title, authors, heading and an excerpt; an external host; or a link the library cannot resolve) and whether you have read that edition.

## Composition

| Tier | Parts |
| --- | --- |
| Molecules (shadcn) | `HoverCard` with `HoverCardContent`; its `anchor` prop (passed through to Base UI's Positioner) places it at the link |

The document's links are rendered Markdown, not React, so the card has no Trigger. `links.mjs` opens and closes it, keeping the rules readers rely on:

- a 350 ms hover pause, but focus shows the card at once;
- Escape, a click elsewhere, scrolling or a text selection closes it;
- moving from the link onto the card keeps it open;
- no preview while a page turns.

At 640 px and below the card is a bottom sheet inside the 16 px gutters, placed by a virtual anchor just above the status line. Previews appear constantly while reading, so the card does not animate.

## Test hooks

`#link-preview` (with `role=tooltip` and the link's `aria-describedby`), `[data-sheet]`, `[data-link-preview-kicker]`, `[data-link-preview-title]`, `[data-unread]`, `[data-link-preview-heading]`, `[data-link-preview-excerpt]`, `[data-link-preview-host]`.
