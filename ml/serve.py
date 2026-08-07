#!/usr/bin/env python3
"""Ancha — Aquarius's handwriting recognition server (contract used by /ink).

    cd ml && .venv/bin/uvicorn serve:app --host 127.0.0.1 --port 8787

API:
  POST /recognize  {"strokes":[{"x":[..],"y":[..],"t":[..],"p":[..]?}], "mode":...}
                   x/y are CSS pixels, t is ms from session start. "p" (pressure)
                   may be sent by the web client and is ACCEPTED but IGNORED
                   (MathWriting ink has no pressure channel).
                   -> {"latex": str, "confidence": float 0..1, ...}

                   "auto" (the product default) is the UNIFIED mode: Ancha
                   segments the page herself — lines, then runs — decides per
                   run whether it is prose or a formula, and returns the whole
                   thing assembled as the app's paragraph source, prose with
                   \\( ... \\) inline math. Extra fields `source`, `segments`,
                   `lines` and `engine` ride along so the UI can show and
                   re-label each run. It NEVER 501s: with no text engine on the
                   platform it degrades to geometry-only, every run read as
                   math and flagged `degraded`.

                   The three single-interpretation modes are unchanged, byte for
                   byte, and carry none of the new fields:
                   "math" decodes the whole ink as one LaTeX expression;
                   "text" reads it as words via Apple Vision (501 elsewhere);
                   "chem" decodes with the chem checkpoint when one exists
                   (checkpoints/chem.pt or INK_CHEM_CHECKPOINT), else the shared
                   math model, then reinterprets the result as chemistry:
                   mhchem source wrapped as \\ce{...} (src/chem_normalize.py);
                   falls back to plain math LaTeX when not chemistry-expressible.

                   `chem: true` is an INTERPRETATION flag for "auto", not a
                   mode: it decides how the formula runs are read and leaves the
                   prose runs alone. (`Sn` is tin or `\\sin` purely by the
                   writer's intent — that is why chemistry stays a switch the
                   user throws, while text-vs-math is detected.)
  POST /recognize/segment  {"strokes":[...], "kind":"text"|"math"|"chem"}
                   Re-read ONE run under a kind the user picked, without
                   disturbing the rest of the page.
  GET  /health     -> {"status":"ok","name":"Ancha","version":..., ...}
  POST /collect    save a human-labeled ink sample as training data
  POST /collect/mixed  save a corrected "auto" page: one parent record plus one
                   child per segment, each shaped exactly like a /collect record
  GET  /collect    -> {"count": N}
  POST /collect/accepted  save ink the user INSERTED UNCHANGED (Ancha's reading
                   ratified by use) into a SEPARATE store — same record shape,
                   never mixed into the x32-oversampled corrections
  GET  /collect/accepted  -> {"count": N}
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
from collections.abc import Sequence
from typing import Literal

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ML_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ML_DIR))

from src import layout, unified, vision_layout  # noqa: E402
from src.chem_normalize import latex_to_ce  # noqa: E402
from src.latex_normalize import normalize_operators  # noqa: E402
from src.latex_tokenizer import Tokenizer  # noqa: E402
from src.model import InkToLatex  # noqa: E402
from src.render import render_strokes, strokes_to_array  # noqa: E402
from src.text_ocr import VisionUnavailable, recognize_text  # noqa: E402

# Ancha's own version, deliberately independent of the app's (package.json):
# a cloud re-train ships a new Ancha without touching the app, and vice versa.
ANCHA_VERSION = "1.0"

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

# ACCEPTED samples — ink the user inserted WITHOUT editing Ancha's reading, i.e.
# she was right and the user ratified it by using the result. A separate store,
# never the corrections file, for two reasons:
#   1. corrections are oversampled x32 in a training run (--corrections-repeat).
#      Accepted samples arrive with every insert, so they will outnumber
#      corrections by orders of magnitude; mixing them would both drown the
#      corrections and replay the model's OWN OUTPUT back at it 32 times over,
#      which locks in whatever it already does instead of fixing it.
#   2. the review UI triages corrections — burying them under thousands of
#      "she got it right" rows would make it useless.
# Same record shape, so src/dataset.py's load_corrections() reads this file
# as-is whenever we decide to mix it in (with its own, much smaller repeat).
ACCEPTED_DIR = Path(os.environ.get("INK_ACCEPTED_DIR", ML_DIR / "data" / "accepted"))
ACCEPTED_JSONL = ACCEPTED_DIR / "accepted.jsonl"
ACCEPTED_IMG_DIR = ACCEPTED_DIR / "img"

_collect_lock = threading.Lock()


def _count_lines(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("r", encoding="utf-8") as f:
        return sum(1 for line in f if line.strip())


def _corrections_count() -> int:
    return _count_lines(CORRECTIONS_JSONL)


def _accepted_count() -> int:
    return _count_lines(ACCEPTED_JSONL)


def _persist(records: list[dict], jsonl: Path, img_dir: Path) -> None:
    """Render each record's ink to a PNG and append the batch to `jsonl`.

    Caller must hold `_collect_lock`: the batch is written under one lock so a
    crash can never leave a child record without its parent. A sample whose
    geometry the renderer chokes on still gets its LABEL saved (image: null) —
    losing the training pair to a thumbnail failure would be the worse trade.
    """
    img_dir.mkdir(parents=True, exist_ok=True)
    jsonl.parent.mkdir(parents=True, exist_ok=True)
    for record in records:
        try:
            render_strokes(record["strokes"]).save(img_dir / f"{record['id']}.png")
            record["image"] = f"img/{record['id']}.png"
        except Exception:
            record["image"] = None
    with jsonl.open("a", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


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

try:
    # Apple Vision's first request costs ~360 ms of framework warm-up; paying it
    # at import keeps it out of the user's first recognition. Absent off macOS,
    # which is exactly the platform where "auto" degrades to geometry-only.
    vision_layout.warmup()
except Exception:  # warm-up is an optimization; never let it block startup
    pass

app = FastAPI(title="Ancha — Aquarius handwriting recognizer", version=ANCHA_VERSION)
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


class SegmentOverride(BaseModel):
    """A run the user re-labelled by hand. Replayed on every later recognize
    call so the correction survives the next stroke."""

    strokes: list[int]
    kind: Literal["text", "math", "chem"]


class RecognizeRequest(BaseModel):
    strokes: list[Stroke]
    mode: Literal["math", "text", "chem", "auto"] = "math"
    # "auto" only, all three: how to read the formula runs, where the ink pages
    # break, and which runs the user has already re-labelled.
    chem: bool = False
    pageBreaks: list[float] | None = None
    overrides: list[SegmentOverride] | None = None


class SegmentOut(BaseModel):
    id: str
    line: int
    page: int
    kind: Literal["text", "math", "chem"]
    text: str | None = None
    latex: str | None = None
    visionText: str | None = None
    confidence: float
    box: dict
    strokes: list[int]
    sourceStart: int
    sourceEnd: int
    degraded: bool = False


class LineOut(BaseModel):
    index: int
    page: int
    box: dict


class RecognizeResponse(BaseModel):
    latex: str
    confidence: float = Field(ge=0.0, le=1.0)
    # "auto" only. `response_model_exclude_none` drops every one of these on the
    # legacy paths, so those responses stay byte-identical to the old contract.
    source: str | None = None
    segments: list[SegmentOut] | None = None
    lines: list[LineOut] | None = None
    engine: dict | None = None


def _kept_strokes(raw: list[Stroke]) -> tuple[list[dict], list[int]]:
    """Drop point-less strokes for the single-expression decoders, remembering
    where each survivor came from.

    The legacy modes render one image and never speak about individual strokes,
    so the index map is unused there — but "auto" returns stroke indices to the
    client, and silently renumbering them would make every segment point at the
    wrong ink. Hence one filter with an explicit map rather than two filters
    that disagree.
    """
    kept = [(i, {"x": s.x, "y": s.y, "t": s.t}) for i, s in enumerate(raw) if s.x]
    return [d for _, d in kept], [i for i, _ in kept]


def _box_out(box) -> dict:
    """layout.Box (x0, y0, x1, y1) -> the client's {minX, minY, maxX, maxY}."""
    x0, y0, x1, y1 = box
    return {"minX": x0, "minY": y0, "maxX": x1, "maxY": y1}


