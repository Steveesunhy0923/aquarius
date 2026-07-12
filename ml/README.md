# ml/ — handwriting → LaTeX recognition

Small encoder-decoder model (CNN + Transformer decoder, ~5.5M params) trained
on Google's [MathWriting 2024](https://github.com/google-research/mathwriting)
online-handwriting dataset, served over the HTTP contract the `/ink` web UI
already speaks.

Everything runs from the `ml/` directory with the local venv
(`ml/.venv`, Python 3.11). `ml/data/`, `ml/checkpoints/`, `ml/.venv/` and
exported `.mlpackage`s are gitignored.

## Setup

```bash
cd ml
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
# only needed for CoreML export:
.venv/bin/pip install -r requirements-export.txt
```

## Download the dataset

```bash
.venv/bin/python data/download_mathwriting.py          # excerpt (~1.6 MB, 500 samples)
.venv/bin/python data/download_mathwriting.py --full   # full dataset (~2.9 GB!)
```

Extracts to `data/mathwriting-2024-excerpt/` (or `data/mathwriting-2024/`)
with `train/ valid/ test/ symbols/ synthetic/` directories of `.inkml` files.
Labels come from `<annotation type="normalizedLabel">` (fallback `label`).
Traces are `(x, y, t)` triples — no pressure channel.

## Sanity checks (each module is runnable)

```bash
.venv/bin/python -m src.inkml data/mathwriting-2024-excerpt/train/<file>.inkml
.venv/bin/python -m src.latex_tokenizer     # builds checkpoints/vocab.json
.venv/bin/python -m src.render data/mathwriting-2024-excerpt/train/<file>.inkml out.png
.venv/bin/python -m src.dataset
.venv/bin/python -m src.model               # prints param count
```

## Train

```bash
# smoke run (~45 s on M2 Max MPS): proves the plumbing, overfits 100 samples
.venv/bin/python train.py --steps 300 --batch-size 16

# options: --lr 3e-4  --device auto|mps|cpu  --data <dir>  --out <ckpt>  --max-len 160
```

Writes `checkpoints/smoke.pt` (weights + vocab + config),
`checkpoints/smoke_loss.txt`, and `checkpoints/vocab.json`.
A real model needs the `--full` dataset and a proper training schedule.

## Serve

```bash
.venv/bin/uvicorn serve:app --host 127.0.0.1 --port 8787
# env: INK_CHECKPOINT=checkpoints/smoke.pt  INK_DEVICE=cpu
```

API (contract used by the web `/ink` client — do not change):

- `POST /recognize` — `{"strokes": [{"x": [..], "y": [..], "t": [..], "p": [..]?}], "mode": "math"|"text"}`
  (x/y CSS pixels, t ms; `p` accepted and ignored) →
  `{"latex": "...", "confidence": 0..1}`. `"text"` mode → HTTP 501
  (will use Apple Vision on-device).
- `GET /health` → `{"status":"ok","model":"smoke.pt"}`
- CORS: all origins.

Quick test:

```bash
curl http://127.0.0.1:8787/health
curl -X POST http://127.0.0.1:8787/recognize -H 'Content-Type: application/json' \
  -d '{"strokes":[{"x":[10,60,110],"y":[80,20,80],"t":[0,120,240]}],"mode":"math"}'
```

## CoreML export (best effort)

```bash
.venv/bin/python export/export_coreml.py --checkpoint checkpoints/smoke.pt
```

Produces `export/ink_encoder.mlpackage` (image → memory) and
`export/ink_decoder_step.mlpackage` (memory + padded token buffer → logits
for all positions; the greedy loop lives on the app side). coremltools 9.0
officially supports torch ≤ 2.7 while this venv has 2.12.1 — the conversion
works only via the export-friendly wrappers documented at the top of
`export/export_coreml.py` (fixed shapes, manual attention, no key-padding
mask).

## Layout

```
data/download_mathwriting.py  dataset fetch/extract (excerpt or --full)
src/inkml.py                  namespaced InkML parser -> strokes + label
src/latex_tokenizer.py        LaTeX tokenizer + vocab (<pad>/<sos>/<eos>/<unk>)
src/render.py                 strokes -> 96x768 grayscale image (shared by train & serve)
src/dataset.py                torch Dataset + collate
src/model.py                  CNN encoder + TransformerDecoder + greedy_decode
train.py                      training CLI
serve.py                      FastAPI recognition server (port 8787)
export/export_coreml.py       CoreML conversion of encoder + decoder step
```
