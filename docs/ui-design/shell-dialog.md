# Design sheet: App dialogs (Keyboard help, diagram viewer, annotation, Speak menu)

Source: `web/src/shell-dialog.tsx`, opened from `app.mjs` and `speech.mjs` through `openShellDialog`, `openAnnotationDialog` and `openSpeakMenu` (`reader-controls.tsx`).

## Focused activity

**Do one small thing, then go back to reading.** Keyboard help shows the map of keys and commands. The diagram viewer shows a diagram enlarged. The annotation dialog takes a comment or warning on the selected passage. The Speak menu sends the whole article, from your place or the selection to AI-TTS (`a`, `f`, `s`; `j`/`k` move). All are modal: the page underneath is inert, Escape or the close button closes them, and focus returns to where it was.

## Composition

| Tier | Parts |
| --- | --- |
| Organisms (shadcn) | `Dialog` with `DialogContent`, `DialogHeader`, `DialogTitle` and a labelled `DialogClose` icon `Button` (`AppDialog`) |
| Atoms (shadcn) | `Textarea` and a submit `Button` (annotation); a vertical `ButtonGroup` of outline `Button`s with `Kbd` (Speak menu) |

`AppDialog` holds the open state and frame. `openAppDialog` mounts each dialog in its own container and removes it once closed; opening a dialog that is already open replaces it. The initial element (the comment box, the first Speak choice) also takes `autoFocus`. A native dialog's `showModal()` moved focus at once, and Base UI's `initialFocus` runs a frame later, so this way keys typed the moment a dialog appears still reach it. In the shell dialogs, the body is one element that plain JavaScript fills once it exists: `keys.renderHelp()` writes the generated key map into `#help-keys`, and the viewer copies the diagram's SVG. `openShellDialog` returns `{close, body}`. It runs `onClosed` after the dialog has gone, and the app then resumes the reading smoother and refocuses a split view.

The popup carries `data-reader-modal`, so `modalOpen()` in `web_ui/modal.mjs` counts it like a native `<dialog>`: no selection capture, no reading keys, no scratch status. Base UI unmounts a closed dialog, so the help exists only while open.

## Test hooks

`#help`, `#help-keys`, `#diagram-dialog`, `#diagram-body`, `#annotation-dialog` (with `data-kind`), `#annotation-quote`, `#annotation-form`, `#annotation-body`, `#speak-menu`, `[data-speak=article|from|selection]`. The close buttons are labelled *Close keyboard help*, *Close diagram*, *Close annotation* and *Close*.
