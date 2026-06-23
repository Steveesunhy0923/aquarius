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
