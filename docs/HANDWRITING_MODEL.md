# Handwriting → LaTeX: the model build document

_This is the living document tracking every step of building Aquarius's handwriting recognition
model. Companion: [IPAD_APP_PLAN.md](IPAD_APP_PLAN.md). Code lives in [ml/](../ml/)._

_Last updated: 2026-07-09 — S0 (smoke pipeline) complete: trained checkpoint, live inference
server, CoreML export all working (build log §6)._

## 1. Objective

Convert Apple Pencil ink into LaTeX, Notability-style but LaTeX-native:

- **Math strokes** → LaTeX math (`\frac{x^2}{2} + \int_0^1 f\,dx`), rendered immediately by the
  existing KaTeX pipeline.
- **Word strokes** → plain text (which Aquarius already serializes to LaTeX).
- Input is **online handwriting**: ordered stroke point sequences `(x, y, t, pressure)` from the
  ink canvas ([components/ink/](../components/ink/)) or PencilKit — not scanned images. Stroke
  order and timing carry real signal that offline OCR throws away.

## 2. Strategy: train math, use the platform for text

| Track | Approach | Why |
|---|---|---|
| Math | **Custom model**, trained on MathWriting (§3) | No open on-device math recognizer exists; Apple has none (verified — see §2a); this is the differentiating feature |
| Plain text | **Apple Vision framework** on-device recognition | Ships with iPadOS; reads neat handwriting on-device (~70–85% on print-style, weaker on cursive); training our own would take years to match |
| Fallback | MyScript iink SDK (commercial) | Does ink-math→LaTeX today; on-device pricing is sales-gated, cloud is 2,000 free requests/mo then $10/1k. The buy option if custom quality stalls |

### 2a. What Apple provides (verified against Apple docs, 2026-07)
- **PencilKit** gives full raw stroke access (`PKStrokePoint`: location, timeOffset, force,
  azimuth, altitude — iOS 14+). Maps 1:1 onto our `/recognize` payload. This is the capture layer.
- **No math recognition API exists.** Math Notes (iPadOS 18) has no public API; Scribble is
  text-input-field-only; Vision has no `RecognizeHandwriting` request and no LaTeX output.
  Handwritten math → LaTeX must be our own model (or MyScript). This validates the build.

## 3. Training data

Primary: **Google MathWriting 2024** — the largest public online handwritten-math dataset, and
still unsuperseded as of mid-2026 (nothing newer covers *stroke* math; 2025's Tex80M is offline
images only).

