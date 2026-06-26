/**
 * List blocks: numbered (ordered) or bulleted (unordered). Items are prose
 * strings that support the same bold / italic / etc. formatting markers.
 * Exports to LaTeX enumerate / itemize.
 */

import type { Block } from "@/lib/blocks/types";

const uid = (): string => crypto.randomUUID();

export function listOrdered(block: Block): boolean {
  return block.attrs?.ordered === true;
}

export function listItems(block: Block): string[] {
  const arr = block.attrs?.items;
  if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
  return [""];
}

export function makeList(ordered: boolean): Block {
  return {
    id: uid(),
    type: "list",
    attrs: { ordered, items: ["First item", "Second item"] },
  };
}

export function withList(block: Block, items: string[], ordered?: boolean): Block {
  const attrs = { ...block.attrs };
  attrs.items = items;
  if (ordered != null) attrs.ordered = ordered;
  return { ...block, attrs };
}
