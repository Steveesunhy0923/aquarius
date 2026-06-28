/**
 * Structural math editor — editing operations (pure) + char classification +
 * the toolbar/symbol snippet→structure map.
 *
 * Every op takes `{ tree, cursor }` and returns a NEW `{ tree, cursor }`, built
 * from the existing block factories. No DOM.
 */

import type { Block } from "@/lib/blocks/types";
import {
  bigop, fraction, identifier, integral, number as numberAtom, operator, root as rootBlock,
  script, symbol,
} from "@/lib/blocks/factory";

import { moveLeft } from "./nav";
import {
  type Cursor, type EditState, findBlock, findParent, findRow, isLeaf, replaceRow, spatialOf,
} from "./model";

function splice(row: Block[], index: number, ...items: Block[]): Block[] {
  return [...row.slice(0, index), ...items, ...row.slice(index)];
}

/** Insert a leaf atom at the caret; caret advances past it. */
export function insertAtom(tree: Block, cursor: Cursor, atom: Block): EditState {
  const row = findRow(tree, cursor.rowOwnerId, cursor.slot) ?? [];
  const next = replaceRow(tree, cursor.rowOwnerId, cursor.slot, splice(row, cursor.index, atom));
  return { tree: next, cursor: { ...cursor, index: cursor.index + 1 } };
}

/** Insert a container; caret moves into its `enter` slot (e.g. integral→lower). */
export function insertContainer(tree: Block, cursor: Cursor, make: () => Block): EditState {
  const container = make();
  const row = findRow(tree, cursor.rowOwnerId, cursor.slot) ?? [];
  const next = replaceRow(tree, cursor.rowOwnerId, cursor.slot, splice(row, cursor.index, container));
  return { tree: next, cursor: { rowOwnerId: container.id, slot: spatialOf(container).enter, index: 0 } };
}

/**
 * `^`/`_`: wrap the atom left of the caret as the base of a `script`, caret into
 * sup/sub. If the left atom is already a script, just move into that slot. If
 * there's nothing to the left, create a script with an empty base.
 */
export function applyScript(tree: Block, cursor: Cursor, which: "sup" | "sub"): EditState {
  const row = findRow(tree, cursor.rowOwnerId, cursor.slot) ?? [];
  const left = cursor.index > 0 ? row[cursor.index - 1] : null;
  if (left && left.type === "script") {
    const slotRow = left.slots?.[which] ?? [];
    return { tree, cursor: { rowOwnerId: left.id, slot: which, index: slotRow.length } };
  }
  const base = left && isLeaf(left) ? left : null;
  const scr = script(base ?? undefined);
  const start = base ? cursor.index - 1 : cursor.index;
  const removed = base ? row.slice(0, start).concat(row.slice(cursor.index)) : row;
  const newRow = splice(removed, start, scr);
  const next = replaceRow(tree, cursor.rowOwnerId, cursor.slot, newRow);
  return { tree: next, cursor: { rowOwnerId: scr.id, slot: which, index: 0 } };
}

/** `/`: wrap the atom left of the caret as the numerator (so "1/2" → ½), caret
 *  into the denominator. With nothing to the left, insert an empty fraction. */
export function applyFraction(tree: Block, cursor: Cursor): EditState {
  const row = findRow(tree, cursor.rowOwnerId, cursor.slot) ?? [];
  const left = cursor.index > 0 ? row[cursor.index - 1] : null;
  if (left && isLeaf(left)) {
    const frac = fraction(left);
    const newRow = splice(row.slice(0, cursor.index - 1).concat(row.slice(cursor.index)), cursor.index - 1, frac);
    const next = replaceRow(tree, cursor.rowOwnerId, cursor.slot, newRow);
    return { tree: next, cursor: { rowOwnerId: frac.id, slot: "den", index: 0 } };
  }
  return insertContainer(tree, cursor, () => fraction());
}

/** Backspace: delete the leaf left of the caret, step into a container, or remove
 *  an empty container and pop out. Non-destructive otherwise (v1). */
