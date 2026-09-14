/**
 * Structural math editor — editing operations (pure) + char classification +
 * the toolbar/symbol snippet→structure map.
 *
 * Every op takes `{ tree, cursor }` and returns a NEW `{ tree, cursor }`, built
 * from the existing block factories. No DOM.
 */

import type { Block } from "@/lib/blocks/types";
import {
  bigop, cursorSlots, fraction, identifier, integral, matrix, number as numberAtom, operator,
  root as rootBlock, script, symbol,
} from "@/lib/blocks/factory";
import { ENV_COLS, ENV_ROWS, fillEnvCells } from "@/lib/blocks/mathenv";

import { moveLeft } from "./nav";
import {
  type Cursor, type EditState, findBlock, findParent, findRow, isLeaf, replaceRow, spatialOf,
  updateBlock,
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

// ── Growing a grid (matrix rows / cases) ──────────────────────────────────────

/** The cell coordinate a cursor sits in, when it is inside a matrix at all. */
function cellAt(tree: Block, cursor: Cursor): { grid: Block; row: number; col: number; rows: number; cols: number } | null {
  const grid = findBlock(tree, cursor.rowOwnerId);
  if (!grid || grid.type !== "matrix") return null;
  const at = /^r(\d+)c(\d+)$/.exec(cursor.slot);
  if (!at) return null;
  const rows = Number(grid.attrs?.rows ?? 0);
  const cols = Number(grid.attrs?.cols ?? 0);
  return { grid, row: Number(at[1]), col: Number(at[2]), rows, cols };
}

/** Rebuild a grid's cell slots from a row order given as old indices (`null` =
 *  a brand-new, empty row), renumbering `r{i}c{j}` to match. */
function reindexRows(grid: Block, order: Array<number | null>): Block {
  const cols = Number(grid.attrs?.cols ?? 0);
  const slots: Record<string, Block[]> = {};
  order.forEach((from, i) => {
    for (let c = 0; c < cols; c++) {
      slots[`r${i}c${c}`] = from == null ? [] : (grid.slots?.[`r${from}c${c}`] ?? []);
    }
  });
  return { ...grid, slots, attrs: { ...(grid.attrs ?? {}), rows: order.length, cols } };
}

/**
 * Enter inside a grid: add a row below the one the caret is in, caret into its
 * first cell.
 *
 * For a `cases` that is "add another case", which is the whole point of the
 * environment — a system of equations that cannot grow past the two rows it was
 * inserted with is not a system of equations. Outside a grid the caller keeps
 * Enter's ordinary meaning; this returns the state untouched.
 */
export function addGridRow(tree: Block, cursor: Cursor): EditState {
  const at = cellAt(tree, cursor);
  if (!at) return { tree, cursor };
  const order: Array<number | null> = [];
  for (let i = 0; i < at.rows; i++) {
    order.push(i);
    if (i === at.row) order.push(null); // the new, empty row
  }
  const next = updateBlock(tree, at.grid.id, (g) => reindexRows(g, order));
  return { tree: next, cursor: { rowOwnerId: at.grid.id, slot: `r${at.row + 1}c0`, index: 0 } };
}

/** ⇧Enter: take the caret's row out of the grid (never the last one), caret to
 *  the first cell of the row that takes its place. */
export function removeGridRow(tree: Block, cursor: Cursor): EditState {
  const at = cellAt(tree, cursor);
  if (!at || at.rows <= 1) return { tree, cursor };
  const order: Array<number | null> = [];
  for (let i = 0; i < at.rows; i++) if (i !== at.row) order.push(i);
  const next = updateBlock(tree, at.grid.id, (g) => reindexRows(g, order));
  const landing = Math.min(at.row, order.length - 1);
  return { tree: next, cursor: { rowOwnerId: at.grid.id, slot: `r${landing}c0`, index: 0 } };
}

/**
 * The slot a freshly-opened formula should put its caret in: the first EMPTY
 * one, depth-first (a matrix's `r0c0`, a fraction's numerator), falling back to
 * the end of the body.
 *
 * Without this, a formula created from a snippet opens with the caret before
 * the structure rather than inside it, so the first thing typed lands beside
 * the brackets instead of in the box the user is looking at.
 */
export function initialCursor(tree: Block): Cursor {
  const seen = new Set<string>();
  const walk = (b: Block): Cursor | null => {
    if (seen.has(b.id)) return null; // a malformed tree must not spin
    seen.add(b.id);
    for (const slot of cursorSlots(b)) {
      const row = b.slots?.[slot] ?? [];
      if (row.length === 0) return { rowOwnerId: b.id, slot, index: 0 };
      for (const child of row) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  const body = tree.slots?.body ?? [];
  return walk(tree) ?? { rowOwnerId: tree.id, slot: "body", index: body.length };
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
  // The matrix environments this editor models as a real `matrix` block: the
  // cursor lands in cell r0c0 and walks the cells, instead of the whole
  // environment arriving as one opaque atom nothing can be typed into.
  ...Object.fromEntries(
    (["matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "cases"] as const).map((env) => [
      `\\begin{${env}}\\end{${env}}`,
      (t: Block, c: Cursor) => insertContainer(t, c, () => matrix(ENV_ROWS, ENV_COLS, env)),
    ]),
  ),
};

/**
 * Map a toolbar/SymbolPicker LaTeX snippet to a structural insert. Known
 * structures build the real container (cursor in its first slot — e.g. an
 * integral's LOWER bound); anything else becomes a single `symbol` atom carrying
 * the LaTeX (renders + serializes correctly).
 *
 * Environments this editor has no block for (`Bmatrix`, `smallmatrix`,
 * `aligned`) still become atoms — but filled ones, since an empty environment
 * renders as bare delimiters with nothing inside.
 */
export function insertSnippet(tree: Block, cursor: Cursor, latex: string): EditState {
  const op = SNIPPET_OPS[latex];
  if (op) return op(tree, cursor);
  return insertAtom(tree, cursor, symbol(fillEnvCells(latex, () => "")));
}

// ── Words inside a formula (`\text{…}`) ──────────────────────────────────────
/** A character of words in a formula: an upright identifier marked `text`,
 *  spaces included. A run of them serializes as one `\text{…}`. */
export function textAtom(ch: string): Block {
  const a = identifier(ch);
  return { ...a, attrs: { ...(a.attrs ?? {}), text: true } };
}

export function isTextAtom(b: Block | undefined): boolean {
  return b?.type === "identifier" && b.attrs?.text === true;
}

/** Type one character of words at the caret. */
export function typeText(tree: Block, cursor: Cursor, ch: string): EditState {
  return insertAtom(tree, cursor, textAtom(ch));
}

/** The caret is inside a run of words (words on both sides of it), where the
 *  next key should type words too. At either end of a run it types maths. */
export function inTextRun(tree: Block, cursor: Cursor): boolean {
  const row = findRow(tree, cursor.rowOwnerId, cursor.slot) ?? [];
  return isTextAtom(row[cursor.index - 1]) && isTextAtom(row[cursor.index]);
}
