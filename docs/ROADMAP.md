# Roadmap

## Release record

- **0.6.2 — Fillable fields + inline `[[` autocomplete + backlinks + corrections review**
  (branch `ui-graphite-redesign`, unreleased). **Fillable module fields**: `{{Field}}` tokens in
  module/preset prose (`lib/blocks/fields.ts`) prompt once on insert (`ModuleFieldsDialog`, wired
  into both slash-insert and template apply); unfilled tokens render as dashed placeholder chips;
  scanned via `moduleFields()`, filled purely via `fillFields()`. **Inline note-link
  autocomplete**: typing `[[` opens a search-as-you-type menu (`NoteLinkMenu`, an `EditBox` state
  machine mirroring the `/` slash menu) with a "browse / link a section" fallback to the full
  picker. **Backlinks panel**: a "Linked from" sidebar list backed by a new
  `LibraryStore.listBacklinks` (local tree-JSON scan; cloud `backlink_note_ids` function,
  migration `0010`). **Handwriting corrections review**: `serve.py` gained
  `GET /collect/samples`, `GET /collect/img/{id}`, `DELETE /collect/{id}`, surfaced as a **Review**
  dialog in the `/ink` lab (thumbnail + label + model-guess + delete). The dataset loader and
  `--corrections` mix-in flag it feeds were already shipped in 0.6.1's ML work. See
  `docs/MODULES.md` for the detailed record. Verified end-to-end in a real browser (23 assertions).
- **0.6.1 — Editable preset stacks + link previews + ML training** (branch
  `ui-graphite-redesign`). **Presets as editable stacks**: the Designs dialog's Note-layout
  cards show each preset's module stack as chips — tick modules in/out, drag to reorder,
  live preview, then insert exactly that stack (`PresetCard` in `DesignPicker`,
  `stackTree()` in `lib/templates/modules.ts`). **Orientation-aware link previews**
  (Google-Docs style): note links preview as a miniature page following the note's
  `pageLayout` (portrait/landscape card); external links unfurl via the new SSRF-hardened
  `/api/unfurl` route (first API route) into cards shaped by the page's cover-image aspect,
  with graceful no-preview fallback; shared hover plumbing in `components/ui/hovercard.ts`.
  **ML workstream**: S2-XL cloud training stack + RunPod run (bf16, augmentation,
  corrections mix-in), and /ink text mode via Apple Vision OCR (`ml/src/text_ocr.py`);
  details in `docs/HANDWRITING_MODEL.md`.
- **0.6.0 — Graphite + modular notes + note links** (branch `ui-graphite-redesign`).
  The Graphite hand-drawn UI restyle (drawn icon set, redesigned library/home, editor
  chrome split into `DocStyleBar`/`SymbolToolbar`/`ToolbarControls`/`EditBox`, new
  `components/ui/` kit with stacked-dialog Escape handling). **Modular notes**
  (`docs/MODULES.md` is the detailed record): `Module` type + built-in catalog, the five
  note templates as module stacks, `/` slash-insert menu (fuzzy, keyboard, usage-ranked),
  save-section-as-module from the outline, and a Modules tab in the Designs dialog with a
  form-based builder (create from scratch, edit/delete, customize built-ins; lossless
  round-trip; dirty-close guard). **Note links**: `[text](note://id#headingBlockId)` —
  insert via `[[` or the toolbar picker (whole note or a chosen section), hover preview
  card, click-to-open with section scroll and in-place jumps for already-open panes;
  copies rewrite self-links; LaTeX/print export as plain text. Plus the `/ink`
  handwriting→LaTeX lab with correction capture (`docs/HANDWRITING_MODEL.md`), the `ml/`
  MathWriting pipeline (code only), Capacitor iOS shell scaffolding
  (`docs/IPAD_APP_PLAN.md`), demo-library seeding, and migration `0009`.
- **0.5.0** (`14a99e0`) — MathLive fill-the-box math input + structural math editor beta.
- **0.4.x** — auth/profiles/cloud store, sharing + roles, Yjs realtime co-editing.

