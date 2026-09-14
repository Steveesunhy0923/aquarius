# Architecture

> **Status: working foundation.** The shapes described here are real and live in
> [`../lib/blocks/types.ts`](../lib/blocks/types.ts). The LaTeX/KaTeX serializer
> ([`../lib/blocks/serialize.ts`](../lib/blocks/serialize.ts)), the render pipeline
> (`BlockView → Katex → katex`), and a minimal editor are **implemented**. The other
> exporters (PDF/Markdown/Anki/share link), undo/redo, and the spatial canvas remain
> **planned** — flagged explicitly below.

## The block tree is the source of truth

Aquarius's guiding principle is that **LaTeX is an output format, not the input format.**
The user never authors a string of backslash commands. Instead they edit a tree of
structured blocks — a math-aware DOM — and every artifact (KaTeX on screen, a `.tex` file,
a PDF, Markdown, Anki cards, a share link) is a *serialization* of that one tree.

```
        ┌─────────────┐  ┌────────────┐  ┌──────────────┐
input → │ toolbar /   │  │ symbol     │  │ shorthand    │ → all mutate
        │ structure   │  │ palette    │  │ autocomplete │   the SAME tree
        └──────┬──────┘  └─────┬──────┘  └──────┬───────┘
               └───────────────┼────────────────┘
                               ▼
                    ╔═══════════════════════╗
                    ║   DocumentTree        ║   ← single source of truth
                    ║   (Block[] + mode)    ║      (lib/blocks/types.ts)
                    ╚═══════════╤═══════════╝
                                │
        ┌───────────┬───────────┼───────────┬───────────┬──────────┐
        ▼           ▼           ▼           ▼           ▼          ▼
   blockToKatex   .tex        .pdf         .md         Anki     share link
        │       (done)     (planned)   (planned)   (planned)   (planned)
        ▼
     KaTeX
   (on screen)

   blockToKatex + .tex (documentToLatex) are implemented; the remaining
   export adapters are planned.
```

Because the tree — not a LaTeX string — is canonical, the same document can be rendered to
screen, exported, and round-tripped without ever parsing LaTeX back into structure.

## The `Block` shape and slot-based nesting

The tree is built from one universal `Block` shape, deliberately generic so serialization
is table-driven rather than per-type. The real definitions live in
[`../lib/blocks/types.ts`](../lib/blocks/types.ts):

```ts
interface Block {
  id: BlockId;
  type: BlockType;     // "fraction" | "script" | "integral" | "text" | …
  value?: string;      // literal payload for leaf blocks (symbol cmd, text, code src)
  slots?: Slots;       // named child slots for container blocks
  attrs?: BlockAttrs;  // block-specific structured attributes
}
```

- **`BlockType`** is a single union covering document-level prose (`text`), math leaf
  atoms (`symbol`, `operator`, `number`, `identifier`), math containers (`math`,
  `fraction`, `root`, `script`, `integral`, `bigop`, `matrix`, `group`), and rich blocks
  (`tikz`, `code`, `image`).
- **`Slots`** is `Record<string, Block[]>` — a named argument slot holds an *ordered list*
  of child blocks. A `fraction` has `{ num, den }`; a `script` has `{ base, sup, sub }`; a
  `root` has `{ radicand, index }`. Because each slot is itself a `Block[]`, **any structure
  can nest inside any slot to arbitrary depth** — a fraction inside a superscript inside a
  matrix cell is just nesting.
- Slot-name conventions are exported as `SLOT_NAMES` so the serializer, renderer, and
  validators all agree on slot order (and which slot the cursor lands in on insertion).
- **`BlockAttrs`** is a loosely-typed bag documented per block type: `op` for `bigop`,
  `rows`/`cols`/`env` for `matrix`, `delimiters` for `group`, `lang` for `code`,
  `assetId` for `image`, and `runs` for inline math interleaved in a `text` block.

A **`DocumentTree`** wraps the whole document: `{ schema: 1, mode, blocks: Block[] }`. The
`emptyDocument()` helper returns the canonical empty document.

## Input methods → tree → output adapters

**Inputs** all converge on tree mutations: a structure toolbar (insert
fraction/root/script/…), a symbol palette (insert `symbol` atoms), and LaTeX-shorthand
autocomplete (typing `\frac` or `/` expands to the corresponding block, never to a raw
string). Whatever the input method, the result is a structural edit to `DocumentTree`. A
**minimal** structure toolbar exists today in the editor (it inserts real
fraction/root/sum/integral/text blocks); the symbol palette and shorthand autocomplete are
**planned**.

### Editor chrome: contextual, not permanent

