#!/usr/bin/env python3
"""Handwriting->LaTeX recognition server (contract used by the /ink web UI).

    cd ml && .venv/bin/uvicorn serve:app --host 127.0.0.1 --port 8787

API:
  POST /recognize  {"strokes":[{"x":[..],"y":[..],"t":[..],"p":[..]?}], "mode":"math"|"text"|"chem"}
                   x/y are CSS pixels, t is ms from session start. "p" (pressure)
                   may be sent by the web client and is ACCEPTED but IGNORED
                   (MathWriting ink has no pressure channel).
                   -> {"latex": str, "confidence": float 0..1}
                   "text" mode -> 501 (will use Apple Vision on-device).
                   "chem" mode decodes with the chem checkpoint when one exists
                   (checkpoints/chem.pt or INK_CHEM_CHECKPOINT), else the shared
                   math model, then reinterprets the result as chemistry:
                   mhchem source wrapped as \ce{...} (src/chem_normalize.py);
                   falls back to plain math LaTeX when not chemistry-expressible.
  GET  /health     -> {"status":"ok","model":"<checkpoint name>","collected":N}
  POST /collect    save a human-labeled ink sample as training data
  GET  /collect    -> {"count": N}
  GET  /collect/samples        list collected samples (no strokes), newest first
  GET  /collect/img/{id}       the rendered PNG of a collected sample
  DELETE /collect/{id}         remove a collected sample (JSONL line + PNG)
CORS: all origins allowed.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ML_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ML_DIR))

from src.chem_normalize import latex_to_ce  # noqa: E402
from src.latex_normalize import normalize_operators  # noqa: E402
from src.latex_tokenizer import Tokenizer  # noqa: E402
from src.model import InkToLatex  # noqa: E402
from src.render import render_strokes, strokes_to_array  # noqa: E402
from src.text_ocr import VisionUnavailable, recognize_text  # noqa: E402

def _default_checkpoint() -> Path:
    """Prefer the best trained model available: xl.pt (cloud S2-XL run) over
    full.pt (local MPS run); smoke.pt is the pipeline-test fallback."""
    for name in ("xl.pt", "full.pt"):
        candidate = ML_DIR / "checkpoints" / name
        if candidate.exists():
            return candidate
    return ML_DIR / "checkpoints" / "smoke.pt"


CHECKPOINT = Path(os.environ.get("INK_CHECKPOINT", _default_checkpoint()))
DEVICE = torch.device(os.environ.get("INK_DEVICE", "cpu"))  # cpu is plenty for 1 image

# Human-corrected samples land here as training data (see /collect below).
CORRECTIONS_DIR = Path(os.environ.get("INK_CORRECTIONS_DIR", ML_DIR / "data" / "corrections"))
CORRECTIONS_JSONL = CORRECTIONS_DIR / "collected.jsonl"
CORRECTIONS_IMG_DIR = CORRECTIONS_DIR / "img"
_collect_lock = threading.Lock()


def _corrections_count() -> int:
    if not CORRECTIONS_JSONL.exists():
        return 0
    with CORRECTIONS_JSONL.open("r", encoding="utf-8") as f:
        return sum(1 for line in f if line.strip())


def load_model(checkpoint: Path) -> tuple[InkToLatex, Tokenizer]:
    ckpt = torch.load(checkpoint, map_location="cpu", weights_only=True)
    tokenizer = Tokenizer(ckpt["vocab"])
    model = InkToLatex(**ckpt["config"])
    model.load_state_dict(ckpt["model_state"])
    model.to(DEVICE).eval()
    return model, tokenizer


MODEL, TOKENIZER = load_model(CHECKPOINT)

# Chemistry gets its own model SLOT: a chem fine-tune (checkpoints/chem.pt or
# INK_CHEM_CHECKPOINT) is picked up automatically; until one exists, chem mode
# shares the math model — its output is then reinterpreted by latex_to_ce.
_chem_env = os.environ.get("INK_CHEM_CHECKPOINT")
CHEM_CHECKPOINT = (
    Path(_chem_env) if _chem_env else ML_DIR / "checkpoints" / "chem.pt"
)
if CHEM_CHECKPOINT.exists():
    CHEM_MODEL, CHEM_TOKENIZER = load_model(CHEM_CHECKPOINT)
else:
    CHEM_CHECKPOINT = CHECKPOINT
    CHEM_MODEL, CHEM_TOKENIZER = MODEL, TOKENIZER

app = FastAPI(title="aquarius ink recognizer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Stroke(BaseModel):
    x: list[float]
    y: list[float]
    t: list[float]
    p: list[float] | None = None  # accepted from the web client, ignored


class RecognizeRequest(BaseModel):
    strokes: list[Stroke]
    mode: Literal["math", "text", "chem"] = "math"


class RecognizeResponse(BaseModel):
    latex: str
    confidence: float = Field(ge=0.0, le=1.0)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": CHECKPOINT.name,
        "chemModel": CHEM_CHECKPOINT.name,
        "collected": _corrections_count(),
    }


@app.post("/recognize", response_model=RecognizeResponse)
def recognize(req: RecognizeRequest):
    strokes = [{"x": s.x, "y": s.y, "t": s.t} for s in req.strokes if s.x]
    if not strokes:
        return RecognizeResponse(latex="", confidence=0.0)

    if req.mode == "text":
        # Handwritten WORDS via Apple Vision (macOS dev; iPad ships the same
        # engine on-device — see docs/MODULES.md decision record). The plain
        # text rides the `latex` field of the shared contract.
        try:
            text, confidence = recognize_text(strokes)
        except VisionUnavailable:
            raise HTTPException(
                status_code=501,
                detail="text mode needs Apple Vision (macOS dev server / iPad on-device)",
            )
        return RecognizeResponse(latex=text, confidence=confidence)

    model, tokenizer = (CHEM_MODEL, CHEM_TOKENIZER) if req.mode == "chem" else (MODEL, TOKENIZER)
    image = torch.from_numpy(strokes_to_array(strokes)).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        seqs, mean_logp = model.greedy_decode(image, max_len=160)
    decoded = tokenizer.decode(seqs[0])
    confidence = float(torch.exp(mean_logp[0]).clamp(0.0, 1.0))

    if req.mode == "chem":
        # Chemistry interpretation: the expression becomes mhchem source
        # wrapped as \ce{...}, the app's chem storage form. Not chemistry-
        # expressible -> the RAW decoded LaTeX. No operator normalization on
        # either path: the user declared this ink chemistry, and `Pr` is
        # praseodymium, `Sn` is tin — not \Pr / \sin.
        ce = latex_to_ce(decoded)
        latex = f"\\ce{{{ce}}}" if ce is not None else decoded
        return RecognizeResponse(latex=latex, confidence=confidence)

    # MathWriting labels write operators as bare letters (log, sin, lim …) so
    # the model does too — reconstruct proper \operators deterministically.
    return RecognizeResponse(latex=normalize_operators(decoded), confidence=confidence)


class CollectRequest(BaseModel):
    strokes: list[Stroke]
    label: str = Field(min_length=1)  # the CORRECT LaTeX the user typed
    predicted: str | None = None  # what the model guessed (for error analysis)
    mode: Literal["math", "text", "chem"] = "math"


class CollectResponse(BaseModel):
    ok: bool
    id: str
    count: int  # total corrections collected so far


@app.get("/collect")
def collect_count():
    return {"count": _corrections_count()}


@app.post("/collect", response_model=CollectResponse)
def collect(req: CollectRequest):
    """Persist a human-labeled ink sample for later training.

    Writes one JSON line per sample to data/corrections/collected.jsonl and a
    PNG of the drawing to data/corrections/img/<id>.png. The JSONL is directly
    consumable by a future dataset loader (strokes + normalizedLabel), mirroring
    MathWriting's own shape so corrections can be mixed straight into training.
    """
    strokes = [{"x": s.x, "y": s.y, "t": s.t} for s in req.strokes if s.x]
    if not strokes:
        raise HTTPException(status_code=400, detail="no strokes to save")

    sample_id = uuid.uuid4().hex
    record = {
        "id": sample_id,
        "ts": datetime.now(timezone.utc).isoformat(),
        "label": req.label.strip(),
        "predicted": req.predicted,
        "mode": req.mode,
        "image": f"img/{sample_id}.png",
        "strokes": strokes,
    }

    with _collect_lock:
        CORRECTIONS_IMG_DIR.mkdir(parents=True, exist_ok=True)
        # Visual backup of the "drawn figure" (same renderer the model sees).
        try:
            render_strokes(strokes).save(CORRECTIONS_IMG_DIR / f"{sample_id}.png")
        except Exception:  # a bad-geometry sample must not lose the label data
            record["image"] = None
        with CORRECTIONS_JSONL.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        count = _corrections_count()

    return CollectResponse(ok=True, id=sample_id, count=count)


# ── Review: list / view / delete collected samples ──────────────────────────

_SAMPLE_ID_RE = re.compile(r"[0-9a-f]{32}")


def _read_records() -> list[dict]:
    """All JSONL records, oldest first; malformed lines are skipped."""
    if not CORRECTIONS_JSONL.exists():
        return []
    records = []
    with CORRECTIONS_JSONL.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


@app.get("/collect/samples")
def collect_samples():
    """Collected samples for the review UI (metadata only, newest first)."""
    with _collect_lock:
        records = _read_records()
    samples = [
        {
            "id": r.get("id"),
            "ts": r.get("ts"),
            "label": r.get("label", ""),
            "predicted": r.get("predicted"),
            "mode": r.get("mode", "math"),
            "hasImage": bool(r.get("image")),
            "strokes": len(r.get("strokes", [])),
        }
        for r in reversed(records)
        if r.get("id")
    ]
    return {"count": len(samples), "samples": samples}


@app.get("/collect/img/{sample_id}")
def collect_image(sample_id: str):
    if not _SAMPLE_ID_RE.fullmatch(sample_id):
        raise HTTPException(status_code=400, detail="bad sample id")
    path = CORRECTIONS_IMG_DIR / f"{sample_id}.png"
    if not path.exists():
        raise HTTPException(status_code=404, detail="no image for this sample")
    return FileResponse(path, media_type="image/png")


@app.delete("/collect/{sample_id}")
def collect_delete(sample_id: str):
    """Remove one collected sample: its JSONL line and its PNG."""
    if not _SAMPLE_ID_RE.fullmatch(sample_id):
        raise HTTPException(status_code=400, detail="bad sample id")
    with _collect_lock:
        records = _read_records()
        kept = [r for r in records if r.get("id") != sample_id]
        if len(kept) == len(records):
            raise HTTPException(status_code=404, detail="unknown sample id")
        tmp = CORRECTIONS_JSONL.with_suffix(".jsonl.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for r in kept:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        tmp.replace(CORRECTIONS_JSONL)  # atomic — a crash never truncates the data
        (CORRECTIONS_IMG_DIR / f"{sample_id}.png").unlink(missing_ok=True)
        count = _corrections_count()
    return {"ok": True, "count": count}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787)
