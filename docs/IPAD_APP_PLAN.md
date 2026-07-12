# Aquarius on iPad — plan & testing environment

_Last updated: 2026-07-08 (initial bootstrap). Companion document: [HANDWRITING_MODEL.md](HANDWRITING_MODEL.md) — the handwriting→LaTeX model build log._

## 1. Goal

Ship Aquarius as an iPad app on the App Store, with a Notability-style pencil experience where
**everything you write — words and math — converts to rendered LaTeX**. LaTeX stays the output
format (the core Aquarius principle); the Apple Pencil becomes a new input format.

## 2. Architecture decision: Capacitor shell (not a rewrite)

Aquarius is a client-side, local-first Next.js app (IndexedDB storage, Supabase sync, KaTeX/MathLive
rendering, a custom structural math editor). The pragmatic path to the App Store is a **native shell
around the existing web app** using [Capacitor](https://capacitorjs.com) (installed: **7.6.7**, Swift
Package Manager mode — no CocoaPods on this machine, none needed):

- **Reuses ~100% of the existing app** — editor, sync, collab, the graphite redesign.
- **Native access where it matters**: an ink/PencilKit layer, CoreML for on-device recognition,
  haptics, file export — all reachable via Capacitor plugins (Swift).
- Alternatives rejected: React Native / SwiftUI rewrite (months of duplicated editor work),
  PWA-only (no App Store presence, no CoreML, no low-latency pencil pipeline).

The repo layout after bootstrap:

| Piece | Where | What it is |
|---|---|---|
| iOS shell | `ios/` + [capacitor.config.ts](../capacitor.config.ts) | Xcode project that loads the web app |
| Ink lab | [app/ink/page.tsx](../app/ink/page.tsx), [components/ink/](../components/ink/) | Pencil canvas + convert-to-LaTeX testbed |
| Recognition model | [ml/](../ml/) | Training pipeline + local inference server |

## 3. The iPad testing environment

Three ways to test, from fastest to most faithful:

### 3a. Desktop browser — instant
```bash
npm run dev
# open http://localhost:3000/ink   ← the ink lab (draw with mouse/trackpad)
```

### 3b. Real iPad, no app install — 30 seconds
The dev server is reachable over your LAN. On the iPad, open Safari and visit
`http://<your-Mac's-IP>:3000/ink` (find the IP with `ipconfig getifaddr en0`).
**Apple Pencil works in Safari** — pointer events deliver pencil input with pressure,
so stroke capture and recognition can be tested on real hardware immediately.
(Recognition calls go to the ML server on the Mac; the ink lab points at `127.0.0.1:8787`,
so for on-iPad testing the recognition endpoint must be made configurable — noted as a follow-up.)