The editor used to stack four toolbars (header, block tools, symbol strip,
document style) above the canvas — 209px and 59 controls, all at equal
priority. Chrome is now ranked by when a control can actually act:

| Surface | Lives in | Shown |
| --- | --- | --- |
| Header | `EditorClient` | always — title, undo/redo, save *status*, share, export, history |
| The one bar | `EditorClient` + `InsertMenu` | always — Insert menu, block style, B/I/U/S, lists, TeX view, handwriting, Design, Document |
| Symbol strip | `SymbolToolbar` / `ChemToolbar` | while a `math` block is open for editing, or pinned with ⌘/ |
| Format popover | `FormatPopover` | while the prose textarea holds a non-empty selection |
| Document settings | `DocumentInspector` | toggled; open by default on a full-width pane |

Two rules keep it that way. **Block inserts go behind the labelled `InsertMenu`,
not onto the bar** — a glyph on a bar must carry its whole meaning alone, which
is what made `square-sigma` (equation), `Σ` (math mode) and `square-function`
(browse symbols) collide. **A control that needs a selection or a caret does not
get permanent space**; it is raised by the state that makes it useful.

**Every line is edited where it sits.** A paragraph, heading, list or formula is
not opened in a box: pressing the words puts a caret in them (`lib/editor/caret.ts`
maps the press to the source offset), and the editor carries the document's own
type, indent and width — no border, no surface, no preview pane, no button row,
no hover rectangle. Enter starts the next block, Shift+Enter a line break inside
this one, Backspace/Delete at a seam join two blocks, and the arrow keys walk out
of a block into its neighbours, so a note reads as one document rather than a
column of widgets. Deleting a line (Backspace in a blank one, or the delete
button on the line being edited) puts the caret at the end of the nearest
non-empty line before it, whatever that line is: a paragraph, a heading, a list's
last item or an equation. Blank lines and objects are passed over, and the last
line of a note is never deleted out from under the caret (`lineNear` in
`EditorClient`). Backspace at the very front of a line that has words brings the
whole line up onto the end of the line before it, caret at the seam: onto a
paragraph (a blank one included), a heading, or a list's last item. A list's
first item and a heading join upward the same way (`joinOnto`). An equation or an
object cannot take words, so nothing moves in front of one. An equation reports
its value as Enter or Escape is pressed, because MathLive's own change event
trails the keystroke. Lists are edited as lists — real markers, one caret per item.
The settings that used to sit in the box (heading alignment and numbering, list
marker, paragraph box colour) are hover strips that float clear of the text.

