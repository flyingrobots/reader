# Reader marks

The homepage keeps the full **Reader.** wordmark. The [circular r. mark](../src/reader_mcp/web_ui/mark-circle.svg) appears at the left of the sticky footer as a **Back to library** button. It stays visible at narrow widths and returns through Reader’s normal home navigation. Favicons and installed-app icons retain their existing assets.

## Shapes and theme tokens

The SVG has a 256 × 256 viewBox, a circular background, an outlined serif r and a separate circular dot. The r is the bundled Newsreader glyph at weight 600 converted to an SVG path. It contains no `<text>`, embedded font, script or external resource.

- Background: `--surface`.
- Thin circular border: `--line`.
- Letter: `--ink`.
- Dot: `--accent`.

Inline SVG inherits Reader’s theme tokens. An SVG loaded through an external `<img>` or favicon does not inherit the containing page’s custom properties; its fallbacks use Reader’s One Dark roles. A theme-specific external icon needs its colors resolved into the exported asset. Raster app icons should be generated from the vector after adoption; do not convert the existing homepage wordmark into this symbol.

## Regeneration

Run from the code repository:

```sh
uv run --no-project --with 'fonttools[woff]==4.66.1' python scripts/generate_circle_mark.py
```

This uses fontTools and its WOFF decoder as authoring tools, not Reader runtime dependencies. The generator reads the retained Newsreader font, instantiates weight 600, converts its r glyph to the final coordinate space and writes `src/reader_mcp/web_ui/mark-circle.svg`, and synchronizes the marked inline SVG inside the footer in `index.html`. The SVG records the source font hash and license; the original font and license remain under `web_ui/vendor/`. The asset can also be edited directly as ordinary vector paths and circles; regeneration replaces such manual changes.
