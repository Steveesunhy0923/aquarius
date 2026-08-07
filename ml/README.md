# ml/ — Ancha, the handwriting → LaTeX model

**Ancha** is Aquarius's handwriting recognizer. At her core is a small
encoder-decoder model (CNN + Transformer decoder, ~5.5M params) trained on
Google's [MathWriting 2024](https://github.com/google-research/mathwriting)
online-handwriting dataset, served over the HTTP contract the `/ink` web UI
already speaks.

Her headline mode is **`auto`**: the user writes words and formulas together
and never picks a mode. Ancha segments the page geometrically (`src/layout.py`),
asks Apple Vision for the word boundaries (`src/vision_layout.py`), decides per
run whether it is prose or a formula, decodes the formulas with her own model,
and assembles the lot into the app's paragraph source — prose with `\( … \)`
inline math (`src/unified.py`). With no text engine on the platform she
degrades to geometry-only rather than failing.

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
.venv/bin/python -m src.latex_normalize     # 18 operator-normalization cases
.venv/bin/python -m src.chem_normalize      # 26 mhchem conversion cases
.venv/bin/python -m src.layout              # 25 segmentation cases (pure geometry, no torch)
.venv/bin/python -m src.vision_layout       # Vision layout analysis (skips off macOS)
.venv/bin/python -m src.unified             # 14 router/assembly cases (no checkpoint needed)
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

## Serve (run Ancha)

```bash
.venv/bin/uvicorn serve:app --host 127.0.0.1 --port 8787
# env: INK_CHECKPOINT=checkpoints/smoke.pt  INK_DEVICE=cpu
```

API (contract used by the web `/ink` client — do not change):

- `POST /recognize` — `{"strokes": [{"x": [..], "y": [..], "t": [..], "p": [..]?}], "mode": "math"|"text"|"chem"}`
  (x/y CSS pixels, t ms; `p` accepted and ignored) →
  `{"latex": "...", "confidence": 0..1}`. `"text"` mode runs Apple Vision on
  macOS (HTTP 501 elsewhere). `"chem"` mode decodes with `checkpoints/chem.pt`
  when present (`INK_CHEM_CHECKPOINT` overrides; falls back to the math model)
  and reinterprets the result as chemistry via `src/chem_normalize.py` →
  `\ce{2H2 + O2 -> 2H2O}`; non-chemistry ink falls back to plain math LaTeX.
- `GET /health` → `{"status":"ok","name":"Ancha","version":"1.0","checkpoint":"xl.pt","chemCheckpoint":"xl.pt","modes":["auto","math","chem","text"],"textEngine":"apple-vision","collected":N,"accepted":M}`
- `POST /collect` — a CORRECTION: the user overruled Ancha, so the label is
  ground truth. → `data/corrections/collected.jsonl`.
- `POST /collect/accepted` — an ACCEPTANCE: the user inserted Ancha's reading
  unchanged, so the label is her own output, ratified by use.
  → `data/accepted/accepted.jsonl` (same record shape, separate file).
  Body adds `confidence`, and `segments` for a mixed page.
- CORS: all origins.

**Why two stores.** Corrections are oversampled **x32** in a training run
(`--corrections-repeat`), because there are only ever a handful and each one is
a place the model was demonstrably wrong. Acceptances arrive with *every*
insert, and their label is what the model already predicts — replaying those at
x32 would drown the corrections and entrench current behavior instead of
correcting it. Same shape, so `src/dataset.py`'s `load_corrections()` reads the
accepted file as-is whenever we choose to mix it in, with its own (much
smaller) repeat. Nothing reads it during training today.

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

## Chemistry mode: synth data + evaluation

No public online-stroke chemistry dataset exists (docs/HANDWRITING_MODEL.md §9a),
so chemistry ink is synthesized from real MathWriting symbol strokes and the chem
path is benchmarked on that plus a real-ink proxy set:

```bash
.venv/bin/python -m src.chem_corpus         # corpus self-test (latex/ce consistency gate)
.venv/bin/python -m src.chem_synth --out data/chem/synth_test.jsonl --n 300 --seed 7
.venv/bin/python -m src.chem_proxy          # chem-shaped real ink from the MathWriting test split
.venv/bin/python eval_chem.py data/chem/synth_test.jsonl
.venv/bin/python eval_chem.py data/chem/mathwriting_chem_proxy.jsonl
```

`eval_chem.py` runs the exact serve-time chem path (render → decode → `latex_to_ce`)
and reports `\ce` exact match, char similarity, conversion rate, and raw-decoder
similarity; it also accepts `data/corrections/collected.jsonl` (chem-mode rows).
External test sets and label corpora (EDU-CHEMC, Chemistry StackExchange `\ce`
dump, …) land in `data/chem/external/` — survey with verified URLs/licenses in
docs/HANDWRITING_MODEL.md §9a.

## Layout

```
data/download_mathwriting.py  dataset fetch/extract (excerpt or --full)
data/corrections/            samples the user CORRECTED (ground truth, trained x32)
data/accepted/               samples the user INSERTED UNCHANGED (self-labelled, untrained)
src/inkml.py                  namespaced InkML parser -> strokes + label
src/latex_tokenizer.py        LaTeX tokenizer + vocab (<pad>/<sos>/<eos>/<unk>)
src/render.py                 strokes -> 96x768 grayscale image (shared by train & serve)
src/dataset.py                torch Dataset + collate
src/model.py                  CNN encoder + TransformerDecoder + greedy_decode
src/latex_normalize.py        post-decode math cleanup (bare `log` -> \log, 50 operators)
src/chem_normalize.py         chem interpretation: decoder LaTeX -> mhchem source for \ce{...}
src/chem_corpus.py            chemical-equation label corpus (curated + seeded random; gated)
src/chem_synth.py             synthetic chemistry ink stitched from MathWriting symbol strokes
src/chem_proxy.py             chem-shaped REAL-ink test set filtered from the MathWriting test split
src/text_ocr.py               text mode via Apple Vision (macOS)
src/layout.py                 pure-geometry stroke segmentation: strokes -> lines -> runs
src/vision_layout.py          Apple Vision layout: line/word boxes mapped back into stroke space
src/unified.py                the `auto` mode: classify runs, merge, decode, assemble to source
train.py                      training CLI
serve.py                      Ancha's FastAPI server (port 8787)
eval_chem.py                  chem-mode benchmark (exact/similarity/conversion metrics)
export/export_coreml.py       CoreML conversion of encoder + decoder step
```