**Indentation is Google Docs'.** Nothing indents by itself: the LaTeX preset
takes `article`'s metrics but not its `\parindent` (`lib/blocks/docstyle.ts`), and
notes that stored the old 17pt default read it as none unless the inspector
marked it `indentChosen`. Paragraphs are separated by a `\parskip` instead (half a
baseline, the `parskip`-package pairing for zero indent). An indent is a property
of the WHOLE paragraph (`attrs.indent`, half-inch steps, `lib/blocks/indent.ts`),
never characters in it, so wrapped lines keep one left edge: Tab at the start of
a paragraph and ⌘] add a step, Shift+Tab and ⌘[ remove one, Backspace at the
start removes one before it would join the paragraph above, and Enter carries
the indent to the next line. A Tab mid-line still types a tab, on the same grid.
Lists nest the same way (`attrs.levels`): Tab at the start of an item nests it,
Shift+Tab lifts it, Enter or Backspace on an empty or nested item steps it out,
and markers cycle per level (• ◦ ▪, 1. a. i.). Lists autoformat as in Docs:
"- ", "* " or "1. " typed at the start of a paragraph, or a list button pressed
in it, turns THAT paragraph into a list item with its text, joining a list of the
same kind directly above (`listTrigger` in `lib/blocks/lists.ts`). One step (`--indent-step`, half
an inch of the sheet) measures both, so a bullet's text and an indented
paragraph line up. The export follows: `\leftskip` for paragraphs, nested
`itemize`/`enumerate` with `enumitem` labels, and `\setlist{leftmargin=36pt}`.

**Section folding is opt-in.** Settings → Fold sections puts the fold arrow on
headings and the hide button in the outline. Off (the default), neither shows,
and a section folded earlier is displayed in full.

**A list item is prose, not a widget.** It is stored as one source string in
`attrs.items` (a paragraph carries its maths pre-split into `attrs.runs`), so
`$…$` inside one is split at the point of use: `renderSource` in `BlockView` for
the screen, `sourceToLatex` in `serialize.ts` for the export. While a list is
open it registers as the document's insert target (`setActiveTextInserter`), so
the formula button, Insert ▸ Equation, the chemistry inserts, the symbol picker
and a handwriting reading all splice into the item holding the caret instead of
starting a block underneath the list. `$$…$$` in an item renders as
display-style maths beside the bullet.

**A formula in a line of text is its own tiny box.** Paragraphs and list items
are edited in `components/RichLine.tsx`, a contenteditable that turns the line's
source (prose with `$…$` spans, unchanged on disk) into words and formula boxes
and back. The words stay ordinary text; each formula shows as rendered maths
with no border and no dollar signs, and becomes the MathLive field (the equation
editor's input) when the caret goes in: a press on it, an arrow key or
Backspace/Delete into it from the words, or the formula button, which opens a
blank one. The symbol strip follows the caret into a formula and away again. A
plain symbol from the pinned strip goes in as a finished formula with the words
carrying on; a structure opens to be filled. Enter or Escape finish a formula
with the caret after it, an arrow off either end leaves on that side, Backspace
in an empty one removes it, and `$…$` typed by hand becomes a box as its closing
`$` lands. Callers keep a textarea-like handle (`LineHandle`: value,
selectionStart/End, setSelectionRange, focus) whose offsets are source offsets.
React renders only the editable root and the open field (a portal into the
box's own edit host); `syncDom` keeps the rest in step, because the browser
rewrites a contenteditable's nodes as the writer types. Chemistry keeps its
popover.

**An equation is always a line of its own.** The Equation button (and Insert ▸
Equation, and Chemical equation) never puts maths into the words: it adds a
centred equation line after the paragraph or list holding the caret, or in place
of an empty line, writing any formula open in the current line first. Maths in
the words is the formula button's job.

**Formulas take words.** Typing `"` in any formula, or the Text button on the
symbol strip, switches between maths and words (`\text{…}`), so "x if y" or "for
all x" can be written inside an equation. MathLive does it with its own text mode
(`switchMode`). The structural editor stores each word character as an upright
`identifier` marked `attrs.text` (spaces included); a run of them serializes as
one `\text{…}` (`renderRow` in `lib/blocks/serialize.ts`), and moving the caret
into the middle of existing words turns words mode on.

**A press on a formula puts the caret where it landed.** The editor that
replaces a rendered formula draws it at another size, so the press is kept as
fractions of the formula's rendered box (`formulaPointAt` in
`lib/editor/caret.ts`) and each editor turns them back into a caret once it has
laid the formula out: MathLive through `getOffsetFromPoint`, the structural
editor by the innermost row cell nearest the point (`placeAt`). A press on the
blank line beside an open equation lands at its nearer end. An equation block is edited centred, as
it is drawn, and Enter in it starts a new line underneath.

**Entering a line is a press, and leaving one is explicit.** `pressToEdit` in
`EditorClient` handles `mousedown` — not `click` — and `preventDefault`s it, so
the browser never moves focus and the transition is entirely the editor's:
`leaveOpenBlock` closes whatever was open (running `endEdit`'s tidy — drop an
abandoned empty block, promote a typed `$$…$$`) and the new block opens in the
same update. **Nothing exits on blur.** That is not a style preference: the old
model lost the first press on a line outright. A `click` only fires when
mousedown and mouseup share a target, and the blur-driven exit re-rendered the
line being pressed between the two, so the browser dropped the click and the
caret went nowhere until you pressed a second time. The one-shot "sticky" flag
that every toolbar button had to arm to survive its own focus steal is gone with
it; toolbar presses only `preventDefault` now, to hold the caret where an insert
should land. The ways out are Escape, a press on blank document space
(`exitOnBlankClick`), and pressing into another line.

**Maths is typed, not dialogued**: `$x^2$` inline, and a paragraph that is
nothing but `$$…$$` becomes a display equation block (`lib/blocks/source.ts`,
which still reads the older `\(…\)` and rewrites it on the first edit). Money
survives — a closing `$` after whitespace is not a delimiter, and `\$` is
literal. The MathLive popover remains only for structures inserted from the
symbol strip, where filling boxes beats typing.

Block-level properties (`FigureControls`, table style) deliberately stay next to
their block rather than moving into the inspector — only document-wide state
moved.

**Outputs** read the tree and emit a target format:

| Adapter        | Output                          | Status      |
| -------------- | ------------------------------- | ----------- |
| `blockToKatex` | KaTeX string for on-screen math | implemented |
| `.tex`         | standalone LaTeX document       | implemented |
| `.pdf`         | typeset PDF                     | planned     |
| `.md`          | Markdown with embedded math     | planned     |
| Anki           | flashcard export                | planned     |
| share link     | read-only shared document       | planned     |

`lib/blocks/types.ts` is intentionally serialization-agnostic — it "knows nothing about
LaTeX." The LaTeX/KaTeX adapter lives in
[`../lib/blocks/serialize.ts`](../lib/blocks/serialize.ts) and is **implemented + tested**:
it is table-driven over all 16 block types and exposes `documentToLatex()`,
`blockToLatex()`, and `blockToKatex()`.

## The WYSIWYG render pipeline

On-screen math is produced by serializing the tree to LaTeX and handing that to KaTeX:

```
DocumentTree → blockToKatex(block) → LaTeX string → katex.render() → DOM
```

This keeps the editor WYSIWYG while reusing a battle-tested typesetter: blocks render
exactly as their exported LaTeX would. `katex/dist/katex.min.css` is already imported in
[`../app/layout.tsx`](../app/layout.tsx), and `globals.css` tunes `.katex` sizing. This loop
is **wired and working**: [`../components/BlockView.tsx`](../components/BlockView.tsx)
dispatches each block (math through `blockToKatex`, text/code/image/tikz natively) and
[`../components/Katex.tsx`](../components/Katex.tsx) calls `katex.renderToString`. The
minimal editor at [`../app/editor/[id]/page.tsx`](../app/editor/%5Bid%5D/page.tsx) drives it,
with a Source-view toggle that shows `documentToLatex(tree)`.

## Document style: the LaTeX preset

`DocumentTree.style` carries the document's typography, and every document authored here
starts in the **LaTeX preset** (`style.preset === "latex"`, stamped by `emptyDocument`).
That is not a theme — it is `article` at 11pt, reproduced from the class files:

| | LaTeX preset | Plain (pre-0.8.1) |
|---|---|---|
| body | Computer Modern, 10.95pt (`[11pt]`'s `\normalsize`) | 14px |
| leading | 1.242 (13.6pt baseline) | 1.5 |
| paragraphs | justified, `\parindent` 17pt, `\parskip` 0 | ragged right, no indent, 4px gap |
| margins | 22mm, matching the export's `geometry` | 9% of page width |
| headings | `\Large` / `\large` / `\normalsize`, `article`'s own skips | 24 / 20 / 18 / 16px |

[`../lib/blocks/docstyle.ts`](../lib/blocks/docstyle.ts) is the single source for all of it:
`resolveStyle()` fills a document's blanks from its preset, and the editor, the library
cover thumbnails ([`../components/NoteCover.tsx`](../components/NoteCover.tsx)) and the
typeset PDF export ([`../lib/export/pdf.ts`](../lib/export/pdf.ts), which derives
`\documentclass`, `geometry`, `\linespread`, `\parindent` and `\parskip` from the same
values) all read from it — so the page on screen and the compiled PDF agree.

What is a *relationship between blocks* — section skips, the absent paragraph gap, the
paragraphs that take no first-line indent — lives in the `.aq-tex` rules in
[`../app/globals.css`](../app/globals.css) instead, since no single block can know it.
Two consequences worth remembering when touching the editor:

- Those skips are **padding, not margin**, because the paginator measures blocks with
  `offsetHeight`. A margin would make page breaks drift.
- Editor chrome (the press-to-edit hit target, hover actions) must not take layout
  space, or blocks stop matching the document — hence `TEXT_HIT` carrying no padding of
  its own. There is no per-block move up / drag / move down column in the margin; it was
  removed, and sections still reorder by dragging in the outline.

The body font is vendored, not fetched: [`../scripts/prepare-fonts.mjs`](../scripts/prepare-fonts.mjs)
copies the OFL Computer Modern faces into `public/fonts/cm`, so the default style also
holds offline and in the iPad shell.

## Undo / redo on the tree

Because the tree is the single source of truth, history is modeled as snapshots/operations
over `DocumentTree` rather than over text or DOM. Undo/redo restores prior tree states;
every derived output (KaTeX, `.tex`, etc.) is recomputed from the restored tree, so history
stays consistent across all serializations. **(Planned — no history implementation exists
yet.)**

## Flow vs spatial canvas modes

`DocumentTree.mode` is a `CanvasMode` of `"flow" | "spatial"`:

- **flow** — top-level blocks stack linearly, like a document.
- **spatial** — each block may carry an optional position (`attrs.x` / `attrs.y`) and is
  placed freely on a canvas.

The mode is part of the document shape today and is surfaced into the library UI via
`NoteMeta.mode`. The spatial canvas interaction itself is **planned**.
