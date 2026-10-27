# Cover art hover behavior

2026-10-27. Isolated branch `fix/cover-hover-expanded`, based on `abe7869`.

## Behavior

Cover previews and feature thumbnails no longer open the art prompt card on hover
or touch long-press. The cover's explicit Prompt button remains usable. The
expanded full-screen Focus view supports hover, long-press and its Prompt button.
Article heroes and the Space g view retain their existing prompt-card behavior.

The preview rule is applied when painting a figure, so returning from Focus,
changing its version or repainting it does not re-enable cover hover. The caption
tooltip no longer offers hover on a cover preview.

Opening a hover card in Focus exposed an Escape propagation bug: dismissing the
card let the same key reach the underlying page, moving focus outside the dialog.
The Focus handler now consumes that already-handled Escape. The next Escape can
close Focus normally.
Clicking or dragging the art cancels a pending hover card and closes an unpinned
one, so manipulating the scene does not summon an overlay.

## Verification

- JavaScript syntax checks passed for the three changed modules and the prompt
  browser suite.
- `tests/web_art_prompt.cjs` passed on the final production source: quiet cover
  hover with no prompt fetch, explicit Prompt button, expanded cover hover,
  nested Escape and focus retention, quiet preview after closing Focus and after
  a theme repaint, quiet cover/thumbnail touch long-press, and existing article
  hero, Space g, archived-prompt Copy and phone behavior.
- `tests/web_art_focus.cjs` passed: opening by button, double-click and Space G;
  closing and restoring position/focus in both reading layouts; the existing
  live/still renderer branches; regeneration using a fake voice; and phone width.
  A new assertion checks that dragging live artwork does not open a hover card.
- `git diff --check` passed. There is no controls bundle rebuild: these changes
  are in the browser's directly served JavaScript modules.

The first run caught the Escape propagation bug described above. Later runs
passed the prompt suite but exposed the old Focus test's assumption that art
could not open a hover card. Its unrelated control checks now keep the pointer
over the heading, outside the canvas; the prompt suite separately exercises the
new hover and nested Escape behavior. Final successful evidence is in the local
`cover-hover-browser-v3` prompt result and `cover-hover-focus-verified` Focus result;
the production modules were unchanged between those successful checks.

## Resource and validation boundaries

All runs used synthetic vaults and fake voices in the reused `reader-node-checks`
worker, under workstation locks `host/heavy-work` and
`host/docker/reader-node-checks/`. The container root was read-only with no host
mounts; generated files were confined to 3 GiB `/work` and 512 MiB `/tmp` tmpfs,
with 4 CPUs, 6 GiB RAM, a 600-second watchdog, 8 MiB per-run logs and 64 MiB
aggregate helper logs. Failures stopped the worker and discarded its tmpfs.

The final run used about 521 MiB in `/work` and 2.6 MiB in `/tmp`, with about
600 GiB free on the host and 571 GiB on Docker's backing filesystem. Its log was
12,732 bytes; screenshots and logs were exported to ignored local evidence
storage before stopping the idle worker. No unbounded campaign or new image was
created. Existing shared reservations and the project budgets were preserved.

No full backend suite or independent review was run for this UI behavior fix.
No real voice/model, private document or running Reader service was changed.
The change is committed locally; it has not been pushed or deployed.
