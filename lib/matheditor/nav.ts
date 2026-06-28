/**
 * Structural math editor — caret navigation (pure).
 *
 * moveLeft/moveRight walk the tree in reading order, descending into containers
 * and popping to parents at row edges. moveUp/moveDown switch vertically-stacked
 * slots (fraction num↔den, an integral's lower↔upper bounds). All functions take
 * and return a Cursor; the tree is read-only here.
 */

import type { Block } from "@/lib/blocks/types";

import { type Cursor, findBlock, findParent, findRow, isContainer, spatialOf } from "./model";

/** Place the caret just after `ownerId` within its parent row, or no-op at root. */
function exitAfter(tree: Block, ownerId: string, fallback: Cursor): Cursor {
  const parent = findParent(tree, ownerId);
  if (!parent) return fallback; // owner is the root → end of formula
  return { rowOwnerId: parent.owner.id, slot: parent.slot, index: parent.index + 1 };
}
/** Place the caret just before `ownerId` within its parent row, or no-op at root. */
function exitBefore(tree: Block, ownerId: string, fallback: Cursor): Cursor {
  const parent = findParent(tree, ownerId);
  if (!parent) return fallback;
  return { rowOwnerId: parent.owner.id, slot: parent.slot, index: parent.index };
}

export function moveRight(tree: Block, cursor: Cursor): Cursor {
  const row = findRow(tree, cursor.rowOwnerId, cursor.slot) ?? [];
  if (cursor.index < row.length) {
    const next = row[cursor.index];
    if (isContainer(next)) {
      // Descend into the leftmost slot, caret at its start.
      const sp = spatialOf(next);
      return { rowOwnerId: next.id, slot: sp.slotsLR[0] ?? sp.enter, index: 0 };
    }
    return { ...cursor, index: cursor.index + 1 }; // step over a leaf
  }
  // End of the row: advance to the next slot in slotsLR, or exit the container.
  const owner = findBlock(tree, cursor.rowOwnerId);
  if (owner) {
    const sp = spatialOf(owner);
    const i = sp.slotsLR.indexOf(cursor.slot);
    if (i >= 0 && i < sp.slotsLR.length - 1) {
      return { rowOwnerId: owner.id, slot: sp.slotsLR[i + 1], index: 0 };
    }
  }
  return exitAfter(tree, cursor.rowOwnerId, cursor);
}

export function moveLeft(tree: Block, cursor: Cursor): Cursor {
  const row = findRow(tree, cursor.rowOwnerId, cursor.slot) ?? [];
  if (cursor.index > 0) {
    const prev = row[cursor.index - 1];
    if (isContainer(prev)) {
      // Descend into the rightmost slot, caret at its end.
      const sp = spatialOf(prev);
      const lastSlot = sp.slotsLR[sp.slotsLR.length - 1] ?? sp.enter;
      const lastRow = prev.slots?.[lastSlot] ?? [];
      return { rowOwnerId: prev.id, slot: lastSlot, index: lastRow.length };
    }
    return { ...cursor, index: cursor.index - 1 }; // step over a leaf
  }
  // Start of the row: retreat to the previous slot's end, or exit the container.
  const owner = findBlock(tree, cursor.rowOwnerId);
  if (owner) {
    const sp = spatialOf(owner);
    const i = sp.slotsLR.indexOf(cursor.slot);
    if (i > 0) {
      const prevSlot = sp.slotsLR[i - 1];
      const prevRow = owner.slots?.[prevSlot] ?? [];
      return { rowOwnerId: owner.id, slot: prevSlot, index: prevRow.length };
    }
  }
  return exitBefore(tree, cursor.rowOwnerId, cursor);
}

function moveVertical(tree: Block, cursor: Cursor, dir: "up" | "down"): Cursor {
  let ownerId = cursor.rowOwnerId;
  let slot = cursor.slot;
  // Walk up: if this container has no vertical neighbour for the slot, treat the
  // container as a unit in its parent and check the parent's map.
  for (let guard = 0; guard < 64; guard++) {
    const owner = findBlock(tree, ownerId);
    if (!owner) return cursor;
    const map = dir === "up" ? spatialOf(owner).up : spatialOf(owner).down;
    const target = map?.[slot];
    if (target) {
      const targetRow = owner.slots?.[target] ?? [];
      return { rowOwnerId: owner.id, slot: target, index: Math.min(cursor.index, targetRow.length) };
    }
    const parent = findParent(tree, ownerId);
    if (!parent) return cursor; // nothing above/below anywhere
    ownerId = parent.owner.id;
    slot = parent.slot;
  }
  return cursor;
}

export const moveUp = (tree: Block, cursor: Cursor): Cursor => moveVertical(tree, cursor, "up");
export const moveDown = (tree: Block, cursor: Cursor): Cursor => moveVertical(tree, cursor, "down");