Status note: some "not started" rows below predate 0.5/0.6 — templates, the symbol
palette, and the full toolbar exist now; `docs/MODULES.md` supersedes this file for the
modules initiative.

## Next up (queued 2026-07-12)

The near-term build queue, in priority order:

1. **LaTeX shorthand autocomplete** (V1 step 3, still not started) — typing `\frac` / `/` etc.
   expands to the matching block rather than a raw string. The last unbuilt piece of the input
   trio (toolbar + symbol palette exist).
2. **Real PDF export** (V1 step 6) — tree → LaTeX → typeset PDF (server-side or WASM TeX);
   today output is browser-print only. Note links already degrade to plain text in export.
3. **TikZ canvas** (V1 step 10) — the scaffolded `tikz` block (`attrs.shapes`) needs a
   constrained drawing canvas; reuse the graph block's interactive-SVG→tikzpicture pattern.

### Extra targets (kept for later)

- **Dynamic / smart modules** — Table of Contents (`computeOutline`), Formula index, Flashcards
  (→ Anki export), Graph module. *(also in `docs/MODULES.md`)*
- **Per-subject default stacks** — each Subject starts new notes from its own module skeleton;
  the 0.6.1 editable-stack UI is the editor for it.
- **Shareable module packs** — move user modules off localStorage; publish/install via cloud +
  sharing infra; first step toward the template gallery + likes.
- **iPad text-mode editor integration** — the ink sheet gains a Text mode inserting recognized
  words as prose at the caret, gated to the Capacitor build, plus the LAN-IP / on-device
  recognizer endpoint (per the `docs/MODULES.md` decision record).

## 0.4 — Social platform (in progress)

Turning Aquarius from local-only into a collaborative platform. **Slice 1 (auth +
profiles + cloud documents) is implemented:** Supabase Auth (Google + email/password,
with identity linking; Apple deferred), a `profiles` table with usernames
(`supabase/migrations/0003_profiles.sql`), `owner_id default auth.uid()`
(`0004`), note soft-delete in the cloud (`0005`), and a `SupabaseLibraryStore`
(`lib/storage/cloud.ts`) that `getStore()` returns when signed in (guest stays on
IndexedDB). Realtime collaboration uses Yjs-over-Supabase-Realtime in a later
slice. **Still to build:** sharing by username + roles (viewer/commenter/editor)
and the membership-based RLS rewrite; comments + the right-side overlay drawer;
Yjs realtime co-editing; the template gallery + likes; Apple sign-in.

---

This is the intended build order. **Be precise about status:** the core loop is implemented
end-to-end — the block tree, the LaTeX/KaTeX serializer, the IndexedDB store (with `.aqnote`
export/import), the Supabase Postgres schema + RLS, and a minimal library browser and
WYSIWYG editor all exist and run. The sync engine is a type-correct **skeleton** with
reconciliation deferred, and the input-method polish (symbol palette, shorthand
autocomplete, full toolbar) plus the export/import/collaboration features are **not started**.
The tables below mark what is done versus skeleton versus not started.

## Status legend

- **done** — implemented and working (minimal/initial where noted).
- **skeleton** — a type-correct scaffold exists, but the behavior is deferred.
- **not started** — planned only.

| Area                     | Where                                | Status                                   |
| ------------------------ | ------------------------------------ | ---------------------------------------- |
| Block tree types         | `lib/blocks/types.ts`                | ✅ done (types/contracts)                 |
| LaTeX/KaTeX serializer   | `lib/blocks/serialize.ts`            | ✅ done (table-driven, all 16 block types, tested) |
| Block factory            | `lib/blocks/factory.ts`              | ✅ done (constructors + `cursorSlots()`)  |
| KaTeX render pipeline    | `components/{BlockView,Katex}.tsx`   | ✅ done (BlockView → Katex → katex)        |
| Storage model + contract | `lib/storage/types.ts`               | ✅ done (types/contracts)                 |
| IndexedDB store          | `lib/storage/local.ts`               | ✅ done (full `LibraryStore` + `.aqnote`) |
| Supabase client          | `lib/supabase/client.ts`             | ✅ done (optional, returns `null`)        |
| Supabase schema + RLS    | `supabase/migrations/`               | ✅ done (`0001_init.sql`, `0002_rls.sql`) |
| Sync engine              | `lib/sync/`                          | 🟨 skeleton (reconciliation deferred, `TODO(crdt)`) |
| Library UI               | `app/page.tsx`                       | ✅ done (minimal browser)                 |
| Editor UI                | `app/editor/[id]/page.tsx`           | ✅ done (minimal WYSIWYG)                  |

