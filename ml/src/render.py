"""Render ink strokes to a fixed-size grayscale image.

This is the SINGLE code path used by both training (dataset.py) and serving
(serve.py) so train/serve inputs can never drift apart.

Pipeline:
  1. normalize coordinates (device ranges vary wildly): translate bbox to
     origin, uniform scale to fit the target box, aspect-preserving.
  2. fit to height 96; if the scaled width exceeds max width 768, shrink to
     fit width instead. The drawing is left-aligned, padded right.
  3. draw anti-aliased polylines (supersample x3 then LANCZOS downsample).

Output: PIL 'L' image, white background (255), black ink (0).
image_to_array() converts to float32 [1, H, W] with ink=1.0, background=0.0.
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

HEIGHT = 96
MAX_WIDTH = 768
MARGIN = 4  # px kept clear on each side at target resolution
SUPERSAMPLE = 3


def normalize_strokes(
    strokes: list[dict],
    height: int = HEIGHT,
    max_width: int = MAX_WIDTH,
    margin: int = MARGIN,
) -> list[np.ndarray]:
    """Map strokes into pixel space: fit height, cap width, keep aspect."""
    pts = [np.column_stack([s["x"], s["y"]]).astype(np.float64) for s in strokes if s["x"]]
    if not pts:
        return []
    allp = np.concatenate(pts)
    mn, mx = allp.min(axis=0), allp.max(axis=0)
    span = mx - mn

    box_h = height - 2 * margin
    box_w = max_width - 2 * margin
    if span[1] > 1e-9:
        scale = box_h / span[1]
    elif span[0] > 1e-9:  # perfectly horizontal ink: scale by width instead
        scale = box_w / span[0]
    else:  # single dot
        scale = 1.0
    if span[0] * scale > box_w:  # too wide at that scale -> fit width
        scale = box_w / span[0]

    out = []
    for p in pts:
        q = (p - mn) * scale
        # vertically center within the box; left-align horizontally
        q[:, 1] += (box_h - span[1] * scale) / 2.0
        q += margin
        out.append(q.astype(np.float32))
    return out


def render_strokes(
    strokes: list[dict],
    height: int = HEIGHT,
    max_width: int = MAX_WIDTH,
    line_width: float = 2.0,
) -> Image.Image:
    """strokes [{'x':[..],'y':[..],'t':[..]}] -> PIL 'L' image (height x max_width)."""
    ss = SUPERSAMPLE
    img = Image.new("L", (max_width * ss, height * ss), color=255)
    draw = ImageDraw.Draw(img)
    lw = max(1, int(round(line_width * ss)))
    r = lw / 2.0

    for q in normalize_strokes(strokes, height=height, max_width=max_width):
        q = q * ss
        if len(q) == 1:
            x, y = q[0]
            draw.ellipse([x - r, y - r, x + r, y + r], fill=0)
        else:
            draw.line([(float(x), float(y)) for x, y in q], fill=0, width=lw, joint="curve")
            for x, y in (q[0], q[-1]):  # round caps
                draw.ellipse([x - r, y - r, x + r, y + r], fill=0)

    return img.resize((max_width, height), Image.LANCZOS)


def image_to_array(img: Image.Image) -> np.ndarray:
    """PIL 'L' image -> float32 [1, H, W], ink=1.0, background=0.0."""
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return (1.0 - arr)[None, :, :]


def strokes_to_array(
    strokes: list[dict],
    line_width: float = 2.0,
    height: int = HEIGHT,
    max_width: int = MAX_WIDTH,
) -> np.ndarray:
    """One-call helper used by dataset.py and serve.py.

    height/max_width are pass-throughs to render_strokes, which has always
    accepted them — only this helper hardcoded the pair. Leave the defaults
    alone for anything headed to the decoder: Encoder registers pos2d for a
    fixed (height//16, width//16) grid (model.py:61-62) and adds it by slice
    (:69), so 96x768 is the only shape the model can consume. The knobs exist
    for callers that want the identical normalize+draw pipeline at another
    resolution (OCR-scale rasters, debug renders) rather than a second one.
    """
    return image_to_array(
        render_strokes(strokes, height=height, max_width=max_width, line_width=line_width)
    )


if __name__ == "__main__":
    import sys

    from .inkml import parse_inkml

    ink = parse_inkml(sys.argv[1])
    img = render_strokes(ink.strokes)
    out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/render_debug.png"
    img.save(out)
    arr = strokes_to_array(ink.strokes)
    print(f"label: {ink.label}")
    print(f"image: {img.size} -> array {arr.shape}, ink pixels: {(arr > 0.5).sum()}")
    print(f"saved {out}")
