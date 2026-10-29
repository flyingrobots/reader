# Monocolor theme — 2026-10-28

Added Monocolor Light and Dark to the existing built-in theme catalog, Settings,
quick picker and family-preserving light/dark switch. The palette contains ten
median RGB samples from the centers of the user-supplied LINX SUPPLY swatches
(2625 × 2100 photograph). Samples use 30 × 60 pixel patches at mid-height,
excluding swatch boundaries, paper and shadows. The slight photographic tints
are retained rather than replaced with invented neutral values.

Palette-only built-ins preserve explicitly mapped tokens instead of running the
usual contrast recoloring. Their generated prose and modal colors use existing
swatches, and shadows are disabled. Existing themes retain normal derivation.
Copied editable user themes retain the editor's normal behavior. Document
images and emoji remain source content, outside the interface palette contract.

Validation:

- `npm run build --prefix web`: passed; shipped controls and provenance rebuilt.
- `.venv/bin/python -m pytest tests/test_themes.py -q`: 27 passed. Includes exact
  shipped token containment, both color schemes, text contrast on all three
  surfaces, accent-label contrast and text over each highlight fill.
- `PYTHONPATH=src node tests/web_theme_picker.cjs`: passed, including Monocolor
  selection, persisted reload, paired switches, palette containment for every
  base/prose/mode token and desktop/phone picker behavior.
- `PYTHONPATH=src node tests/web_code_block.cjs`: passed, including syntax roles
  and code chrome at least 4.5:1 across all 24 built-in variants. Its existing
  console message still calls this 22 themes; the assertion uses catalog size.
- `npm run check --prefix web`: blocked by pre-existing missing `onClick` action
  properties at `web/src/server-card.tsx:52–53`, confirmed present in HEAD.
- Updated catalog-size assertions in related browser suites. Those other suites
  were not run. The colorful-prose hue-separation test excludes Monocolor;
  its intentional palette containment is checked separately.

Deployment candidate is based on the current live D3/library branch, preserving
its bookmark, inbox-contrast and notification fixes. Theme source originated in
`07b26a9`; generated assets were rebuilt on this baseline. TypeScript checking
passes on this baseline. No remote push or merge. Service rollout evidence is
recorded separately after deployment.
Focused checks used existing host dependencies, ephemeral fixture ports, one
serialized fixture service lock, and a 120–150 second command timeout. No Docker
worker, image or compiler target was created. Host free space was 590 GiB;
local web build cache was 92 KiB and existing npm cache approximately 303 MiB.
