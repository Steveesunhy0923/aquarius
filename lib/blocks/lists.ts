/**
 * List blocks: numbered (ordered) or bulleted (unordered). Items are prose
 * strings that support the same bold / italic / etc. formatting markers.
 * Exports to LaTeX enumerate / itemize.
 *
 * Nesting follows Google Docs. Every item has a LEVEL (`attrs.levels`, parallel
 * to `attrs.items`): Tab at the start of an item nests it under the item above,
 * Shift+Tab lifts it back out, and each level indents by the same half-inch step
 * a paragraph indent uses (lib/blocks/indent.ts), so a bullet's text and an
 * indented paragraph share one left edge. The marker cycles per level
 * (• ◦ ▪, 1. a. i.), as it does in Docs.
 */

import type { Block } from "@/lib/blocks/types";

const uid = (): string => crypto.randomUUID();

/** Marker styles. Values double as CSS `list-style-type` names. */
export type BulletMarker = "disc" | "circle" | "square";
export type NumberMarker = "decimal" | "lower-alpha" | "lower-roman";
export type ListMarker = BulletMarker | NumberMarker;

export const BULLET_MARKERS: BulletMarker[] = ["disc", "circle", "square"];
export const NUMBER_MARKERS: NumberMarker[] = ["decimal", "lower-alpha", "lower-roman"];
const DEFAULT_BULLET: BulletMarker = "disc";
const DEFAULT_NUMBER: NumberMarker = "decimal";

/**
 * The deepest nesting level (0-based). LaTeX's itemize/enumerate stop at four
 * deep, and a fifth is a "Too deeply nested" compile error, so the editor stops
 * where the export would.
 */
export const MAX_LIST_LEVEL = 3;

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

/**
 * Clamp raw levels into a valid outline, one per item: the first item sits at
 * 0, and no item is more than one level deeper than the item above it (a child
 * needs a parent). Missing or malformed entries read as 0.
 */
export function normalizeLevels(levels: readonly unknown[], count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = levels[i];
    const want = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
    const cap = i === 0 ? 0 : Math.min(out[i - 1] + 1, MAX_LIST_LEVEL);
    out.push(Math.max(0, Math.min(want, cap)));
  }
  return out;
}

/** Each item's nesting level. A list with no `attrs.levels` is flat. */
export function listLevels(block: Block): number[] {
  const raw = block.attrs?.levels;
  return normalizeLevels(Array.isArray(raw) ? raw : [], listItems(block).length);
}

/** The marker drawn at `level`: the list's own marker at the top, then its
 *  family's cycle onward from there (disc → circle → square → disc …). */
export function markerAtLevel(block: Block, level: number): ListMarker {
  const family: ListMarker[] = listOrdered(block) ? NUMBER_MARKERS : BULLET_MARKERS;
  const start = Math.max(0, family.indexOf(listMarker(block)));
  return family[(start + level) % family.length];
}

/** The visible marker for the n-th (1-based) item of a run. */
export function markerText(marker: ListMarker, n: number): string {
  switch (marker) {
    case "disc": return "•";
    case "circle": return "◦";
    case "square": return "▪";
    case "decimal": return `${n}.`;
    case "lower-alpha": return `${alpha(n)}.`;
    case "lower-roman": return `${roman(n)}.`;
  }
}

function alpha(n: number): string {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
  return s || "a";
}

function roman(n: number): string {
  const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let s = "";
  let k = Math.max(1, n);
  for (const [v, r] of table) while (k >= v) { s += r; k -= v; }
  return s;
}

export interface ListRow {
  /** Index into `attrs.items`. */
  index: number;
  text: string;
  level: number;
  /** The marker as drawn: "•", "2.", "b.", … */
  marker: string;
}

/**
 * The rows a list draws, in order, with their markers worked out. Numbering
 * restarts under each parent and carries on past its children — 1, a, b, 2 —
 * as in Docs. `skipBlank` leaves empty items out (the read view).
 */
export function listRows(block: Block, skipBlank = false): ListRow[] {
  const items = listItems(block);
  const levels = listLevels(block);
  const counters: number[] = [];
  const rows: ListRow[] = [];
  items.forEach((text, index) => {
    if (skipBlank && !text.trim()) return;
    const level = levels[index];
    counters.length = level + 1; // a shallower item ends the deeper runs
    counters[level] = (counters[level] ?? 0) + 1;
    rows.push({ index, text, level, marker: markerText(markerAtLevel(block, level), counters[level]) });
  });
  return rows;
}

/**
 * Google Docs' list autoformat: "- ", "* " or "• " (bullets), or "1. " / "1) "
 * (numbers), typed at the very start of a paragraph turns the paragraph into a
 * list item, and whatever text already followed becomes the item's text — so
 * typing a bullet in front of an existing line puts that line in a list.
 * Null unless `text` starts with a trigger that ends exactly at `caret`.
 */
export function listTrigger(text: string, caret: number): { ordered: boolean; rest: string } | null {
  const m = /^([-*\u2022]|1[.)]) $/.exec(text.slice(0, caret));
  return m ? { ordered: m[1].startsWith("1"), rest: text.slice(caret) } : null;
}

/**
 * A list item's source with `$$…$$` read as maths. An item is one line of
 * prose, so an equation typed into it sits beside its bullet (in display style)
 * instead of showing its dollar signs.
 */
export function itemSource(src: string): string {
  if (!src.includes("$$")) return src;
  return src.replace(/\$\$([^$]+?)\$\$/g, (_m, tex: string) => `$\\displaystyle ${tex.trim()}$`);
}

/**
 * A new list: ONE empty item, ready to type into.
 *
 * Not seeded with sample text ("First item", "Second item"), which every user
 * has to select and delete before writing anything — a new list is as empty as
 * a new paragraph. It also means an abandoned list is `isEmptyBlock`, so
 * clicking away disposes of it instead of leaving fake content in the note.
 * Callers with real content (templates, the module builder) pass it through
 * `withList` and never see this default.
 */
export function makeList(ordered: boolean, marker?: ListMarker): Block {
  return {
    id: uid(),
    type: "list",
    attrs: {
      ordered,
      marker: marker ?? (ordered ? DEFAULT_NUMBER : DEFAULT_BULLET),
      items: [""],
    },
  };
}

/**
 * New items (and optionally kind and levels) for a list.
 *
 * Levels travel with their items. A caller that keeps the same number of items
 * without passing levels keeps the nesting (switching bulleted ↔ numbered); one
 * that reshapes the items without saying where the levels went gets a flat list
 * rather than levels shifted onto the wrong lines.
 */
export function withList(block: Block, items: string[], ordered?: boolean, levels?: readonly number[]): Block {
  const attrs = { ...block.attrs };
  const prev = block.attrs?.levels;
  attrs.items = items;
  if (ordered != null) attrs.ordered = ordered;
  const source = levels ?? (Array.isArray(prev) && prev.length === items.length ? prev : null);
  const norm = source ? normalizeLevels(source, items.length) : null;
  if (norm && norm.some((l) => l > 0)) attrs.levels = norm;
  else delete attrs.levels;
  return { ...block, attrs };
}
