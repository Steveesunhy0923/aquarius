/**
 * Pure block constructors for the Aquarius tree.
 *
 * Every factory returns a fresh `Block` (or `DocumentTree`) with a unique id and
 * its slots pre-populated per `SLOT_NAMES`. Constructors are pure (no DOM, no
 * global mutation) and run in both Node and the browser.
 */

import type {
  Block,
  BlockId,
  BlockType,
  Slots,
  DocumentTree,
  CanvasMode,
} from "./types";
import { SLOT_NAMES, emptyDocument } from "./types";

// ──────────────────────────────────────────────────────────────────────────
// id generation
// ──────────────────────────────────────────────────────────────────────────

/** Fresh unique id. Uses crypto.randomUUID() (available in Node 16+ & browsers). */
export function newId(): BlockId {
  return crypto.randomUUID();
}

// ──────────────────────────────────────────────────────────────────────────
// internal helpers
// ──────────────────────────────────────────────────────────────────────────

/** Build an empty slot map for a block type, one key per SLOT_NAMES entry. */
function emptySlots(type: BlockType): Slots {
  const names = SLOT_NAMES[type] ?? [];
  const slots: Slots = {};
  for (const name of names) slots[name] = [];
  return slots;
}

/** Normalize a slot input to a Block[] (accepts a single block or a list). */
function asRow(input: Block | Block[] | undefined): Block[] {
  if (input == null) return [];
  return Array.isArray(input) ? input : [input];
}

// ──────────────────────────────────────────────────────────────────────────
// leaf constructors
// ──────────────────────────────────────────────────────────────────────────

/** A prose paragraph. */
export function text(s = ""): Block {
  return { id: newId(), type: "text", value: s };
}

export interface SymbolOpts {
  /** Optional human-readable name carried alongside the latex value. */
  name?: string;
}

/** A named symbol atom, e.g. symbol("\\alpha"). `latex` is its LaTeX command. */
export function symbol(latex: string, opts?: SymbolOpts): Block {
  const block: Block = { id: newId(), type: "symbol", value: latex };
  if (opts?.name != null) block.attrs = { name: opts.name };
  return block;
}

/** A binary/relational operator token, e.g. operator("+"). */
export function operator(v: string): Block {
  return { id: newId(), type: "operator", value: v };
}

/** A numeric literal token, e.g. number("42"). */
export function number(v: string): Block {
  return { id: newId(), type: "number", value: v };
}

/** A variable / function name token, e.g. identifier("x"). */
export function identifier(v: string): Block {
  return { id: newId(), type: "identifier", value: v };
}

// ──────────────────────────────────────────────────────────────────────────
// math container constructors
// ──────────────────────────────────────────────────────────────────────────

/** A math row container. `children` populate the "body" slot. */
export function math(children: Block[] = []): Block {
  const slots = emptySlots("math");
  slots.body = [...children];
  return { id: newId(), type: "math", slots };
}

/** A fraction. `num`/`den` may be a single block or a row of blocks. */
export function fraction(
  num?: Block | Block[],
  den?: Block | Block[]
): Block {
  const slots = emptySlots("fraction");
  slots.num = asRow(num);
  slots.den = asRow(den);
  return { id: newId(), type: "fraction", slots };
}

/** A root. Omitting `index` yields a square root. */
export function root(
  radicand?: Block | Block[],
  index?: Block | Block[]
): Block {
  const slots = emptySlots("root");
  slots.radicand = asRow(radicand);
  slots.index = asRow(index);
  return { id: newId(), type: "root", slots };
}

export interface ScriptOpts {
  sup?: Block | Block[];
  sub?: Block | Block[];
}

/** A super/subscript wrapper around `base`. Either script may be omitted. */
export function script(base?: Block | Block[], opts?: ScriptOpts): Block {
  const slots = emptySlots("script");
  slots.base = asRow(base);
  slots.sup = asRow(opts?.sup);
  slots.sub = asRow(opts?.sub);
  return { id: newId(), type: "script", slots };
}

export interface IntegralOpts {
  integrand?: Block | Block[];
  lower?: Block | Block[];
  upper?: Block | Block[];
  diff?: Block | Block[];
}