export function backspace(tree: Block, cursor: Cursor): EditState {
  const row = findRow(tree, cursor.rowOwnerId, cursor.slot) ?? [];
  if (cursor.index > 0) {
    const prev = row[cursor.index - 1];
    if (isLeaf(prev)) {
      const next = replaceRow(tree, cursor.rowOwnerId, cursor.slot, row.slice(0, cursor.index - 1).concat(row.slice(cursor.index)));
      return { tree: next, cursor: { ...cursor, index: cursor.index - 1 } };
    }
    // A container to the left → step INTO it (MathQuill-style), don't delete.
    return { tree, cursor: moveLeft(tree, cursor) };
  }
  // Start of a slot: if the whole owner container is empty, remove it.
  const owner = findBlock(tree, cursor.rowOwnerId);
  const parent = owner ? findParent(tree, owner.id) : null;
  if (owner && parent) {
    const allEmpty = Object.values(owner.slots ?? {}).every((r) => r.length === 0);
    if (allEmpty) {
      const parentRow = parent.owner.slots?.[parent.slot] ?? [];
      const next = replaceRow(tree, parent.owner.id, parent.slot, parentRow.slice(0, parent.index).concat(parentRow.slice(parent.index + 1)));
      return { tree: next, cursor: { rowOwnerId: parent.owner.id, slot: parent.slot, index: parent.index } };
    }
    return { tree, cursor: { rowOwnerId: parent.owner.id, slot: parent.slot, index: parent.index } };
  }
  return { tree, cursor };
}

/** Forward delete: remove the leaf right of the caret (v1: leaves containers). */
export function del(tree: Block, cursor: Cursor): EditState {
  const row = findRow(tree, cursor.rowOwnerId, cursor.slot) ?? [];
  if (cursor.index < row.length && isLeaf(row[cursor.index])) {
    const next = replaceRow(tree, cursor.rowOwnerId, cursor.slot, row.slice(0, cursor.index).concat(row.slice(cursor.index + 1)));
    return { tree: next, cursor };
  }
  return { tree, cursor };
}

// ── Char classification ───────────────────────────────────────────────────────
const OPERATOR_CHARS = new Set("+-=<>*/|,;:!".split(""));

/** Type a single printable character (a key press) into the formula. */
export function typeChar(tree: Block, cursor: Cursor, ch: string): EditState {
  if (ch === "/") return applyFraction(tree, cursor);
  if (ch === "^") return applyScript(tree, cursor, "sup");
  if (ch === "_") return applyScript(tree, cursor, "sub");
  if (/[0-9.]/.test(ch)) return insertAtom(tree, cursor, numberAtom(ch));
  if (/[A-Za-z]/.test(ch)) return insertAtom(tree, cursor, identifier(ch));
  if (OPERATOR_CHARS.has(ch)) return insertAtom(tree, cursor, operator(ch));
  return insertAtom(tree, cursor, symbol(ch)); // fallback (e.g. parens, unknown)
}

// ── Toolbar / SymbolPicker snippet → structural insert ────────────────────────
const SNIPPET_OPS: Record<string, (tree: Block, cursor: Cursor) => EditState> = {
  "\\frac{}{}": (t, c) => insertContainer(t, c, () => fraction()),
  "\\sqrt{}": (t, c) => insertContainer(t, c, () => rootBlock()),
  "^{}": (t, c) => applyScript(t, c, "sup"),
  "_{}": (t, c) => applyScript(t, c, "sub"),
  "\\sum_{}^{}": (t, c) => insertContainer(t, c, () => bigop("sum")),
  "\\prod_{}^{}": (t, c) => insertContainer(t, c, () => bigop("prod")),
  "\\int_{}^{}": (t, c) => insertContainer(t, c, () => integral()),
};

/**
 * Map a toolbar/SymbolPicker LaTeX snippet to a structural insert. Known
 * structures build the real container (cursor in its first slot — e.g. an
 * integral's LOWER bound); anything else becomes a single `symbol` atom carrying
 * the LaTeX (renders + serializes correctly).
 */
export function insertSnippet(tree: Block, cursor: Cursor, latex: string): EditState {
  const op = SNIPPET_OPS[latex];
  if (op) return op(tree, cursor);
  return insertAtom(tree, cursor, symbol(latex));
}