### 3c. iPad Simulator / native shell — the real thing
```bash
npm run dev            # terminal 1 — the web app
npm run ios:open       # opens ios/App in Xcode → pick an iPad simulator → Run
```
The shell loads `http://localhost:3000` (the simulator shares the Mac's network).
For a **physical iPad** via USB/WiFi: `CAP_SERVER_URL=http://<Mac-IP>:3000 npm run ios:sync`,
then run on the device from Xcode (requires a free Apple ID at minimum for signing).

Shell configuration facts (all verified during bootstrap):
- [capacitor.config.ts](../capacitor.config.ts): appId `com.stevee.aquarius` (placeholder),
  webDir `shell/www` (placeholder page), server URL `http://localhost:3000` overridable via
  `CAP_SERVER_URL`; setting `CAP_STATIC=1` drops the server block entirely for future
  static-export production builds. All three modes verified against the generated config.
- iPad supported out of the box (`TARGETED_DEVICE_FAMILY = "1,2"`), deployment target iOS 14.
- A narrow ATS exception (`NSAllowsArbitraryLoadsInWebContent`) was added to `ios/App/App/Info.plist`
  so a real iPad can load the dev server over plain LAN HTTP; native networking keeps full ATS.
- Known quirk: `@capacitor/cli` 7.6.7 has a case-sensitivity bug in `cap add ios --packagemanager SPM`
  (it demands CocoaPods). It was worked around with a temporary, since-reverted patch; only matters
  if `ios/` is ever deleted and re-added.
- The iOS simulator **runtime** (iOS 26.1, 7.8 GB — a separate download since Xcode 26 ships
  without it) is installed and registered; `xcodebuild … -destination 'generic/platform=iOS
  Simulator' build` → **BUILD SUCCEEDED**, and the app was installed and launched on the
  "iPad Pro 13-inch (M5)" simulator with the home/library screen rendering correctly.
- Follow-ups found by this first on-iPad run:
  - **Status-bar overlap**: the web view extends under the iPad status bar (clock/battery covers
    the app header). Fix: `viewport-fit=cover` + `env(safe-area-inset-*)` padding in the app
    header, or constrain the Capacitor web view to the safe area.
  - On a **real iPad**, the ink lab's recognition endpoint (`127.0.0.1:8787`) points at the iPad
    itself — it needs the same LAN-IP treatment as the dev server.

## 4. Handwriting → LaTeX (the headline feature)

Full detail in [HANDWRITING_MODEL.md](HANDWRITING_MODEL.md). Summary of the two-track strategy:

1. **Math (custom model)** — encoder-decoder trained on Google's **MathWriting 2024** dataset
   (the largest public online-handwriting math dataset). Served locally during development
   (FastAPI on `127.0.0.1:8787`), exported to **CoreML** for on-device inference in production.
2. **Plain text (platform model)** — Apple's Vision framework recognizes handwritten text
   on-device for free; no training needed. We route "text mode" strokes there in the native shell.
3. **Commercial fallback** — MyScript iink SDK (what Notability-class apps license) does both,
   at a licensing cost. Documented as the buy-vs-build option if model quality stalls.

## 5. Path to the App Store

1. **Now** — testing environment (this bootstrap): shell + ink lab + model pipeline. ✅
2. **Beta** — static export of the web app bundled into the shell (offline-first, no dev server):
   requires reworking `app/editor/[id]` to a client-resolved route (`output: 'export'` cannot
   enumerate local-first note ids at build time). Then TestFlight — 100 internal testers with no
   review; up to 10,000 external testers after a lighter Beta App Review; builds expire after 90 days.
3. **Review-proofing ([guideline 4.2](https://developer.apple.com/app-store/review/guidelines/),
   "minimum functionality")** — a pure web wrapper risks rejection, and reviewers literally test
   offline (Airplane Mode → blank webview = instant flag). Our mitigations are exactly what
   reviewers look for: offline local-first storage that genuinely works, native Pencil ink layer,
   on-device CoreML recognition, iPad-specific UI. The offline requirement makes the static-export
   step (2) a hard prerequisite for submission, not a nice-to-have.
4. **Submission** — App Store Connect listing, privacy policy URL, privacy nutrition labels
   (Supabase account data), screenshots (12.9" and 11" iPad), review notes.
5. **Training-data licensing** — before shipping the math recognizer commercially, resolve the
   MathWriting/CROHME non-commercial license question (see
   [HANDWRITING_MODEL.md §3](HANDWRITING_MODEL.md)): legal read, MyScript license (on-device
   pricing is sales-quoted; cloud tier is 2,000 free requests/month then $10 per 1,000), or
   synthetic training data.

## 6. What you (Steve) need to do

- [ ] **Nothing for simulator testing** — signing is not required for the simulator.
- [ ] **Real-iPad testing**: add your Apple ID in Xcode → Settings → Accounts (free), then select
      it under Signing & Capabilities for the App target. iPadOS 16.4+ device with Developer Mode on.
- [ ] **App Store / TestFlight**: enroll in the [Apple Developer Program](https://developer.apple.com/programs/) — $99/year. Pick the final bundle id (currently the placeholder `com.stevee.aquarius`) — changing it later before first upload is trivial.
- [ ] **Model training compute**: the M2 Max can smoke-train and overfit small sets, but full
      MathWriting training (~400k samples) realistically wants a cloud GPU (a single A100/H100 or
      a 4090 on Lambda/RunPod — roughly $1–3/hr, expect low tens of hours). Decision needed when
      we get there; everything until then runs locally.
- [ ] **Dataset registrations** (only if/when we add plain-text training data): IAM-OnDB requires
      a free academic registration. MathWriting needs none.
- [ ] Optional: a decision later on **MyScript licensing** if we want commercial-grade recognition
      faster than we can train it.

## 7. Status log

- **2026-07-08** — Bootstrap started: environment audit (Xcode 26.1 present, iOS simulator runtime
  download started, Python 3.11, M2 Max/32GB).
- **2026-07-09** — Capacitor 7.6.7 iOS shell scaffolded and synced (SPM, iPad-enabled, ATS dev
  exception). `/ink` pencil lab built and runtime-verified in a real browser (stroke capture,
  undo/clear, offline hint, contract-exact `/recognize` payloads, KaTeX result rendering);
  `npm run typecheck` clean. Research pass verified datasets/licenses/SOTA/App-Store facts.
  `ml/` pipeline complete with smoke-trained model, live recognition server, and working CoreML
  export — details in [HANDWRITING_MODEL.md §6](HANDWRITING_MODEL.md). Full-loop browser test:
  draw on `/ink` → model server → KaTeX render, zero console errors.
- **2026-07-09 (later)** — iOS 26.1 simulator runtime installed (first download attempt was killed
  by a machine reboot; second attempt succeeded, 7.8 GB registered). **`xcodebuild` BUILD
  SUCCEEDED**; Aquarius installed and launched on the iPad Pro 13-inch (M5) simulator against the
  dev server — home/library screen verified by screenshot. Found: status-bar safe-area overlap
  (see §3c follow-ups). The iPad testing environment is fully operational.
