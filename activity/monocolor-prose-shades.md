# Monocolor prose shades — 2026-10-28

The first Monocolor implementation assigned the same ink to every vivid prose
role. That preserved palette containment but lost Colorful Language's visual
hierarchy. The user requested the supplied range of gray shades.

Palette-only prose now orders supplied swatches by contrast and assigns different
shades to function words, names, numbers, quotes and other word classes. Four
shades meet 4.5:1 on both light page/surface swatches; five meet it on the dark
pair. Clear mode selects a softer supplied swatch meeting at least 3:1 for its
structural words. Quoted passages use the existing surface swatch, with all
vivid roles retaining 4.5:1 over it. No new colors or blended swatches are added.

Validation on the deployment branch:

- TypeScript checking and the controls build passed.
- All 27 theme tests passed, including added role-diversity, palette containment,
  page contrast and quoted-background checks against generated CSS.
- The Colorful Language browser suite passed with real synthetic CLI ranges,
  at least four/five distinct Monocolor role shades, both mode screenshots,
  existing colored-theme checks, annotations, find, page turns and mobile views.
- The code-block browser suite passed, including syntax/chrome contrast across
  all 24 theme variants. Existing console summaries still say 22 themes.
- Inspected the rendered dark-mode prose screenshot and confirmed varied shades.

Built on `b3a33d6`, retaining the current deployment's fixes. Uses the standard
Reader service smoke/health/rollback gate for rollout, with service receipts
retained by that updater. No remote push or merge.
