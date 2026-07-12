"""Stroke-level data augmentation for handwriting training.

Operates on parsed strokes BEFORE rasterization (render.py re-normalizes the
bounding box afterwards, so only shape-changing transforms survive — which is
exactly what we apply):

  - global rotation        ±6°
  - global shear (x by y)  ±0.12
  - anisotropic scale      0.85–1.15 independently per axis (changes aspect)
  - per-stroke translation jitter (small, relative to the ink's diagonal —
    a global translation would be undone by bbox normalization)
  - random line width in [1.4, 2.8], passed through to the renderer

Pure numpy. All random draws happen in a FIXED order regardless of the ink's
content, so a given rng state always yields the same transform.

Determinism / worker safety: callers derive a fresh np.random.Generator per
sample from (base_seed, sample index, epoch nonce) — see
MathWritingDataset._sample_rng — so DataLoader workers never repeat each
other's augmentations and re-visits of the same sample get new transforms.

Entry point:
    augment_strokes(strokes, rng) -> (strokes, line_width)

Sanity check (renders original + N augmented variants):
    ml/.venv/bin/python -m src.augment data/mathwriting-2024-excerpt/train/<f>.inkml /tmp/aug
"""

from __future__ import annotations

import numpy as np

ROTATION_DEG = 6.0
SHEAR = 0.12
SCALE_LO, SCALE_HI = 0.85, 1.15
STROKE_JITTER = 0.015  # stddev of per-stroke offset, as a fraction of the ink diagonal
LINE_WIDTH_LO, LINE_WIDTH_HI = 1.4, 2.8


def augment_strokes(
    strokes: list[dict], rng: np.random.Generator
) -> tuple[list[dict], float]:
    """Randomly transform strokes [{'x':[..],'y':[..],'t':[..]}] in place-shape.

    Returns (new strokes with the same dict contract, line_width for the
    renderer). Timestamps pass through untouched. Empty input comes back
    unchanged (but the rng is still advanced identically).
    """
    # Draw everything up front, in a fixed order.
    theta = np.deg2rad(rng.uniform(-ROTATION_DEG, ROTATION_DEG))
    shear = rng.uniform(-SHEAR, SHEAR)
    sx, sy = rng.uniform(SCALE_LO, SCALE_HI, size=2)
    line_width = float(rng.uniform(LINE_WIDTH_LO, LINE_WIDTH_HI))
    offsets = rng.normal(0.0, 1.0, size=(len(strokes), 2))  # scaled below

    pts = [np.column_stack([s["x"], s["y"]]).astype(np.float64) for s in strokes]
    nonempty = [p for p in pts if len(p)]
    if not nonempty:
        return strokes, line_width

    allp = np.concatenate(nonempty)
    center = (allp.min(axis=0) + allp.max(axis=0)) / 2.0
    span = allp.max(axis=0) - allp.min(axis=0)
    diag = float(np.hypot(span[0], span[1])) or 1.0

    # rotation @ shear @ anisotropic-scale (2x2, applied about the bbox center)
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    rot = np.array([[cos_t, -sin_t], [sin_t, cos_t]])
    shr = np.array([[1.0, shear], [0.0, 1.0]])
    scl = np.array([[sx, 0.0], [0.0, sy]])
    mat = rot @ shr @ scl

    out: list[dict] = []
    for stroke, p, off in zip(strokes, pts, offsets):
        if not len(p):
            out.append(stroke)
            continue
        q = (p - center) @ mat.T + center + off * (STROKE_JITTER * diag)
        out.append({"x": q[:, 0].tolist(), "y": q[:, 1].tolist(), "t": stroke.get("t", [])})
    return out, line_width


if __name__ == "__main__":
    import sys
    from pathlib import Path

    from .inkml import parse_inkml
    from .render import render_strokes

    ink = parse_inkml(sys.argv[1])
    out_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/augment_debug")
    out_dir.mkdir(parents=True, exist_ok=True)

    render_strokes(ink.strokes).save(out_dir / "original.png")
    print(f"label: {ink.label}")
    print(f"strokes: {len(ink.strokes)}  ->  {out_dir}/original.png")
    for i in range(6):
        rng = np.random.default_rng((0, 42, i))  # (base_seed, index, epoch_nonce)
        strokes, lw = augment_strokes(ink.strokes, rng)
        render_strokes(strokes, line_width=lw).save(out_dir / f"aug_{i}.png")
        print(f"aug_{i}: line_width={lw:.2f}  ->  {out_dir}/aug_{i}.png")
    # determinism check: same rng seed => identical output
    a, lwa = augment_strokes(ink.strokes, np.random.default_rng((0, 42, 0)))
    b, lwb = augment_strokes(ink.strokes, np.random.default_rng((0, 42, 0)))
    same = lwa == lwb and all(np.allclose(s["x"], t["x"]) for s, t in zip(a, b))
    print(f"deterministic per (seed, index, nonce): {same}")
