# Design sheet: App dialogs (Keyboard help, diagram viewer)

Source: `web/src/shell-dialog.tsx`, opened from `app.mjs` with `openShellDialog`.

## Focused activity

**Look at one thing in full, then go back to reading.** Keyboard help shows the map of keys and commands; the diagram viewer shows a diagram enlarged. Both are modal: the page underneath is inert, Escape or the close button closes them, and focus returns to where it was.

## Composition

| Tier | Parts |
| --- | --- |
| Organisms (shadcn) | `Dialog` with `DialogContent`, `DialogHeader`, `DialogTitle` and a labelled `DialogClose` icon `Button` |

The body is one element that plain JavaScript fills once it exists: `keys.renderHelp()` writes the generated key map into `#help-keys`, and the viewer copies the diagram's SVG. `openShellDialog` returns `{close, body}`. It runs `onClosed` after the dialog has gone, and the app then resumes the reading smoother and refocuses a split view.

The popup carries `data-reader-modal`, so `modalOpen()` in `web_ui/modal.mjs` counts it like a native `<dialog>`: no selection capture, no reading keys, no scratch status. Base UI unmounts a closed dialog, so the help exists only while open.

## Test hooks

`#help`, `#help-keys`, `#diagram-dialog`, `#diagram-body`; the close buttons are labelled *Close keyboard help* and *Close diagram*.
