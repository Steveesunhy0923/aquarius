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

---

# UI cleanup & design consistency — proposal (2026-07-18)

Design proposal, **not yet built**. One branch of work covering three asks: **(A)** make the
app read as one consistent system, **(B)** hard-separate chemistry input from math input so
they can't mess together, **(C)** drop the hand-drawn icon set for a single icon language.
Each item tags rough effort (S/M/L) and the files it touches. Direction decided up-front with
the user: replace the **whole** drawn icon set (not just the math symbols), and render **every
math/chem symbol as real KaTeX**.

## The mess today (audit)

The Graphite restyle (`04f7dd2`, `d4b6af9`, `1fc5189`) modernized the home, editor chrome,
settings and the newer dialogs, but left the app with **two competing token systems and no
shared primitives**, so equivalent things are styled differently all over:

- **Two token vocabularies.** Live tokens in `app/globals.css`
  (`--background/--foreground/--border/--accent`, colors only) vs. an **orphaned second design
  kit** `design/kit.css` (`--bg/--ink/--line/--radius/--radius-sm/lg`) imported **nowhere**,
  yet whose values leak in as magic numbers — `--radius:7px` → `rounded-[7px]`
  (`components/library/Sidebar.tsx:38`), its hover shadow →
  `shadow-[0_10px_26px_rgba(40,40,80,0.09)]` (`components/library/NoteCard.tsx:72`).
- **Tokens are colors-only** — there are **no** tokens for radius, spacing, type scale, shadow,
  or status (danger/success/warning), so everything downstream is ad-hoc.
- **Copy-pasted, drifted class strings** instead of shared components — `BTN`/`PRIMARY`/
  `INPUT`/`FIELD`/`SECTION` are re-declared with drift across `ui/dialogs.tsx`,
  `ModuleFieldsDialog.tsx`, `ModuleEditorDialog.tsx`, `auth/AccountMenu.tsx`, `auth/AuthDialog.tsx`.
- **Visible symptoms** (each a real divergence found in the audit): section "eyebrow" headings
  come in 3 styles (`ui/Dialog.tsx:7` `10.5px` vs `app/page.tsx:481` `text-sm` vs
  `EditorSidebar.tsx:63` `text-xs`); the same button is `rounded-md` most places but `rounded-lg`
  in `auth/*`; identical text fields split `bg-background` vs `bg-surface`; the library grid mixes
  `rounded-xl`/`rounded-lg` cards with a hover shadow on only one; "active/selected" uses three
  color idioms (`bg-accent-soft text-accent`, `bg-accent text-white`, `bg-foreground text-background`);
  radius is unmanaged (`rounded-md`×125, bare `rounded`×69, `rounded-lg`×34, `rounded-xl`×12);
  shadows mix `shadow`/`shadow-lg`/`shadow-xl`/`shadow-2xl` + a magic rgba; 30+ raw status colors
  (`text-red-500`×21, `emerald-600` vs `green-600`, `red-500` vs `red-400`).
- **Drawn glyphs collide with rendered ones.** In the same toolbar row, 5 math structures render
  as hand-drawn line-icons while `sin/cos/π/α` + all slots render as KaTeX serif glyphs
  (`SymbolToolbar.tsx:13-20,84-98`); the ordered-list dropdown shows literal `1./a./i.` text next
  to drawn bullet markers (`ToolbarControls.tsx:40-42,68`).
- **Chemistry and math input share almost everything** — same block type, same renderer, same
  insert routers, same inline-popover state — separated only by a runtime string test. Fragile.

## A — One visual system