def _ink_box(strokes: list[dict]):
    """Bounding box of every stroke, or a degenerate box when there is no ink."""
    boxes = layout.stroke_boxes(strokes)
    if not boxes:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "name": "Ancha",
        "version": ANCHA_VERSION,
        "checkpoint": CHECKPOINT.name,
        "chemCheckpoint": CHEM_CHECKPOINT.name,
        "modes": ["auto", "math", "chem", "text"],
        "textEngine": "apple-vision" if _vision_ready() else None,
        "collected": _corrections_count(),
        "accepted": _accepted_count(),
        # Deprecated aliases, kept one release so an older client or a pasted
        # curl from the docs still reads what it expects.
        "model": CHECKPOINT.name,
        "chemModel": CHEM_CHECKPOINT.name,
    }


def _vision_ready() -> bool:
    """Whether a text engine exists on this box. Cheap after warmup()."""
    try:
        vision_layout.warmup()
        return True
    except Exception:
        return False


@app.post("/recognize", response_model=RecognizeResponse, response_model_exclude_none=True)
def recognize(req: RecognizeRequest):
    if req.mode == "auto":
        return recognize_auto(req)

    strokes, _ = _kept_strokes(req.strokes)
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
                detail="Ancha needs Apple Vision for text mode (macOS dev server / iPad on-device)",
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


