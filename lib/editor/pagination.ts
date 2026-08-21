import type { Block } from "@/lib/blocks/types";

/**
 * Greedily pack blocks into A4-height pages by their measured heights.
 *
 * `gap` is the document's inter-block gap in px (0 under the LaTeX preset,
 * where paragraphs abut). The blocks' own vertical skips are NOT added here:
 * they are padding, so the caller's offsetHeight measurement already has them.
 */
export function paginate(
  blocks: Block[],
  heights: Record<string, number>,
  pageContent: number,
  gap = 4,
): string[][] {
  const pages: string[][] = [];
  let cur: string[] = [];
  let curH = 0;
  for (const b of blocks) {
    const h = (heights[b.id] ?? 0) + gap;
    if (cur.length && curH + h > pageContent) {
      pages.push(cur);
      cur = [];
      curH = 0;
    }
    cur.push(b.id);
    curH += h;
  }
  pages.push(cur); // always at least one page (possibly empty)
  return pages;
}
