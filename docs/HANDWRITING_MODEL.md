# Ancha — handwriting → LaTeX: the model build document

_This is the living document tracking every step of building **Ancha**, Aquarius's handwriting
recognition model. Companion: [IPAD_APP_PLAN.md](IPAD_APP_PLAN.md). Code lives in [ml/](../ml/)._

**The name.** The recognizer as a whole — the service the user talks to, all of its modes — is
**Ancha**. "Ancha's math model" is the neural net inside her; Apple Vision is a delegate she uses
for words and is never surfaced in UI copy. Checkpoint filenames (`xl.pt`), env vars
(`INK_CHECKPOINT`), the `/ink` route and the HTTP paths are unchanged: branding lives at the
reporting layer (`/health` → `{"name":"Ancha", …}`), not in the artifacts.

_Last updated: 2026-08-07 — every Insert now saves a training sample; corrections and acceptances
are collected in separate stores, and correction capture (dead since `auto` shipped) is fixed
(build log Step 14)._

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
| Math | **Ancha's own model**, trained on MathWriting (§3) | No open on-device math recognizer exists; Apple has none (verified — see §2a); this is the differentiating feature |
| Plain text | **Apple Vision framework** — ✅ LIVE in dev (2026-07-12): `ml/src/text_ocr.py` via pyobjc on macOS; iPad ships the same engine on-device | Ships with iPadOS; reads neat handwriting on-device (~70–85% on print-style, weaker on cursive); training our own would take years to match |
| Chemistry | **Separate `chem` mode** — ✅ LIVE in dev (2026-07-18): decode with the math model (own checkpoint slot `chem.pt` for a future fine-tune), then reinterpret as mhchem via `ml/src/chem_normalize.py` → `\ce{...}` (§9) | Handwritten chemistry is letters/digits/sub-sup/arrows — all in the math vocabulary; what differs is INTERPRETATION (`Sn` is tin, not `\sin`; `H_{2}O` is `H2O`). No public online-stroke chem dataset exists (§9a), so a trained-from-scratch chem model has no data anyway — synthesis is the path |
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

### 2026-07-12 — Step 9: S2-XL cloud training launched ✅ (running)
- **Training stack upgraded** for cloud GPUs, all verified locally before any paid compute:
  CUDA autocast (bf16) + GradScaler fallback, `--model-size xl` (16.4M params: 384/8/6/1536),
  `--synthetic` (396k extra samples), `--augment` (stroke-level: rotate/shear/scale/jitter +
  random pen width, worker-safe per-sample RNG — [ml/src/augment.py](../ml/src/augment.py)),
  `--corrections` mix-in (user-collected ink, oversampled), warmup+cosine LR, `--resume`,
  best-validation checkpoint keeping, grad accumulation. Runbook: [ml/cloud/README.md](../ml/cloud/README.md).
- **Quality gates before launch**: 7-item local verification suite (backward compat, all new
  flags, resume incl. old checkpoints, corrections, augment determinism, script syntax) +
  an independent adversarial code review (verdict: core trainer ship-worthy; three bootstrap-
  script findings + a per-step `.item()` GPU-sync stall — **all fixed**, sync now batched per
  flush) + a real CUDA/AMP smoke on the target GPU.
- **The run**: RunPod RTX 4090 (24 GB, 32 cores, $0.35–0.70/hr), driven entirely over SSH.
  625,910 samples (train + synthetic + corrections ×32), batch 128 bf16, 150,000 steps
  (~30 epochs), validate + checkpoint every 2,000 steps → `xl.pt` / `xl_best.pt`.
  Measured ~0.15 s/step (data-pipeline-bound at ~850 renders/s; GPU ~50%).
