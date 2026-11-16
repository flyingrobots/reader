# Mobile articles default to scrolling

Change kind: deliberate behavior change.

Reader now selects a separate mobile layout preference when a window opens
below 900 CSS pixels. An absent mobile choice means continuous scrolling,
including browsers that already saved the desktop two-page layout. Settings
and the existing layout toggle can still select page turning. Saving a mobile
choice preserves the desktop choice, and storage updates select the layout
for the receiving window. Resizing retains the current layout.

Validation on the local candidate:

- `python3 scripts/run_browser_suites.py -j 1 --timeout 60 mobile_layout`
  failed before the change because the mobile article used two-page mode.
  After the change it passed: scrolling default, actual vertical scrolling,
  explicit Two pages and Continuous choices surviving reload, and the desktop
  spread preference preserved.
- `python3 scripts/run_browser_suites.py -j 1 --timeout 90 web_controls`
  passed the existing settings, pagination and mobile controls suite.
- `node --check src/reader_mcp/web_ui/app.mjs` and `git diff --check` passed.

The tests used a synthetic vault and local Chromium mobile emulation. Physical
phone behavior and the deployed service were not tested. No controls bundle
rebuild is required because the change is in the directly served application
module. Publication and deployment remain separate steps.

Review follow-up: a narrow desktop split pane initially selected the mobile
preference. The expanded browser regression reproduced that failure. Embedded
panes now select preferences using the outer window width, preserving desktop
layout loading and saving while leaving responsive page rendering unchanged.
