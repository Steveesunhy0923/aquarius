/**
 * Paragraph indentation, the Google Docs way.
 *
 * An indent belongs to the WHOLE paragraph (`attrs.indent`, a count of
 * half-inch steps); it is never characters typed into the text. So every
 * wrapped line starts at the same edge, and Backspace at the start of an
 * indented paragraph takes a step off before it would join the paragraph above.
 * Tab at the start of a paragraph and ⌘] add a step; Shift+Tab and ⌘[ remove
 * one. The step is the same one a list level uses (lib/blocks/lists.ts), so an
 * indented paragraph lines up with the text of a bullet.
 */

import type { Block } from "./types";

/** Half an inch of the A4 sheet in CSS px (96 px to the inch): Docs' step. */
export const INDENT_STEP_PX = 48;
/** The same half inch in TeX points, for the export. */
export const INDENT_STEP_PT = 36;
/** Eight steps is four inches: past that the line is too short to write on. */
export const MAX_INDENT = 8;

export function paraIndent(b: Block | null | undefined): number {
  const v = b?.attrs?.indent;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(MAX_INDENT, Math.floor(v))) : 0;
}

/** The block with `level` indent steps (0 removes the attribute). */
export function withParaIndent(b: Block, level: number): Block {
  const n = Math.max(0, Math.min(MAX_INDENT, Math.floor(level)));
  if (n === paraIndent(b) && (n > 0 || b.attrs?.indent === undefined)) return b;
  const attrs = { ...b.attrs };
  if (n > 0) attrs.indent = n;
  else delete attrs.indent;
  return { ...b, attrs };
}

/**
 * A CSS length of `steps` indent steps. The page sets `--indent-step` (see
 * pageContentStyle), scaled with its zoom; the fallback is half an inch at the
 * 11pt body, for surfaces that draw a block outside a page (previews).
 */
export function indentCss(steps: number): string {
  return `calc(var(--indent-step, 3.27em) * ${steps})`;
}
