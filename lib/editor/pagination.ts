import type { Block } from "@/lib/blocks/types";

/** Greedily pack blocks into A4-height pages by their measured heights. */
export function paginate(
  blocks: Block[],
  heights: Record<string, number>,
  pageContent: number,
): string[][] {
  const pages: string[][] = [];
  let cur: string[] = [];
  let curH = 0;
  for (const b of blocks) {
    const h = (heights[b.id] ?? 0) + 4; // + inter-block gap
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
