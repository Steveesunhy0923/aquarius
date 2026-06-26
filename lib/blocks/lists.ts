/**
 * List blocks: numbered (ordered) or bulleted (unordered). Items are prose
 * strings that support the same bold / italic / etc. formatting markers.
 * Exports to LaTeX enumerate / itemize.
 */

import type { Block } from "@/lib/blocks/types";

const uid = (): string => crypto.randomUUID();

/** Marker styles. Values double as CSS `list-style-type` for on-screen render. */
export type BulletMarker = "disc" | "circle" | "square";
export type NumberMarker = "decimal" | "lower-alpha" | "lower-roman";
export type ListMarker = BulletMarker | NumberMarker;

export const BULLET_MARKERS: BulletMarker[] = ["disc", "circle", "square"];
export const NUMBER_MARKERS: NumberMarker[] = ["decimal", "lower-alpha", "lower-roman"];
const DEFAULT_BULLET: BulletMarker = "disc";
const DEFAULT_NUMBER: NumberMarker = "decimal";

export function listOrdered(block: Block): boolean {
  return block.attrs?.ordered === true;
}

/** The marker style, validated against the list's ordered/unordered kind. */
export function listMarker(block: Block): ListMarker {
  const m = block.attrs?.marker as ListMarker | undefined;
  if (listOrdered(block))
    return m && (NUMBER_MARKERS as string[]).includes(m) ? m : DEFAULT_NUMBER;
  return m && (BULLET_MARKERS as string[]).includes(m) ? m : DEFAULT_BULLET;
}

export function listItems(block: Block): string[] {
  const arr = block.attrs?.items;
  if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
  return [""];
}

export function makeList(ordered: boolean, marker?: ListMarker): Block {
  return {
    id: uid(),
    type: "list",
    attrs: {
      ordered,
      marker: marker ?? (ordered ? DEFAULT_NUMBER : DEFAULT_BULLET),
      items: ["First item", "Second item"],
    },
  };
}

export function withList(block: Block, items: string[], ordered?: boolean): Block {
  const attrs = { ...block.attrs };
  attrs.items = items;
  if (ordered != null) attrs.ordered = ordered;
  return { ...block, attrs };
}