- **RUN COMPLETE (2026-07-13)**: 150k steps in **359.8 min (6.0 h)**, train loss 8.22 → 0.08;
  validation milestones 0.19 @10k → 0.134 @30k → 0.107 @70k → **best 0.0866 @140k** (44%
  better than the local model's 0.154). **Final benchmark, 100 unseen test expressions:
  local 32/100 exact (0.872 sim) → XL 51/100 exact (0.924 sim), +59% relative.** A mid-flight
  preview @78k (23/50 vs 13/50) had already validated the fetch+eval path. Best checkpoint
  fetched as `ml/checkpoints/xl.pt` (final-step kept as `xl_final150k.pt`); server swapped and
  verified live (unseen sample recognized at 1.00 confidence). Operator normalization and
  correction capture apply unchanged.

### 2026-07-12 — Step 10: text mode (written words → text) live in dev ✅
- **[ml/src/text_ocr.py](../ml/src/text_ocr.py)**: strokes → OCR-scale raster (256px, ink-cropped,
  pen ≈9% of letter height — Vision ignores hairlines; empirically 24px on 256px letters reads
  `HELLO` at 1.0 while 10–14px reads nothing) → `VNRecognizeTextRequest` via pyobjc. Same Apple
  engine family the iPad will run on-device, so dev behavior is representative.
- **[ml/serve.py](../ml/serve.py)** text mode now real (was 501): plain words ride the `latex`
  field of the shared contract; graceful 501 remains on non-macOS (e.g. the training pod).
- **Lab UI**: text-mode results and correction previews render as words, not KaTeX
  (`resultMode` tracked in `useRecognition`); text corrections flow into `/collect` with
  `mode:"text"`.
- **Verified in the dev session**: drew HELLO in block strokes on `/ink` (Text mode) → panel
  shows `HELLO` at 100%. Editor integration of text input is deliberately deferred —
  **iPad-only per the decision record in [MODULES.md](MODULES.md)**.

### 2026-07-12 — Step 11: operator normalization (`sin\theta` → `\sin\theta`) ✅
- User-reported: recognized trig/log/lim functions came back as bare letters (`sin\theta`),
  typeset as italic variable products. Root cause is MathWriting's **label convention** (the
  dataset itself writes `log`, not `\log`) — so retraining, including the XL run, would NOT
  fix it. Fixed deterministically at serve time instead:
  [ml/src/latex_normalize.py](../ml/src/latex_normalize.py) rewrites ~30 standard operator
  letter-runs into `\operators` with letter/backslash boundary guards (`missing`, `s_{index}`,
  already-escaped `\sin` all untouched; idempotent; 9 unit cases + end-to-end verified on a
  real `log`-containing sample). Applies to the current model AND the incoming XL model.
- **Expanded to 50 operators** (user request): amsmath set (`mod`→`\bmod` for `a≡b (mod n)`,
  `\hom`, `\injlim`, `\projlim`, `\argmin`, `\argmax`) + `\operatorname{…}` forms for names
  KaTeX lacks builtins for (`sech csch arccot arcsec arccsc sgn curl div grad rank trace lcm
  erf` — each would otherwise be a KaTeX parse error). Every mapping validated against the
  installed KaTeX (50/50 render).
