r"""Features describing one run of ink, for the prose-vs-formula classifier.

Everything the hand-written cascade in `unified.route_word` looked at, plus the
evidence it had no way to use:

  - **is the token an English word** (`src/lexicon.py`). The cascade could only
    ask whether it was ALPHABETIC, which `PQ`, `nRT` and `let` all are — the
    single reason 99.1% of letters-only formula ink came back as prose.
  - **case shape.** `nRT` and `aR` carry an uppercase letter in the middle;
    English words do not. Free, and orthogonal to the dictionary.
  - **vertical structure.** A run carrying a superscript or a subscript rises
    and drops away from its line's baseline far more than a word does, and its
    strokes vary far more in height. The cascade's only structural test was
    `spanning`, which fires on a fraction bar or a big operator and on nothing
    else.
  - **line context.** A line that contains a fraction bar anywhere is a line
    where a bare `xy` is overwhelmingly likely to be math. The cascade's
    smoothing pass looked only at a run's immediate left and right neighbour,
    and only at their assigned KINDS, never at the evidence behind them.

All lengths are in x-heights, the unit `layout.py` thresholds in, so the vector
is invariant to how large the user writes — verified by `layout`'s own
scale-invariance test and re-checked here in the self-test.

`FEATURES` is the ORDER the weights are stored against. Appending is safe;
reordering or removing silently invalidates every trained model, so the name
list is written into the model file and checked on load.
"""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np

from .latex_normalize import OPERATORS
from .layout import Line, Run, extent_gap
from .lexicon import Lexicon, load as load_lexicon

# Mirrors unified.MATH_CHARS / STRIP_CHARS. Duplicated rather than imported to
# keep this module free of a circular import (unified imports this one).
MATH_CHARS = frozenset("=+*/^_<>\\|{}[]~0123456789")
STRIP_CHARS = ".,;:!?'\"…()"

FEATURES: tuple[str, ...] = (
    "has_word",
    "is_lexicon_word",
    "core_len",
    "is_alpha",
    "has_math_char",
    "has_digit",
    "is_single_letter",
    "is_operator_name",
    "is_differential",
    "all_lower",
    "all_upper",
    "internal_upper",
    "spanning",
    "n_strokes",
    "width_xh",
    "height_xh",
    "aspect",
    "rise_xh",
    "drop_xh",
    "stroke_height_sd",
    "gap_left_xh",
    "gap_right_xh",
    "is_first",
    "is_last",
    "line_has_spanning",
    "line_math_char_frac",
    "line_n_runs",
    "bias",
)


def _core(run: Run) -> str:
    return (run.vision_word or "").strip(STRIP_CHARS)


def _sat(v: float, cap: float) -> float:
    """Saturating scale into ~[0,1]. A run 40 x-heights wide and one 12 wide are
    both simply "long"; letting the raw number through would hand a linear model
    a lever it should not have."""
    return min(max(v, 0.0), cap) / cap


def _is_differential(core: str) -> bool:
    return len(core) == 2 and core[0] == "d" and core[1].isalpha()


