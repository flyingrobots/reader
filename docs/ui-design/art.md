# Design sheet: Article art (prompt card, focus view)

Sources: `web/src/art-prompt-card.tsx` (the body of `#art-prompt-card`) and `web/src/art-focus-chrome.tsx` (the focus view's heading, actions, Artist's note and status). `art-prompt.mjs` and `art-focus.mjs` keep the behaviour: when the card shows (hover, focus, long press) and where it sits, and the focus view's stage, focus trap and Escape.

## Focused activity

**See the art, and how it was made.** The prompt card says who made a piece and when, gives the Artist's note, and shows each stage's prompt as sent: the instructions first, with the quoted article, brief and scene-language reference collapsed, and a Copy button per stage. The focus view shows one piece full screen, with the Artist's note, the prompt card, Regenerate this and Close.

## Composition

| Tier | Parts |
| --- | --- |
| Atoms (shadcn) | `Button` (Copy, the focus actions), `CodeBlock` (prompt text), `Collapsible` (quoted inputs) |
| Molecules (shadcn) | `ButtonGroup` (focus actions) |
| Organisms (shadcn) | `Card` for the prompt card, the focus heading and the Artist's note |

The prompt card's shell (`#art-prompt-card`) keeps only its fixed position and computed size. The Card inherits that maximum height and scrolls. The focus chrome renders once and never again; `art-focus.mjs` wires its `data-focus-*` buttons and toggles the note's `hidden`. The `art-focus-*` classes only position the overlays over the stage. The focus heading's content sits in `CardContent`, not `CardHeader`: the header is a container-query container, and its zero intrinsic width stopped the card fitting its title.

## Test hooks

`#art-prompt-card` (with `data-state`), `[data-art-prompt-stage]` with `data-stage`, `[data-art-stage-title]`, `[data-prompt-text]`, `[data-part]` (quoted inputs), `[data-copy]`; `.art-focus-heading`, `[data-focus-note]`, `[data-focus-prompt]`, `[data-focus-regenerate]`, `[data-focus-close]`, `#art-focus-note`, `.art-focus-status`.

`tests/web_art_touch.cjs` dispatches the drag as in-page pointer events on Playwright's clock. CDP touch events reach a loaded renderer late, so a real drag could look like a 550 ms stationary press. The stationary press stays a real CDP touch, because late delivery can only make it more likely to register.
