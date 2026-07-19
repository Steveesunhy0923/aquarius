r"""Synthesize chemistry handwriting from real MathWriting symbol inks.

There is no public online-stroke dataset for handwritten chemistry, so this
module STITCHES one: real single-symbol inks from the MathWriting symbols
split (data/mathwriting-2024/symbols/*.inkml) are laid out left-to-right on a
baseline following a chem_corpus entry's decoder LaTeX. Layout rules:

  - base glyph height H (randomized ~60-110 px per sample), per-glyph width
    from the source sample's own aspect ratio
  - `_{...}` scaled ~0.55 and shifted down ~0.35H; `^{...}` scaled ~0.55 and
    shifted up ~0.45H; an isotope prefix ^{a}_{b} stacks BEFORE its element
  - extra gaps around + / = / arrows; arrows drawn ~2.2x a glyph advance wide;
    \cdot is a small mid-height dot
  - randomized: symbol instance, per-glyph scale/rotation jitter, baseline
    wobble, global slant, inter-glyph spacing
  - monotone timestamps synthesized from arc length (~0.4-1.2 px/ms) with
    80-250 ms inter-stroke gaps

Output JSONL records: {"id", "ce", "latex", "strokes": [{"x","y","t"}, ...]}
— strokes in the exact shape src/inkml.py produces, ready for eval_chem.py
or a chem fine-tune. Deterministic: the same seed yields byte-identical
output (ids are chem-synth-<seed>-<n>; no clocks, no uuids).

CLI (also writes a few rendered preview PNGs for eyeballing):
    ml/.venv/bin/python -m src.chem_synth --out data/chem/synth_test.jsonl --n 300 --seed 7
"""

from __future__ import annotations

import argparse
import json
import random
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .chem_corpus import build_corpus
from .inkml import parse_inkml
from .latex_tokenizer import tokenize
from .render import render_strokes

ML_DIR = Path(__file__).resolve().parents[1]
SCRIPT_SCALE = 0.55  # sub/superscript size relative to its base level
SUB_SHIFT = 0.35  # subscript baseline sits this far BELOW the base baseline (xH)
SUP_SHIFT = 0.45  # superscript baseline sits this far ABOVE it (xH)

_LABEL_RE = re.compile(r'<annotation type="label">([^<]+)</annotation>')
_ARROW_GLYPHS = {"\\rightarrow", "\\leftarrow", "\\rightleftharpoons"}
_XHEIGHT = set("acemnorsuvwxz")
_DESCEND = set("gpqy")


@dataclass(frozen=True)
class Glyph:
    """One symbol sample, strokes translated to bbox origin, max dimension 1."""

    strokes: tuple  # of np.ndarray [N, 2]
    w: float
    h: float


class SymbolBank:
    """Label -> handwriting samples index over the MathWriting symbols split."""

    def __init__(self, symbols_dir: str | Path):
        self.index: dict[str, list[Path]] = {}
        for f in sorted(Path(symbols_dir).glob("*.inkml")):
            with f.open("rb") as fh:
                head = fh.read(512).decode("utf-8", "ignore")
            m = _LABEL_RE.search(head)
            if m:
                self.index.setdefault(m.group(1), []).append(f)
        if not self.index:
            raise FileNotFoundError(f"no labeled .inkml symbols in {symbols_dir}")
        self._cache: dict[Path, Glyph] = {}

    def labels(self) -> set[str]:
        return set(self.index)

    def glyph(self, label: str, rng: random.Random) -> Glyph:
        files = self.index.get(label)
        if not files:
            raise KeyError(f"no symbol samples for label {label!r}")
        path = files[rng.randrange(len(files))]
        cached = self._cache.get(path)
        if cached is None:
            cached = _normalize_glyph(parse_inkml(path).strokes)
            self._cache[path] = cached
        return cached


def _normalize_glyph(strokes: list[dict]) -> Glyph:
    pts = [np.column_stack([s["x"], s["y"]]).astype(np.float64) for s in strokes if s["x"]]
    allp = np.concatenate(pts)
    mn = allp.min(axis=0)
    span = allp.max(axis=0) - mn
    scale = 1.0 / max(span[0], span[1], 1e-6)
    return Glyph(
        strokes=tuple((p - mn) * scale for p in pts),
        w=float(span[0] * scale),
        h=float(span[1] * scale),
    )


# --------------------------------------------------------------------------
# layout