def line_features(line: Line, strokes: Sequence[dict], lex: Lexicon | None = None) -> np.ndarray:
    """Feature matrix for one line: [n_runs, len(FEATURES)], run order preserved."""
    lex = lex or load_lexicon()
    runs = line.runs
    xh = max(line.xh, 1e-6)
    n = len(runs)
    if n == 0:
        return np.zeros((0, len(FEATURES)), dtype=np.float64)

    # The line's baseline, taken as the median of run bottoms: robust to one
    # descender and to one fraction hanging below everything else.
    bottoms = [r.box[3] for r in runs]
    baseline = float(np.median(bottoms))

    cores = [_core(r) for r in runs]
    line_has_spanning = float(any(r.spanning for r in runs))
    line_math_frac = (
        sum(1.0 for c in cores if any(ch in MATH_CHARS for ch in c)) / n if n else 0.0
    )

    rows = np.zeros((n, len(FEATURES)), dtype=np.float64)
    for i, run in enumerate(runs):
        core = cores[i]
        has_word = run.vision_word is not None and bool(core)
        x0, y0, x1, y1 = run.box
        w, h = max(x1 - x0, 0.0), max(y1 - y0, 0.0)

        heights = [
            max(strokes[s]["y"]) - min(strokes[s]["y"])
            for s in run.strokes
            if 0 <= s < len(strokes) and strokes[s]["y"]
        ]
        sd = float(np.std(heights)) / xh if len(heights) > 1 else 0.0

        gl = extent_gap(runs[i - 1], run, strokes, xh) if i > 0 else 0.0
        gr = extent_gap(run, runs[i + 1], strokes, xh) if i + 1 < n else 0.0

        f = {
            "has_word": float(has_word),
            "is_lexicon_word": float(has_word and lex.is_word(core)),
            "core_len": _sat(len(core), 12.0),
            "is_alpha": float(bool(core) and core.isalpha()),
            "has_math_char": float(any(ch in MATH_CHARS for ch in core)),
            "has_digit": float(any(ch.isdigit() for ch in core)),
            "is_single_letter": float(len(core) == 1 and core.isalpha()),
            "is_operator_name": float(core.lower() in OPERATORS),
            "is_differential": float(_is_differential(core)),
            "all_lower": float(bool(core) and core.isalpha() and core.islower()),
            "all_upper": float(bool(core) and core.isalpha() and core.isupper()),
            # `nRT`, `aR`: an uppercase letter after the first is a shape English
            # words do not have, and mixed-case juxtaposition is very common in
            # physical formulas.
            "internal_upper": float(len(core) > 1 and any(c.isupper() for c in core[1:]) and not core.isupper()),
            "spanning": float(run.spanning),
            "n_strokes": _sat(len(run.strokes), 12.0),
            "width_xh": _sat(w / xh, 12.0),
            "height_xh": _sat(h / xh, 4.0),
            "aspect": _sat(w / max(h, 1e-6), 8.0),
            "rise_xh": _sat((baseline - y0) / xh, 4.0),
            "drop_xh": _sat((y1 - baseline) / xh, 2.0),
            "stroke_height_sd": _sat(sd, 2.0),
            "gap_left_xh": _sat(gl, 3.0),
            "gap_right_xh": _sat(gr, 3.0),
            "is_first": float(i == 0),
            "is_last": float(i == n - 1),
            "line_has_spanning": line_has_spanning,
            "line_math_char_frac": line_math_frac,
            "line_n_runs": _sat(n, 12.0),
            "bias": 1.0,
        }
        rows[i] = [f[name] for name in FEATURES]
    return rows


if __name__ == "__main__":
    # Repo convention: gated __main__, cases list, exit code. The property that
    # matters here is scale invariance — a feature vector that changed when the
    # user writes bigger would make every threshold above it meaningless.
    from .layout import segment_geometric

    def bar(x: float, y: float = 0.0, h: float = 100.0) -> dict:
        return {"x": [float(x), float(x)], "y": [float(y), float(y + h)], "t": [0.0, 80.0]}

    failures = []

    def check(name: str, ok: bool) -> None:
        print(("✓ " if ok else "✗ ") + name)
        if not ok:
            failures.append(name)

    lex = load_lexicon()
    base = [bar(0), bar(40), bar(300), bar(340)]
    lines = segment_geometric(base)
    f1 = line_features(lines[0], base, lex)
    check("F1  one line -> one row per run", f1.shape == (len(lines[0].runs), len(FEATURES)))

    big = [{"x": [v * 3.7 for v in s["x"]], "y": [v * 3.7 for v in s["y"]], "t": s["t"]} for s in base]
    f2 = line_features(segment_geometric(big)[0], big, lex)
    check("F2  x3.7 scale leaves the vector unchanged", np.allclose(f1, f2, atol=1e-9))

    shifted = [{"x": [v + 917.0 for v in s["x"]], "y": [v - 43.0 for v in s["y"]], "t": s["t"]} for s in base]
    f3 = line_features(segment_geometric(shifted)[0], shifted, lex)
    check("F3  translation leaves the vector unchanged", np.allclose(f1, f3, atol=1e-9))

    check("F4  bias column is always 1", bool(np.all(f1[:, FEATURES.index("bias")] == 1.0)))
    check("F5  every feature is finite", bool(np.all(np.isfinite(f1))))
    check("F6  every feature is bounded to [0,1]", bool(f1.min() >= 0.0 and f1.max() <= 1.0))
    check("F7  FEATURES names are unique", len(set(FEATURES)) == len(FEATURES))

    line = segment_geometric(base)[0]
    line.runs[0].vision_word = "let"
    line.runs[-1].vision_word = "PQ"
    fw = line_features(line, base, lex)
    li = FEATURES.index("is_lexicon_word")
    check("F8  'let' is a word, 'PQ' is not", fw[0, li] == 1.0 and fw[-1, li] == 0.0)

    print(f"cases passed: {8 - len(failures)} / failed: {len(failures)}")
    raise SystemExit(1 if failures else 0)
