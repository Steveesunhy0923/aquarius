r"""Measure how well Ancha tells PROSE from FORMULA on a mixed page.

Until this script existed there was no such measurement: `unified.py`'s router
is eleven hand-written rules over five numeric thresholds, all tuned against one
51-stroke fixture, and nothing in `ml/` could say whether a change to them made
the product better or worse. That is the gap this closes.

The primary metric is PER-STROKE, not per-run. Run boundaries are a choice the
pipeline makes — `merge_runs` coalesces adjacent same-kind runs, so the same
page can come back as three segments or five without either being wrong — and
comparing boundary sets would score bookkeeping instead of recognition. Every
stroke, by contrast, has one unambiguous truth: it was drawn as part of a word
or as part of a formula.

The two error directions are reported SEPARATELY and never averaged into one
accuracy, because they are different failures with different causes and they
trade off against each other:

    math->text   a formula came back as prose   (LaTeX lost; the user retypes)
    text->math   prose came back as a formula   (words mangled into symbols)

Reported per corpus slice, so a fix that helps one case at the expense of
another cannot hide inside a single number:

    letters-only formulas   `PQ`, `AB`, `nRT` — no operator, no digit, no
                            structure. The router has NO evidence for math here.
    short-word adjacency    a <=2 character word within S2's 0.55 xh of a
                            formula: the rule that eats `of`, `is`, `in`.

Usage:
    ml/.venv/bin/python eval_mixed.py data/mixed/eval.jsonl
    ml/.venv/bin/python eval_mixed.py data/mixed/eval.jsonl --no-vision
    ml/.venv/bin/python eval_mixed.py data/mixed/eval.jsonl --json out.eval.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.layout import stroke_boxes, xheight  # noqa: E402
from src.mixed_synth import stroke_kinds  # noqa: E402
from src.unified import recognize_unified  # noqa: E402

ML_DIR = Path(__file__).resolve().parent

# S2's threshold and length limit, mirrored here so the slice this script
# reports is exactly the population that rule acts on.
SHORT_TEXT_LEN = 2
SHORT_TEXT_GAP = 0.55


def load_model(checkpoint: Path):
    """serve.py's loader, minus the FastAPI import. Importing serve would spin
    up an app and bind a port as a side effect of measuring a model."""
    import torch

    from src.latex_tokenizer import Tokenizer
    from src.model import InkToLatex

    ckpt = torch.load(checkpoint, map_location="cpu", weights_only=True)
    tokenizer = Tokenizer(ckpt["vocab"])
    model = InkToLatex(**ckpt["config"])
    model.load_state_dict(ckpt["model_state"])
    model.to(torch.device("cpu")).eval()
    return model, tokenizer


def _default_checkpoint() -> Path:
    for name in ("xl.pt", "full.pt", "smoke.pt"):
        p = ML_DIR / "checkpoints" / name
        if p.exists():
            return p
    raise FileNotFoundError("no checkpoint in ml/checkpoints/")


# --------------------------------------------------------------------------
# slices
# --------------------------------------------------------------------------

_ALPHA_ONLY = re.compile(r"^[A-Za-z]{2,}$")


def is_letters_only(label: str) -> bool:
    """A formula with no operator, no digit and no structure — the case where
    the router has no evidence for math at all."""
    return bool(_ALPHA_ONLY.match(label.strip()))


def short_word_runs(record: dict) -> set[int]:
    """Indices of text runs that S2 is entitled to convert: <= 2 characters and
    within 0.55 xh of a math run, measured on stroke extents the way
    `layout.extent_gap` measures it."""
    runs = record["runs"]
    strokes = record["strokes"]
    xh = record["xh"]

    def extent(run):
        xs = [v for i in run["strokes"] for v in strokes[i]["x"]]
        return (min(xs), max(xs)) if xs else (0.0, 0.0)

    ext = [extent(r) for r in runs]
    out = set()
    for i, run in enumerate(runs):
        if run["kind"] != "text" or len(run["label"]) > SHORT_TEXT_LEN:
            continue
        for j in (i - 1, i + 1):
            if not (0 <= j < len(runs)) or runs[j]["kind"] != "math":
                continue
            a, b = ext[i], ext[j]
            gap = max(b[0] - a[1], a[0] - b[1], 0.0) / max(xh, 1e-6)
            if gap < SHORT_TEXT_GAP:
                out.add(i)
                break
    return out


# --------------------------------------------------------------------------
# scoring
# --------------------------------------------------------------------------


class Tally:
    """Per-stroke confusion, kept per slice."""

    def __init__(self) -> None:
        self.math_ok = self.math_as_text = 0
        self.text_ok = self.text_as_math = 0

    def add(self, truth: str, pred: str) -> None:
        if truth == "math":
            if pred == "math":
                self.math_ok += 1
            else:
                self.math_as_text += 1
        elif truth == "text":
            if pred == "text":
                self.text_ok += 1
            else:
                self.text_as_math += 1

    @property
    def n(self) -> int:
        return self.math_ok + self.math_as_text + self.text_ok + self.text_as_math

    def report(self) -> dict:
        m = self.math_ok + self.math_as_text
        t = self.text_ok + self.text_as_math
        return {
            "strokes": self.n,
            "accuracy": round((self.math_ok + self.text_ok) / self.n, 4) if self.n else None,
            "math_strokes": m,
            "math_as_text": round(self.math_as_text / m, 4) if m else None,
            "text_strokes": t,
            "text_as_math": round(self.text_as_math / t, 4) if t else None,
        }


def evaluate(records: list[dict], *, vision: bool, model, tokenizer, limit: int = 0,
             classifier: bool = True) -> dict:
    overall = Tally()
    slices = {
        "letters_only_formula": Tally(),
        "short_word_next_to_formula": Tally(),
        "pure_prose_line": Tally(),
        "pure_formula_line": Tally(),
    }
    run_hits = run_total = 0
    sims: list[float] = []
    t0 = time.time()

    for n, rec in enumerate(records if not limit else records[:limit]):
        strokes = rec["strokes"]
        truth = stroke_kinds(rec)
        segments, source, _conf, _engine = recognize_unified(
            strokes, vision=vision, model=model, tokenizer=tokenizer,
            use_classifier=classifier,
        )
        pred = [""] * len(strokes)
        for seg in segments:
            # chem is a re-interpretation of a math run, not a third truth
            kind = "math" if seg.kind in ("math", "chem") else "text"
            for i in seg.strokes:
                if 0 <= i < len(pred):
                    pred[i] = kind

        short_runs = short_word_runs(rec)
        kinds_of_line = {r["kind"] for r in rec["runs"]}
        for ri, run in enumerate(rec["runs"]):
            votes = [pred[i] for i in run["strokes"] if pred[i]]
            if votes:
                run_total += 1
                run_hits += max(set(votes), key=votes.count) == run["kind"]
            for i in run["strokes"]:
                if not truth[i] or not pred[i]:
                    continue
                overall.add(truth[i], pred[i])
                if run["kind"] == "math" and is_letters_only(run["label"]):
                    slices["letters_only_formula"].add(truth[i], pred[i])
                if ri in short_runs:
                    slices["short_word_next_to_formula"].add(truth[i], pred[i])
                if kinds_of_line == {"text"}:
                    slices["pure_prose_line"].add(truth[i], pred[i])
                if kinds_of_line == {"math"}:
                    slices["pure_formula_line"].add(truth[i], pred[i])

        sims.append(SequenceMatcher(None, rec["source"], source).ratio())
        if (n + 1) % 25 == 0:
            print(f"  {n + 1}/{len(records)}  ({time.time() - t0:.0f}s)", file=sys.stderr)

    return {
        "lines": len(records if not limit else records[:limit]),
        "vision": vision,
        "classifier": classifier,
        "seconds": round(time.time() - t0, 1),
        "overall": overall.report(),
        "run_kind_accuracy": round(run_hits / run_total, 4) if run_total else None,
        "source_similarity": round(sum(sims) / len(sims), 4) if sims else None,
        "slices": {k: v.report() for k, v in slices.items() if v.n},
    }


def print_report(r: dict) -> None:
    o = r["overall"]
    pct = lambda v: "  n/a " if v is None else f"{100 * v:5.1f}%"  # noqa: E731
    print()
    print(f"lines {r['lines']}   vision={'on' if r['vision'] else 'OFF'}   "
          f"router={'trained' if r.get('classifier') else 'cascade'}   {r['seconds']}s")
    print("-" * 62)
    print(f"  per-stroke kind accuracy   {pct(o['accuracy'])}   ({o['strokes']} strokes)")
    print(f"  math read as text          {pct(o['math_as_text'])}   (of {o['math_strokes']} math strokes)")
    print(f"  text read as math          {pct(o['text_as_math'])}   (of {o['text_strokes']} text strokes)")
    print(f"  per-run kind accuracy      {pct(r['run_kind_accuracy'])}")
    print(f"  source similarity          {pct(r['source_similarity'])}")
    if r["slices"]:
        print("\n  slices                        acc    math->text   text->math   n")
        for name, s in r["slices"].items():
            print(
                f"    {name:<26} {pct(s['accuracy'])}  {pct(s['math_as_text'])}      "
                f"{pct(s['text_as_math'])}    {s['strokes']}"
            )
    print()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("dataset")
    ap.add_argument("--checkpoint", default="")
    ap.add_argument("--no-vision", action="store_true", help="measure the degraded path")
    ap.add_argument("--no-classifier", action="store_true",
                    help="force the C1-C7 cascade, for before/after comparison")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    records = [json.loads(l) for l in Path(args.dataset).read_text().splitlines() if l.strip()]
    ckpt = Path(args.checkpoint) if args.checkpoint else _default_checkpoint()
    print(f"checkpoint: {ckpt.name}", file=sys.stderr)
    model, tokenizer = load_model(ckpt)

    report = evaluate(
        records, vision=not args.no_vision, model=model, tokenizer=tokenizer, limit=args.limit,
        classifier=not args.no_classifier,
    )
    report["dataset"] = args.dataset
    report["checkpoint"] = ckpt.name
    print_report(report)
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
        print(f"wrote {args.json}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
