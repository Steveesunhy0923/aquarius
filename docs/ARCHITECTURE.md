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
- Editor chrome (the reorder column, the click-to-edit hit target) must not take layout
  space, or blocks stop matching the document — hence `EDIT_HIT`'s negative margins and
  the absolutely-positioned reorder controls in `EditorClient`.

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
