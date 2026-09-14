/**
 * Editor source <-> block-tree helpers.
 *
 * The block tree is the source of truth, but the *interim* editor lets you edit
 * a block's content as text:
 *   - a paragraph is edited as prose with inline maths written `$…$` (and the
 *     older `\(…\)`, still read); a paragraph that is nothing but `$$…$$` is
 *     an equation, and becomes a display formula block
 *   - a formula is edited as its raw LaTeX
 * and both render live via KaTeX. The full structural (argument-slot) editor is
 * the planned next step; until then this keeps every block fully editable.
 *
 * A "raw" formula is stored as a `math` block wrapping a single `symbol` leaf
 * whose value is the LaTeX, so it round-trips through the existing serializer
 * (blockToKatex / documentToLatex) unchanged.
 *
 * Every builder here is 1:1 (one source string → one block) except
 * `blocksFromSource`, which is the entry point for payloads that arrive as
 * several blocks at once — a handwriting recognition covering a whole page, or
 * a paste.
 */

import { blockToKatex } from "@/lib/blocks";
import { ceInner, tagChem } from "@/lib/blocks/chem";
import { previewEnvCells } from "@/lib/blocks/mathenv";
import type { Block, InlineRun } from "@/lib/blocks/types";

const uid = (): string => crypto.randomUUID();

/** A formula stored as raw LaTeX (math block → single symbol leaf). */
export function rawMath(latex: string, id: string = uid()): Block {
  return {
    id,
    type: "math",
    slots: { body: [{ id: uid(), type: "symbol", value: latex }] },
  };
}

/** A paragraph is a text block (possibly carrying inline-math runs). */
export function isParagraph(block: Block): boolean {
  return block.type === "text";
}

/** True when a block has any renderable content (used to show placeholders). */
export function hasContent(block: Block): boolean {
  if (isParagraph(block)) {
    if (block.value && block.value.trim()) return true;
    const runs = block.attrs?.runs as InlineRun[] | undefined;
    return Boolean(
      runs?.some((r) =>
        r.kind === "math" ? true : Boolean(r.text && r.text.trim()),
      ),
    );
  }
  return blockToKatex(block).trim().length > 0;
}

/**
 * Inline maths in the editable paragraph source is written `$…$` — what people
 * type, and what every maths-aware editor they have used accepts. `\(…\)` is
 * still READ, because notes written before this (and handwriting recognitions,
 * which emit it) are full of it.
 *
 * A `$` is only a delimiter when it reads like one, so prose about money keeps
 * working: "it costs $5, not $10" has whitespace before its closing `$` and is
 * left alone, and `\$` is always a literal dollar. `$$` is never an inline
 * delimiter — that is a display equation, which is a block of its own
 * (`displayMathSource`).
 */

/** Where a `$…$` span that opened at `from` closes, or -1. */
function closingDollar(src: string, from: number): number {
  if (from >= src.length || /\s/.test(src[from])) return -1; // "$ x$" is not maths
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "\n") return -1; // a span never crosses a line
    if (c === "\\") { i++; continue; } // \$ and friends are literals
    if (c !== "$") continue;
    if (src[i + 1] === "$") return -1; // ran into a display delimiter
    if (i === from) return -1; // "$$" — empty
    if (/\s/.test(src[i - 1])) return -1; // "$5, not $10" — money, not maths
    return i;
  }
  return -1;
}

/**
 * Locate every inline-math span in the source, in order — `$…$` and the legacy
 * `\(…\)`. The i-th span corresponds 1:1 to the i-th math run from
 * `runsFromSource` (this is what that function walks), so a caret or a chip can
 * be mapped back to its source range.
 */