def _decode_one(strokes: list[dict], *, chem: bool) -> tuple[str, float]:
    """Decode one group of strokes as a single expression — the operation both
    the legacy modes and every math segment of `auto` are built from."""
    model, tokenizer = (CHEM_MODEL, CHEM_TOKENIZER) if chem else (MODEL, TOKENIZER)
    image = torch.from_numpy(strokes_to_array(strokes)).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        seqs, mean_logp = model.greedy_decode(image, max_len=160)
    return tokenizer.decode(seqs[0]), float(torch.exp(mean_logp[0]).clamp(0.0, 1.0))


# NOTE — there is deliberately NO geometric fast path here.
#
# The plan called for one ("single line, no internal gap > 1.0 x-height -> skip
# the layout pass and decode as one expression"), and it is wrong: measured on
# 120 real MathWriting test expressions, a single formula spans a median 7.3
# x-heights and up to 18.5, while the reference MIXED page ("LET" + a formula +
# "BE TRUE") spans 13.7 — the distributions overlap, and both true word gaps in
# that page (0.85 and 0.70 xh) sit BELOW the 1.0 xh split threshold. The gate
# therefore fired on genuinely mixed ink and returned the whole line as one
# garbage formula. That is the same finding that made this design Vision-led in
# the first place: stroke geometry alone cannot tell a word space from a space
# inside an expression.
#
# The full path costs a Vision call (~180 ms) plus one decode for a lone
# formula, comfortably inside the 800 ms auto-convert debounce, so the fast path
# was buying very little and risking a silent misread of every short mixed note.


def recognize_auto(req: RecognizeRequest) -> RecognizeResponse:
    """The unified read: prose and formulas in one page of ink, no mode picking.

    Never raises for a missing text engine — `recognize_unified` degrades to
    geometry-only and flags every segment `degraded`. Only the legacy
    `mode:"text"` still answers 501, because there the user asked for exactly
    the thing that is unavailable.
    """
    strokes, _ = _kept_strokes(req.strokes)
    if not strokes:
        return RecognizeResponse(latex="", confidence=0.0, source="", segments=[], lines=[])

    page_breaks = tuple(req.pageBreaks or ())

    # `recognize_unified` wants the request array WHOLE (point-less strokes
    # included) so its segment indices are the client's indices.
    whole = [{"x": s.x, "y": s.y, "t": s.t} for s in req.strokes]
    segments, source, confidence, engine = unified.recognize_unified(
        whole,
        chem=req.chem,
        page_breaks=page_breaks,
        overrides=req.overrides or (),
        model=MODEL,
        tokenizer=TOKENIZER,
        chem_model=CHEM_MODEL,
        chem_tokenizer=CHEM_TOKENIZER,
        device=DEVICE,
        engine_name=CHECKPOINT.name,
    )

    seen: dict[int, tuple] = {}
    for seg in segments:
        seen.setdefault(seg.line, seg.box)
    return RecognizeResponse(
        # `latex` carries the assembled source so a client that only knows the
        # old two-field contract still gets something it can render.
        latex=source,
        confidence=confidence,
        source=source,
        segments=[
            SegmentOut(
                id=seg.id,
                line=seg.line,
                page=seg.page,
                kind=seg.kind,
                text=seg.text,
                latex=seg.latex,
                visionText=seg.vision_text,
                confidence=seg.confidence,
                box=_box_out(seg.box),
                strokes=list(seg.strokes),
                sourceStart=seg.source_start,
                sourceEnd=seg.source_end,
                degraded=seg.degraded,
            )
            for seg in segments
        ],
        lines=[
            LineOut(index=i, page=next(s.page for s in segments if s.line == i), box=_box_out(box))
            for i, box in sorted(seen.items())
        ],
        engine=engine,
    )


