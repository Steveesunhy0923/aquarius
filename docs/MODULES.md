# Modular Notes — Current Progress

Living status doc for the "modular notes" initiative. Update as slices land.

## Current version

- **Aquarius 0.6.1** — released from `ui-graphite-redesign`: presets as editable stacks
  (module chips on the Note-layout cards), Google-Docs-style orientation-aware link
  previews for note + external links (`/api/unfurl`), and the ML workstream's XL cloud
  training + text mode (Apple Vision OCR) in the /ink lab.
- **Aquarius 0.6.0** — released from `ui-graphite-redesign`: the Graphite UI restyle,
  modular notes (catalog + presets-as-stacks + slash-insert + save-section + module
  manager/builder), wiki-style note links, the /ink handwriting lab, and the Capacitor
  iOS shell scaffolding. `package.json` now tracks the release version.

## Current goal

Turn Aquarius into a **modular note-taking app**: users build note structures from
**presets** or **their own templates**, composed of reusable **modules**.

**The reframe.** Today a template is a whole `DocumentTree`, applied add-or-replace only
(`components/TemplateApplyDialog.tsx`, `lib/templates/templates.ts`). Move to a composable
model:

```
Module   = a named, insertable Block[] fragment (usually one heading + body = a section)
Preset   = an ordered list of modules → produces a DocumentTree
```

A preset becomes a *stack of modules* (e.g. Lab Report = `[Objective, Materials, Procedure,
Data Table, Analysis, Conclusion]`) that users can remove/reorder/extend. This unifies
presets + custom templates + modules into one underlying thing.

