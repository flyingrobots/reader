# Design sheet: App dialogs

Source: `web/src/shell-dialog.tsx`, opened from `app.mjs` and `speech.mjs` through `openShellDialog`, `openAnnotationDialog` and `openSpeakMenu` (`reader-controls.tsx`).

## Focused activity

**Do one small thing, then go back to reading.** Keyboard help shows the map of keys and commands. The diagram viewer shows a diagram enlarged. The annotation dialog takes a comment or warning on the selected passage. The Speak menu sends the whole article, from your place or the selection to AI-TTS (`a`, `f`, `s`; `j`/`k` move). The Scratch pad's Save dialog names and saves a piece to the vault, or saves a new version. The Documents picker browses and filters the library. All are modal: the page underneath is inert, Escape or the close button closes them, and focus returns to where it was.

## Composition

| Tier | Parts |
| --- | --- |
| Organisms (shadcn) | `Dialog` with `DialogContent`, `DialogHeader`, `DialogTitle` and a labelled `DialogClose` icon `Button` (`AppDialog`) |
| Atoms (shadcn) | `Textarea` and a submit `Button` (annotation); a vertical `ButtonGroup` of outline `Button`s with `Kbd` (Speak menu); `Input`, `NativeSelect` and `Button`s (Save) |
| Molecules | `Field`, `FieldLabel`, `FieldDescription`, `FieldGroup` and a `Notice` for errors (Save) |

`AppDialog` holds the open state and frame. `openAppDialog` mounts each dialog in its own container and removes it once closed; opening a dialog that is already open replaces it. The initial element (the comment box, the first Speak choice) also takes `autoFocus`. A native dialog's `showModal()` moved focus at once, and Base UI's `initialFocus` runs a frame later, so this way keys typed the moment a dialog appears still reach it. In the shell dialogs, the body is one element that plain JavaScript fills once it exists: `keys.renderHelp()` writes the generated key map into `#help-keys`, and the viewer copies the diagram's SVG. `openShellDialog` returns `{close, body}`. It runs `onClosed` after the dialog has gone, and the app then resumes the reading smoother and refocuses a split view.

The popup carries `data-reader-modal`, so `modalOpen()` in `web_ui/modal.mjs` counts it like a native `<dialog>`: no selection capture, no reading keys, no scratch status. Base UI unmounts a closed dialog, so the help exists only while open.

## The Scratch pad's Save dialog

`ScratchSaveDialog` holds the form's state. The slug follows the title until you edit it, and the path preview follows the slug. `scratch.mjs` computes the defaults (title, slug, the document it responds to), saves through `/api/writing` and closes the dialog on success. A failure comes back as `{error, slug?}`, and a suggested free slug replaces the typed one. *Save and ask for a reply* appears when the draft answers a writing prompt.

## The Documents picker

`PickerDialog` is the same Dialog, kept mounted (`keepMounted`, passed through `DialogContent`). Its content is `#picker-content` from `index.html`: the filter, folder scope, document tree and key hints, which `app.mjs` drives by id. The popup takes that node once at startup and keeps it, with its handlers, between openings. `app.mjs` opens and closes it with `mountPicker`'s control. The first Escape hides an open filter: Base UI's close is cancelled when `escape()` handles it.

Focus works as it did with the native dialog:
- it moves to the results when the picker opens;
- it returns the moment the picker starts closing, not after Base UI's exit animation. Otherwise a key typed during the animation (`/`) would land in the closing picker;
- it returns to what had focus, or to `#main` when nothing did. Base UI's own final focus is off, because with no opener (a new split pane opens on the picker) it picked the first tabbable element, a margin pin.

`AppDialog` returns focus the same way as soon as it starts closing.

## Test hooks

`#picker` (with `data-open` while open), `#picker-content`, `#file-results`, `#picker-filter`, `#help`, `#help-keys`, `#diagram-dialog`, `#diagram-body`, `#annotation-dialog` (with `data-kind`), `#annotation-quote`, `#annotation-form`, `#annotation-body`, `#speak-menu`, `[data-speak=article|from|selection]`, `#scratch-save` (fields by `name`), `#scratch-save-title`, `[data-save-path]`, `[data-save-error]`, `[data-save-close]`. The close buttons are labelled *Close keyboard help*, *Close diagram*, *Close annotation* and *Close*.
