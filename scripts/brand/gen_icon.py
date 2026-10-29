"""Builds public/icon.svg, the badge-ring logo: BASKETBALL LEGENDS around a ring with the ball in the middle,
and scripts/brand/out/og.svg, the link preview card (the main menu title over court lines, beside the badge).

The lettering is converted to outlines (Big Shoulders Black, the game's display face), so the icon looks the
same everywhere without loading a font. Needs fontTools:
  python3 -m venv .venv && .venv/bin/pip install fonttools && .venv/bin/python scripts/brand/gen_icon.py
Then `npm run assets:icons` rasterizes the PNG icons, favicon.ico and og.png from them.
"""

import math
import os
import urllib.request

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
CACHE = os.path.join(ROOT, "scripts", "brand", "out")
FONT_URL = "https://github.com/google/fonts/raw/main/ofl/bigshoulders/BigShoulders%5Bopsz,wght%5D.ttf"

NAVY, PANEL, RIM, AMBER, NET, ORANGE, SEAMS = "#0d1b2e", "#16283f", "#2c4566", "#ffb627", "#f2f5f8", "#e0692c", "#1a0f0a"
C = 256  # center of the 512 canvas
TEXT_R = 152  # the lettering sits on this circle: BASKETBALL above it, LEGENDS hanging below it
SIZE = 46


def load_font():
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "BigShoulders.ttf")
    if not os.path.exists(path):
        urllib.request.urlretrieve(FONT_URL, path)
    return instantiateVariableFont(TTFont(path), {"wght": 900, "opsz": SIZE})


def ring_text(font, text, spacing, bottom):
    """Each glyph as an outline, centered on the top (or bottom) of the circle and turned to follow it."""
    cmap, glyphs, hmtx = font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
    k = SIZE / font["head"].unitsPerEm
    cap = font["OS/2"].sCapHeight * k
    names = [cmap[ord(ch)] for ch in text]
    adv = [hmtx[n][0] * k for n in names]
    total = sum(adv) + spacing * (len(adv) - 1)
    out, s = [], -total / 2
    for name, a in zip(names, adv):
        mid = s + a / 2
        deg = math.degrees(mid / TEXT_R) * (-1 if bottom else 1)
        base = C + TEXT_R + cap if bottom else C - TEXT_R
        pen = SVGPathPen(glyphs)
        # font units (y up) to the canvas, with the glyph's advance centered on x = C
        glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, C - a / 2, base)))
        out.append(f'<path transform="rotate({deg:.3f} {C} {C})" d="{pen.getCommands()}"/>')
        s += a + spacing
    return "\n    ".join(out)


def line_text(font, text, x, y, size):
    """A line of text as one outline path with its baseline at (x, y)."""
    cmap, glyphs, hmtx = font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
    k = size / font["head"].unitsPerEm
    pen = SVGPathPen(glyphs)
    for ch in text:
        name = cmap[ord(ch)]
        glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, x, y)))
        x += hmtx[name][0] * k
    return pen.getCommands()


def ball(cx, cy, r):
    """The ball from the old favicon (drawn on a 300 box), scaled to radius r."""
    k = r / 140
    return f"""<g transform="translate({cx - 150 * k:.2f} {cy - 150 * k:.2f}) scale({k:.4f})">
    <circle cx="150" cy="150" r="140" fill="{ORANGE}"/>
    <g fill="none" stroke="{SEAMS}" stroke-width="12" stroke-linecap="round">
      <path d="M10 150 H290"/><path d="M150 10 V290"/>
      <path d="M50 52 C102 104 102 196 50 248"/><path d="M250 52 C198 104 198 196 250 248"/>
    </g>
    <circle cx="150" cy="150" r="140" fill="none" stroke="{AMBER}" stroke-width="9"/>
  </g>"""


def main():
    font = load_font()
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="{NAVY}"/>
  <circle cx="{C}" cy="{C}" r="210" fill="{PANEL}" stroke="{AMBER}" stroke-width="12"/>
  <circle cx="{C}" cy="{C}" r="118" fill="none" stroke="{RIM}" stroke-width="6"/>
  <g fill="{NET}">
    {ring_text(font, "BASKETBALL", 9, bottom=False)}
  </g>
  <g fill="{AMBER}">
    {ring_text(font, "LEGENDS", 12, bottom=True)}
  </g>
  {ball(C, C, 89)}
</svg>
"""
    with open(os.path.join(ROOT, "public", "icon.svg"), "w") as f:
        f.write(svg)
    print("public/icon.svg written")

    # 1200x630 link preview: the title (white Basketball, amber Legends) over court paint, the badge on the right
    inner = svg[svg.index(">") + 1 : svg.rindex("</svg>")]
    og = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="{NAVY}"/>
  <g transform="translate(50 150) scale(1.55 1.45)" fill="none" stroke="{AMBER}" stroke-width="3">
    <path d="M10 210 A190 190 0 0 1 390 210" stroke-opacity="0.45"/>
    <rect x="140" y="80" width="120" height="130" stroke-opacity="0.35"/>
    <circle cx="200" cy="80" r="60" stroke-opacity="0.3" stroke-dasharray="10 8"/>
  </g>
  <path fill="{NET}" d="{line_text(font, "Basketball", 80, 318, 150)}"/>
  <path fill="{AMBER}" d="{line_text(font, "Legends", 80, 448, 150)}"/>
  <g transform="translate(800 130) scale(0.72)">{inner}</g>
</svg>
"""
    with open(os.path.join(CACHE, "og.svg"), "w") as f:
        f.write(og)
    print("scripts/brand/out/og.svg written")


if __name__ == "__main__":
    main()