class SegmentRequest(BaseModel):
    strokes: list[Stroke]
    kind: Literal["text", "math", "chem"]


@app.post("/recognize/segment", response_model=RecognizeResponse, response_model_exclude_none=True)
def recognize_segment(req: SegmentRequest):
    """Re-read ONE run under the kind the user picked.

    The math->text direction is deliberately NOT served here: reading an
    isolated word without its line's context returns no observation at all, so
    the client flips that direction by splicing the `visionText` it already
    holds. This endpoint exists for the text->math/chem direction, where a fresh
    decode is both possible and necessary.
    """
    strokes, _ = _kept_strokes(req.strokes)
    if not strokes:
        return RecognizeResponse(latex="", confidence=0.0)
    if req.kind == "text":
        try:
            text, confidence = recognize_text(strokes)
        except VisionUnavailable:
            raise HTTPException(
                status_code=501,
                detail="Ancha needs Apple Vision to read words (macOS dev server / iPad on-device)",
            )
        return RecognizeResponse(latex=text, confidence=confidence, source=text)
    decoded, confidence = _decode_one(strokes, chem=req.kind == "chem")
    latex, _kind = unified.interpret_math(decoded, chem=req.kind == "chem")
    return RecognizeResponse(latex=latex, confidence=confidence, source=f"\\({latex}\\)")


class CollectRequest(BaseModel):
    strokes: list[Stroke]
    label: str = Field(min_length=1)  # the CORRECT LaTeX the user typed
    predicted: str | None = None  # what the model guessed (for error analysis)
    # "mixed" is accepted so a corrected PAGE is never dropped on the floor: the
    # user edits the assembled reading as one string, and there is no way to
    # attribute that edit back to individual runs, so it cannot be split into
    # trainable children the way /collect/mixed does. Stored whole instead —
    # load_corrections() admits only math and chem, so it stays out of training
    # until someone segments it by hand, but the sample is KEPT.
    mode: Literal["math", "text", "chem", "mixed"] = "math"


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
        # Visual backup of the "drawn figure" (same renderer the model sees).
        _persist([record], CORRECTIONS_JSONL, CORRECTIONS_IMG_DIR)
        count = _corrections_count()

    return CollectResponse(ok=True, id=sample_id, count=count)


class MixedChild(BaseModel):
    """One corrected run of a mixed page: the ink indices it covers, plus the
    label the user settled on."""

    strokes: list[int]
    label: str = Field(min_length=1)
    predicted: str | None = None
    kind: Literal["text", "math", "chem"]


class MixedCollectRequest(BaseModel):
    strokes: list[Stroke]
    source: str = Field(min_length=1)  # the whole corrected page
    predicted: str | None = None  # what Ancha assembled before the fix
    segments: list[MixedChild]