# label -> (mode, size, offset). Modes anchor the glyph against the baseline:
#   "h"  scale by height,  glyph BOTTOM at baseline + offset*H
#   "hc" scale by height,  glyph CENTER at baseline + offset*H
#   "w"  scale by width,   glyph CENTER at baseline + offset*H
#   "m"  scale by max dim, glyph CENTER at baseline + offset*H
def _spec(label: str) -> tuple[str, float, float]:
    if label in _ARROW_GLYPHS:
        return ("w", 2.2 * 0.6, -0.32)  # ~2.2x a typical glyph advance, on the math axis
    if label == "+":
        return ("hc", 0.52, -0.32)
    if label in ("=", "\\equiv"):
        return ("w", 0.65, -0.32)
    if label == "-":
        return ("w", 0.50, -0.32)
    if label == "\\cdot":
        return ("m", 0.09, -0.30)
    if label == ".":
        return ("m", 0.07, -0.03)
    if label in "()[]":
        return ("hc", 1.10, -0.44)
    if label == "\\Delta":
        return ("h", 0.95, 0.0)
    if len(label) == 1:
        if label.isdigit() or label.isupper():
            return ("h", 1.0, 0.0)
        if label in _DESCEND:
            return ("h", 0.92, 0.30)
        if label == "j":
            return ("h", 0.95, 0.25)
        if label in _XHEIGHT:
            return ("h", 0.65, 0.0)
        return ("h", 0.95, 0.0)  # ascenders b d f h k l t, i (dotted bbox)
    return ("h", 0.9, 0.0)


# extra horizontal padding (xH, applied on BOTH sides) for operator glyphs
_EXTRA_PAD = {
    "+": 0.30, "=": 0.15, "\\equiv": 0.15, "\\cdot": 0.22, "-": 0.06,
    "\\rightarrow": 0.40, "\\leftarrow": 0.40, "\\rightleftharpoons": 0.40,
}


@dataclass
class _Layout:
    """Per-sample layout state shared across recursion levels."""

    bank: SymbolBank
    rng: random.Random
    gap: float  # base inter-glyph gap as a fraction of the local H
    strokes: list = field(default_factory=list)  # np.ndarray [N, 2], write order


def _read_group(toks: list[str], i: int) -> tuple[list[str], int]:
    """Argument tokens at position i (brace group inner tokens, or one token)."""
    if toks[i] != "{":
        return [toks[i]], i + 1
    depth, j = 1, i + 1
    while j < len(toks):
        if toks[j] == "{":
            depth += 1
        elif toks[j] == "}":
            depth -= 1
            if depth == 0:
                return toks[i + 1 : j], j + 1
        j += 1
    raise ValueError(f"unterminated brace group in {toks!r}")


def _place(st: _Layout, label: str, x: float, baseline: float, h: float) -> float:
    """Draw one glyph with jitter at cursor x; return its advance width."""
    rng = st.rng
    glyph = st.bank.glyph(label, rng)
    mode, size, off = _spec(label)
    target = size * h * rng.uniform(0.92, 1.10)
    if mode == "w":
        scale = target / max(glyph.w, 1e-6)
    elif mode == "m":
        scale = target / max(glyph.w, glyph.h, 1e-6)
    else:
        scale = target / max(glyph.h, 1e-6)
    gw, gh = glyph.w * scale, glyph.h * scale

    wobble = rng.uniform(-0.035, 0.035) * h
    if mode == "h":
        y0 = baseline + off * h + wobble - gh  # bottom-anchored
    else:
        y0 = baseline + off * h + wobble - gh / 2.0  # center-anchored

    theta = rng.uniform(-0.07, 0.07)
    c, s = np.cos(theta), np.sin(theta)
    rot = np.array([[c, -s], [s, c]])
    center = np.array([x + gw / 2.0, y0 + gh / 2.0])
    for pts in glyph.strokes:
        p = pts * scale + np.array([x, y0])
        st.strokes.append((p - center) @ rot.T + center)
    return gw


def _layout(st: _Layout, toks: list[str], x: float, baseline: float, h: float) -> float:
    """Lay out a token sequence at height h on baseline; return the end x."""
    rng = st.rng
    i, n = 0, len(toks)
    first = True
    while i < n:
        t = toks[i]
        if t in ("{", "}"):
            i += 1
            continue
        if t == "_":
            grp, i = _read_group(toks, i + 1)
            x = _layout(st, grp, x, baseline + SUB_SHIFT * h, h * SCRIPT_SCALE)
            continue
        if t == "^":
            grp, j = _read_group(toks, i + 1)
            # isotope prefix ^{a}_{b}X: mass and atomic number STACK before X
            if (
                all(g.isdigit() for g in grp)
                and j < n
                and toks[j] == "_"
            ):
                sub, k = _read_group(toks, j + 1)
                if all(g.isdigit() for g in sub) and k < n and toks[k].isalpha():
                    if not first:
                        x += st.gap * h * rng.uniform(0.6, 1.4)
                    x_sup = _layout(st, grp, x, baseline - SUP_SHIFT * h, h * SCRIPT_SCALE)
                    x_sub = _layout(st, sub, x, baseline + SUB_SHIFT * h, h * SCRIPT_SCALE)
                    x = max(x_sup, x_sub) + 0.04 * h
                    first = False
                    i = k
                    continue
            x = _layout(st, grp, x, baseline - SUP_SHIFT * h, h * SCRIPT_SCALE)
            i = j
            continue
        # a drawable glyph
        pad = _EXTRA_PAD.get(t, 0.0) * h
        if not first:
            x += st.gap * h * rng.uniform(0.6, 1.4)
        x += pad
        x += _place(st, t, x, baseline, h)
        x += pad
        first = False
        i += 1
    return x


