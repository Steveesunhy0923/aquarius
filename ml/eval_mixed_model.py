r"""Score the phase-2 mixed-aware decoder on the same corpus the pipeline is scored on.

Directly comparable to `eval_mixed.py`'s `source_similarity`: same eval lines,
same ground-truth `source` string, same similarity ratio. What differs is who
produced the reading — there segmentation, a router and two engines; here one
model that emits the whole line, boundaries included.

Also reported, because similarity alone hides the thing under test:

    boundary F1   over the MATH SPANS of the reading. A span is a maximal
                  `\( ... \)` region; predicted and gold spans match when their
                  CONTENT matches. This is the metric that says whether the
                  model learned where a formula starts and stops, independently
                  of whether it then decoded the formula correctly.

Usage:
    ml/.venv/bin/python eval_mixed_model.py data/mixed/eval.jsonl
    ml/.venv/bin/python eval_mixed_model.py data/mixed/eval.jsonl --show 12
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.latex_tokenizer import Tokenizer  # noqa: E402
from src.mixed_tokens import decode as detokenize  # noqa: E402
from src.model import InkToLatex  # noqa: E402
from src.render import strokes_to_array  # noqa: E402
from train_mixed import HEIGHT, WIDTH, ids_to_tokens, pick_device  # noqa: E402

ML_DIR = Path(__file__).resolve().parent
_SPAN = re.compile(r"\\\((.*?)\\\)", re.S)


def math_spans(source: str) -> list[str]:
    """The content of every inline-math region, in order."""
    return [m.group(1).strip() for m in _SPAN.finditer(source)]


def span_f1(gold: list[str], pred: list[str]) -> tuple[int, int, int]:
    """(matched, n_pred, n_gold) by multiset content match."""
    remaining = list(gold)
    matched = 0
    for p in pred:
        if p in remaining:
            remaining.remove(p)
            matched += 1
    return matched, len(pred), len(gold)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("dataset")
    ap.add_argument("--checkpoint", default=str(ML_DIR / "checkpoints" / "mixed.pt"))
    ap.add_argument("--device", default="auto")
    ap.add_argument("--max-len", type=int, default=160)
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--show", type=int, default=8)
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    device = pick_device(args.device)
    ck = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    tokenizer = Tokenizer(ck["vocab"])
    model = InkToLatex(**ck["config"]).to(device).eval()
    model.load_state_dict(ck["model_state"])
    print(f"checkpoint: {Path(args.checkpoint).name}  step {ck.get('step')}  "
          f"canvas {ck.get('height', HEIGHT)}x{ck.get('width', WIDTH)}  {device}", file=sys.stderr)

    records = [json.loads(l) for l in Path(args.dataset).read_text().splitlines() if l.strip()]
    if args.limit:
        records = records[: args.limit]

    sims, exact = [], 0
    tot_match = tot_pred = tot_gold = 0
    examples = []
    t0 = time.time()

    for start in range(0, len(records), args.batch_size):
        chunk = records[start : start + args.batch_size]
        imgs = torch.stack([
            torch.from_numpy(strokes_to_array(r["strokes"], height=HEIGHT, max_width=WIDTH))
            for r in chunk
        ]).to(device)
        with torch.no_grad():
            ids, _ = model.greedy_decode(imgs, max_len=args.max_len)
        for rec, seq in zip(chunk, ids):
            got = detokenize(ids_to_tokens(tokenizer, seq))
            want = rec["source"]
            sims.append(SequenceMatcher(None, want, got).ratio())
            exact += got == want
            m, p, g = span_f1(math_spans(want), math_spans(got))
            tot_match += m
            tot_pred += p
            tot_gold += g
            if len(examples) < args.show:
                examples.append((want, got))
        if (start + args.batch_size) % 64 == 0:
            print(f"  {start + len(chunk)}/{len(records)} ({time.time() - t0:.0f}s)", file=sys.stderr)

    prec = tot_match / tot_pred if tot_pred else 0.0
    rec_ = tot_match / tot_gold if tot_gold else 0.0
    f1 = 2 * prec * rec_ / (prec + rec_) if (prec + rec_) else 0.0
    report = {
        "dataset": args.dataset,
        "checkpoint": Path(args.checkpoint).name,
        "step": ck.get("step"),
        "lines": len(records),
        "source_similarity": round(float(np.mean(sims)), 4),
        "exact_match": round(exact / len(records), 4),
        "math_span_precision": round(prec, 4),
        "math_span_recall": round(rec_, 4),
        "math_span_f1": round(f1, 4),
        "seconds": round(time.time() - t0, 1),
    }

    print()
    print(f"lines {report['lines']}   {report['seconds']}s")
    print("-" * 62)
    print(f"  source similarity     {100 * report['source_similarity']:5.1f}%")
    print(f"  exact match           {100 * report['exact_match']:5.1f}%")
    print(f"  math-span F1          {100 * report['math_span_f1']:5.1f}%   "
          f"(P {100 * prec:.1f}  R {100 * rec_:.1f})")
    if examples:
        print("\n  examples (gold -> predicted):")
        for want, got in examples:
            mark = "=" if want == got else " "
            print(f"   {mark} {want}")
            print(f"     {got}")
    print()
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
