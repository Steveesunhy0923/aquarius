# Code blocks — runnable listings

Jupyter-style runnable code chunks inside a note. A code block is a first-class
block (`type: "code"`): CodeMirror 6 editing with per-language syntax
highlighting, a Run button, and captured outputs rendered under the code —
persisted with the note and exported to LaTeX.

## How it looks, and why

The page is a typeset A4 document in Computer Modern where **nothing else is
boxed** and every control is revealed in the margin. A code block is therefore
drawn as a *listing*, not as an IDE pane:

- One hairline rule on the left marks the code the way a blockquote marks a
  quote; it takes the accent while the caret is inside — that replaces the old
  card border as the "you are editing this" signal.
- The result hangs off a single `→` in quieter ink: an output is a consequence
  of the code, not a second code pane.
- Language and run counter live in a caption under the block, like a figure's.
  The language name is the button that opens the language menu.
- No header bar, no line-number gutter, no lint gutter — 5–20 line snippets
  don't need them, and dropping them lets the code sit at the document's own
  text column instead of 34px to the right of it.
- Syntax colors are deliberately desaturated so they carry structure without
  out-shouting the prose. All of them clear 4.5:1 on the page surface.

The payoff beyond looks: **what you see is what prints.** Controls carry
`print-hide`, so the printed page and the on-screen block are the same object —
and both now resemble the `lstlisting` that the LaTeX export produces. Before
this pass the same note had three different appearances (screen, print, PDF).

Design exploration and the shipped result are in
[design/codeblock.html](../design/codeblock.html) and
`design/codeblock-shipped*.png`.

## Using it

- Insert via the toolbar `⌗` split button (main click = Python; the chevron
  lists every language), or ⌘K → "Code block".
- **Shift+⏎ / ⌘+⏎ runs.** Python and JavaScript are runnable; the other
  languages (TypeScript, C, C++, Java, MATLAB, Julia, R, SQL, HTML, CSS, JSON,
  Shell, plain text) are highlight-only. The language menu tags runnable ones.
- **Kernels are per note, per language** — variables persist across blocks in
  the same note, like Jupyter cells. `[n]` shows the run counter, and a block
  waiting for a busy kernel shows "Queued…".
- **Stop** (while running) terminates the kernel: without cross-origin
  isolation there is no mid-run interrupt, so stopping discards the session's
  variables. "Restart kernel" in the ⋯ menu does the same on purpose. A run
  that never started is simply dropped — nothing is written to that block.

## Indentation

- **Enter auto-indents.** After `if x:` / `def f():` the caret lands one level
  in; after `return`, `pass`, `break`, `continue` or `raise` it steps back out
  by the block's own step (CodeMirror's Python grammar has no such rule, so
  `lib/editor/py-indent.ts` registers an `indentService`). Brace languages
  indent from the syntax tree, and a block with no grammar keeps the previous
  line's indentation. Tab indents, Shift-Tab outdents.
  That service answers **only while a line break is being simulated** — i.e.
  the Enter key. An indent service is also consulted by `indentRange`, which
  backs "Fix indentation"; answering there would dedent every `return` in the
  block and turn correct Python into a `SyntaxError`. `py-indent.ts` is kept
  out of `cm.ts` (which needs a DOM) precisely so that contract can be
  unit-tested — see `py-indent.test.ts`.
- **Wrapped lines stay aligned.** A long line's continuation rows hang at that
  line's own indentation instead of snapping to column 0 (a `Decoration.line`
  with matched `padding-left` / negative `text-indent`, cached per column).