@app.post("/collect/mixed", response_model=CollectResponse)
def collect_mixed(req: MixedCollectRequest):
    """Save a corrected unified page as training data.

    Written as ONE parent (`mode:"mixed"`, the whole page and its source — kept
    for the review UI and for layout research) plus one CHILD per segment,
    shaped byte-for-byte like a /collect record so the existing dataset loader
    consumes them with no special case. The children carry only their own ink,
    re-based to their own origin, because that is the geometry the decoder is
    trained on.

    The parent is deliberately NOT trainable: `src/dataset.py` admits only
    modes math and chem, so a page of prose can never reach the math decoder —
    which matters because corrections are oversampled x32 in a training run.
    Everything happens under one lock: a crash must not leave orphan children.
    """
    if not req.segments:
        raise HTTPException(status_code=400, detail="no segments to save")
    all_strokes = [{"x": s.x, "y": s.y, "t": s.t} for s in req.strokes]

    parent_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    records: list[dict] = [
        {
            "id": parent_id,
            "ts": now,
            "label": req.source.strip(),
            "predicted": req.predicted,
            "mode": "mixed",
            "image": None,  # filled below when the page renders
            "strokes": [s for s in all_strokes if s["x"]],
        }
    ]
    for child in req.segments:
        ink = [all_strokes[i] for i in child.strokes if 0 <= i < len(all_strokes) and all_strokes[i]["x"]]
        if not ink:
            continue
        records.append(
            {
                "id": uuid.uuid4().hex,
                "ts": now,
                "label": child.label.strip(),
                "predicted": child.predicted,
                "mode": child.kind,
                "image": None,
                "parent": parent_id,
                "strokes": _rebase(ink),
            }
        )

    with _collect_lock:
        _persist(records, CORRECTIONS_JSONL, CORRECTIONS_IMG_DIR)
        count = _corrections_count()

    return CollectResponse(ok=True, id=parent_id, count=count)


def _rebase(strokes: list[dict]) -> list[dict]:
    """Translate a segment's ink to its own origin and t=0.

    A run cut out of a page still carries the page's offsets; the decoder only
    ever saw glyphs at their own origin, and /collect samples are replayed as
    training data verbatim, so the child must look like something drawn alone.
    """
    xs = [v for s in strokes for v in s["x"]]
    ys = [v for s in strokes for v in s["y"]]
    ts = [v for s in strokes for v in s["t"]]
    if not xs:
        return strokes
    x0, y0, t0 = min(xs), min(ys), min(ts)
    return [
        {
            "x": [round(v - x0, 2) for v in s["x"]],
            "y": [round(v - y0, 2) for v in s["y"]],
            "t": [round(v - t0, 1) for v in s["t"]],
        }
        for s in strokes
    ]


# ── Accepted samples: ink the user inserted without editing ─────────────────


class AcceptedSegment(BaseModel):
    """One run of a unified reading, as Ancha segmented it. Same shape as
    MixedChild minus `predicted` — for an accepted sample the prediction IS
    the label."""

    strokes: list[int]
    label: str = Field(min_length=1)
    kind: Literal["text", "math", "chem"]


class AcceptedRequest(BaseModel):
    strokes: list[Stroke]
    label: str = Field(min_length=1)  # exactly what the user inserted
    mode: Literal["math", "text", "chem", "mixed"] = "math"
    confidence: float | None = None  # Ancha's own confidence, for later filtering
    segments: list[AcceptedSegment] | None = None


@app.get("/collect/accepted")
def accepted_count():
    return {"count": _accepted_count()}


@app.post("/collect/accepted", response_model=CollectResponse)
def collect_accepted(req: AcceptedRequest):
    """Persist ink the user INSERTED UNCHANGED — a self-labelled training pair.

    The label is Ancha's own output, ratified by the user putting it in their
    note: if she had misread it they would have fixed the line first (which
    takes the /collect correction path instead) or redrawn it. That makes these
    cheap and plentiful but WEAKER evidence than a correction — they can only
    confirm what the model already does, never teach it something new — so they
    land in their own store (see ACCEPTED_JSONL) and carry `confidence` so a
    future run can keep, say, only the ones she was unsure of and still got
    right.

    Segmented (unified) readings are written exactly like /collect/mixed: a
    non-trainable `mode:"mixed"` parent holding the whole page, plus one child
    per run re-based to its own origin, which is the geometry the decoder is
    trained on.
    """
    all_strokes = [{"x": s.x, "y": s.y, "t": s.t} for s in req.strokes]
    if not any(s["x"] for s in all_strokes):
        raise HTTPException(status_code=400, detail="no strokes to save")

    parent_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    label = req.label.strip()
    parent = {
        "id": parent_id,
        "ts": now,
        "label": label,
        "predicted": label,  # accepted: the model predicted exactly this
        "mode": req.mode,
        "source": "accepted",
        "confidence": req.confidence,
        "image": None,
        "strokes": [s for s in all_strokes if s["x"]],
    }
    records: list[dict] = [parent]
    # Children ONLY under a "mixed" parent. That parent is non-trainable (the
    # dataset loader admits math and chem alone), so the ink reaches the trainer
    # exactly once, through the children. A single-run reading is filed as the
    # parent itself — emitting a child too would hand the trainer the very same
    # ink and label twice, silently double-weighting it.
    children = req.segments or [] if req.mode == "mixed" else []
    for child in children:
        ink = [all_strokes[i] for i in child.strokes if 0 <= i < len(all_strokes) and all_strokes[i]["x"]]
        if not ink:
            continue
        child_label = child.label.strip()
        records.append(
            {
                "id": uuid.uuid4().hex,
                "ts": now,
                "label": child_label,
                "predicted": child_label,
                "mode": child.kind,
                "source": "accepted",
                "confidence": req.confidence,
                "image": None,
                "parent": parent_id,
                "strokes": _rebase(ink),
            }
        )

    with _collect_lock:
        _persist(records, ACCEPTED_JSONL, ACCEPTED_IMG_DIR)
        count = _accepted_count()

    return CollectResponse(ok=True, id=parent_id, count=count)


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


