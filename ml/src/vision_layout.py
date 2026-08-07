r"""Apple Vision as a LAYOUT engine: where the words are, not just what they say.

`text_ocr.recognize_text` asks Vision for a string and drops the geometry on
the floor — the observation boxes never leave its loop. For unified
recognition the geometry is the more valuable half. On a mixed line of
block-letter "LET" + the real MathWriting ink for `\nabla I=(I_{x},I_{y})` +
"BE TRUE", Vision's five word boxes partitioned all 51 strokes with 100%
purity against ground truth *while its string was garbage* — `'LET VI (I×I EE
TRUE'`, at line confidence 1.000. So this module hands back boxes plus the raw
candidate strings and never judges text-vs-math itself; that call belongs to
the router, which weighs this evidence against structure it can measure.

Two things make it work, and both are why this must NOT reuse
`render.render_strokes`:

  1. SCALE. `render_strokes` fits the ink's *bounding-box height* into 96 px
     (256 px on text_ocr's OCR path). One expression is fine; a page is not —
     an eight-line page through that path gives Vision ~30 px per line and
     returns ZERO observations. `render_for_vision` scales so the caller's
     estimated x-height lands on ~110 px regardless of how tall the page is.
     That spends pixels, and pixels are free here: a 12.0 Mpx A4 page measured
     179 ms / 8 observations against 161 ms / 8 for the same page at 3.6 Mpx.
     Cost is flat in pixels and linear in lines, so the `max_side` clamp is
     free as well — but Vision must then run once per ink PAGE, not once per
     document.

  2. NO CROP. `text_ocr` crops to the ink after rendering. A crop is a second
     transform that the returned affine does not describe, and every box would
     come back displaced by it. The margin is drawn into the canvas up front
     instead, so one `(scale, ox, oy)` inverts every box exactly.

Boxes are returned in STROKE space — the coordinate system of the request —
so a caller can intersect them with strokes with no further bookkeeping:

    layout = analyze(strokes, xh)          # raises VisionUnavailable off macOS
    for line in layout.lines:
        for w in line.words:
            w.box                          # (x0,y0,x1,y1), y grows DOWN
            line.text[w.char_range[0]:w.char_range[1]] == w.text

Two traps for whoever consumes this, both measured on the fixture in
`__main__` and both invisible until they silently degrade results:

  - Assign strokes to boxes by POINT CONTAINMENT, never by bbox IoU. 28 of the
    fixture's 51 stroke bounding boxes have zero area (axis-aligned segments,
    i-dots, bars), so their IoU against anything is identically 0: containment
    claims 51/51 strokes where IoU claims 23/51.
  - Vision box gaps are NOT a distance signal. The boxes are uniformly padded
    — measured inter-box gaps 0.164 / 0.163 / 0.164 xh where the true
    stroke-extent gaps were 0.85 and 0.70 xh. Every spacing threshold has to be
    computed on stroke extents.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from PIL import Image, ImageDraw

from .text_ocr import VisionUnavailable, _cgimage_from_pil, _load_vision, _run_text_request

# (x0, y0, x1, y1) with y growing DOWN — structurally identical to layout.Box,
# aliased here so this module stays importable without the geometry layer.
Box = tuple[float, float, float, float]
# (scale, ox, oy):  image_px = stroke * scale + o.  Uniform and aspect-preserving,
# which is what makes the inverse a two-line expression.
Affine = tuple[float, float, float]

# Vision reads handwriting well at roughly this letter size and stops seeing
# hairlines below roughly this pen weight (text_ocr's OCR constants encode the
# same finding at a different scale). The pad keeps ink off the frame edge,
# where Vision tends to drop the first and last glyph of a line.
XHEIGHT_PX = 110.0
PEN_FRAC = 0.09
PAD_PX = 40
# iOS/WebKit tops out around 4096^2 for a canvas, and there is no accuracy left
# to buy above this anyway — see the 12.0 vs 3.6 Mpx timing above.
MAX_SIDE = 4096


@dataclass(frozen=True)
class VWord:
    """One space-delimited token of a line candidate, with its ink box."""

    text: str
    char_range: tuple[int, int]  # [start, end) into VLine.text — a Python slice
    box: Box  # STROKE space


@dataclass(frozen=True)
class VLine:
    """One VNRecognizedTextObservation: its top candidate, verbatim.

    `words` is a SUBSET of the line, never a tiling of it. Vision answers
    `boundingBoxForRange_` with None — or with a degenerate zero-area rect for
    whitespace — on ranges it has no geometry for, and `_range_box` drops those
    tokens rather than hand back a box that would claim no strokes. So a
    consumer must NOT assume either of

        "".join(w.text for w in line.words) == line.text
        the char_ranges tile [0, len(line.text))

    The only guaranteed relation is per word:
    `line.text[w.char_range[0]:w.char_range[1]] == w.text`. Ink under a dropped
    word belongs to no box at all, which is a hole for the geometric segmenter
    to fill, not an empty region.
    """

    text: str  # UNSTRIPPED — VWord.char_range indexes this exact string
    conf: float
    box: Box  # STROKE space
    words: tuple[VWord, ...]


@dataclass(frozen=True)
class VisionLayout:
    lines: tuple[VLine, ...]
    engine: str = "apple-vision"


def _validated_xh(xh: float) -> float:
    """The single gate on the number that sets the raster scale.

    `scale = xheight_px / xh`, so a bad x-height is not a small error. 0.0 gives
    a scale of 1.1e8 that the `max_side` clamp turns into a 4096x4096 page — a
    multi-second Vision call on ink that has no measurable size — and a NaN
    propagates silently until PIL's `int(nan)` blows up somewhere unrelated.

    This RAISES rather than returning an empty layout, deliberately.
    `layout.xheight` already floors its estimate at 1e-6 and returns that floor
    for ink with no vertical extent, so a non-positive value can only come from
    a caller that skipped the estimator. An empty layout would dress that bug up
    as "Vision read nothing on this page", which is exactly the outcome the
    geometric fallback absorbs without a word — the bug would never surface.
    """
    v = float(xh)
    if not math.isfinite(v) or v <= 0.0:
        raise ValueError(f"x-height must be finite and positive, got {xh!r}")
    return v


def render_for_vision(
    strokes: list[dict],
    xh: float,
    *,
    xheight_px: float = XHEIGHT_PX,
    pen_frac: float = PEN_FRAC,
    pad_px: int = PAD_PX,
    max_side: int = MAX_SIDE,
) -> tuple[Image.Image, Affine]:
    """Rasterize strokes at native reading scale; return the image and its affine.

    `xh` is the caller's x-height estimate in stroke units (layout.xheight):
    scale is chosen so it lands on `xheight_px`, which is what keeps a one-line
    note and a full page equally legible to Vision. Returns a 1x1 white image
    and an identity affine for empty ink so callers never special-case None,
    and raises ValueError on an `xh` that is not finite and positive (see
    `_validated_xh` — no ink is a page, no x-height is a caller bug).
    """
    v_xh = _validated_xh(xh)

    # A stroke missing "x"/"y", or with the two arrays out of step, is IGNORED
    # up to its shorter half rather than raising: `analyze` already tolerates it
    # (`s.get("x")`) and so does `layout.frac_points_in` (`if not xs`), and the
    # three are called on the same wire payload. Raising here would make the
    # tolerance depend on which of them the caller reached first.
    xs: list[float] = []
    ys: list[float] = []
    for s in strokes:
        sx, sy = s.get("x") or (), s.get("y") or ()
        n = min(len(sx), len(sy))
        if n:
            xs.extend(sx[:n])
            ys.extend(sy[:n])
    if not xs:
        return Image.new("L", (1, 1), 255), (1.0, 0.0, 0.0)

    x0, y0 = min(xs), min(ys)
    span_x, span_y = max(xs) - x0, max(ys) - y0
    scale = xheight_px / v_xh

    # Clamp the long side. Shrinking `scale` (rather than resizing afterwards)
    # keeps the affine the single source of truth for the inverse mapping.
    budget = max(1, max_side - 2 * pad_px)
    longest = max(span_x, span_y) * scale
    if longest > budget:
        scale *= budget / longest

    width = int(span_x * scale) + 2 * pad_px
    height = int(span_y * scale) + 2 * pad_px
    ox = pad_px - x0 * scale
    oy = pad_px - y0 * scale

    # Pen weight follows the *rendered* x-height, so a clamped page thins out
    # in proportion instead of turning into a blob.
    line_width = max(1, int(pen_frac * v_xh * scale))

    img = Image.new("L", (max(1, width), max(1, height)), 255)
    draw = ImageDraw.Draw(img)
    for s in strokes:
        # zip truncates to the shorter array, which is the same "ignore the
        # ragged tail" rule the extent pass above applies.
        pts = [
            (x * scale + ox, y * scale + oy)
            for x, y in zip(s.get("x") or (), s.get("y") or ())
        ]
        if not pts:
            continue
        if len(pts) == 1:
            cx, cy = pts[0]
            r = line_width / 2.0
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=0)
        else:
            draw.line(pts, fill=0, width=line_width, joint="curve")
    return img, (scale, ox, oy)


def _to_stroke_box(rect, size: tuple[int, int], affine: Affine) -> Box:
    """Vision's normalized BOTTOM-LEFT-origin CGRect -> a stroke-space Box.

    Two flips in one step: normalized [0,1] -> image pixels, and Vision's
    y-up convention -> the y-down convention strokes are stored in (so the
    rect's *top* edge is the one at the larger normalized y).
    """
    img_w, img_h = size
    scale, ox, oy = affine
    ix0 = rect.origin.x * img_w
    ix1 = (rect.origin.x + rect.size.width) * img_w
    iy_top = (1.0 - (rect.origin.y + rect.size.height)) * img_h
    iy_bot = (1.0 - rect.origin.y) * img_h
    return (
        (ix0 - ox) / scale,
        (iy_top - oy) / scale,
        (ix1 - ox) / scale,
        (iy_bot - oy) / scale,
    )


def _range_box(cand, start: int, length: int, size: tuple[int, int], affine: Affine) -> Box | None:
    """Box for `cand.string()[start:start+length]`, or None if Vision has none.

    `boundingBoxForRange_error_` is the only sub-line geometry Vision exposes.
    It snaps a partial range up to the enclosing word, so whole tokens are both
    the natural query and the finest granularity available — that ceiling is
    what makes a Vision word box the segmentation primitive here.
    """
    try:
        rect_obs, _err = cand.boundingBoxForRange_error_((start, length), None)
    except Exception:  # pragma: no cover - pyobjc raises on out-of-range spans
        return None
    if rect_obs is None:
        return None
    rect = rect_obs.boundingBox()
    # Whitespace-only ranges come back as origin (0,1) with zero size; a
    # zero-width box would claim nothing and pollute the word list.
    if rect.size.width <= 0.0 or rect.size.height <= 0.0:
        return None
    return _to_stroke_box(rect, size, affine)


def _line_words(cand, text: str, size: tuple[int, int], affine: Affine) -> tuple[VWord, ...]:
    """Split a line candidate on spaces and box each token.

    Offsets are counted in Python characters, which matches the NSRange Vision
    wants as long as nothing is outside the BMP — true of anything handwriting
    produces, including the `×` this fixture yields.
    """
    words: list[VWord] = []
    start = 0
    for token in text.split(" "):
        end = start + len(token)
        if token:
            box = _range_box(cand, start, len(token), size, affine)
            if box is not None:
                words.append(VWord(text=token, char_range=(start, end), box=box))
        start = end + 1  # the separator we split on
    return tuple(words)


def analyze(strokes: list[dict], xh: float) -> VisionLayout:
    """One Vision pass over one ink page -> lines, words and boxes in stroke space.

    Raises VisionUnavailable off macOS (and if the request itself fails), which
    is the caller's signal to fall back to the purely geometric segmenter —
    never to fail the request.

    Raises ValueError on a non-positive or non-finite `xh`. That check runs
    FIRST — ahead of the platform probe and ahead of the empty-ink early-out —
    so a caller passing a raw 0 gets the same diagnosis on a Linux box, on an
    empty page, and on real ink. A VisionUnavailable there would send the
    caller down the fallback path and hide the bug forever.
    """
    v_xh = _validated_xh(xh)
    _load_vision()  # fail fast off macOS, before rasterizing a whole page
    if not any(s.get("x") for s in strokes):
        return VisionLayout(lines=())

    img, affine = render_for_vision(strokes, v_xh)
    cg = _cgimage_from_pil(img)
    if cg is None:
        raise VisionUnavailable("could not build a CGImage from the rendered page")
    size = img.size

    lines: list[VLine] = []
    for obs in _run_text_request(cg):
        top = obs.topCandidates_(1)
        if not top or top.count() == 0:
            continue
        cand = top.objectAtIndex_(0)
        text = str(cand.string())
        if not text.strip():
            continue
        lines.append(
            VLine(
                text=text,
                conf=float(cand.confidence()),
                box=_to_stroke_box(obs.boundingBox(), size, affine),
                words=_line_words(cand, text, size, affine),
            )
        )
    # Vision's own ordering is reading order, which is what we want, but it is
    # not contractual — sort so downstream line indices are reproducible.
    lines.sort(key=lambda v: (v.box[1], v.box[0]))
    return VisionLayout(lines=tuple(lines))


def warmup() -> None:
    """Pay Vision's cold start (~260 ms) at server import, not on the first stroke.

    One 32x32 white frame through the real request path; results discarded.
    Raises VisionUnavailable off macOS so the caller can wrap the whole thing
    in a single try/except and carry on.
    """
    _load_vision()
    cg = _cgimage_from_pil(Image.new("L", (32, 32), 255))
    if cg is not None:
        _run_text_request(cg)


if __name__ == "__main__":
    # Three tiers, in this order because each needs strictly more of the world
    # than the last:
    #   1. input guards — pure Python, so they still run on the Linux pod where
    #      every Vision case skips;
    #   2. a multi-line page of block capitals — needs Vision, not the corpus.
    #      This is the ONLY case that pins the y-inversion in `_to_stroke_box`;
    #   3. the mixed prose+math fixture the design was measured on — needs
    #      MathWriting ink too, so it is the first to go missing.
    # Every tier appends to `cases` and every skip exits through `finish()`, so
    # a skipped tier cannot bury a failure an earlier tier already recorded.
    from pathlib import Path

    import numpy as np

    from .inkml import parse_inkml

    # (name, got, want, hint-printed-only-on-failure)
    cases: list[tuple[str, object, object, str]] = []

    def finish():
        ok = True
        for name, got, want, hint in cases:
            if got == want:
                print(f"✓ {name}: {got}")
                continue
            ok = False
            print(f"✗ {name}: {got}   (wanted {want})")
            if hint:
                print(f"    ^ {hint}")
        raise SystemExit(0 if ok else 1)

    ML_DIR = Path(__file__).resolve().parents[1]
    # sorted(data/mathwriting-2024/test/*.inkml)[1], pinned by name so a
    # partially-extracted corpus cannot silently swap the fixture out.
    INK_PATH = ML_DIR / "data" / "mathwriting-2024" / "test" / "001083e26028da36.inkml"

    def seg(x0, y0, x1, y1):
        return {"x": [x0, x1], "y": [y0, y1], "t": [0, 80]}

    # Block capitals as unit-square polylines, w = 0.55h, gap = 0.25h. Crude on
    # purpose: Vision must be given ink it can plausibly read as words while the
    # math beside it stays unreadable, which is the whole point of the fixture.
    GLYPHS = {
        "L": ((0, 0, 0, 1), (0, 1, 1, 1)),
        "E": ((0, 0, 0, 1), (0, 0, 1, 0), (0, 0.5, 0.8, 0.5), (0, 1, 1, 1)),
        "T": ((0, 0, 1, 0), (0.5, 0, 0.5, 1)),
        "B": ((0, 0, 0, 1), (0, 0, 0.9, 0.25), (0, 0.5, 0.9, 0.5), (0, 0.5, 0.9, 0.75), (0, 1, 0.9, 1)),
        "R": ((0, 0, 0, 1), (0, 0, 0.9, 0), (0.9, 0, 0.9, 0.5), (0, 0.5, 0.9, 0.5), (0, 0.5, 0.9, 1)),
        "U": ((0, 0, 0, 1), (0, 1, 1, 1), (1, 0, 1, 1)),
    }

    def letters(word, x0, y0, h=100.0):
        out, x, w, g = [], x0, h * 0.55, h * 0.25
        for ch in word:
            if ch == " ":
                x += g * 3
                continue
            for a, b, c, d in GLYPHS[ch]:
                out.append(seg(x + a * w, y0 + b * h, x + c * w, y0 + d * h))
            x += w + g
        return out, x

    def bbox(ss):
        xs = [v for s in ss for v in s["x"]]
        ys = [v for s in ss for v in s["y"]]
        return min(xs), min(ys), max(xs), max(ys)

    def xheight(ss):
        # layout.xheight's estimator, inlined: 60th percentile of per-stroke
        # heights AFTER dropping anything under 0.20*max, because 28 of these
        # 51 strokes are exactly flat and would otherwise drag it to noise.
        hs = np.array([max(s["y"]) - min(s["y"]) for s in ss], float)
        keep = hs[hs > 0.20 * hs.max()]
        if keep.size == 0:
            keep = hs
        return max(float(np.percentile(keep, 60)), 1e-6)

    def frac_in(s, box, pad):
        # layout.frac_points_in, inlined: POINTS in the box, not box overlap.
        bx0, by0, bx1, by1 = box
        hits = sum(
            1
            for X, Y in zip(s["x"], s["y"])
            if bx0 - pad <= X <= bx1 + pad and by0 - pad <= Y <= by1 + pad
        )
        return hits / len(s["x"])

    # ---- tier 1: input guards, hermetic --------------------------------------
    # `xh` sets the raster scale outright, so every bad value is expensive in a
    # different way (0 -> a 4096^2 page of nothing; NaN -> a crash three frames
    # away inside PIL). Both entry points must reject them, and `analyze` must
    # do it BEFORE `_load_vision`, or the check is dead on every non-mac box.
    rejected_analyze, rejected_render = 0, 0
    for bad in (0.0, -1.0, float("nan"), float("inf")):
        try:
            analyze([{"x": [0.0, 1.0], "y": [0.0, 1.0]}], bad)
        except ValueError:
            rejected_analyze += 1
        except Exception:
            pass  # VisionUnavailable here means the guard ran too late
        # Both with ink and without: the empty-ink early-out must not swallow a
        # caller bug, or an empty page becomes the one place 0.0 looks fine.
        for ss in ([{"x": [0.0, 1.0], "y": [0.0, 1.0]}], []):
            try:
                render_for_vision(ss, bad)
            except ValueError:
                rejected_render += 1
            except Exception:
                pass
    cases.append(("analyze rejects a non-positive/non-finite x-height", rejected_analyze, 4, ""))
    cases.append(("render_for_vision rejects the same, ink or not", rejected_render, 8, ""))

    # The ORDER of the two checks is invisible on a mac, where `_load_vision`
    # succeeds either way. Force it to fail — `analyze` resolves the name from
    # this module's globals, and `-m` runs this file as that module — so the
    # case can distinguish "guard first" from "platform probe first" here too.
    _real_load_vision = _load_vision

    def _no_vision():
        raise VisionUnavailable("forced by the self-test")

    _load_vision = _no_vision  # noqa: F811
    try:
        analyze([{"x": [0.0, 1.0], "y": [0.0, 1.0]}], 0.0)
        raised = "nothing"
    except Exception as e:
        raised = type(e).__name__
    finally:
        _load_vision = _real_load_vision
    cases.append(("a bad x-height outranks the platform probe", raised, "ValueError", ""))

    # A stroke with no "x" must be skipped, not raise: `analyze` and
    # `layout.frac_points_in` both tolerate it, and all three see the same wire
    # payload. Rendering junk + good must give byte-identical geometry to good
    # alone — a stroke that contributes no point may not move the affine either.
    good_stroke = {"x": [0.0, 100.0], "y": [0.0, 100.0]}
    junk = [{"y": [0.0, 5.0]}, {"x": [3.0]}, {}, {"x": [], "y": []}, good_stroke, {"x": [7.0, 8.0]}]
    clean_img, clean_aff = render_for_vision([good_stroke], 100.0)
    try:
        junk_img, junk_aff = render_for_vision(junk, 100.0)
        got_junk: object = (junk_img.size, junk_aff)
    except Exception as e:  # KeyError('x') if the .get guards regress
        got_junk = f"raised {type(e).__name__}: {e}"
    cases.append(
        ("render_for_vision skips strokes missing x/y", got_junk, (clean_img.size, clean_aff), "")
    )

    # ---- tier 2: reading order across MULTIPLE lines (needs Vision) ----------
    # The mixed fixture below is ONE horizontally-centred line, so it cannot see
    # a y-convention error at all: deleting the y-flip from `_to_stroke_box`
    # shifts its boxes by ~6 stroke units and every case there still passes.
    # Here the rows are stacked, each strictly wider than the one above it, so
    # box WIDTH names the row that produced a line without depending on what
    # Vision read ('BE' comes back as 'EE'). Correct code returns widths
    # 151/304/473 top-down; the un-flipped mutant returns 473/304/151.
    ML_ROWS = ("BE", "TRUE", "LETTER")
    ml_strokes: list[dict] = []
    ml_row_w: list[float] = []
    for r, word in enumerate(ML_ROWS):
        row, _end = letters(word, 0.0, r * 260.0)
        ml_row_w.append(max(v for s in row for v in s["x"]))
        ml_strokes += row
    try:
        ml = analyze(ml_strokes, 100.0)
    except VisionUnavailable as e:
        print(f"SKIP: Apple Vision unavailable on this platform ({e}).")
        finish()

    for i, ln in enumerate(ml.lines):
        print(f"  ROW[{i}] {ln.text!r} box={tuple(round(v, 1) for v in ln.box)} w={ln.box[2] - ln.box[0]:.1f}")
    ml_order = tuple(
        min(range(len(ML_ROWS)), key=lambda r: abs((ln.box[2] - ln.box[0]) - ml_row_w[r]))
        for ln in ml.lines
    )
    cases.append(
        (
            "multi-line reading order: line k is written row k",
            ml_order,
            (0, 1, 2),
            "reversed => the y-inversion in _to_stroke_box is gone; short/short-count "
            "=> Vision merged or split the rows (an environment change)",
        )
    )

    # ---- tier 3: the mixed prose+math fixture (needs the corpus too) ---------
    if not INK_PATH.exists():
        print(f"SKIP: MathWriting corpus not extracted ({INK_PATH} missing).")
        print("      Run data/download_mathwriting.py to enable this self-test.")
        finish()

    # "LET" + real ink for \nabla I=(I_{x},I_{y}) scaled to 130 units tall and
    # dropped 15 units so it straddles the letters' baseline + "BE TRUE".
    left, pen_x = letters("LET", 0, 0)
    ink = parse_inkml(INK_PATH)
    mx0, my0, _mx1, my1 = bbox(ink.strokes)
    sc = 130.0 / max(my1 - my0, 1e-6)
    mid = [
        {
            "x": [(v - mx0) * sc + pen_x + 60 for v in s["x"]],
            "y": [(v - my0) * sc - 15 for v in s["y"]],
            "t": s.get("t", list(range(len(s["x"])))),
        }
        for s in ink.strokes
    ]
    right, _ = letters("BE TRUE", max(v for s in mid for v in s["x"]) + 70, 0)
    strokes = left + mid + right
    truth = ["LET"] * len(left) + ["MATH"] * len(mid) + ["BETRUE"] * len(right)
    xh = xheight(strokes)
    print(f"fixture: {len(strokes)} strokes, xh = {xh:.2f}, math truth = {ink.label}")

    try:
        layout = analyze(strokes, xh)
    except VisionUnavailable as e:
        print(f"SKIP: Apple Vision unavailable on this platform ({e}).")
        finish()

    words = [w for line in layout.lines for w in line.words]
    for line in layout.lines:
        print(f"  LINE {line.text!r} conf={line.conf}")
        for w in line.words:
            print(f"    word {w.text!r} strokebox={tuple(round(v, 1) for v in w.box)}")

    # Point containment, exactly as layout.claim_by_boxes will do it.
    pad = 0.15 * xh
    claims: dict[int, int] = {}
    for k, s in enumerate(strokes):
        best = None
        for wi, w in enumerate(words):
            f = frac_in(s, w.box, pad)
            if f >= 0.6 and (best is None or f > best[1]):
                best = (wi, f)
        if best is not None:
            claims[k] = best[0]

    pure = 0
    for wi, w in enumerate(words):
        tags = {truth[k] for k, v in claims.items() if v == wi}
        if len(tags) == 1:
            pure += 1
        print(f"  {w.text!r} <- {sorted(tags)} ({sum(v == wi for v in claims.values())} strokes)")

    slices_ok = sum(
        line.text[w.char_range[0] : w.char_range[1]] == w.text
        for line in layout.lines
        for w in line.words
    )

    cases += [
        # The one assertion here that is not about this module: 5 is Vision's
        # tokenization of this line, so an OS that re-tokenizes moves it.
        (
            "word boxes",
            len(words),
            5,
            "this counts VISION's tokens, not our boxes — an OS update that "
            "splits/joins this line changes it. Read the word list printed "
            "above: if the boxes still tile the ink, re-pin the number, do not "
            "'fix' src/vision_layout.py",
        ),
        ("strokes claimed by point containment", len(claims), len(strokes), ""),
        ("word boxes pure against ground truth", pure, len(words), ""),
        ("char_range slices back to word text", slices_ok, len(words), ""),
    ]
    finish()