- **Wrong indentation is flagged** by `lib/editor/indent.ts` — a pure,
  unit-tested pass surfaced through a CodeMirror linter: a dotted underline, a
  gutter dot, a hover message with a one-click **Fix**, and a header chip that
  jumps to the first bad line. Python gets the structural rules (unexpected
  indent, a dedent matching no open level, a missing block after `:`); every
  language gets the whitespace rules (tabs mixed with spaces, a line that
  disagrees with the block's indent character, an off-step indent). The step
  size is inferred from the code, so a 2-space block is never nagged for not
  being 4-space, and lines inside strings, comments, brackets or backslash
  continuations are exempt. ⋯ → **Fix indentation** reindents the whole block.
- **Staying quiet matters more than being thorough.** A block that merely ENDS
  on an opener (`if x:` with no body yet) is never flagged: that is the state
  the editor is in every time you press Enter after a colon. Only the first
  physical line of a multi-line statement carries indentation meaning, and only
  those lines vote on whether the block indents with tabs or spaces — otherwise
  tab-indented code with space-aligned arguments flags itself. `indent.fp.test.ts`
  is a false-positive sweep over tricky-but-valid snippets plus real shipped
  source files from `node_modules`; it asserts the checker says *nothing*.

## How it runs (all client-side)

Static export / Capacitor cannot rely on API routes, so execution is fully
in-browser (lib/run/):

- **JavaScript** — a sandboxed classic Blob worker (`js-worker.ts`): indirect
  eval in the worker global (so `var`/top-level `const`/`let` persist across
  runs — the rewrite skips strings, template literals and comments so code
  held in a string is never altered), console capture, REPL-style result
  formatting, and output bounded per message and per run. `setTimeout`/
  `setInterval` callbacks stay tagged with the run that created them, so a
  stray timer can't spill output into the next cell that runs.
- **Python** — Pyodide in a **module** Blob worker (`py-worker.ts`; Pyodide
  ≥ 314 is ESM-only). The core runtime (~14 MB) is vendored into
  `public/pyodide/` by `scripts/prepare-pyodide.mjs` (chained into
  dev/build/build:static, version-stamped so the copy is skipped when
  current), so Python works offline — including the iPad shell. Fallback is
  the version-pinned jsDelivr CDN; if neither loads the worker reports a boot
  error and the next Run retries from scratch. Third-party packages auto-load
  from imports via `loadPackagesFromImports` (network required for those
  wheels). The cell's value is `repr`'d **inside Python** (a small `_aq_run`
  helper) rather than after Pyodide's JS conversion, so `4/2` prints `2.0`
  like CPython and no PyProxy leaks; tracebacks are stripped of interpreter
  frames.
- `lib/run/manager.ts` owns kernels + transient run state. Streaming stdout
  stays OUT of the block tree (it would thrash autosave, Yjs collab and the
  whole-tree undo stack); the bounded final outputs (20 KB cap,
  `lib/blocks/codeblock.ts`) are committed to `attrs.outputs`/`attrs.execCount`
  in one write when the run finishes, and the transient state is then dropped
  so the persisted document drives the UI (that is what makes "Clear output",
  undo and collab updates visible). Read-only viewers keep their transient
  outputs, since their commit is a no-op. Replies carrying a stale run id are
  ignored, so late output is never attributed to another block.

## Data & export

- Model + defensive accessors: `lib/blocks/codeblock.ts` (graph.ts pattern —
  attrs arrive untrusted, readers never throw).
- LaTeX: `serializeCode` emits an `lstlisting` (language mapped to a
  listings-known name; unmapped → no `[language=…]`) plus a gray `% run
  output` listing, with `% requires` hints for hand-compiled `.tex` exports.
  `\end{lstlisting}` inside source/output is defused with an inserted space,
  and ANSI/C0 control bytes are stripped — TeX aborts on them. Preamble bits
  (xcolor, `keepspaces=true` so aligned output keeps its columns, no-op
  language defs) live in `lib/export/pdf.ts`. minted is not an option: the
  server compiles with `tectonic --untrusted`, i.e. no shell-escape.
- Read-only viewers can RUN blocks locally (execution is client-side), but
  outputs don't persist — `setBlocks` drops writes for viewers.