| Fact | Value (verified live 2026-07-08) |
|---|---|
| Full archive | [mathwriting-2024.tgz](https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz) — 3,096,141,721 bytes (~2.9 GB), no registration |
| Excerpt | [mathwriting-2024-excerpt.tgz](https://storage.googleapis.com/mathwriting_data/mathwriting-2024-excerpt.tgz) — ~1.6 MB, used for the smoke pipeline |
| Scale | ~230k train / ~16k valid / ~8k test human-written inks + ~396k synthetic |
| Format | InkML; traces of (x, y, t) — **no pressure channel**; label in `<annotation type="normalizedLabel">` |
| Gotcha | Sampling rates 9.4–260 pts/s and coordinate ranges vary by device → normalize everything |
| Home | [google-research/mathwriting](https://github.com/google-research/google-research/tree/master/mathwriting) (old standalone repo 404s) · [paper](https://arxiv.org/abs/2404.10690) |
| **License** | **Data: CC BY-NC-SA 4.0 (NonCommercial). Code: Apache-2.0** |

> ⚠️ **Licensing flag (needs your attention before shipping, not now):** MathWriting's data — and
> CROHME's too — is licensed **non-commercial**. Perfect for this prototype and research phase;
> murky for a model inside a commercial App Store app. Options when we get there: legal read on
> trained-model status, MyScript licensing, or synthetic self-generated training data. Tracked in
> [IPAD_APP_PLAN.md §6](IPAD_APP_PLAN.md).

Evaluation/benchmark: **CROHME 2023** ([Zenodo record 8428035](https://zenodo.org/records/8428035),
open access; 3,905 new equations + all prior CROHME data) — the academic benchmark, so we can
compare against published systems. **IAM-OnDB** (13k handwritten text lines, online strokes) exists
for the text track if ever needed — registration required, research-only license.

### Published reference points (what "good" looks like)
- MathWriting paper baseline: **CTC Transformer on raw stroke sequences → 5.49% CER** on the
  MathWriting test set; Google's OCR on rasterized inks → 7.17% CER.
- CROHME offline SOTA lineage: CoMER (2022) ≈59–63% ExpRate → PosFormer/ICAL (2024) ≈60–62% →
  Tex80M/TexTeller scaling (2025) ≈86–88% — data scale beat architecture cleverness.
- Takeaway for us: a compact rasterize-then-decode model is the proven starting recipe, and a
  raw-stroke encoder is the proven upgrade path (both validated by the MathWriting baselines).

## 4. Model architecture

**v0 (this bootstrap): rendered-ink image encoder + Transformer decoder.**

```
strokes ──render (96px-high grayscale, anti-aliased polylines)──▶ image
image ──CNN encoder (downsampling conv blocks + 2D pos-enc)──▶ feature sequence
feature sequence ──Transformer decoder (4 layers, d_model 256, 8 heads)──▶ LaTeX tokens
```

- The same stroke-rasterizer runs in training and serving — no train/serve skew.
- Pressure is captured by the ink canvas but **not** consumed by the model (MathWriting has no
  pressure channel to train on).
- LaTeX tokenizer: `\commands`, braces, `^ _ &`, single chars; vocab built from the corpus.
- ~10–20M parameters — deliberately compact, because the production target is **on-device CoreML**
  (no server round-trip, ink never leaves the iPad).

Why render-to-image first, rather than a raw-stroke model: it reuses the strongest published
recipes (CROHME leaders are image-based encoder-decoders), it is robust to device/sampling
differences, and MathWriting's own baselines show it is competitive. The v1 candidate — a
stroke-sequence encoder (CTC Transformer, the 5.49%-CER recipe) — swaps in behind the same decoder
and tokenizer; the pipeline keeps raw strokes, so nothing is lost.

## 5. Training plan

| Stage | Data | Where | Purpose |
|---|---|---|---|
| S0 smoke ✅ | MathWriting excerpt | Mac (MPS) | Proved pipeline: loss decreases, checkpoint saves, server serves |
| S2 full train ✅ (2026-07-12) | Full MathWriting human set (230k) | Mac (MPS), 105 min | **Done locally** — valid 0.154, 26% exact / 0.864 similarity on unseen test. `checkpoints/full.pt`, live in the app |
| S2-XL | + 396k synthetic, bigger model, augmentation | **Cloud GPU — your call, see §8** | The quality jump: expect large exact-match gains from scale |
| S3 finetune + benchmark | CROHME 2023 + `/collect`-ed user corrections | Cloud/Mac | ExpRate comparability + adapt to real Aquarius users' writing |

Metrics: CER on MathWriting valid/test; ExpRate on CROHME 2023 for comparison with the literature.

## 6. Build log — every step

> Newest entries at the bottom. Each entry: what was done, exact commands, result.

### 2026-07-08 — Step 1: environment audit
- Xcode 26.1 installed; **iOS simulator runtime missing** → `xcodebuild -downloadPlatform iOS`
  started in background; `xcodebuild -runFirstLaunch` completed.
- Python 3.11.13 (pyenv), no PyTorch yet → dedicated venv at `ml/.venv`.
- Hardware: Apple M2 Max, 32 GB RAM, 204 GB free disk → fine for S0/S1 (MPS), not for S2.

### 2026-07-08/09 — Step 2: dataset & literature verification (research pass)
- Both MathWriting archive URLs verified live with `curl -sI` (sizes above); registration-free.
- License verified from the README: **data CC BY-NC-SA 4.0** — flagged in §3.
- Label location confirmed (`normalizedLabel`), no pressure channel, device-variance gotchas noted.
- SOTA survey (CoMER → PosFormer/ICAL → Tex80M; MathWriting CTC-Transformer 5.49% CER) — §3.
- Verified Apple platform reality (no math API; PencilKit gives strokes; Scribble/Vision limits) — §2a.
- CROHME 2023 located on Zenodo (open) and TC11 (account required). One unverified item: Zenodo
  file sizes (zenodo.org unreachable from this network at check time).

### 2026-07-09 — Step 3: pipeline construction (`ml/`) ✅ S0 complete
- `ml/.venv` provisioned: **torch 2.12.1, fastapi 0.139.0, uvicorn 0.51.0, pillow 12.3.0,
  numpy 2.4.6, coremltools 9.0**; `ml/requirements.txt` + `requirements-export.txt` written.
  (The first build agent died mid-run after venv setup; a continuation run completed everything.)
- **Data**: excerpt downloaded (1.6 MB) and extracted to `ml/data/mathwriting-2024-excerpt/` —
  500 InkML files (100 each: train/valid/test/symbols/synthetic). `--full` flag documented for the
  2.9 GB set, not downloaded yet.
- **Modules** (each sanity-checked against real data): [ml/src/inkml.py](../ml/src/inkml.py)
  (parser; verified 26 strokes/780 pts + correct `normalizedLabel` on a real file),
  [latex_tokenizer.py](../ml/src/latex_tokenizer.py) (**vocab 180**, round-trip verified),
  [render.py](../ml/src/render.py) (96×768 anti-aliased rasterizer, shared by train + serve),
  [dataset.py](../ml/src/dataset.py), [model.py](../ml/src/model.py)
  (**5,478,740 params**: CNN encoder → 288×256 memory + 4-layer/8-head/d256 Transformer decoder).
- **Smoke train** ([ml/train.py](../ml/train.py)): 300 steps, batch 16, AdamW 3e-4, **MPS** —
  loss **5.85 → 0.12 in 45.2 s** (0.15 s/step). Checkpoint `ml/checkpoints/smoke.pt` (21 MB).
- **Overfit proof (end-to-end correctness)**: feeding the server strokes from a *training* file
  reproduced its ground-truth label **exactly** (`\vartheta=-\frac{log\frac{\phi_{\varsigma_1}}...`)
  at 0.94 confidence — parser → rasterizer → model → tokenizer → decode all agree. On unseen
  strokes the smoke model outputs plausible-looking gibberish, as expected from 100 samples.
- **Server** ([ml/serve.py](../ml/serve.py)): uvicorn at `127.0.0.1:8787`, left running.
  `/health` 200; `/recognize` 200 with latex+confidence (accepts and ignores the `p` channel;
  MathWriting has none); text mode → 501 with the agreed detail string; CORS `*` verified.
- **CoreML export** ([ml/export/export_coreml.py](../ml/export/export_coreml.py)): **succeeded** —
  `ink_encoder.mlpackage` (2.4 MB, max error vs torch 0.025 ≈ fp16 noise) and
  `ink_decoder_step.mlpackage` (8.4 MB, max err 0.0088). Two conversion failures were diagnosed
  and fixed (torch 2.12 vs coremltools 9.0: dynamic-shape `aten::Int` ops and traced
  `nn.MultiheadAttention` → fixed-shape wrappers + manual attention reusing trained weights,
  parity-checked to 4e-6). On-device deployment is therefore de-risked already.
- Usage documented in [ml/README.md](../ml/README.md). `.gitignore` extended so data/checkpoints/
  venv/mlpackages stay untracked while all code stays tracked (verified with `git check-ignore`).
- Known cosmetic quirk: decoded LaTeX has a space after commands (`\frac {a}` vs `\frac{a}`) —
  semantically identical.

### 2026-07-09 — Step 4: ink lab wiring (`/ink`) ✅
- Built [app/ink/page.tsx](../app/ink/page.tsx) + [components/ink/](../components/ink/)
  (`InkCanvas.tsx`, `RecognitionPanel.tsx`, `InkLab.tsx`, `strokes.ts`) in the Graphite design
  language. Pointer Events with pointer capture + `getCoalescedEvents()` for full-rate Pencil
  sampling, pressure-modulated quadratic-midpoint smoothing, pen-latch palm rejection (once a
  `pen` pointer is seen, touch no longer draws), undo/clear, Math/Text mode toggle, manual
  Convert + 800 ms debounced auto-convert, KaTeX render of the result with confidence bar and
  copyable raw LaTeX, quiet offline hint when the server is down.
- **Runtime-verified in headless Chrome (puppeteer-core)**: drawing produced non-blank canvas
  pixels (4475 → 2680 after undo → 0 after clear); offline hint shown when the server is down;
  with a mocked `/recognize`, the request body matched the API contract exactly (equal-length
  `x/y/t/p` arrays, `t[0]=0` monotonic, `p∈[0,1]`, mode toggles to `"text"`) and the KaTeX result
  + 93% confidence + Copy all rendered. Project-wide `npm run typecheck` clean.
- Known limits (deliberate): switching mode doesn't auto-re-recognize (press Convert); recognition
  URL is hardcoded to `127.0.0.1:8787` (needs a LAN-IP setting for real-iPad testing); theme
  switches recolor existing ink on next redraw.

### 2026-07-09 — Step 5: full-loop integration test ✅
- With the real dev server and the real model server both live: drew strokes on `/ink` in headless
  Chrome, pressed Convert → two HTTP 200s to `/recognize` (auto-convert + manual), model inference
  ran, and the result rendered in KaTeX with a 93% confidence bar and a copyable raw-LaTeX line.
  Zero console errors. The entire chain — canvas → contract JSON → FastAPI → rasterizer → model →
  tokenizer decode → KaTeX — works. (Output content is smoke-model gibberish by design; S1/S2
  training is what makes it *correct*.)

### 2026-07-11 — Step 6: "was it even trained?" diagnostic + correction capture ✅
- **Diagnostic** (triggered by the smoke model returning `\overline{Y}_1` for everything):
  fed the live server strokes from 6 real *training* files → **5/6 reproduced their exact
  ground-truth LaTeX** at 0.94–0.97 confidence, while a novel hand-drawn input collapsed to
  `\overline{Y}_1` (0.91). Conclusion: the model **did** train (loss 5.85→0.06, confirmed in
  `smoke_loss.txt`) but, at 100 samples / 45 s, it memorized its training set and treats
  everything else as one attractor. Undertrained by design, not broken. The fix is S2 (full
  MathWriting ~253k+396k samples), which just needs the 2.9 GB download + real training time.
- **Correction capture loop** (turns wrong results into training data): `POST /collect` in
  [ml/serve.py](../ml/serve.py) persists `{strokes,label,predicted,mode}` to
  `ml/data/corrections/collected.jsonl` + a PNG of the drawing; the `/ink` result panel gained a
  "Not right? Fix the label" editor (prefilled with the guess, live KaTeX preview). Verified
  end-to-end in headless Chrome (200, JSONL + PNG written, count increments); typecheck clean.
  **Full detail: [MODULES.md → Handwriting correction capture](MODULES.md#handwriting-correction-capture-data-collection-loop).**

### 2026-07-12 — Step 7: S2 begins — real training on the full dataset ✅ (in progress)
- **Full MathWriting downloaded + extracted** (3.1 GB in ~6.5 min): 229,864 train / 15,674
  valid / 7,644 test / 396,014 synthetic / 6,423 symbols — matches the paper's counts.
- **train.py hardened for long runs** (all verified on a 6-step dry run first): parallel
  data workers (MPS was starving on single-threaded InkML parse/render), atomic periodic
  checkpointing (`--save-every`), held-out validation (`--valid-every`), incremental
  loss/valid logs, reusable `--vocab` (full-train scan: **231 tokens**, 74 s, saved to
  `checkpoints/vocab_full.json`).
- **Run**: 50,000 steps, batch 32, 8 workers, AdamW 3e-4, MPS — measured **0.13 s/step**
  steady-state (~1.7 h total), checkpoint + validation every 2,000 steps → `checkpoints/full.pt`.
- **Curve so far**: valid loss 6.25 (init) → 0.70 @2k → 0.48 @4k → 0.29 @6k → 0.25 @8k →
  0.24 @10k → 0.23 @12k. Degenerate `||||` outputs (present @2k) gone by @4k.
- **Quality @8k on 30 unseen test expressions**: 7 exact + 11 near (≥0.8 char similarity),
  0 degenerate. Synthetic everyday inputs now recognize (drawn `x = x` → `X=X`); the
  `\overline{Y}_1` attractor is dead.
- **Server swapped onto the trained model**: `serve.py` now defaults to `full.pt` when it
  exists (`smoke.pt` remains the fallback; `INK_CHECKPOINT` still overrides). `/health` →
  `{"model":"full.pt"}`.
- **RUN COMPLETE**: 50,000 steps in **105.2 min** on the M2 Max (0.13 s/step), train loss
  6.37 → 0.10, validation 6.25 → **0.154** (plateaued ~0.15 from step 40k — converged for
  this 5.5M-param architecture/LR). **Final eval on 50 unseen test expressions: 26% exact
  match, 72% at ≥0.8 character similarity, mean similarity 0.864.** These are *hard*
  research-math expressions; everyday input (symbols, short algebra) does noticeably better.
  Server restarted on the final weights. Next quality jumps, in order of value: mix in the
  396k synthetic samples, add data augmentation, train longer/bigger on a cloud GPU (S2-XL),
  and fine-tune on `/collect`-ed user corrections.

### 2026-07-12 — Step 8: handwriting lands in the note editor ✅
- **The `/ink` flow is now a first-class editor tool**: a pencil toolbar button (new drawn
  `ink` icon) opens a bottom writing sheet ([components/ink/InkInsertPanel.tsx](../components/ink/InkInsertPanel.tsx))
  inside the note editor. Strokes auto-recognize; the result sits in an **editable LaTeX line**
  with live KaTeX preview + confidence; **Insert** feeds the editor's insertion dispatcher, so
  handwriting lands wherever it should: a focused MathLive field, a table cell, **inline math in
  the paragraph being edited**, or a fresh equation block. The sheet stays open between inserts
  (write → insert → write the next formula); editing the recognition before inserting silently
  posts the (ink, corrected-LaTeX) pair to `/collect` as training data.
- Built by a 12-agent workflow: implementation → independent runtime verification (both insertion
  paths against the live model, screenshots) → two parallel reviewers whose findings were
  adversarially verified. **8 confirmed findings, 8 fixed** (0 false positives), all re-verified
  in a real browser afterwards:
  focus-arming so editing the LaTeX line doesn't kill the block editor (`markSticky`), Escape
  pecking order (block editor first, sheet last, suppressed while other overlays are open),
  a staleness guard so Insert can't commit a recognition older than the ink (`resultSeq`
  stamping in `useRecognition`), explicit LaTeX-line reset after offline/hand-typed inserts,
  pane-`absolute` positioning (split view safe), and a `pb-[52vh]` scroll inset + auto-scroll
  so the sheet never hides the block being edited.
- Fix-verification suite: 15/15 scenarios pass (two-step Escape, stale-insert blocking,
  edit-box survival across sheet + input focus, inline popover on diverged insert, sheet
  persistence + reset, absolute positioning). One dev-only flake diagnosed as Next.js Fast
  Refresh reloading during MathLive's first lazy compile — not an app bug.

## 7. Serving & deployment

- **Development**: `cd ml && .venv/bin/python serve.py` → FastAPI at `http://127.0.0.1:8787`.
  Contract: `POST /recognize` `{strokes:[{x[],y[],t[],p[]}], mode:"math"|"text"}` →
  `{latex, confidence}`; `GET /health`; text mode returns 501 until it routes to Apple Vision.
  The ink lab at `/ink` speaks exactly this contract (verified above).
- **Production**: export to CoreML ([ml/export/](../ml/export/)), embed in the Capacitor iOS shell
  behind a small Swift plugin exposing the same contract to the web layer; text mode routes to
  Apple Vision in the same plugin. No user ink ever leaves the device.

## 8. What you need to do (model-specific)

- [ ] Nothing yet for S0/S1 — they run on this Mac.
- [ ] **S2 (full training)**: choose cloud GPU (Lambda/RunPod A100-class, ~$1–3/hr, low tens of
      hours) when S1 looks good — or accept a much slower multi-day MPS run locally.
- [ ] **Licensing decision before shipping** (not now): MathWriting/CROHME are non-commercial
      licensed — legal read vs MyScript license vs synthetic data. See §3 flag.
- [ ] Try the ink lab on your real iPad + Pencil (plan doc §3b) and tell me how stroke feel
      compares to Notability — latency and palm rejection tuning need human judgment.
