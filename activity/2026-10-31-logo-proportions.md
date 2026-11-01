# Circle mark proportions — 2026-10-31

Doubled the accent dot’s diameter from 22 to 44 viewBox units, matching a one-third ratio to the 132-unit r height. Recentered the composition and kept the dot aligned with the letter’s baseline. Removed the outer circle stroke from both the standalone SVG and the footer presentation. The footer retains its theme-aware raised circular fill.

Regenerated both copies through `generate_circle_mark.py`. XML checks verified no outer stroke, the new dot radius and baseline, accent-token fill, and identical letter outlines between the standalone asset and inline footer copy. Focused Chromium checks passed in One Dark and Paper, at 390/320-pixel widths, and for the footer home navigation action, with no page errors. `git diff --check` passed. Deployment uses the existing Reader service gate and local deployment branch; no remote push is included.
