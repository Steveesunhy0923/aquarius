#!/usr/bin/env python3
"""Handwriting->LaTeX recognition server (contract used by the /ink web UI).

    cd ml && .venv/bin/uvicorn serve:app --host 127.0.0.1 --port 8787

API:
  POST /recognize  {"strokes":[{"x":[..],"y":[..],"t":[..],"p":[..]?}], "mode":"math"|"text"}
                   x/y are CSS pixels, t is ms from session start. "p" (pressure)
                   may be sent by the web client and is ACCEPTED but IGNORED
                   (MathWriting ink has no pressure channel).
                   -> {"latex": str, "confidence": float 0..1}
                   "text" mode -> 501 (will use Apple Vision on-device).
  GET  /health     -> {"status":"ok","model":"<checkpoint name>"}
CORS: all origins allowed.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ML_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ML_DIR))

from src.latex_tokenizer import Tokenizer  # noqa: E402
from src.model import InkToLatex  # noqa: E402
from src.render import render_strokes, strokes_to_array  # noqa: E402

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


def load_model() -> tuple[InkToLatex, Tokenizer]:
    ckpt = torch.load(CHECKPOINT, map_location="cpu", weights_only=True)
    tokenizer = Tokenizer(ckpt["vocab"])
    model = InkToLatex(**ckpt["config"])
    model.load_state_dict(ckpt["model_state"])
    model.to(DEVICE).eval()
    return model, tokenizer


MODEL, TOKENIZER = load_model()

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
    mode: Literal["math", "text"] = "math"


class RecognizeResponse(BaseModel):
    latex: str
    confidence: float = Field(ge=0.0, le=1.0)


@app.get("/health")
def health():
    return {"status": "ok", "model": CHECKPOINT.name, "collected": _corrections_count()}


@app.post("/recognize", response_model=RecognizeResponse)
def recognize(req: RecognizeRequest):
    if req.mode == "text":
        raise HTTPException(
            status_code=501,
            detail="text mode not implemented yet — will use Apple Vision on-device",
        )
    strokes = [{"x": s.x, "y": s.y, "t": s.t} for s in req.strokes if s.x]
    if not strokes:
        return RecognizeResponse(latex="", confidence=0.0)

    image = torch.from_numpy(strokes_to_array(strokes)).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        seqs, mean_logp = MODEL.greedy_decode(image, max_len=160)
    latex = TOKENIZER.decode(seqs[0])
    confidence = float(torch.exp(mean_logp[0]).clamp(0.0, 1.0))
    return RecognizeResponse(latex=latex, confidence=confidence)


class CollectRequest(BaseModel):
    strokes: list[Stroke]
    label: str = Field(min_length=1)  # the CORRECT LaTeX the user typed
    predicted: str | None = None  # what the model guessed (for error analysis)
    mode: Literal["math", "text"] = "math"


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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787)
