r"""Chem-proxy test set: real MathWriting ink that LOOKS like chemistry.

No public online-stroke handwritten-chemistry dataset exists (verified
2026-07-18 — see docs/HANDWRITING_MODEL.md §9a), so the closest REAL-ink
benchmark for chem mode is MathWriting's own test split filtered down to
chemistry-shaped expressions: element-style capital runs with digit
subscripts (`H_{2}O`, `X_{3}=2Y_{1}...`), reaction/equilibrium arrows,
charge-style superscripts. The labels are math, not chemistry — but the
GLYPHS and LAYOUTS are exactly what `\ce{}` recognition must read, and the
ink is real human writing rather than stitched synthesis (src/chem_synth.py
covers the true-chemistry-label side; the two sets are complementary).

Output: the same JSONL schema eval_chem.py consumes
  {"id", "ce", "latex", "strokes": [{"x": [...], "y": [...], "t": [...]}]}
where `ce` is the mhchem reinterpretation of the (math) label via
latex_to_ce — i.e. the exact string chem mode is expected to return.

    .venv/bin/python -m src.chem_proxy --out data/chem/mathwriting_chem_proxy.jsonl
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from .chem_normalize import latex_to_ce
from .inkml import parse_inkml

# Chemistry-shaped: an ELEMENT-style shape must appear — a capital letter with
# a digit subscript, a charge-style superscript, or a hydrate dot. Arrows alone
# do NOT qualify (a bare \rightarrow is a mapping/limit far more often than a
# reaction; arrow-only matching filled 17% of the set with generic math).
_ELEMENT_SHAPES = [
    re.compile(r"[A-Z][a-z]?_\{\d+\}"),          # H_{2}, Cl_{2}, X_{3}
    re.compile(r"\^\{\d*[+-]\}"),                # ^{2-}, ^{+} charges
    re.compile(r"\\cdot \d*[A-Z]"),              # hydrate-style dot
]


def is_chem_shaped(label: str) -> bool:
    return any(p.search(label) for p in _ELEMENT_SHAPES)


def build(split_dir: Path, out_path: Path, limit: int | None = None) -> tuple[int, int]:
    """Scan a MathWriting split, keep chem-shaped + \ce-convertible samples.

    Returns (kept, scanned)."""
    kept = scanned = 0
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as out:
        for f in sorted(split_dir.glob("*.inkml")):
            scanned += 1
            ink = parse_inkml(f)
            label = (ink.label or "").strip()
            if not label or not is_chem_shaped(label):
                continue
            ce = latex_to_ce(label)
            if ce is None:
                continue
            record = {"id": f.stem, "ce": ce, "latex": label, "strokes": ink.strokes}
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            kept += 1
            if limit is not None and kept >= limit:
                break
    return kept, scanned


if __name__ == "__main__":
    ml_dir = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--split", default=ml_dir / "data" / "mathwriting-2024" / "test", type=Path)
    ap.add_argument("--out", default=ml_dir / "data" / "chem" / "mathwriting_chem_proxy.jsonl", type=Path)
    ap.add_argument("--limit", type=int, default=None, help="stop after N kept samples")
    args = ap.parse_args()

    kept, scanned = build(args.split, args.out, args.limit)
    print(f"kept {kept}/{scanned} chem-shaped samples -> {args.out}")
