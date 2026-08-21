r"""Fit the prose-vs-formula run classifier (phase 1).

Pipeline: synthesize mixed lines -> run them through the REAL segmentation and
Vision pass (`unified.prepare_lines`) -> extract features per run -> label each
run by the ground truth of the strokes it actually claimed -> IRLS -> save.

Labelling by claimed strokes rather than by the plan matters. Segmentation is
imperfect: a run can straddle a word and the formula beside it, and training it
as though it were cleanly one or the other teaches the classifier a distribution
the pipeline never produces. A run whose strokes are more than `--impure` mixed
is dropped instead — it has no honest label.

**An honesty note about the lexicon feature.** `is_lexicon_word` is the
strongest single feature, and the corpus draws its prose from a fixed
vocabulary, so this script's numbers flatter it twice over: the eval words are
real English (in the dictionary by construction) and Apple Vision reads cleanly
printed stitched letters far better than it reads cursive. Two things keep the
result meaningful rather than circular:

  1. train and eval use DISJOINT halves of the prose vocabulary
     (`mixed_synth.split_vocab`) and disjoint halves of the symbol instances, so
     nothing is scored on a word or a glyph sample it was fitted on;
  2. `--ablate` refits without the lexicon column and reports both, so the share
     of the gain that rests on the dictionary is stated rather than hidden.

The remaining gap — Vision garbling real cursive, where a garbled string is not
a dictionary word and the run therefore falls to math — is NOT measured by this
corpus and is called out in the report.

Usage:
    ml/.venv/bin/python train_run_clf.py --n 1200
    ml/.venv/bin/python train_run_clf.py --n 1200 --ablate --sweep
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.lexicon import load as load_lexicon  # noqa: E402
from src.mixed_synth import build as build_corpus, stroke_kinds  # noqa: E402
from src.run_classifier import RunClassifier  # noqa: E402
from src.run_features import FEATURES, line_features  # noqa: E402
from src.unified import prepare_lines  # noqa: E402

ML_DIR = Path(__file__).resolve().parent


def dataset(records: list[dict], *, impure: float = 0.25, vision: bool = True):
    """Records -> (X, y, meta). y is 1 for math, 0 for text."""
    lex = load_lexicon()
    Xs, ys, kept, dropped = [], [], 0, 0
    for rec in records:
        strokes = rec["strokes"]
        truth = stroke_kinds(rec)
        lines, _vlines, _refs, _ok = prepare_lines(strokes, vision=vision)
        for line in lines:
            if not line.runs:
                continue
            feats = line_features(line, strokes, lex)
            for row, run in zip(feats, line.runs):
                votes = [truth[i] for i in run.strokes if 0 <= i < len(truth) and truth[i]]
                if not votes:
                    continue
                n_math = sum(1 for v in votes if v == "math")
                frac = n_math / len(votes)
                if impure < frac < 1.0 - impure:
                    dropped += 1  # a run straddling both: no honest label
                    continue
                Xs.append(row)
                ys.append(1.0 if frac >= 0.5 else 0.0)
                kept += 1
    X = np.asarray(Xs, dtype=np.float64) if Xs else np.zeros((0, len(FEATURES)))
    y = np.asarray(ys, dtype=np.float64)
    return X, y, {"runs": kept, "dropped_impure": dropped}


def score(clf: RunClassifier, X: np.ndarray, y: np.ndarray) -> dict:
    pred = clf.predict(X)
    truth = y > 0.5
    math_n = int(truth.sum())
    text_n = int((~truth).sum())
    math_as_text = int((truth & ~pred).sum())
    text_as_math = int((~truth & pred).sum())
    return {
        "runs": int(len(y)),
        "accuracy": round(float((pred == truth).mean()), 4) if len(y) else None,
        "math_runs": math_n,
        "math_as_text": round(math_as_text / math_n, 4) if math_n else None,
        "text_runs": text_n,
        "text_as_math": round(text_as_math / text_n, 4) if text_n else None,
    }


def sweep(clf: RunClassifier, X: np.ndarray, y: np.ndarray) -> list[dict]:
    """Both error rates across the threshold, so the trade is visible."""
    out = []
    for t in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
        clf.threshold = t
        s = score(clf, X, y)
        out.append({"threshold": t, **{k: s[k] for k in ("accuracy", "math_as_text", "text_as_math")}})
    clf.threshold = 0.5
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=1200, help="training lines to synthesize")
    ap.add_argument("--seed", type=int, default=77)
    ap.add_argument("--eval", default="data/mixed/eval.jsonl")
    ap.add_argument("--eval-letters", default="data/mixed/eval_letters.jsonl")
    ap.add_argument("--l2", type=float, default=1.0)
    ap.add_argument("--impure", type=float, default=0.25)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--ablate", action="store_true", help="also fit without the lexicon feature")
    ap.add_argument("--sweep", action="store_true")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    t0 = time.time()
    print(f"synthesizing {args.n} training lines (train split, symbol half 1, vocab half 0)…")
    train_records = build_corpus(args.n, args.seed, "train", half=1, vocab_half=0)
    # The letters-only case is 0.26% of MathWriting but a routine part of real
    # notation, so the trainer sees a deliberate dose of it. This is a prior
    # about the world, not a fit to the test set: the eval corpus draws from the
    # VALID split with the other half of the vocabulary and the other half of
    # the symbol instances.
    train_records += build_corpus(max(args.n // 4, 1), args.seed + 1, "train", half=1,
                                  vocab_half=0, letters_only=True)
    print(f"  {len(train_records)} lines in {time.time() - t0:.0f}s")

    print("extracting features through the real segmentation + Vision pass…")
    Xtr, ytr, meta = dataset(train_records, impure=args.impure)
    print(f"  {meta['runs']} runs ({int(ytr.sum())} math, {int(len(ytr) - ytr.sum())} text), "
          f"{meta['dropped_impure']} dropped as mixed")

    clf = RunClassifier.fit(Xtr, ytr, l2=args.l2)
    clf.threshold = args.threshold
    print("\ntop weights:\n" + clf.describe())

    report = {"train": score(clf, Xtr, ytr), "n_train_lines": len(train_records)}

    for name, path in (("eval", args.eval), ("eval_letters", args.eval_letters)):
        p = Path(path)
        if not p.exists():
            continue
        recs = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
        Xe, ye, _ = dataset(recs, impure=args.impure)
        report[name] = score(clf, Xe, ye)
        print(f"\n{name}: {report[name]}")
        if args.sweep:
            report[name + "_sweep"] = sweep(clf, Xe, ye)
            print("  threshold sweep:")
            for row in report[name + "_sweep"]:
                print(f"    t={row['threshold']}  acc={row['accuracy']}  "
                      f"math->text={row['math_as_text']}  text->math={row['text_as_math']}")

    if args.ablate:
        li = FEATURES.index("is_lexicon_word")
        Xa = Xtr.copy()
        Xa[:, li] = 0.0
        abl = RunClassifier.fit(Xa, ytr, l2=args.l2)
        abl.threshold = args.threshold
        report["ablation_no_lexicon"] = {}
        for name, path in (("eval", args.eval), ("eval_letters", args.eval_letters)):
            p = Path(path)
            if not p.exists():
                continue
            recs = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
            Xe, ye, _ = dataset(recs, impure=args.impure)
            Xe[:, li] = 0.0
            report["ablation_no_lexicon"][name] = score(abl, Xe, ye)
        print(f"\nablation (no lexicon feature): {report['ablation_no_lexicon']}")

    clf.meta = {
        "trained": time.strftime("%Y-%m-%d"),
        "train_lines": len(train_records),
        "train_runs": meta["runs"],
        "l2": args.l2,
        "report": report,
    }
    out = clf.save(Path(args.out) if args.out else None)
    print(f"\nsaved -> {out}  ({time.time() - t0:.0f}s total)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
