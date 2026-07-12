import { math as makeMathBlock } from "@/lib/blocks/factory";
import type { Block } from "@/lib/blocks/types";
import { insertSnippet } from "./ops";

/** A structural (block-tree) formula — tagged so legacy rawMath formulas (no
 *  marker) keep opening in MathLive. Only new equations made by the beta editor. */
export function isStructural(b: Block): boolean {
  return b.type === "math" && b.attrs?.editor === "structural";
}

/** Build a new tagged structural math block, optionally seeded with a snippet. */
export function structuralEquation(latex?: string): Block {
  const m = makeMathBlock();
  const tagged: Block = { ...m, attrs: { ...(m.attrs ?? {}), editor: "structural" } };
  if (!latex) return tagged;
  return insertSnippet(tagged, { rowOwnerId: tagged.id, slot: "body", index: 0 }, latex).tree;
}