So: **the block tree, serializer, render pipeline, IndexedDB store, Supabase schema + RLS,
and a minimal library + editor are done; the sync engine is a skeleton; the symbol palette,
shorthand autocomplete, full toolbar, exports, OCR, share viewer, and collaboration are not
started.** The `yjs` dependency is installed but referenced **type-only** in the sync
skeleton.

## V1 — build order

1. **Block tree + KaTeX render.** The core loop: edit `DocumentTree`, serialize via
   `blockToKatex`, render with KaTeX.
   *Essentially in place: types (`lib/blocks/types.ts`), serializer
   (`lib/blocks/serialize.ts`), and the render component (`components/BlockView.tsx` →
   `components/Katex.tsx`) are all done.*
2. **Structure toolbar + symbol palette.** Insert fractions/roots/scripts/integrals and
   symbol atoms into the tree. *A minimal structure toolbar exists in the editor
   (fraction/root/sum/integral/text); the symbol palette is not started.*
3. **LaTeX shorthand autocomplete.** Typing `\frac` / `/` etc. expands to the matching
   block (never a raw string). *Not started.*
4. **IndexedDB + Supabase sync.** Implement the `LibraryStore` contract over IndexedDB,
   then a Supabase backend and the reconciliation engine.
   *IndexedDB store (`lib/storage/local.ts`) is done, including `.aqnote` export/import; the
   Supabase Postgres schema + RLS (`supabase/migrations/`) are done; the sync engine
   (`lib/sync/`) is a **skeleton** (reconciliation deferred); a dedicated Supabase-backed
   `LibraryStore` is not started.*
5. **Notability-style file UI.** Subject → Notebook → Note library browser over the light
   index. *A minimal version is in place (`app/page.tsx`): browse subjects/notebooks/notes
   and create each; drag-reorder, move, and rename UI not started.*
6. **PDF export.** Tree → LaTeX → typeset PDF. *Not started.*
7. **Mathpix OCR.** Photo/handwriting → block tree (server-side keys already reserved in
   `.env.example`). *Not started.*
8. **Templates.** Reusable document/block templates. *Not started.*
9. **Share links.** Read-only shared serialization of a note. *Not started.*
10. **TikZ canvas.** Constrained drawing mode backed by the `tikz` block
    (`attrs.shapes`). *Block type scaffolded; canvas not started.*

## V2 — later

- **iPad handwriting.** Pencil input as a first-class asset/input method. *Not started.*
- **Realtime collaboration via Yjs.** Multi-user editing of the shared tree. The `yjs`
  dependency is present but referenced **type-only** in the sync skeleton (the `TODO(crdt)`
  seam); no CRDT runtime integration exists yet. *Not started.*
- **Community templates.** Shared, discoverable template library. *Not started.*

## Near-term next steps

V1 step 1 is done — `lib/blocks/serialize.ts` (`blockToKatex` / `documentToLatex`), the
render pipeline (`components/BlockView.tsx` → `components/Katex.tsx`), and a minimal editor
(`app/editor/[id]/page.tsx`) mounted from `app/page.tsx` already produce visible WYSIWYG
output. The natural next slice is the rest of input (steps 2–3): the **symbol palette**
(Toolbar 2), **LaTeX-shorthand autocomplete** (`\frac` / `/` → block), and fleshing out the
structure toolbar into the full customizable 10-slot toolbar — so authoring is no longer
limited to the demo subset of blocks.