**A1 · Kill the orphaned kit.** *(effort: S)* Delete `design/kit.css` (and the `design/*.html`/
`*.png` mockups once they're no longer needed as reference) rather than leaving a dead second
system; replace the two leaked magic values (`Sidebar.tsx:38` `rounded-[7px]`, `NoteCard.tsx:72`
shadow) with A2 tokens. The live `@theme` becomes the single source of truth.

**A2 · Extend `@theme` with the missing token families.** *(effort: S–M)* In `app/globals.css`:
a **radius scale** (`--radius-sm/md/lg` — pick 3 real steps: controls / cards / modals — instead
of today's 6 ad-hoc radii); a **shadow scale** (`--shadow-card / --shadow-popover / --shadow-modal`);
**status colors** (`--danger / --success / --warning` + soft variants) to replace the 30+ raw
palette hits; and one **eyebrow type token** to collapse the 3 heading styles. Also fix off-token
stray hexes while here — `theme-color #4f46e5` (`app/layout.tsx:18`) doesn't even match `--accent`
`#5b5bd6`; `#1f2937` (`ToolbarControls.tsx:92`); avatar hexes (`ShareDialog.tsx:20`).
(GraphEditor's canvas hexes are canvas-draw, lower priority.)

**A3 · Extract shared primitives.** *(effort: M)* One `Button` (variants primary/secondary/ghost/
danger, sizes sm/md), one `Input`/`Field`, one `Eyebrow` — reused everywhere. This alone deletes
most of the §audit divergences because the class string then lives in one place. Fold the existing
`ToolbarControls` `ICON_BTN`/`HEAD_BTN` into the same system and pick **one** icon-button hover
idiom (today `hover:border-accent` vs `hover:bg-foreground/[0.06]`).

**A4 · One idiom per interaction, applied.** *(effort: M)* **Active/selected** → one idiom
(recommend `bg-accent-soft text-accent`), retiring the competing `bg-accent text-white`
(`DocStyleBar.tsx:53`) and `bg-foreground text-background` (`SettingsDialog.tsx:59`) unless a
control truly needs the strong fill. **Input fill** → one of `bg-surface`/`bg-background` (recommend
`bg-surface` for inset fields). **Cards** → NoteCard/SharedNoteCard/DeletedCard all one radius +
the same hover shadow.

**A5 · Bring the stragglers onto the system.** *(effort: M)* Components the Graphite pass skipped,
in priority order: `auth/AuthDialog.tsx` (hand-rolls its own modal — adopt the shared `ui/Dialog`
shell; it also closes on any overlay click and lacks Dialog's press-started-on-scrim guard), then
`DocStyleBar.tsx` (bare `rounded`, native selects, `bg-accent text-white`), then `DesignPicker`,
`FigureControls`/`FigureBox`, `TablePicker`/`TableView`, `ExternalLink`, `NoteLink`/`NoteLinkPicker`,
`GraphEditor`, `ink/*`.

## B — Separate chemistry from math input

The two systems are already cleanly separate in **catalog, toolbar strip, field component and
inline popover** (`lib/symbols.ts` vs `lib/chemsymbols.ts`; `SymbolToolbar`/`SymbolField` vs
`ChemToolbar`/`ChemField`). The coupling that lets them "mess together" is concentrated in four
spots — fix in this order:

**B1 · Give chem blocks an explicit tag; stop inferring.** *(effort: M — the keystone)* Today a
chemistry formula is just a `math` block whose LaTeX happens to be one `\ce{...}`; the **only**
signal that says "this is chemistry" is a runtime string test `ceInner()` (`lib/blocks/chem.ts:27-50`,
consulted at `page.tsx:697`, `page.tsx:887`, `EditBox.tsx:408`). Consequence: **type `\ce{H2O}` into
the math editor and next session it silently reopens in the chemistry editor** — a formula can flip
systems with no user action. Fix: persist an explicit `attrs.kind: "chem"` on chem blocks (mirrors
the existing `attrs.editor: "structural"` flag at `lib/blocks/structural.ts:8`) and branch on that,
not the string. `ceInner` stays as a fallback/migration for old notes. "Which editor opens" becomes
a stored property, not a guess.

**B2 · Decouple the insert routers from each other's fields.** *(effort: M)* `onInsert` (math) and
`onInsertChem` (`page.tsx:848-909`) each reach into the **other** system's active-field registry and
cross-route (math strip → focused chem field at `:868-869`; chem strip → focused math field at
`:894-897`). Because the visible strip (`barMode`) and the field that actually receives the insert
(last-focused registry) are independent, **a math-strip click can land in a chem field and
vice-versa.** Fix: gate an insert on the active field's kind — a math-strip insert into a focused
chem field should be blocked or explicitly wrapped, never silently rewritten. Keep the deliberate
cross-escapes (`$…$` into chem, `\ce{}` into MathLive) only where intentional, and label them.

**B3 · Stop the math preview transform from touching chem.** *(effort: S)* `previewLatex()`
(`lib/blocks/source.ts:137-145`) fills empty `{}`→`{a}`, `[]`→`[n]` and prepends a base for a leading
`^`/`_` — a **math-only** rewrite — yet it runs on **chem** picker entries via `SymbolPicker.tsx:176`.
Harmless for today's `CHEM_SYMBOLS` but a latent corruption path the moment a chem entry contains
empty braces (e.g. `\ce{->[]}`). The toolbars already avoid it (ChemToolbar renders raw `\ce`). Fix:
branch `previewLatex` on chem, or give the chem picker a preview that never rewrites braces. (This is
the "never placeholder-rewrite `\ce`" rule — honored in the router, leaking through the shared picker.)

**B4 · Split the shared inline-popover state.** *(effort: S–M)* `EditBox.tsx:77-81` funnels both
inline popovers through one `mathPopover` state with a `chem?: boolean` flag and one `commitMath`
(`:454-475`). Give chem its own state + handle so a math popover and a chem popover can't clobber
each other's draft.

**Keep shared (intentional — do NOT "fix"):** the single `Katex` renderer with mhchem registered
globally (`Katex.tsx:7`), and the disjoint catalogs. That is the *good* kind of sharing.

## C — One icon language (drop the drawn set)

Everything funnels through **one component and one type** — `Icon({name})` / `IconName` in
`components/Icon.tsx` (87 hand-drawn glyphs, consumed by 30 files). So the swap is centralized:
change the glyph bodies, keep the names, and all call sites update at once.

**C1 · Swap the drawn glyphs for a standard library, same API.** *(effort: M)* Recommend **Lucide**
— its icons are already 24×24, `fill:none`, `stroke:currentColor`, round caps at ~1.5–2px, i.e.
nearly identical to the current `Icon` SVG conventions (`Icon.tsx:125-138`), so it drops in cleanly.
Two ways: **(a, recommended, zero new runtime)** replace each `PATHS[name]` body with Lucide's path
data under the **same key** — no dependency, no call-site changes, same `dangerouslySetInnerHTML`
render; or **(b)** add `lucide-react` and render `<LucideIcon>` behind the `Icon` wrapper. Keep the
`IconName` union and every name stable — modules store `icon: IconName` (`lib/templates/modules.ts:144,158,460`)
and graph tools reference names (`lib/blocks/graph-edit.ts:36-46`), so renaming breaks stored data;
add aliases where a Lucide name differs. **Caveat:** a few app-specific glyphs have no clean Lucide
equal (`parabola`, `plot`, the `marker*` list markers; Lucide has `flask-conical`/`atom` for chem) —
map those to the nearest Lucide icon, or keep a **small bespoke set drawn to Lucide's exact metrics**
(24×24, 2px, round caps) so they still read as one family.

**C2 · Render every math/chem symbol as KaTeX.** *(effort: S)* Remove `STRUCT_ICON` from
`SymbolToolbar.tsx:13-20,88` so fraction/√/xⁿ/Σ/∫ render through KaTeX like every other symbol
button — then the whole toolbar row is one visual family (real math type) instead of drawn-icons
sitting next to KaTeX. The chem toolbar already renders raw `\ce` via KaTeX, so it's consistent
once its chrome icons (`flask/atom`) come from C1.

**C3 · Mop up the remaining non-icon glyph sources.** *(effort: S)* Render the ordered-list markers
(`ToolbarControls.tsx:40-42,68` literal `1./a./i.`) in the same type as their sibling drawn bullet
markers; **leave** the multicolor Google "G" (`auth/AuthDialog.tsx:131-135`) as a deliberate brand
exception; **leave** real remote favicons (`ExternalLink.tsx:150`) as-is (they degrade to the `link`
icon). Retire the now-unused `design/*.html`/`*.png` icon mockups with the drawn set.

## Suggested phasing

1. **Tokens + primitives first** (A2, A3) — everything else snaps to them.
2. **Icon swap** (C1, C2) — mechanical once the `Icon` API stays put; biggest visible consistency win.
3. **Normalize idioms + stragglers** (A1, A4, A5, C3).
4. **Chem/math separation** (B1 → B2 → B3 → B4) — B1 (the stored `kind` tag) is the keystone; the
   rest hardens around it. Anything touching stored data ships behind the existing beta-flag pattern.

Per repo convention, verify UI changes in a **real browser**, not just typecheck.

## Out of scope / open questions

- Delete `design/kit.css` + mockups vs promote the kit to canonical (A1) — recommend delete.
- Icon library choice (Lucide vs Phosphor/Heroicons) — Lucide recommended for the near-identical
  stroke conventions.
- Whether the chem `kind` tag (B1) needs a one-time migration over existing notes, or can rely on
  the `ceInner` fallback for legacy blocks.

## Implemented (2026-07-18, verified in a real browser)

Shipped in this pass — `tsc` clean, chem unit tests green (`chem.test.ts`, 16), and home /
editor / Settings / Sign-in / symbol-library all verified rendering in headless Chrome with
**no console errors**:

- **A1–A4 · tokens + primitives.** `app/globals.css` gained `--radius-control/card/modal`,
  `--shadow-popover/card/modal`, and `--danger/success/warning` (+ soft) with light/dark values;
  `themeColor` fixed to `#5b5bd6`. New **`components/ui/primitives.ts`** is the single source of
  truth for `BTN* / FIELD* / SELECT / EYEBROW / CLOSE_BTN`; the dialog cluster (`ui/Dialog`,
  `ui/dialogs`, `ModuleEditorDialog`, `ModuleFieldsDialog`, `ShareDialog`, `AccountMenu`,
  `SymbolPicker`) imports them. Modals use `rounded-modal`/`shadow-modal`. A repo-wide
  **status-color sweep** replaced every raw `red/emerald/green/amber-*` status class with
  `danger|success|warning` tokens (17 files).
- **A5 · stragglers.** `auth/AuthDialog` now uses the shared `Dialog` shell (fixes its
  close-on-any-overlay-click bug + adopts the press-start guard) and the primitives. `DocStyleBar`
  moved onto a shared `SELECT_SM` primitive + the `bg-accent-soft`/`text-accent` active idiom
  (matching the Σ/⚗ switch) + an accent-tinted zoom slider. `FigureControls`, `TablePicker` and
  the `GraphEditor` chrome now use token radii, `SELECT_SM`, the accent-soft active idiom, and
  `shadow-card`/`rounded-card` cards; the two leaked kit.css magic values (`NoteCard` hover shadow,
  `Sidebar` `rounded-[7px]`) are gone.
- **C1–C2 · icons.** `components/Icon.tsx` regenerated from **Lucide** geometry (authentic paths
  inlined — same `Icon({name})` API + `IconName` union, so all ~30 call sites updated at once),
  keeping 11 bespoke math/graph primitives in the same stroke language. `SymbolToolbar` no longer
  draws fraction/√/xⁿ/Σ/∫ — they render as real KaTeX like every other symbol. Icons are
  self-contained (no runtime dep); regenerate by reinstalling `lucide-static` + re-running the
  one-off generator.
- **B1 + B3 · chem/math separation.** Chem formulas now carry a stored **`attrs.kind:"chem"`**
  tag (mirrors the structural-editor flag): `addBlock`/`commit` stamp it, `startEdit` prefers it
  (legacy notes fall back to `ceInner`). A `\ce` formula always reopens in the chem editor and a
  math formula is never sniffed into it — verified end-to-end (create → commit → reopen as chem).
  `SymbolPicker` no longer runs `previewLatex` over `\ce`/`\pu` entries.

**Deferred (lower value / intentional coupling):** **B2** — the insert routers still cross-route
into each other's focused field (partly intentional `$…$`/`\ce` escapes; no observed corruption
now that identity is stored); **B4** — the inline math/chem popovers still share one `EditBox`
state (only one is open at a time). The only remaining hardcoded colors are `GraphEditor`'s
**canvas** draw fills (2D-context strokes that can't read CSS vars without a dedicated theming
pass) — left as-is by design.