def synth_strokes(latex: str, bank: SymbolBank, rng: random.Random, height: float = 0.0) -> list[dict]:
    """One corpus entry's LaTeX -> synthetic ink strokes [{'x','y','t'}, ...]."""
    h = float(height) if height else rng.uniform(60.0, 110.0)
    st = _Layout(bank=bank, rng=rng, gap=rng.uniform(0.06, 0.15))
    _layout(st, tokenize(latex), x=0.0, baseline=0.0, h=h)
    if not st.strokes:
        raise ValueError(f"nothing laid out for {latex!r}")

    # global slant (handwriting leans), then shift into positive coordinates
    slant = rng.uniform(-0.06, 0.22)
    slanted = [p - np.column_stack([p[:, 1] * slant, np.zeros(len(p))]) for p in st.strokes]
    mn = np.concatenate(slanted).min(axis=0) - 16.0

    # monotone timestamps from arc length; pen lifts take 80-250 ms
    speed = rng.uniform(0.4, 1.2)  # px/ms
    strokes: list[dict] = []
    t = 0.0
    for p in slanted:
        q = p - mn
        if strokes:
            t += rng.uniform(80.0, 250.0)
        sp = speed * rng.uniform(0.85, 1.15)
        ts = [t]
        for k in range(1, len(q)):
            t += max(float(np.hypot(*(q[k] - q[k - 1]))) / sp, 0.4)
            ts.append(t)
        strokes.append(
            {
                "x": [round(float(v), 2) for v in q[:, 0]],
                "y": [round(float(v), 2) for v in q[:, 1]],
                "t": [round(v, 1) for v in ts],
            }
        )
    return strokes


def _required_labels(latexes: list[str]) -> set[str]:
    labels: set[str] = set()
    for latex in latexes:
        labels.update(t for t in tokenize(latex) if t not in ("{", "}", "^", "_"))
    return labels


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--out", default=str(ML_DIR / "data" / "chem" / "synth_test.jsonl"))
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--height", type=float, default=0.0,
                    help="fix the base glyph height in px (0 = random 60-110 per sample)")
    ap.add_argument("--curated-only", action="store_true",
                    help="cycle the curated reactions only (no random compositions)")
    ap.add_argument("--symbols", default=str(ML_DIR / "data" / "mathwriting-2024" / "symbols"))
    ap.add_argument("--preview", type=int, default=8, help="how many preview PNGs to render")
    ap.add_argument("--preview-dir", default=str(ML_DIR / "data" / "chem" / "preview"))
    args = ap.parse_args()

    entries = build_corpus(args.n, seed=args.seed, curated_only=args.curated_only)
    bank = SymbolBank(args.symbols)
    missing = _required_labels([e.latex for e in entries]) - bank.labels()
    if missing:
        raise SystemExit(f"symbol bank is missing glyphs for: {sorted(missing)}")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    records = []
    with out_path.open("w", encoding="utf-8") as f:
        for i, entry in enumerate(entries):
            rng = random.Random(f"chem-synth-{args.seed}-{i}")  # str-seeded: stable everywhere
            rec = {
                "id": f"chem-synth-{args.seed}-{i}",
                "ce": entry.ce,
                "latex": entry.latex,
                "strokes": synth_strokes(entry.latex, bank, rng, height=args.height),
            }
            f.write(json.dumps(rec, separators=(",", ":")) + "\n")
            records.append(rec)

    n_preview = min(args.preview, len(records))
    if n_preview:
        preview_dir = Path(args.preview_dir)
        preview_dir.mkdir(parents=True, exist_ok=True)
        for i in range(n_preview):
            png = preview_dir / f"preview_{i:02d}.png"
            render_strokes(records[i]["strokes"]).save(png)
            print(f"preview {png}  <-  {records[i]['ce']}")

    n_strokes = sum(len(r["strokes"]) for r in records)
    print(f"wrote {len(records)} samples ({n_strokes} strokes) -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
