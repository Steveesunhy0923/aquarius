/**
 * Captions for figure/table blocks. Stored as `attrs.caption` on image and
 * table blocks; rendered below the block in-app and exported as `\caption{…}`
 * inside a figure/table environment.
 */

import type { Block } from "@/lib/blocks/types";

export function captionOf(block: Block): string {
  const c = block.attrs?.caption;
  return typeof c === "string" ? c : "";
}

export function withCaption(block: Block, caption: string): Block {
  const attrs = { ...block.attrs };
  if (caption) attrs.caption = caption;
  else delete attrs.caption;
  return { ...block, attrs };
}

const ESC: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};
export function escapeLatex(s: string): string {
  return (s ?? "").replace(/[\\&%$#_{}~^]/g, (c) => ESC[c] ?? c);
}