export function inlineMathSpans(src: string): { start: number; end: number; latex: string }[] {
  const spans: { start: number; end: number; latex: string }[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] === "(") {
        const end = src.indexOf("\\)", i + 2);
        if (end < 0) break;
        spans.push({ start: i, end: end + 2, latex: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
      i += 2; // an escape — `\$` is a dollar sign, not a delimiter
      continue;
    }
    if (c === "$") {
      if (src[i + 1] === "$") { i += 2; continue; } // display maths, handled elsewhere
      const end = closingDollar(src, i + 1);
      if (end > 0) {
        spans.push({ start: i, end: end + 1, latex: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    i++;
  }
  return spans;
}

/**
 * The inline-math span the caret is strictly INSIDE (between its delimiters),
 * with its index, or null. A caret on the outer edge of either delimiter is
 * outside: that is where arrowing past a formula, or closing its box, leaves it.
 */
export function inlineSpanAt(src: string, caret: number): { index: number; start: number; end: number; latex: string } | null {
  const spans = inlineMathSpans(src);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (caret > s.start && caret < s.end) return { index: i, ...s };
  }
  return null;
}

/** An inline formula as paragraph source: `$latex$`, or nothing when empty.
 *  Trimmed, because "$ x$" and "$x $" do not read as maths (closingDollar). */
export function inlineSource(latex: string): string {
  const t = latex.trim();
  return t ? `$${t}$` : "";
}

/**
 * The LaTeX of a source that is ENTIRELY one `$$…$$` display equation, else
 * null. Typing `$$E = mc^2$$` in a paragraph and leaving it turns the paragraph
 * into an equation block — the same promotion `blocksFromSource` does for a
 * pasted or hand-written line that is nothing but maths.
 */
export function displayMathSource(src: string): string | null {
  const t = src.trim();
  if (!t.startsWith("$$") || !t.endsWith("$$") || t.length < 5) return null;
  const inner = t.slice(2, -2);
  return inner.includes("$$") || !inner.trim() ? null : inner.trim();
}

/** Split editable paragraph source into text / inline-math runs. */
export function runsFromSource(src: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let last = 0;
  for (const span of inlineMathSpans(src)) {
    if (span.start > last) runs.push({ kind: "text", text: src.slice(last, span.start) });
    runs.push({ kind: "math", block: rawMath(span.latex) });
    last = span.end;
  }
  if (last < src.length) runs.push({ kind: "text", text: src.slice(last) });
  if (runs.length === 0) runs.push({ kind: "text", text: "" });
  return runs;
}

/**
 * Replace the inner LaTeX of the index-th inline-math span (empty `latex`
 * removes the whole span). Editing the SOURCE STRING — never `attrs.runs`
 * directly — is required: `commit` rebuilds the block from the source via
 * `paragraphFromSource` every keystroke, so a direct runs mutation wouldn't survive.
 */
export function replaceInlineMathSpan(src: string, index: number, latex: string): string {
  const spans = inlineMathSpans(src);
  const s = spans[index];
  if (!s) return src;
  const replacement = latex.trim() ? `$${latex}$` : "";
  return src.slice(0, s.start) + replacement + src.slice(s.end);
}

/** Inverse of runsFromSource: render runs back to editable source text. */
export function runsToSource(runs: InlineRun[]): string {
  return runs
    .map((r) => (r.kind === "text" ? r.text : `$${blockToKatex(r.block)}$`))
    .join("");
}

/** The editable text for a block (paragraph prose w/ inline math, or LaTeX). */
export function blockEditSource(block: Block): string {
  if (isParagraph(block)) {
    const runs = block.attrs?.runs as InlineRun[] | undefined;
    if (runs && runs.length) return runsToSource(runs);
    return block.value ?? "";
  }
  return blockToKatex(block);
}

/** Build a paragraph block from edited source, preserving id when given. */
export function paragraphFromSource(src: string, id: string = uid()): Block {
  const runs = runsFromSource(src);
  const text = runs
    .map((r) => (r.kind === "text" ? r.text : ""))
    .join("");
  return { id, type: "text", value: text, attrs: { runs } };
}

/** Build a display-formula block from edited LaTeX, preserving id when given. */
export function displayFromSource(src: string, id: string = uid()): Block {
  return rawMath(src.trim(), id);
}

/**
 * Split a whole source payload — a handwriting recognition, a paste — into one
 * or more document blocks.
 *
 * What separates blocks is a BLANK LINE, never a single newline. A lone `\n`
 * belongs INSIDE one block: the editable textarea grows to fit it
 * (EditBox `rows={draft.split("\n").length}`), the rendered paragraph is
 * `whitespace-pre-wrap`, and collab syncs a paragraph as its source string, so
 * the break survives everywhere. Splitting on every `\n` instead would be a
 * quiet semantic change on export — `documentToLatex` joins top-level blocks
 * with "\n\n" (a real paragraph break) while an interior `\n` is just
 * inter-word space. Handwriting comes back one line per written line, and a
 * hand-written paragraph must stay one paragraph.
 *
 * A chunk that is nothing but ONE `\(…\)` span is promoted to a DISPLAY
 * formula — that is what a centred equation written between two prose lines
 * means — and is chem-tagged when its LaTeX is a pure `\ce{…}`, because
 * chemistry identity is STORED on the block and never re-sniffed from the
 * string (lib/blocks/chem.ts). Everything else becomes a paragraph, inline
 * math included.
 *
 * Empty or whitespace-only input yields NO blocks. Callers splice the result
 * into the document, and a recognition that found nothing must not leave a
 * blank paragraph behind (note the empty array: `blocks[0]` is not safe).
 */
export function blocksFromSource(src: string): Block[] {
  const chunks = src
    .replace(/\r\n?/g, "\n") // CR / CRLF from a paste — the grammar is \n-only
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
  return chunks.map((chunk) => {
    const display = displayMathSource(chunk);
    if (display != null) {
      const block = displayFromSource(display);
      return ceInner(display) != null ? tagChem(block) : block;
    }
    const runs = runsFromSource(chunk);
    const only = runs.length === 1 ? runs[0] : undefined;
    // A chunk that is nothing but maths becomes a DISPLAY formula — but only
    // for `\(…\)`, which is what a handwriting recognition or a LaTeX paste
    // emits for a line that stood on its own. `$…$` is the inline delimiter the
    // user typed on purpose; promoting that would contradict `$$…$$`.
    if (!only || only.kind !== "math" || !chunk.trim().startsWith("\\(")) return paragraphFromSource(chunk);
    // Re-serialize rather than re-slicing the source: `rawMath` stores the
    // inner LaTeX verbatim, so this is the exact text between the delimiters.
    const latex = blockToKatex(only.block);
    const block = displayFromSource(latex);
    return ceInner(latex) != null ? tagChem(block) : block;
  });
}

/**
 * Make an insert-snippet renderable as a KaTeX preview by filling empty
 * arguments with sample letters (a, b, c…) instead of placeholder boxes, and
 * giving a leading `^`/`_` a base — so `\frac{}{}` previews as `\frac{a}{b}`,
 * `^{}` as `a^{b}`, `\sum_{}^{}` as `\sum_{a}^{b}`, etc.
 *
 * An environment that draws delimiters previews as JUST those delimiters, sized
 * like every other icon in the picker — `[ ]` says "matrix" more plainly than a
 * worked 2×2 does, and at a fraction of the height (see `previewEnvCells`).
 */
export function previewLatex(latex: string): string {
  const letters = ["a", "b", "c", "d", "e"];
  let i = 0;
  const next = () => letters[i++] ?? "x";
  let s = previewEnvCells(latex, next);
  s = s.replace(/\[\]/g, "[n]"); // optional arg, e.g. nth-root index
  const base = /^[\^_]/.test(s) ? next() : ""; // base for a leading sup/sub
  s = s.replace(/\{\}/g, () => `{${next()}}`); // fill empty groups
  return base + s;
}
