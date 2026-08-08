#!/usr/bin/env python3
"""Regenerates src/app/icon.png and src/app/favicon.ico from the logo mark.

Run from the app root:  python3 docs/build-favicon.py

Two things here are not obvious and were both found by shipping them wrong:

1. COMPOSE AT ss×, THEN DOWNSCALE. Pasting the mark at integer offsets in the
   final resolution leaves the odd pixel of slack entirely on one side — at
   16px that put the M a whole pixel above centre, which is visible in a
   browser tab. Composing at 8× drops the error below 0.1px and the downscale
   folds it into the antialiasing.

2. HINT THE SMALL FRAMES. At 16px the mark is ~10px wide and its two counters
   are the only thing stopping it reading as a blue blob, so its alpha edges
   get a hard contrast push. Large frames have pixels to spare and want the
   smooth ramp — over-hardening those stair-steps the diagonals.

TARGET_W is the CEO's call (Aug 2026): the mark was filling ~81% of the icon
and he asked for smaller. 0.64 is near the floor — below it the 16px frame
loses its counters.
"""

from PIL import Image

SOURCE = "public/logo-mark-master.png"  # trimmed blue M, highest res we have
TARGET_W = 0.64                       # mark width as a fraction of the icon
SS = 8                                # supersample factor
FLOOR = 6                             # alpha under this is ringing, not artwork
ICO_SIZES = [16, 32, 48, 64, 128, 256]

master = Image.open(SOURCE).convert("RGBA")
glyph = master.crop(master.split()[-1].getbbox())
gw, gh = glyph.size


def contrast_for(size: int) -> float:
    if size <= 32:
        return 1.7
    if size <= 64:
        return 1.25
    return 1.0


def build(size: int, ss: int = SS) -> Image.Image:
    n = size * ss
    w = round(n * TARGET_W)
    h = round(gh * w / gw)
    canvas = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    canvas.paste(glyph.resize((w, h), Image.LANCZOS), ((n - w) // 2, (n - h) // 2))
    out = canvas.resize((size, size), Image.LANCZOS) if ss > 1 else canvas

    k = contrast_for(size)

    def curve(v: int) -> int:
        if v < FLOOR:
            return 0
        return max(0, min(255, round((v - 128) * k + 128)))

    out.putalpha(out.split()[-1].point(curve))
    return out


if __name__ == "__main__":
    build(512, ss=4).save("src/app/icon.png")
    frames = [build(s) for s in ICO_SIZES]
    frames[-1].save(
        "src/app/favicon.ico",
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=frames[:-1],
    )
    print("wrote src/app/icon.png and src/app/favicon.ico")
