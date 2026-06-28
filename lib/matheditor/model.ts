/**
 * Structural math editor — core model (pure, no DOM, no React).
 *
 * The editor state is `{ tree, cursor }` where `tree` is a math block (the
 * source of truth — the same `Block` shape the rest of the app uses) and the
 * cursor is a position inside one ROW. A "row" is a `Block[]` held in a slot of
 * some block (e.g. a fraction's `num`, or the root math block's `body`). Because
 * every block has a unique id, a cursor only needs `{ rowOwnerId, slot, index }`.
 *
 * Everything here is pure: ops return a NEW tree + cursor (structural sharing),
 * so they're trivially unit-testable without a browser. This is where we get
 * integral-bound navigation right (which MathLive can't) — see `spatial.ts`.
 */

import type { Block, BlockId, BlockType, Slots } from "@/lib/blocks/types";

export interface Cursor {
  /** The block whose slot holds this row. */
  rowOwnerId: BlockId;
  /** Which slot of that block (e.g. "body" | "num" | "lower" | "r0c1"). */
  slot: string;
  /** Caret sits BEFORE row[index]; 0..row.length. */
  index: number;
}

export interface EditState {
  tree: Block;
  cursor: Cursor;
}

// ── Container vs leaf ─────────────────────────────────────────────────────────
// Containers have navigable slots; leaf atoms carry a `value`.
const CONTAINER_TYPES = new Set<BlockType>([
  "math", "fraction", "root", "script", "integral", "bigop", "matrix", "group",
]);
export function isContainer(b: Block): boolean {
  return CONTAINER_TYPES.has(b.type);
}
export function isLeaf(b: Block): boolean {
  return !isContainer(b);
}

// ── Spatial maps — per-structure caret navigation ─────────────────────────────
/**
 * Defines how the caret moves through a structure's slots. `slotsLR` is the
 * left→right traversal order (only slots on the horizontal path); `enter` is the
 * slot the caret lands in when entering/creating the structure; `up`/`down` map a
 * slot to its vertical neighbour. This is DISTINCT from `cursorSlots` (Tab order)
 * and is what makes e.g. an integral default to the LOWER bound and let arrows
 * switch lower↔upper — the thing MathLive gets wrong.
 */
export interface SpatialMap {
  slotsLR: string[];
  enter: string;
  up?: Record<string, string>;
  down?: Record<string, string>;
}

export const SPATIAL: Partial<Record<BlockType, SpatialMap>> = {
  math: { slotsLR: ["body"], enter: "body" },
  group: { slotsLR: ["body"], enter: "body" },
  // Fraction: stacked. Right from num exits; Up/Down switch num↔den.
  fraction: { slotsLR: ["num"], enter: "num", up: { den: "num" }, down: { num: "den" } },
  // Root: radicand on the line, index up at the kink.
  root: { slotsLR: ["radicand"], enter: "radicand", up: { radicand: "index" }, down: { index: "radicand" } },
  // Script: base on the line; sup above, sub below (reach via Up/Down).
  script: { slotsLR: ["base"], enter: "base", up: { sub: "base", base: "sup" }, down: { sup: "base", base: "sub" } },
  // Integral: caret defaults to the LOWER bound. Bounds switch with the upper on
  // the left of the pair, so Right goes upper→lower and Left goes lower→upper
  // (matching MathLive's feel); Up→upper, Down→lower. From the lower bound, Right
  // continues on into the integrand.
  integral: { slotsLR: ["upper", "lower", "integrand", "diff"], enter: "lower", up: { lower: "upper" }, down: { upper: "lower" } },
  bigop: { slotsLR: ["upper", "lower", "operand"], enter: "lower", up: { lower: "upper" }, down: { upper: "lower" } },
  // Matrix navigation is grid-based — handled specially in nav.ts.
};

export function spatialOf(b: Block): SpatialMap {
  return SPATIAL[b.type] ?? { slotsLR: Object.keys(b.slots ?? {}), enter: Object.keys(b.slots ?? {})[0] ?? "body" };
}

// ── Pure tree lookup + structural-sharing update ──────────────────────────────

export function findBlock(tree: Block, id: BlockId): Block | null {
  if (tree.id === id) return tree;
  if (!tree.slots) return null;
  for (const children of Object.values(tree.slots)) {
    for (const c of children) {
      const found = findBlock(c, id);
      if (found) return found;
    }
  }
  return null;
}

export function findRow(tree: Block, ownerId: BlockId, slot: string): Block[] | null {
  const owner = findBlock(tree, ownerId);
  return owner?.slots?.[slot] ?? null;
}

/** The block that directly contains `childId`, plus the slot + index it sits at. */
export function findParent(
  tree: Block,
  childId: BlockId,
): { owner: Block; slot: string; index: number } | null {
  if (tree.slots) {
    for (const [slot, children] of Object.entries(tree.slots)) {
      const index = children.findIndex((c) => c.id === childId);
      if (index >= 0) return { owner: tree, slot, index };
      for (const c of children) {
        const found = findParent(c, childId);
        if (found) return found;
      }
    }
  }
  return null;
}

/** Return a NEW tree with block `id` replaced by `fn(block)` (path cloned). */
export function updateBlock(tree: Block, id: BlockId, fn: (b: Block) => Block): Block {
  if (tree.id === id) return fn(tree);
  if (!tree.slots) return tree;
  let changed = false;
  const slots: Slots = {};
  for (const [name, children] of Object.entries(tree.slots)) {
    const next = children.map((c) => updateBlock(c, id, fn));
    if (next.some((c, i) => c !== children[i])) changed = true;
    slots[name] = next;
  }
  return changed ? { ...tree, slots } : tree;
}

/** Return a NEW tree with `ownerId`'s `slot` row replaced by `newRow`. */
export function replaceRow(tree: Block, ownerId: BlockId, slot: string, newRow: Block[]): Block {
  return updateBlock(tree, ownerId, (b) => ({ ...b, slots: { ...(b.slots ?? {}), [slot]: newRow } }));
}
