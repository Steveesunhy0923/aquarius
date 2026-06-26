/**
 * Heading blocks: Title / Subtitle / Subsubtitle / Subsubsubtitle (levels 1–4),
 * with optional numbering and alignment. Title (level 1) is always centered;
 * the others default to left and may be left/center/right.
 *
 * Exports to \section / \subsection / \subsubsection / \paragraph
 * (starred when unnumbered).
 */

import { escapeLatex } from "./captions";
import type { ImageAlign } from "./images";
import type { Block } from "@/lib/blocks/types";

export type HeadingLevel = 1 | 2 | 3 | 4;
export const HEADING_NAMES: Record<HeadingLevel, string> = {
  1: "Title",
  2: "Subtitle",
  3: "Subsubtitle",
  4: "Subsubsubtitle",
};

const uid = (): string => crypto.randomUUID();

export function headingLevel(block: Block): HeadingLevel {
  const l = block.attrs?.level;
  return l === 2 || l === 3 || l === 4 ? l : 1;
}

export function headingNumbered(block: Block): boolean {
  return block.attrs?.numbered !== false; // default numbered
}

/** Title (level 1) is always centered; other levels default to left. */
export function headingAlign(block: Block): ImageAlign {
  if (headingLevel(block) === 1) return "center";
  const a = block.attrs?.align;
  return a === "center" || a === "right" ? a : "left";
}

export function makeHeading(level: HeadingLevel = 1, text = ""): Block {
  return { id: uid(), type: "heading", value: text, attrs: { level, numbered: true } };
}

export function withHeading(
  block: Block,
  patch: { level?: HeadingLevel; numbered?: boolean; text?: string; align?: ImageAlign },
): Block {
  const attrs = { ...block.attrs };
  if (patch.level != null) attrs.level = patch.level;
  if (patch.numbered != null) attrs.numbered = patch.numbered;
  if (patch.align != null) attrs.align = patch.align;
  return {
    ...block,
    value: patch.text ?? block.value,
    attrs,
  };
}

/** Displayed number (e.g. "2.1.3") for each NUMBERED heading, in document order. */
export function computeHeadingNumbers(blocks: Block[]): Map<string, string> {
  const map = new Map<string, string>();
  const counters = [0, 0, 0, 0];
  for (const b of blocks) {
    if (b.type !== "heading" || !headingNumbered(b)) continue;
    const lvl = headingLevel(b);
    counters[lvl - 1] += 1;
    for (let i = lvl; i < 4; i++) counters[i] = 0;
    map.set(b.id, counters.slice(0, lvl).join("."));
  }
  return map;
}

/** Serialize a heading to LaTeX (starred when unnumbered). */
export function headingToLatex(block: Block): string {
  const cmd = ["section", "subsection", "subsubsection", "paragraph"][headingLevel(block) - 1];
  const star = headingNumbered(block) ? "" : "*";
  return `\\${cmd}${star}{${escapeLatex(block.value ?? "")}}`;
}