def _lan_ips() -> list[str]:
    """Addresses an iPad on the same WiFi could dial, best guess first.

    Deliberately a LIST, because there is no reliable single answer and a WRONG
    address is worse than none — you paste it into the tablet and get an opaque
    failure. Two traps this avoids:
      - resolving the hostname answers 127.0.0.1 on macOS, i.e. the very address
        that cannot work from another device;
      - the usual "UDP-connect to 8.8.8.8 and read the local end" trick reports
        the VPN interface when a VPN is up (198.18.x here), not the WiFi LAN.
    So: collect candidates, drop the ones no LAN peer can route to, and rank
    ordinary home-network ranges first.
    """
    import socket
    import subprocess

    found: list[str] = []
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:  # no packet is actually sent; this just picks an outbound interface
        s.connect(("8.8.8.8", 80))
        found.append(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    if sys.platform == "darwin":
        for iface in ("en0", "en1", "en2"):  # WiFi is usually en0, Ethernet/Thunderbolt next
            try:
                out = subprocess.run(
                    ["ipconfig", "getifaddr", iface], capture_output=True, text=True, timeout=2
                ).stdout.strip()
                if out:
                    found.append(out)
            except (OSError, subprocess.SubprocessError):
                pass

    def rank(ip: str) -> int:
        if ip.startswith("192.168."):
            return 0  # the overwhelmingly common home-router range
        if ip.startswith("10."):
            return 1
        if ip.split(".")[0] == "172" and 16 <= int(ip.split(".")[1] or 0) <= 31:
            return 2
        return 3  # VPN/benchmark/CGNAT ranges: keep, but never lead with them

    usable = [ip for ip in dict.fromkeys(found) if not ip.startswith(("127.", "169.254."))]
    return sorted(usable, key=rank) or ["<this-mac's-LAN-IP>"]


if __name__ == "__main__":
    import argparse

    import uvicorn

    # Loopback by DEFAULT: Ancha accepts unauthenticated ink from any origin
    # (CORS is "*"), so she must not appear on the network unless asked.
    # Testing on a real iPad is exactly when you have to ask — the iPad's own
    # 127.0.0.1 is not this Mac — hence:
    #     .venv/bin/python serve.py --host 0.0.0.0
    # which publishes her on the LAN. Do that on a network you trust.
    parser = argparse.ArgumentParser(description="Run Ancha, the handwriting recognizer.")
    parser.add_argument(
        "--host",
        default=os.environ.get("INK_HOST", "127.0.0.1"),
        help="interface to bind (default 127.0.0.1; use 0.0.0.0 to reach her from an iPad)",
    )
    parser.add_argument("--port", type=int, default=int(os.environ.get("INK_PORT", "8787")))
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "localhost"):
        candidates = _lan_ips()
        print("\n  Ancha is on the network — point the iPad at:")
        for ip in candidates[:3]:
            print(f"      http://{ip}:{args.port}")
        if len(candidates) > 1:
            print("  (first one is the likeliest; a VPN can add addresses no iPad can reach)")
        print("  Set it in /ink → the endpoint field in the header.\n", flush=True)

    uvicorn.run(app, host=args.host, port=args.port)
