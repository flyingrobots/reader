# Circular mark in the sticky footer — 2026-10-31

Added the circular Reader mark at the left of the status footer as a native, accessible Back to library button. It uses Reader’s existing shadcn Button decoration and priority-1 footer visibility, with the normal home navigation action. The icon is inline so its circle, letter, border and dot inherit the active theme tokens. The homepage’s Reader. wordmark is preserved.

The glyph generator now synchronizes the marked inline footer SVG from the same shape source as `mark-circle.svg`, preventing the two copies from drifting. Branding documentation describes the installed footer use and regeneration.

Checks actually run: generator, JavaScript syntax, `git diff --check`, and a focused synthetic-vault Chromium check of the native footer button, one path/no text objects, 24-pixel rendered size, actual computed letter/dot colors in One Dark and Paper, visibility at 390/320 pixels, no horizontal overflow or overlap with the mode label, and navigation from an article back to the library. No browser page errors occurred. Theme checks wait for color transitions to finish before comparing fills with the active token values. The local footer screenshot is `.reader/logo-preview/footer.png`.

Deployment advances the existing local service branch by fast-forward and uses the normal service update gate, preserving its smoke checks and rollback. Exact activation and live verification receipts remain in ignored local evidence. No remote push is part of this work.
