#!/usr/bin/env python3
r"""Evaluate the ink->LaTeX model on chemistry strokes (JSONL -> metrics).

Loads a stroke test set, runs the SAME pipeline as serve.py chem mode
(render -> greedy_decode -> latex_to_ce) in-process, and scores the mhchem
output against gold. Two input formats are accepted:

  - synthetic sets from src/chem_synth.py:
        {"id", "ce", "latex", "strokes": [{"x","y","t"}, ...]}
  - collected corrections from serve.py /collect (data/corrections/
    collected.jsonl): records with "label" (possibly wrapped as \ce{...})
    and "mode" — only mode=="chem" rows are used. math/text corrections and
    the "mixed" whole-page layout parents are skipped, not scored as bad
    chemistry.

Metrics (printed as a table, written to <input>.eval.json):
  ce exact match       whitespace-normalized mhchem string equality
  mean ce similarity   difflib.SequenceMatcher ratio on the ce strings
  ce conversion rate   latex_to_ce succeeded on the decoded LaTeX
  raw latex similarity decoder output vs gold LaTeX — separates stroke-
                       recognition error from chem-interpretation error

Checkpoint default: checkpoints/chem.pt if present, else xl.pt, else full.pt.

    ml/.venv/bin/python eval_chem.py data/chem/synth_test.jsonl
    ml/.venv/bin/python eval_chem.py data/corrections/collected.jsonl --limit 50
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

import numpy as np
import torch

ML_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ML_DIR))

from src.chem_normalize import latex_to_ce  # noqa: E402
from src.latex_tokenizer import Tokenizer  # noqa: E402
from src.model import InkToLatex  # noqa: E402
from src.render import strokes_to_array  # noqa: E402

def _ce_inner(label: str) -> str | None:
    """Inner mhchem source when `label` is exactly ONE `\\ce{...}` — the Python
    mirror of lib/blocks/chem.ts ceInner (brace-balanced walk incl. its
    unbalanced-tail fallback). A greedy regex would silently splice multi-span
    labels like `\\ce{H2O} + \\ce{O2}` into corrupt gold; those return None
    here and the record is skipped (fail closed)."""
    s = label.strip()
    if not s.startswith("\\ce{"):
        return None
    open_i = len("\\ce{") - 1
    depth = 0
    i = open_i
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                inner = s[open_i + 1 : i] if i == len(s) - 1 else None
                break
        i += 1
    else:
        # Unbalanced but nothing-but-\ce: same recovery contract as wrapCe.
        inner = s[open_i + 1 :]
    if inner is None or "\\ce{" in inner:
        return None  # mixed/multi-span label — not a single gold source
    return inner.strip()


def _default_checkpoint() -> Path:
    for name in ("chem.pt", "xl.pt", "full.pt"):
        candidate = ML_DIR / "checkpoints" / name
        if candidate.exists():
            return candidate
    raise SystemExit("no checkpoint found under checkpoints/ (chem.pt / xl.pt / full.pt)")


def load_model(checkpoint: Path, device: torch.device) -> tuple[InkToLatex, Tokenizer]:
    ckpt = torch.load(checkpoint, map_location="cpu", weights_only=True)
    tokenizer = Tokenizer(ckpt["vocab"])
    model = InkToLatex(**ckpt["config"])
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()
    return model, tokenizer


def load_records(path: Path) -> list[dict]:
    """JSONL -> [{id, ce (gold mhchem), latex (gold LaTeX or None), strokes}]."""
    records: list[dict] = []
    with path.open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                print(f"WARNING: skipping malformed line {lineno} in {path}")
                continue
            strokes = [s for s in rec.get("strokes", []) if s.get("x")]
            if not strokes:
                continue
            # Mode gate, same intent as dataset.load_corrections: /collect files
            # carry math, text and (from unified recognition) "mixed" layout
            # parents whose label is a whole page of source and whose strokes are
            # a whole page of ink. Scored as chemistry those are pure noise in
            # the denominator. A record with no mode at all is only trusted when
            # it is a chem_synth row (which is identified by its "ce" gold, not
            # by a mode field) — a pre-"mode" correction is not known chem.
            mode = rec.get("mode")
            if mode is not None and mode != "chem":
                continue
            if "ce" in rec:  # chem_synth format carries both gold forms
                gold_ce, gold_latex = rec["ce"], rec.get("latex")
            elif "label" in rec:  # serve.py /collect corrections format
                if mode != "chem":
                    continue
                label = (rec["label"] or "").strip()
                inner = _ce_inner(label)
                if inner is not None:
                    gold_ce, gold_latex = inner, None
                else:  # a raw-LaTeX chem label: derive the mhchem gold
                    gold_ce, gold_latex = latex_to_ce(label), label
                if not gold_ce:
                    continue
            else:
                continue
            records.append(
                {
                    "id": str(rec.get("id", f"line{lineno}")),
                    "ce": gold_ce,
                    "latex": gold_latex,
                    "strokes": strokes,
                }
            )
    if not records:
        raise SystemExit(f"no usable chem records in {path}")
    return records


def _ws(s: str) -> str:
    return " ".join(s.split())


def _sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def evaluate(records: list[dict], model: InkToLatex, tokenizer: Tokenizer,
             device: torch.device, batch_size: int) -> list[dict]:
    """Decode every record; returns per-sample result rows."""
    rows: list[dict] = []
    for start in range(0, len(records), batch_size):
        chunk = records[start : start + batch_size]
        images = np.stack([strokes_to_array(r["strokes"]) for r in chunk])
        with torch.no_grad():
            seqs, mean_logp = model.greedy_decode(
                torch.from_numpy(images).to(device), max_len=160
            )
        for rec, seq, logp in zip(chunk, seqs, mean_logp):
            pred_latex = tokenizer.decode(seq)
            pred_ce = latex_to_ce(pred_latex)
            rows.append(
                {
                    "id": rec["id"],
                    "gold_ce": rec["ce"],
                    "gold_latex": rec["latex"],
                    "pred_latex": pred_latex,
                    "pred_ce": pred_ce,
                    "confidence": round(float(torch.exp(logp).clamp(0.0, 1.0)), 4),
                    "exact": pred_ce is not None and _ws(pred_ce) == _ws(rec["ce"]),
                    "ce_sim": round(_sim(_ws(rec["ce"]), _ws(pred_ce or "")), 4),
                    "latex_sim": (
                        round(_sim(rec["latex"], pred_latex), 4) if rec["latex"] else None
                    ),
                }
            )
        done = min(start + batch_size, len(records))
        print(f"\r  decoded {done}/{len(records)}", end="", flush=True)
    print()
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("input", help="JSONL test set (chem_synth output or collected.jsonl)")
    ap.add_argument("--checkpoint", default="", help="model checkpoint (default: chem.pt > xl.pt > full.pt)")
    ap.add_argument("--limit", type=int, default=0, help="evaluate at most N samples (0 = all)")
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()
    if args.limit < 0:
        ap.error(f"--limit must be >= 0, got {args.limit}")

    checkpoint = Path(args.checkpoint) if args.checkpoint else _default_checkpoint()
    device = torch.device(args.device)
    model, tokenizer = load_model(checkpoint, device)

    in_path = Path(args.input)
    records = load_records(in_path)
    if args.limit:
        records = records[: args.limit]
    print(f"model: {checkpoint.name}  |  samples: {len(records)}  |  {in_path}")

    rows = evaluate(records, model, tokenizer, device, args.batch_size)

    n = len(rows)
    latex_rows = [r for r in rows if r["latex_sim"] is not None]
    metrics = {
        "samples": n,
        "ce_exact_match": round(sum(r["exact"] for r in rows) / n, 4),
        "mean_ce_similarity": round(sum(r["ce_sim"] for r in rows) / n, 4),
        "ce_conversion_rate": round(sum(r["pred_ce"] is not None for r in rows) / n, 4),
        "raw_latex_similarity": (
            round(sum(r["latex_sim"] for r in latex_rows) / len(latex_rows), 4)
            if latex_rows
            else None
        ),
    }

    print()
    print(f"{'metric':<24}value")
    print("-" * 32)
    for key, val in metrics.items():
        print(f"{key:<24}{val}")

    matches = [r for r in rows if r["exact"]]
    misses = [r for r in rows if not r["exact"]]
    examples = (matches[:4] + misses)[:10]
    print("\nexamples (gold ce  ->  predicted):")
    for r in examples:
        pred = r["pred_ce"] if r["pred_ce"] is not None else f"[no \\ce] {r['pred_latex']}"
        mark = "✓" if r["exact"] else "✗"
        print(f"  {mark} {r['gold_ce']!r}\n      -> {pred!r}")

    out_path = (
        in_path.with_suffix(".eval.json")
        if in_path.suffix == ".jsonl"
        else Path(str(in_path) + ".eval.json")
    )
    out_path.write_text(
        json.dumps(
            {
                "input": str(in_path),
                "checkpoint": str(checkpoint),
                "metrics": metrics,
                "examples": [
                    {k: r[k] for k in ("id", "gold_ce", "pred_ce", "pred_latex", "exact")}
                    for r in examples
                ],
            },
            indent=1,
        )
        + "\n"
    )
    print(f"\nwrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
