# Quick theme picker validation

2026-10-27. Reader web UI; isolated branch `feat/quick-theme-picker`, based on
`06add3e` (Reader Admin and article coding jobs included).

## Change

The footer uses the existing shadcn Base UI Select and the same choices as
Settings: built-in, famous and saved custom themes. Its selection calls the
existing `useTheme` path, so the preference saves immediately without navigating
away from the current document. The Dark switch still selects the paired variant.
The picker stays available in narrow footer layouts; only its selected-name text
collapses to an icon. `Space Shift+T` and `:themes` open it. `Space t` still opens
threads, and F10 still opens the Theme Editor.

## Executed checks

- Web TypeScript check and production asset build passed (`npm ci`, `npm run
  check`, `npm run build` in `web/`). Changed generated assets were copied out
  of the worker. Existing dependencies and theme tokens are reused.
- `tests/web_theme_picker.cjs` passed: footer selection, immediate application,
  persistence across reload, paired Dark switch, leader shortcut, Select keyboard
  handling and Escape focus, famous palettes, an article remaining open and
  footer visibility at 390 and 320 px.
- `tests/web_themes.cjs` passed, including new checks switching from a saved
  custom theme to Paper and back through the footer, plus its existing editor,
  font, contrast, cache, deletion and mobile checks.
- `tests/web_controls.cjs` passed: Settings, nested Select keyboard/focus,
  existing Dark switch, code blocks, progress/popovers and pagination.
- `tests/web_status_priority.cjs` passed: crowded footer in both reading layouts,
  no overlap or overflow at 700, 390 and 320 px, and breadcrumb menus.
- `git diff --check` passed. Phone and desktop screenshots were exported and
  inspected; all vaults and font responses used for the checks were synthetic.

## Resources and boundaries

Reused `reader-node-checks` under workstation locks `host/heavy-work` and
`host/docker/reader-node-checks/`: read-only container root, no host mounts,
3 GiB `/work` and 512 MiB `/tmp` tmpfs, 4 CPUs, 6 GiB RAM, 600-second
watchdog, 8 MiB per-run and 64 MiB aggregate helper logs. Refusal by another
project's heavy-work reservation was honored before validation ran.

The build used about 571 MiB of `/work`; after the browser checks it used
about 688 MiB, with about 2.6 MiB in `/tmp`. At that point the host had about
601 GiB free and the Docker backing filesystem about 571 GiB free. Browser
validation took 34.67 seconds. Exported logs and two screenshots remain in ignored
local validation storage. The worker is stopped after export; reusable image
retained, tmpfs caches discarded.

No full backend suite or independent review was run for this UI-only change.
No real vault, running Reader service, GitHub publication or deployment was changed.