- **Boundary fix** (user-reported: `ln x` / `log x` stayed italic): the decoder emits letter
  runs with NO spaces (`logx`, `nlogn`), so letter-boundary guards were dropped — this pass
  sees only math-mode decoder output, never prose. Escaped commands are protected by
  consuming whole `\command` atoms first (else `\arcsin`'s tail would become `\arc\sin`).
  `lnx`→`\ln x`, `nlogn`→`n\log n`; 18 unit cases, idempotent, e2e verified.

### 2026-07-18 — Step 12: chemistry mode — third recognition track ✅

- **Serve**: `mode:"chem"` in the `/recognize`+`/collect` contract; new
  [ml/src/chem_normalize.py](../ml/src/chem_normalize.py) reinterprets decoded LaTeX as
  mhchem (`\ce{...}`), with a validated-against-KaTeX rule table (24 self-test cases) and a
  safe math-LaTeX fallback; own checkpoint slot (`chem.pt`/`INK_CHEM_CHECKPOINT`, shares
  `xl.pt` until a fine-tune exists); `/health` reports `chemModel`. Details: §9.
- **UI**: `/ink` mode toggle Math/Chem/Text; editor ink sheet gained the symbol strip's Σ/⚗
  switch (switching re-recognizes current ink); chem corrections edit mhchem SOURCE and store
  `\ce{...}` with `mode:"chem"`; recognized `\ce` routes through `onInsertChem` (ceInner check
  wrapping the sheet's `onInsert`), landing as tagged chem blocks / ChemField splices / inline
  chem popovers.
- **Verified end-to-end in headless Chrome (14/14 checks)**: real MathWriting strokes replayed
  on `/ink` → `mode:"chem"` on the wire → `\ce{X3=2Y1T1Z1X1}` rendered via mhchem KaTeX;
  correction prefill/wrap round-trip; editor-sheet switch + insert landing in the chemistry
  editor. Screenshots + full-loop math/chem A-B against the live server; vitest 77/77,
  typecheck clean.
- **Data + eval built** (agent-verified, deterministic): chem_corpus/chem_synth/eval_chem +
  chem_proxy (§9); baselines recorded (proxy 68.4% / synth 32.7% exact — the fine-tune gap).
- **Test-set research** (54-agent verified sweep, §9a): confirmed NO public online-stroke chem
  dataset exists; EDU-CHEMC test zip (714 MB) + Chemistry SE `\ce` corpus (126 MB) fetched to
  `ml/data/chem/external/`; CCNU formulae set needs a manual Baidu download (§8 checklist).

### 2026-08-02 — Step 13: Ancha, and the unified `auto` mode ✅

The recognizer got a name and stopped asking the user what they were writing.

- **One mode instead of three.** `mode:"auto"` is now the product default: Ancha segments a page
  of ink herself and decides PER RUN whether it is prose or a formula, so "let x² be the root"
  comes back as prose with real inline math in it. The three single-interpretation modes
  (`math`/`text`/`chem`) are untouched and byte-identical — verified by diffing live responses
  against goldens captured before the change.
- **How it decides.** Two evidence sources, one layer. [ml/src/layout.py](../ml/src/layout.py)
  does deterministic geometry (union-find clustering → lines → runs, all thresholds in x-height
  units so they survive device variation); [ml/src/vision_layout.py](../ml/src/vision_layout.py)
  asks Apple Vision for the *word boundaries* it throws away today — on the reference mixed line
  its word boxes partitioned the strokes with **100% purity even though its strings were garbage**
  (`'LET VI (I×I EE TRUE'` at confidence 1.000). [ml/src/unified.py](../ml/src/unified.py) routes
  each run through a 7-rule cascade with the STRUCTURAL test above the lexical one — Vision reads
  structured math confidently and wrongly, so a fraction bar or a big operator overrules it.
- **Two measurements that shaped the design.**
  (1) Vision's word boxes are uniformly padded: measured inter-box gaps 0.163–0.164 x-heights
  where the true stroke gaps were 0.85 and 0.70. Every gap test therefore runs on **stroke
  extents**, never on Vision boxes — computing it the other way converts the genuine word "BE"
  into math. (2) Decode batching costs what its LONGEST member costs: naive batch-8 measured
  958 ms vs 863 ms serial vs 508 ms bucketed, so groups are bucketed by rendered ink width.
- **No fast path.** The plan called for one ("single line, no gap > 1.0 xh → decode as one
  expression"). It is wrong and was removed: across 120 real MathWriting expressions a lone
  formula spans a median 7.3 x-heights and up to 18.5, while the reference *mixed* page spans
  13.7 — the distributions overlap, and both true word gaps in that page sit below the split
  threshold. The gate fired on genuinely mixed ink and returned one garbage formula. Stroke
  geometry alone cannot tell a word space from a space inside an expression; that is the whole
  reason the design is Vision-led. Full path costs ~214 ms for a lone formula, ~380 ms for a
  mixed page — both inside the 800 ms auto-convert debounce.
- **Degradation is total and silent.** No Apple Vision (Linux, the training pod) means no word
  boundaries, so every run falls to math with `degraded:true` and `engine.text:null`. `auto`
  never 501s; only the legacy `text` mode still does, because there the user asked for exactly
  the thing that is missing.
- **Corrections.** Each run carries its own confidence and box, so the UI shows a chip per run
  and one click overrules Ancha. Flipping a run TO text is a pure client-side splice of the
  `visionText` already in hand — re-reading an isolated run returns *no observation at all*, so
  a round trip would lose the words. `POST /collect/mixed` stores a corrected page as a
  non-trainable parent plus per-segment children shaped exactly like existing records;
  [ml/src/dataset.py](../ml/src/dataset.py) now admits only modes `math`/`chem`, which matters
  because corrections are oversampled ×32 in a training run — without that gate a page of English
  prose would reach the math decoder.
- **The canvas grew.** Three sizes (S / M / full pages); at "Page" it is a stack of A4 sheets that
  appends another as you fill the last one, mirroring the note's own pagination, with the sheet
  boundaries handed to Ancha so a line of writing is never split across two of them. One canvas
  per page (WebKit iOS caps a canvas at 4096² px — five stacked A4 sheets at dpr 2 would silently
  return a blank buffer) with a single pointer-capture overlay so a stroke crossing a seam still
  renders continuously.
- **Verified live**, not just typechecked: the legacy byte-identity gate; the mixed fixture
  decoding to exactly `\nabla I=(I_{x},I_{y})` between two prose runs with a 51/51 stroke
  partition; page breaks; stroke indices surviving an empty stroke in the request; no-Vision
  degradation; the corpus-poisoning round trip. Then in a real browser (23 checks across three
  suites): auto is the default, per-run chips render, the size control persists, writing at the
  bottom of a sheet appends another, ink in the inter-sheet gap leaves no invisible mark, clear
  gives the pages back, and a mixed reading inserts into a note as prose with typeset inline math.
- Self-tests, all gated `__main__` in the house style: `src.layout` 25 cases (including a
  ×0.37/×7.3 scale-invariance sweep and a proof the pipeline never reads the `t` channel),
  `src.unified` 14, `src.vision_layout` 9. vitest 230/230, `tsc --noEmit` clean.

### 2026-08-07 — Step 14: every insert is a training sample ✅

- **The idea (user's)**: when someone hits **Insert**, they are telling us the reading is right —
  if it were wrong they would have fixed the line first, or redrawn the ink. So the insert itself
  is a label, and the editor should be quietly harvesting one on every use. Free supervision from
  ordinary note-taking, no labelling UI, no interruption.
- **Two stores, not one.** An insert now produces *either* a correction (the user edited the
  reading → `/collect`, unchanged behavior) *or* an **acceptance** (untouched → new
  `POST /collect/accepted` → `data/accepted/accepted.jsonl`). They are kept apart deliberately:
  corrections are oversampled **x32** in a training run and each one marks a place the model was
  demonstrably wrong, whereas acceptances arrive with every insert and their label is the model's
  **own output**. Mixing them would both bury the corrections and replay the model's predictions
  back at it 32x, entrenching current behavior rather than fixing it — self-distillation with none
  of the safeguards. Same record shape, so `load_corrections()` reads the accepted file as-is
  whenever we choose to mix it in with its own (much smaller) repeat. **Nothing trains on it yet**
  — this step only starts the collection, per the decision to gather first and train once there is
  enough.
- **`confidence` is stored** with every acceptance: the interesting subset later is the samples
  Ancha was *unsure* of and still got right, and that is unrecoverable after the fact.
- **Bug found and fixed: correction capture had been dead since `auto` shipped.** The client
  stamped samples with the RECOGNITION mode, which is `"auto"` on the product path, but
  `/collect` validates `mode` against `math|text|chem` — so every correction made from the note
  editor or the lab since Step 13 was rejected 422 and silently dropped (`collect()` only checks
  `res.ok`). Confirmed against the running server, and corroborated by the corpus: **one** sample,
  dated 2026-07-11, from before `auto` existed. Fixed by separating the two vocabularies —
  `RecognitionMode` (what we ASK: `math|chem|text|auto`) from the new `SampleMode` (what a stored
  sample IS: `math|chem|text|mixed`) — and resolving one to the other *when the response lands*,
  not when the user saves, so a Σ/⚗ flip in between cannot misfile a `\ce{...}` label as math.
- **Two corpus-poisoning traps closed on the way:**
  - a unified reading is assembled as paragraph *source*, so a lone formula arrives as
    `\(x^{2}\)`. Filed verbatim it would have taught the decoder to emit delimiters it must never
    emit (MathWriting labels are bare). Labels filed as math/chem are now unwrapped —
    and a label that *still* contains `\(` after unwrapping is not one formula, so it is demoted
    to non-trainable `mode:"mixed"`: still saved, just out of the math corpus until someone splits
    it by hand. Nothing a user corrected is ever discarded.
  - a single-run reading must not be stored as both a parent and a child; children are emitted
    only under a `mixed` parent, which the dataset loader excludes, so the ink reaches the trainer
    exactly once.
- **Verified**: 16 new unit cases in `components/ink/strokes.test.ts` (vitest include widened to
  `components/**`), the endpoint driven directly for shape/dedup/gating/400s, `load_corrections()`
  confirmed to admit 3 of 5 records from a mixed sample set, and the whole path driven in a **real
  browser** — draw on the sheet, let Ancha read, hit Insert → one accepted record with rebased
  strokes, a rendered PNG and a bare label; then the edited-before-insert path → one correction
  with `predicted` preserved. Test records were deleted afterwards; the corpus is back to its
  single 2026-07-11 sample. vitest 248/248, `tsc --noEmit` clean.

## 7. Serving & deployment

- **Development**: `cd ml && .venv/bin/python serve.py` → Ancha's FastAPI at
  `http://127.0.0.1:8787`. Contract: `POST /recognize`
  `{strokes:[{x[],y[],t[],p[]}], mode:"auto"|"math"|"text"|"chem", chem?, pageBreaks?, overrides?}`
  → `{latex, confidence}` plus, for `auto`, `{source, segments, lines, engine}`;
  `POST /recognize/segment` re-reads one run under a kind the user picked;
  `GET /health` reports `{name:"Ancha", version, checkpoint, chemCheckpoint, modes, textEngine}`
  (with `model`/`chemModel` kept as deprecated aliases). Text runs use Apple Vision on macOS;
  chem returns `\ce{...}` (math-LaTeX fallback when the ink isn't chemistry-expressible).
  The ink lab at `/ink` speaks exactly this contract.
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
- [ ] **CCNU Handwritten Chemical Formulae** (§9a rank 1, the only real handwritten-formula
      test set): the Baidu Pan share needs a logged-in Baidu account — grab it manually if
      you want the offline-image benchmark (37.7 MB, code `f7wb`).

## 9. Chemistry mode (handwriting → \ce) — third recognition track

Chemistry is a separate recognition function beside math and text (shipped 2026-07-18,
build log Step 12). The user-facing story is in [CHEMISTRY.md](CHEMISTRY.md); the model
story:

- **Serving**: `mode:"chem"` decodes strokes with the chem checkpoint when one exists
  (`checkpoints/chem.pt` / `INK_CHEM_CHECKPOINT` — the drop-in slot for a fine-tune),
  else the shared math model. The decoded LaTeX is then reinterpreted as chemistry by
  [ml/src/chem_normalize.py](../ml/src/chem_normalize.py) (`latex_to_ce`):
  `2H_{2}+O_{2}\rightarrow 2H_{2}O` → `\ce{2H2 + O2 -> 2H2O}`. Operator normalization
  deliberately does NOT run in chem mode (`Sn` is tin, not `\sin`); expressions mhchem
  can't express fall back to plain math LaTeX. Every conversion rule is validated
  against the installed KaTeX+mhchem.
- **Why reuse the math model**: handwritten chemistry is letters, digits,
  sub/superscripts, parens and arrows — the math vocabulary covers every needed token
  (verified: all 26+26 letters, digits, `+ - ( ) ^ _ =`, `\rightarrow`,
  `\rightleftharpoons`, `\cdot`, `\Delta`; missing only `\uparrow`/`\downarrow` gas
  and precipitate marks). What differs is INTERPRETATION and prior (element runs like
  `NaCl` vs variable products) — the former is deterministic (chem_normalize), the
  latter is the chem fine-tune's job.
- **Synthetic chemistry ink** (no real online data exists — §9a):
  [ml/src/chem_corpus.py](../ml/src/chem_corpus.py) generates consistent
  (decoder-LaTeX, mhchem) label pairs from structured recipes — 89 curated real
  reactions + a seeded random generator over real elements/polyatomic groups, with a
  consistency gate asserting `latex_to_ce(latex) == ce` for every entry;
  [ml/src/chem_synth.py](../ml/src/chem_synth.py) stitches real MathWriting symbol
  inks (6,423 isolated glyphs incl. `\rightleftharpoons`) into equation layouts with
  sub/sup placement, isotope stacking, jitter/slant, and arc-length timestamps —
  deterministic per seed. This mirrors the only published recipe for online chem
  equations (Shen et al., ICDAR 2023 — whose own dataset was never released).
- **Evaluation**: [ml/eval_chem.py](../ml/eval_chem.py) runs the exact serve-time chem
  path in-process; metrics: `\ce` exact match, mean char similarity, conversion rate,
  and raw-decoder similarity (separates stroke-recognition error from chem
  interpretation error). Two wired test sets, complementary:
  - `data/chem/synth_test.jsonl` (300 stitched samples, seed 7) — TRUE chemistry
    labels, synthetic ink.
  - `data/chem/mathwriting_chem_proxy.jsonl` (126 samples via
    [ml/src/chem_proxy.py](../ml/src/chem_proxy.py)) — REAL human ink from the
    MathWriting test split, filtered to chemistry-shaped expressions
    (element-style shapes required; a bare arrow does not qualify).

  Baselines with `xl.pt` (no chem fine-tune yet), 2026-07-18, after the
  adversarial-review fixes:

  | test set | \ce exact | mean sim | conversion | raw sim |
  |---|---|---|---|---|
  | chem-proxy (real ink) | **69.0%** | 0.919 | 96.0% | 0.951 |
  | synth (true chem labels) | **37.7%** | 0.750 | 86.0% | 0.878 |

  Honest read: stroke recognition is fine (0.87–0.95 raw similarity); exact match on
  true chemistry collapses because the math model never saw element runs (`K`→`k`,
  isotope stacks read bottom-first). That gap is precisely what fine-tuning on
  chem_synth data into `chem.pt` addresses — the serving slot is already wired.

### 9a. Chemistry test-set survey (verified online 2026-07-18)

54-agent research pass; every claim below was adversarially re-verified at the source.
**Headline: no public ONLINE-stroke handwritten chemistry dataset exists.** The two
matching literature datasets (Shen/CVTE ICDAR 2023; Wang LCRNN ICIC 2022) were never
released — do not chase them (author email is the only route).

| Rank | Dataset | What/modality | Access (verified) | License |
|---|---|---|---|---|
| 1 | **CCNU Handwritten Chemical Formulae** | offline images of real handwritten chemical FORMULAS + transcriptions (ICDAR 2019, Zhang Ting group) | Baidu Pan `pan.baidu.com/s/16H3fGauCw-VIdzsVdN8M2w` code `f7wb`, 37.7 MB RAR — needs a Baidu account, no scripted download | academic-research-only, cite |
| 2 | **EDU-CHEMC** (iFLYTEK/USTC) | ~53k offline images: 2D structures + some reaction equations, SSML labels | public Google Drive; test zip (714,114,400 B) fetched into `ml/data/chem/external/` — see command in build log | none stated; don't redistribute |
| 3 | **MathWriting chem-proxy** | ONLINE strokes, chem-shaped math | already local; built by `src/chem_proxy.py` → 152 samples | CC BY-NC-SA 4.0 |
| 4 | **CROHME 2023** | ONLINE strokes, math (regression benchmark for chem mode) | `zenodo.org/records/8428035` CROHME23.zip 1.8 GB (md5 9eb899…) | CC BY-NC-SA 3.0 |
| 5 | **HWRT** / **Detexify** dumps | ONLINE strokes, isolated symbols incl. harpoons, `\uparrow`/`\downarrow` (absent from MathWriting) | HWRT: Zenodo 50022 tar 140 MB; Detexify: Drive sql.gz 214 MB (needs its `resourcekey`) | ODbL 1.0 (commercial-friendly) |
| 6 | **DECIMER hand-drawn** (5,088) / **ChemPixCH** (613) | offline hand-drawn 2D STRUCTURES → SMILES | Zenodo 6456306 (CC-BY 4.0) / GitHub mtzgroup (Apache-2.0) | permissive |

Label corpora for synthesis (real-world mhchem distribution): **Chemistry Stack
Exchange dump** (archive.org, 126 MB 7z, CC BY-SA 4.0 — mine `\ce{...}` from
Posts.xml; fetched into `ml/data/chem/external/`), **Wikidata P274** (~299k distinct
formulas, CC0 — the commercially clean source), Lowe **USPTO reactions** (CC0),
Wikipedia `<chem>` tags. License hygiene: MathWriting/CROHME ink is NC — same caveat
we already carry (§3); a commercially clean ink stock exists in ODbL Detexify/HWRT +
CC-BY UJI v2 if ever needed.
