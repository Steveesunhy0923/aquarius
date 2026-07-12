import { listItems } from "./lists";
import { hasContent } from "./source";
import type { Block } from "./types";

/** A block with no meaningful content (used to auto-remove abandoned boxes). */
export function isEmptyBlock(b: Block): boolean {
  switch (b.type) {
    case "heading":
      return !(b.value && b.value.trim());
    case "list":
      return listItems(b).every((x) => !x.trim());
    case "image":
    case "table":
    case "code":
    case "tikz":
    case "graph":
      return false;
    default:
      return !hasContent(b); // text or formula
  }
}

/** A document with no meaningful content (used to discard abandoned new notes). */
export function isEmptyDoc(blocks: Block[]): boolean {
  return blocks.length === 0 || blocks.every(isEmptyBlock);
}