/** An integral with optional bounds, integrand and differential. */
export function integral(opts?: IntegralOpts): Block {
  const slots = emptySlots("integral");
  slots.integrand = asRow(opts?.integrand);
  slots.lower = asRow(opts?.lower);
  slots.upper = asRow(opts?.upper);
  slots.diff = asRow(opts?.diff);
  return { id: newId(), type: "integral", slots };
}

export type BigopKind = NonNullable<Block["attrs"]>["op"];

export interface BigopOpts {
  operand?: Block | Block[];
  lower?: Block | Block[];
  upper?: Block | Block[];
}

/** A big operator (sum/prod/lim/…) with operand and bounds. */
export function bigop(op: BigopKind, opts?: BigopOpts): Block {
  const slots = emptySlots("bigop");
  slots.operand = asRow(opts?.operand);
  slots.lower = asRow(opts?.lower);
  slots.upper = asRow(opts?.upper);
  return { id: newId(), type: "bigop", slots, attrs: { op: op ?? "sum" } };
}

export type MatrixEnv = NonNullable<Block["attrs"]>["env"];

/**
 * A matrix of `rows` × `cols`. Cells live in slots named r{i}c{j} (0-indexed),
 * each pre-initialized to an empty row. `env` defaults to "pmatrix".
 */
export function matrix(
  rows: number,
  cols: number,
  env: MatrixEnv = "pmatrix"
): Block {
  const r = Math.max(0, Math.floor(rows));
  const c = Math.max(0, Math.floor(cols));
  const slots: Slots = {};
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      slots[`r${i}c${j}`] = [];
    }
  }
  return {
    id: newId(),
    type: "matrix",
    slots,
    attrs: { rows: r, cols: c, env: env ?? "pmatrix" },
  };
}

/** A delimited group, e.g. group(body, ["(", ")"]). */
export function group(
  body?: Block | Block[],
  delimiters: [open: string, close: string] = ["(", ")"]
): Block {
  const slots = emptySlots("group");
  slots.body = asRow(body);
  return { id: newId(), type: "group", slots, attrs: { delimiters } };
}

// ──────────────────────────────────────────────────────────────────────────
// rich / non-math constructors
// ──────────────────────────────────────────────────────────────────────────

export type CodeLang = NonNullable<Block["attrs"]>["lang"];

/** A code block. `source` is the verbatim listing; `lang` tags the language. */
export function code(source: string, lang: CodeLang = "text"): Block {
  return {
    id: newId(),
    type: "code",
    value: source,
    attrs: { lang: lang ?? "text" },
  };
}

/** An image block referencing a stored asset by id. */
export function image(assetId: string, alt?: string): Block {
  const attrs: NonNullable<Block["attrs"]> = { assetId };
  if (alt != null) attrs.alt = alt;
  return { id: newId(), type: "image", attrs };
}

/** A tikz block whose `value` is verbatim tikzpicture source. */
export function tikz(source: string): Block {
  return { id: newId(), type: "tikz", value: source };
}

// ──────────────────────────────────────────────────────────────────────────
// document & navigation
// ──────────────────────────────────────────────────────────────────────────

/** Build a document tree from top-level blocks. */
export function document(
  blocks: Block[] = [],
  mode: CanvasMode = "flow"
): DocumentTree {
  const doc = emptyDocument(mode);
  doc.blocks = [...blocks];
  return doc;
}

/**
 * Ordered slot names for Tab navigation through a block's children.
 * Prefers the canonical SLOT_NAMES order; falls back to the block's own slot
 * keys (e.g. matrix cells r{i}c{j}, which aren't in SLOT_NAMES).
 */
export function cursorSlots(block: Block): string[] {
  const canonical = SLOT_NAMES[block.type];
  if (canonical && canonical.length > 0) {
    // Keep only slots that actually exist on the block, in canonical order.
    const present = block.slots ?? {};
    const ordered = canonical.filter((name) => name in present);
    return ordered.length > 0 ? ordered : [...canonical];
  }
  return Object.keys(block.slots ?? {});
}
