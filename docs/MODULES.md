# Modular Notes — Current Progress

Living status doc for the "modular notes" initiative. Update as slices land.

## Current version

- **Aquarius 0.6.0** — released from `ui-graphite-redesign`: the Graphite UI restyle,
  modular notes (catalog + presets-as-stacks + slash-insert + save-section + module
  manager/builder), wiki-style note links, the /ink handwriting lab, and the Capacitor
  iOS shell scaffolding. `package.json` now tracks the release version (0.6.0).

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

## Todo next

- **Presets as editable stacks (UI)** — the data model is ready (`Preset.stack`); show the
  module chips in the DesignPicker before applying: check/uncheck + drag to reorder, then insert.
- **Fillable fields** — replace the literal `___` / `**Course:** ___` convention with named
  `{{field}}` tokens that prompt once on insert or Tab-through like a snippet. (`Module.fields`
  is reserved for this; design decision: where the token lives in the `attrs.runs` model.)

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
- Later ideas: backlinks panel, link autocomplete while typing `[[query`, rename-aware labels.

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

## Todo next (to close the loop)

- **Dataset loader** — teach `ml/src/dataset.py` to fold `collected.jsonl` into training
  (strokes already match the render path; just parse label + strokes).
- **Fine-tune / mix-in** — a `train.py` flag to weight collected corrections alongside
  MathWriting so the model actually learns from them.
- **On-iPad path** — the endpoint is `127.0.0.1:8787`; for a real iPad it needs the same
  LAN-IP treatment as the dev server (or the eventual on-device CoreML plugin writing locally).
- **Review UI** — list/replay/delete collected samples before training on them.
- **Dedup / provenance** — the raw model guess is stored as `predicted` for error analysis.
