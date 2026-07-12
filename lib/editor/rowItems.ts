/**
 * Generic reorder/move for the item lists inside a figure row block (images or
 * tables) — one implementation parameterized by the block's item accessors.
 */

import type { Block, Placement } from "@/lib/blocks/types";

export interface RowItems<T extends { pos?: Placement }> {
  items: (b: Block) => T[];
  withItems: (b: Block, items: T[]) => Block;
}

/** Reorder an item within its block; returns the block unchanged when invalid. */
export function reorderRowItem<T extends { pos?: Placement }>(
  row: RowItems<T>,
  block: Block,
  from: number,
  to: number,
): Block {
  const items = [...row.items(block)];
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return block;
  const [m] = items.splice(from, 1);
  items.splice(to, 0, m);
  return row.withItems(block, items);
}

/**
 * Move an item across blocks. Crossing boxes reflows both: drop every object's
 * placement so each block re-centers and the in-flow LaTeX stays consistent
 * (all-or-none pos). Returns the blocks updater plus the clamped landing index,
 * or null when either block/item is missing.
 */
export function moveRowItemAcross<T extends { pos?: Placement }>(
  row: RowItems<T>,
  blocks: Block[],
  fromId: string,
  fromIndex: number,
  toId: string,
  toIndex: number,
): { update: (bs: Block[]) => Block[]; at: number } | null {
  const fromBlock = blocks.find((b) => b.id === fromId);
  const toBlock = blocks.find((b) => b.id === toId);
  if (!fromBlock || !toBlock) return null;
  const item = row.items(fromBlock)[fromIndex];
  if (!item) return null;
  const at = Math.max(0, Math.min(toIndex, row.items(toBlock).length));
  const drop = (it: T): T => {
    const c = { ...it };
    delete c.pos;
    return c;
  };
  const update = (bs: Block[]) =>
    bs.flatMap((b) => {
      if (b.id === fromId) {
        const items = row.items(b).filter((_, k) => k !== fromIndex).map(drop);
        return items.length ? [row.withItems(b, items)] : [];
      }
      if (b.id === toId) {
        const items = row.items(b).map(drop);
        items.splice(at, 0, drop(item));
        return [row.withItems(b, items)];
      }
      return [b];
    });
  return { update, at };
}
