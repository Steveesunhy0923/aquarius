/**
 * Editor source <-> block-tree helpers.
 *
 * The block tree is the source of truth, but the *interim* editor lets you edit
 * a block's content as text:
 *   - a paragraph is edited as prose with inline math written `\(  \)`
 *   - a formula is edited as its raw LaTeX
 * and both render live via KaTeX. The full structural (argument-slot) editor is
 * the planned next step; until then this keeps every block fully editable.
 *
 * A "raw" formula is stored as a `math` block wrapping a single `symbol` leaf
 * whose value is the LaTeX, so it round-trips through the existing serializer
 * (blockToKatex / documentToLatex) unchanged.
 */

import { blockToKatex } from "@/lib/blocks";
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

/** Inline-math delimiter in the editable paragraph source: `\(  \)`. */
const INLINE_MATH = /\\\(([\s\S]*?)\\\)/g;

/** Split editable paragraph source into text / inline-math runs. */
export function runsFromSource(src: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_MATH.lastIndex = 0;
  while ((m = INLINE_MATH.exec(src))) {
    if (m.index > last) {
      runs.push({ kind: "text", text: src.slice(last, m.index) });
    }
    runs.push({ kind: "math", block: rawMath(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < src.length) runs.push({ kind: "text", text: src.slice(last) });
  if (runs.length === 0) runs.push({ kind: "text", text: "" });
  return runs;
}

/** Inverse of runsFromSource: render runs back to editable source text. */
export function runsToSource(runs: InlineRun[]): string {
  return runs
    .map((r) => (r.kind === "text" ? r.text : `\\(${blockToKatex(r.block)}\\)`))
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
 * Make an insert-snippet renderable as a KaTeX preview by filling empty
 * arguments with sample letters (a, b, c…) instead of placeholder boxes, and
 * giving a leading `^`/`_` a base — so `\frac{}{}` previews as `\frac{a}{b}`,
 * `^{}` as `a^{b}`, `\sum_{}^{}` as `\sum_{a}^{b}`, etc.
 */
export function previewLatex(latex: string): string {
  const letters = ["a", "b", "c", "d", "e"];
  let i = 0;
  const next = () => letters[i++] ?? "x";
  let s = latex.replace(/\[\]/g, "[n]"); // optional arg, e.g. nth-root index
  const base = /^[\^_]/.test(s) ? next() : ""; // base for a leading sup/sub
  s = s.replace(/\{\}/g, () => `{${next()}}`); // fill empty groups
  return base + s;
}
