#!/usr/bin/env python3
"""Outline Reader's bundled Newsreader r into a theme-aware circle mark.

Development-only regeneration:
  uv run --no-project --with 'fonttools[woff]==4.66.1' python scripts/generate_circle_mark.py
The resulting SVG needs no font, script or runtime dependency.
"""
from pathlib import Path
from hashlib import sha256
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / 'src/reader_mcp/web_ui/vendor/newsreader.woff2'
OUTPUT = ROOT / 'src/reader_mcp/web_ui/mark-circle.svg'


def main():
    font = instantiateVariableFont(TTFont(FONT), {'wght': 600}, inplace=False)
    glyphs = font.getGlyphSet()
    glyph = glyphs[font.getBestCmap()[ord('r')]]
    bounds = BoundsPen(glyphs)
    glyph.draw(bounds)
    left, bottom, right, top = bounds.bounds
    scale = 132 / (top - bottom)
    width = (right - left) * scale
    dot_radius, gap = 11, 14
    start = (256 - (width + gap + dot_radius * 2)) / 2 + 3
    path = SVGPathPen(glyphs, ntos=lambda n: format(n, '.3f').rstrip('0').rstrip('.') if n else '0')
    glyph.draw(TransformPen(path, (scale, 0, 0, -scale, start - left * scale, 62 + top * scale)))
    dot_x = start + width + gap + dot_radius
    # Fallbacks are Reader's One Dark roles. Inline use inherits live theme tokens.
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="reader-circle-title reader-circle-desc">
  <title id="reader-circle-title">Reader</title>
  <desc id="reader-circle-desc">A serif r and an accent-colored dot inside a circle.</desc>
  <!-- Newsreader, weight 600. Glyph converted to an outline; no text or font dependency.
       Bundled source: vendor/newsreader.woff2 (SIL Open Font License 1.1).
       Source SHA-256: {sha256(FONT.read_bytes()).hexdigest()}
       Regenerate with scripts/generate_circle_mark.py. -->
  <circle cx="128" cy="128" r="123" fill="var(--surface, #21252b)" stroke="var(--line, #3e4451)" stroke-width="2"/>
  <path fill="var(--ink, #bfc5cf)" d="{path.getCommands()}"/>
  <circle cx="{dot_x:.3f}" cy="183" r="11" fill="var(--accent, #61afef)"/>
</svg>
'''
    OUTPUT.write_text(svg)
    print(OUTPUT.relative_to(ROOT))


if __name__ == '__main__':
    main()