**Foundations already in the codebase (build on these, don't reinvent):**

- `lib/blocks/outline.ts` `sectionRange()` — section `[start, end)` boundaries → "save section as module".
- `lib/templates/templates.ts` `freshBlock()` / `freshTree()` — id-safe clone → collision-free insert.
- `lib/blocks/outline.ts` `reorderSectionBlocks()` — whole-section move → drag-to-reorder modules.
- `lib/blocks/outline.ts` `computeOutline()` — live outline → dynamic Table of Contents.
- `components/EditorSidebar.tsx` — home for draggable module cards.
- `Subject ▸ Notebook ▸ Note` hierarchy (`lib/storage/types.ts`) — per-subject default stacks.
- Anki export — flashcard module. Interactive `graph` block — graph module.

## Done (the concept is unlocked — landed on `ui-graphite-redesign`, unreleased)

1. ✅ **`Module` type + presets as module stacks** — `lib/templates/modules.ts`:
   `Module = { id, name, icon, category, description, keywords?, fields?, blocks: Block[] }`
   (`fields` is a reserved placeholder for fillable fields). `builtinModules()` is the catalog
   (~18 modules: structural / study / science / planning); `builtinPresets()` rebuilds the five
   note templates as ordered `Module` stacks (`Preset.stack`, materialized by `presetTree()` with
   id-freshening). `templates.ts` note templates now derive from presets — DesignPicker unchanged.
2. ✅ **Slash-insert at the cursor** — type `/` in a paragraph → fuzzy-filtered, keyboard-navigable
   module menu (`components/ModuleSlashMenu.tsx`, state machine in `EditBox`); picks insert the
   module as a section after the current block (drops the paragraph if it was only the `/query`).
   Ranked by recent/frequent use (`aquarius.modules.usage.v1`).
3. ✅ **Save section as module** — hover a section in the sidebar outline → module icon →
   name prompt; captures `sectionRange()` into `aquarius.modules.v1` (category **My modules**,
   shows up in the `/` menu immediately).
4. ✅ **Module manager + builder** — Designs dialog gained a **Modules** tab
   (`DesignPicker` › `ModulesTab`): build a module from scratch, edit/rename/delete saved ones,
   and "Customize" any built-in into a personal copy. The builder
   (`components/ModuleEditorDialog.tsx`) edits a module as typed *parts*
   (heading / text / bullets / numbered / formula / table) with live preview; blocks the form
   can't express (images, graphs, code, multi-table rows, captioned/placed/pipe-cell tables)
   pass through untouched as "kept as-is" parts. Open-then-save is lossless: heading
   numbered/align, list marker styles, and structural-editor formula trees are carried through
   even though the form has no UI for them. Custom rows in the `/` menu have pencil (edit) and
   × (delete) actions; the pencil opens the same builder in place (re-seeded from storage, so a
   stale menu snapshot can't clobber a newer version; `updateModule` upserts if the record was
   deleted meanwhile). Closing a dirty builder asks before discarding. `ui/Dialog` now closes
   the *topmost* dialog on Escape (stacked-dialog aware) and ignores drag-releases on the scrim.

5. ✅ **Presets as editable stacks (UI)** *(0.6.1)* — the Designs dialog's
   "Note layouts" cards are now `PresetCard`s (`DesignPicker`): each preset shows its module
   stack as chips — click a chip to tick a module in/out (drawn `check` icon; excluded chips
   render dashed/dimmed with a `+`), drag chips to reorder (same HTML5 pattern as the sidebar
   outline), and the card's preview re-materializes live from the current stack
   (`stackTree()` in `lib/templates/modules.ts`, which `presetTree()` now delegates to).
   A **Reset** affordance appears once the stack is modified; with every chip off the card
   shows a "Nothing to insert" placeholder and disables **Use this template**. Applying
   inserts exactly the customized stack through the existing add/replace flow. Verified
   end-to-end in a real browser (toggle, drag-reorder, apply order, reset, all-off).

6. ✅ **Fillable fields (`{{Field}}` tokens)** *(unreleased)* — the literal `___` /
   `**Course:** ___` convention is now named `{{field}}` tokens. Tokens live as literal text in
   run strings / heading values / list items / table cells (`lib/blocks/fields.ts` —
   `splitFieldTokens` / `scanFieldNames` / `fillFieldText`), mirroring the marker-in-string
   design of `format.ts`, so they survive `freshBlock`, copy/import, and the ModuleEditorDialog
   round-trip untouched (no `attrs.runs` schema change). `moduleFields()` scans a fragment for
   its token names (so save-section and hand-built modules get fields for free — `Module.fields`
   was dropped as redundant); `fillFields()` substitutes values purely (never mutates the
   memoized catalog). **On insert** (slash-menu `insertModule` **and** preset/template apply
   `applyTemplate`), a module carrying tokens raises `ModuleFieldsDialog` — one input per field,
   Enter advances snippet-style, **Skip** leaves tokens as placeholders. **Unfilled tokens
   render as dashed placeholder chips** (`withFieldChips` in `BlockView`), not literal braces;
   the built-in title blocks + the 4 preset title lines now use tokens (`Course` / `Date` /
   `Topic` / `Name` / `Due` / `Experiment` / `Partners`). Unit-tested (`lib/blocks/fields.test.ts`,
   7 cases) and verified end-to-end in a real browser (slash insert with 2/3 fields filled →
   values land, blank `Date` shows a chip; preset apply prompts, Skip keeps chips).

## Todo next

- **Per-subject default stack** — each Subject defines a skeleton so new notes in *Physics*
  start correctly (the editable-stack UI from 0.6.1 is the editor for it).
- **Dynamic / smart modules** — Table of Contents (bound to `computeOutline`), Formula index
  (collects display equations), Flashcards (→ Anki export), Graph (interactive graph block).
- **Shareable module packs** — publish/install packs via cloud + sharing infra (moves user
  modules off localStorage; first step toward the template gallery).

## Todo later (all ideas kept)

**Convenience mechanics**
- **Module cards in the sidebar** — render sections as draggable cards in `EditorSidebar`
  (backed by `reorderSectionBlocks`).
- **Per-subject default stack** — each Subject defines a skeleton so new notes in *Physics*
  start correctly.
- **Dynamic / smart modules** — Table of Contents (bound to `computeOutline`), Formula index
  (collects display equations), Flashcards (→ Anki export), Graph (interactive graph block).
- **Shareable module packs** — publish/install packs via cloud + sharing infra (move user
  templates off localStorage).
- **Keyboard snippets** — `\lab`+Tab expands a module.
- **Module gallery with live preview thumbnails** (reuse note-thumbnail rendering).
- **Recently-used / favorites / frequency ranking** in the inserter.
- **Nested sub-modules** — modules containing modules (slot system already nests arbitrarily).

**Default module catalog (grouped by function)**

- *Universal / structural:* Title block · Section (heading + body) · Summary / TL;DR callout ·
  Table of Contents *(dynamic)* · Divider · Two-column split.
- *Study & learning:* Cornell notes · Concept card (term → definition → why it matters) ·
  Vocabulary table · Q&A / flashcard pair *(→ Anki)* · Worked example · Practice problems ·
  Mnemonic / memory hook.
- *Math & science:* Lab report skeleton · Hypothesis → method → result · Data table (with
  uncertainty column) · Graph / plot *(interactive graph block)* · Derivation (step-by-step) ·
  Theorem–proof (statement · proof · ∎) · Formula sheet section.
- *Humanities & writing:* Essay outline (thesis · arguments · evidence · conclusion) ·
  Reading notes (citation · summary · key quotes · response) · Source / bibliography entry ·
  Compare & contrast table · Timeline.
- *Planning & productivity:* Meeting notes (attendees · agenda · decisions · action items) ·
  Weekly planner · Checklist / task list · Project brief (goal · scope · milestones) ·
  Daily log / journal entry.
- *Design / poster (exist today):* Event poster · Quote poster · Concept poster · Title banner.

**Presets to ship (curated module stacks)**

- Existing 5: Lecture Notes · Problem Set · Lab Report · Cornell Notes · Formula Sheet.
- New: Reading / Literature Notes · Meeting Notes · Weekly Planner · Essay Draft · Project Doc.

## Notes

- `docs/ROADMAP.md` is stale on templates (lists them "not started"); templates now exist
  (`BUILTIN_TEMPLATES` + `SavedTemplate` in `lib/templates/templates.ts`). This doc supersedes
  it for the modules initiative.

---

# Note links (wiki-style) — shipped alongside modules (unreleased)

`[text](note://<noteId>)` links one note to another; `note://<noteId>#<headingBlockId>`
targets a section (heading block ids are stable across renames). Rides the ordinary
`[text](url)` prose marker — no storage/collab changes.

- **Insert**: type `[[` in a paragraph, or the toolbar's note-link button
  (`components/NoteLinkPicker.tsx` — search notes → link the whole note or pick a section).
- **Render**: `components/NoteLink.tsx` via `BlockView` — accent dashed underline + note glyph.
- **Click**: opens the note (`/editor/<id>?block=<hid>` scrolls to the section on load).
  If the target is already open in a pane, the editor intercepts (`NOTE_LINK_EVENT`) and
  jumps in place instead of navigating — same-note section links work like anchors.
- **Hover**: ~350 ms → live preview card (portal, fixed-position) of the note — or just the
  linked section — with a 30 s cache; dangling targets show "Note not found".
- **Export**: `formatToLatex` drops the `\href` for `note://` (text only — PDFs can't follow);
  browser print renders links as plain text too. Copy/import rewrites self-referential links
  to the new note id (`remapSelfNoteLinks` in `lib/storage/bundle.ts`).
- **Behavior details**: ⌘/Ctrl-click opens a new tab; links into collapsed sections auto-expand
  them; a link clicked in split-pane B to a third note replaces pane B; the toolbar path uses
  the text selection as the label; `[[` only triggers on a genuinely typed bracket.
- Later ideas: rename-aware labels.

## Update (unreleased) — inline `[[` autocomplete + backlinks panel

- **`[[query` inline autocomplete** (`components/NoteLinkMenu.tsx`): typing `[[` now opens an
  inline note-search menu below the edit box instead of jumping straight to the modal — a full
  state machine in `EditBox` mirroring the `/` slash menu (open/refine/dismiss on
  `onChange`+`onSelect`, keyboard branch in `onKeyDown`, `absolute top-full` menu with
  `onMouseDown` preventDefault). Results are `listRecentNotes(6)` for an empty query, debounced
  `searchNotes` (150 ms) otherwise; ↑↓ navigate, Enter links (splices `[title](note://id)` over
  the verified `[[query` range), Esc dismisses. A trailing **"Browse all notes / link a
  section…"** row falls back to the existing two-step `NoteLinkPicker` (still the path for
  section links + the toolbar button). Slash and link menus are mutually exclusive (each
  suppresses the other).
- **Backlinks panel** (`EditorSidebar` › `BacklinksPanel`): a "Linked from" list between Files
  and Sections showing notes that link to the active pane's note; hidden when there are none, a
  row opens the referrer in split view. Backed by a new `LibraryStore.listBacklinks(noteId)` —
  local scans tree JSON in one `getAll("notePackages")` (`note://` hrefs are stripped from
  `latexCache`, so a body search can't find them, per `format.ts`); cloud calls the
  `backlink_note_ids` Postgres function (**migration `0010_backlinks.sql`**, SECURITY INVOKER so
  RLS applies), degrading to "no backlinks" if the function isn't deployed yet.
- Verified end-to-end in a real browser (23-assertion suite): `[[` menu opens with recents,
  filters on query, picks/splices a link; the target note's backlinks panel lists the referrer
  and clicking it opens split view.

## Update (0.6.1) — Google-Docs-style, orientation-aware previews

Hover previews were redesigned for **both link kinds**, and external links got previews for
the first time:

- **Note links** (`NoteLink`): the card now renders the note on a **miniature page** carrying
  the note's own background/foreground (posters preview correctly), and the card's
  orientation follows the note's layout — `style.pageLayout: "horizontal"` → wide 480px
  landscape card, default vertical → 300px portrait card. Section previews unchanged.
- **External links** (new `components/ExternalLink.tsx`, replaces the plain `<a>` in
  `BlockView`): hovering shows the target page's Open Graph card — cover image, title,
  description, favicon + site name. Card orientation follows the **cover image's aspect**:
  landscape cover → wide banner card (420px), portrait cover → tall card (264px),
  square/no image → compact row (360px). Unfurl failure (offline, static build, bot-blocked
  site) degrades to a compact domain + URL card. Clicks now stop propagating (no
  click-to-edit underneath), matching NoteLink.
- **`app/api/unfurl` (first API route)**: server-side metadata fetch (browsers can't read
  cross-origin pages) — SSRF-guarded (public hosts only, every redirect hop re-validated;
  the extracted **og:image + favicon URLs are re-validated too**, so a page can't aim the
  reader's browser at a LAN address on hover), 6s timeout, 512KB fetch cap, `<head>`-only
  parse capped at 128KB with **bounded** tag regexes (no catastrophic backtracking on hostile
  HTML), `Cache-Control: public, max-age=3600`. Best-effort by design: clients treat any
  failure as "no preview". Card `<img>`s (and the client-side aspect probe) use
  `referrerPolicy="no-referrer"`.
- **Shared plumbing**: `components/ui/hovercard.ts` — `useHoverCard` (350ms open / 200ms
  close-grace timers, scroll dismiss, stable callbacks) + `placeCard` viewport clamping,
  extracted from NoteLink and reused by both link components.
- Verified in a real browser: 18 assertions across wide/tall/compact/fallback external cards
  and horizontal/vertical note cards; unfurl route live-tested incl. SSRF rejections. A
  4-dimension adversarial review followed; 6 confirmed findings fixed (regex-DoS via bounded
  head parse, entity-decode crash-guard, image/favicon SSRF re-validation + no-referrer,
  `placeCard` viewport clamp, stable card placement so a growing card doesn't self-dismiss,
  list-editor preview made `pointer-events-none`).

---

# Handwriting correction capture (data-collection loop)

_Backup record of this feature, kept here at the user's request. Primary home for the
handwriting/ML workstream is [HANDWRITING_MODEL.md](HANDWRITING_MODEL.md); this is a
different initiative from modular notes above._

## Why

The `/ink` handwriting→LaTeX recognizer currently runs the **smoke** checkpoint — trained on
100 samples for 45 s purely to prove the pipeline. It reproduces its memorized training
expressions exactly (verified: 5/6 at 0.94–0.97 confidence) but collapses **every** novel
drawing to one attractor output, `\overline{Y}_1`. It is undertrained, not broken; the fix is
training on the full MathWriting 2024 set (~253k human + ~396k synthetic; 2.9 GB; public, no
registration).

Independent of that, every wrong recognition is a free labeled training example **if we
capture it**. This feature turns the lab into a data-collection loop: the user corrects a wrong
result, and the (ink + correct label) pair is saved as training data.

## What shipped (landed on `ui-graphite-redesign`, unreleased)

1. ✅ **"Not right? Fix the label" on every result** — `components/ink/RecognitionPanel.tsx`.
   Every recognition (right or wrong) offers a correction affordance. Opening it reveals an
   editor **pre-filled with the model's guess** (edit, don't retype), a **live KaTeX preview**
   of the typed LaTeX, and Save/Cancel. Enter saves, Escape cancels. After saving it shows
   `✓ Saved for training · N collected`.
2. ✅ **`collect` in the recognition hook** — `useRecognition(...)` gained `collect(label,
   predicted)` and `collectedCount`. Reuses the same ink already in `strokesRef`, so the saved
   sample is byte-identical to what was recognized.
3. ✅ **Shared wire-shaping** — `components/ink/strokes.ts`: `rebaseStrokes()` (t rebased to 0,
   rounded) now backs both `buildRecognizeRequest` and the new `buildCollectRequest`.
4. ✅ **Server persistence** — `ml/serve.py`:
   - `POST /collect` `{strokes, label, predicted?, mode}` → appends one JSON line to
     `ml/data/corrections/collected.jsonl` **and** saves the drawn figure as a PNG to
     `ml/data/corrections/img/<id>.png` (via the same `render_strokes` the model sees).
     Returns `{ok, id, count}`.
   - `GET /collect` → `{count}`; `GET /health` now also reports `collected`.
   - Record shape (mirrors MathWriting so corrections mix straight into training):
     `{id, ts, label, predicted, mode, image, strokes:[{x[],y[],t[]}]}`.

Verified end-to-end in a real browser (headless Chrome): draw → auto-recognize → "Fix the
label" → edit with live preview → Save → HTTP 200, confirmation shown, JSONL + PNG written,
`collected` count incremented. `npm run typecheck` clean.

## Storage locations (all git-ignored)

- `ml/data/corrections/collected.jsonl` — one labeled sample per line.
- `ml/data/corrections/img/<id>.png` — visual backup of each drawing.

## Update 2026-07-12 — model trained + editor integration

- The recognizer is no longer the smoke model: **full 50k-step training run completed on the
  M2 Max** (valid loss 0.154; 26% exact / 0.864 mean similarity on unseen test expressions);
  the server auto-serves `ml/checkpoints/full.pt`.
- **Second collection surface**: handwriting is now embedded in the note editor itself — a
  pencil toolbar button opens a bottom writing sheet (`components/ink/InkInsertPanel.tsx`).
  Its editable LaTeX line doubles as correction capture: inserting an edited recognition
  silently POSTs the (ink, corrected label) pair to `/collect`. Same storage as above.
- 8 review findings (focus/Escape/staleness/positioning) were confirmed and fixed post-build;
  details in [HANDWRITING_MODEL.md §6 step 8](HANDWRITING_MODEL.md).

## Closing the loop (status)

- ✅ **Dataset loader + mix-in flag** — already shipped in the S2-XL cloud-training work
  (Step 9): `load_corrections()` + `MathWritingDataset(corrections_jsonl=…, corrections_repeat=…)`
  in `ml/src/dataset.py` fold `collected.jsonl` straight into training through the same
  render+tokenize path (oversampled ×32 by default), driven by `train.py`'s `--corrections` /
  `--corrections-repeat`. Re-verified: `python -m src.dataset` reports the corrections mixed in.
- ✅ **Review UI** *(unreleased)* — list/view/delete collected samples before training on them.
  New `serve.py` routes: `GET /collect/samples` (metadata, newest first), `GET /collect/img/{id}`
  (the rendered PNG the model trains on, id-validated, `FileResponse`), `DELETE /collect/{id}`
  (atomic JSONL rewrite under the collect lock + PNG unlink). The `/ink` lab gained a **Review ·
  N** button opening `ReviewPanel` — each row shows the ink thumbnail, the corrected label
  (KaTeX/text), the model's original guess (`predicted`), mode/stroke-count/timestamp, and a
  Delete (confirm dialog). Server routes exercised over curl (collect→list→delete round-trip,
  id validation 400/404) and the dialog verified in a real browser (count badge, thumbnail
  loads, "model guessed" line).

## Todo next (to close the loop)

- **On-iPad path** — the endpoint is `127.0.0.1:8787`; for a real iPad it needs the same
  LAN-IP treatment as the dev server (or the eventual on-device CoreML plugin writing locally).
- **Dedup / provenance** — the raw model guess is stored as `predicted` for error analysis.

---

# Handwritten words → text (text mode) — decision record 2026-07-12

**User requirement (recorded verbatim in spirit, saved for later):** written-text handwriting
recognition ("actual words", not math) shall be integrated into the note-taking sections in a
convenient fashion, **limited to the iPad version only**. The dev session (desktop browser)
still exposes it for demonstration/testing — the iPad-only restriction applies to the shipped
product surface, not to the lab.

- **Engine**: Apple Vision (`VNRecognizeTextRequest`) — on macOS in dev via the recognition
  server (`ml/src/text_ocr.py`), and natively on-device in the eventual iPad build. Same engine
  family both places, so dev-session behavior is representative. No training required; strokes
  are rasterized (`ml/src/render.py`) and OCR'd.
- **Shipped now (dev/lab)**: the `/ink` lab's Text mode works end-to-end (was a 501);
  plain-text results render as text, not KaTeX; text corrections flow into `/collect` with
  `mode:"text"` like math ones.
- **Saved for later (the iPad-only editor integration)**: a convenient words-input surface in
  the note editor (e.g. the ink sheet gaining a Text mode that inserts recognized words as
  paragraph prose at the caret), gated to the Capacitor/iPad build (platform check), plus the
  native PencilKit/Vision plugin path from IPAD_APP_PLAN.md. Not built on desktop by design.
