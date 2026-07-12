/**
 * Section-outline helpers over a document's block list: which headings exist,
 * which blocks a collapsed section hides, and whole-section reordering.
 */

import { headingLevel } from "./headings";
import type { Block } from "./types";

/** One entry in the section outline (a heading). */
export interface OutlineItem {
  id: string;
  text: string;
  level: number;
  collapsed: boolean;
}

export const isHeadingCollapsed = (b: Block): boolean => !!b.attrs?.collapsed;

/** The flat outline (one entry per heading), in document order. */
export function computeOutline(blocks: Block[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const b of blocks) {
    if (b.type === "heading") {
      out.push({ id: b.id, text: b.value?.trim() || "Untitled heading", level: headingLevel(b), collapsed: isHeadingCollapsed(b) });
    }
  }
  return out;
}

/**
 * Block ids hidden because they live inside a collapsed section. A collapsed
 * heading hides every following block (incl. deeper headings) until the next
 * heading whose level is the same or higher. The collapsed heading itself shows.
 */
export function hiddenBlockIds(blocks: Block[]): Set<string> {
  const hidden = new Set<string>();
  let hiding = false;
  let threshold = 0;
  for (const b of blocks) {
    if (b.type === "heading") {
      const lvl = headingLevel(b);
      if (hiding) {
        if (lvl <= threshold) hiding = false; // this heading starts a visible region
        else { hidden.add(b.id); continue; } // deeper heading — stay hidden
      }
      if (isHeadingCollapsed(b)) { hiding = true; threshold = lvl; }
      continue;
    }
    if (hiding) hidden.add(b.id);
  }
  return hidden;
}

/** [start, end) index range of a heading's section subtree (heading + its body). */
export function sectionRange(blocks: Block[], headingId: string): [number, number] | null {
  const start = blocks.findIndex((b) => b.id === headingId);
  if (start < 0 || blocks[start].type !== "heading") return null;
  const level = headingLevel(blocks[start]);
  let end = start + 1;
  while (end < blocks.length) {
    const b = blocks[end];
    if (b.type === "heading" && headingLevel(b) <= level) break;
    end++;
  }
  return [start, end];
}

/** Move the `from` heading's whole section relative to the `to` section (or end). */
export function reorderSectionBlocks(blocks: Block[], fromId: string, toId: string | null): Block[] {
  const from = sectionRange(blocks, fromId);
  if (!from) return blocks;
  const moving = blocks.slice(from[0], from[1]);
  const rest = [...blocks.slice(0, from[0]), ...blocks.slice(from[1])];
  if (toId === null) return [...rest, ...moving]; // drop at end
  const origTo = sectionRange(blocks, toId);
  const movingDown = !!origTo && origTo[0] > from[0];
  const to = sectionRange(rest, toId);
  if (!to) return blocks; // target was inside the moved subtree (e.g. its own child)
  // Dragging down → drop AFTER the target section; dragging up → drop BEFORE it.
  const at = movingDown ? to[1] : to[0];
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}
