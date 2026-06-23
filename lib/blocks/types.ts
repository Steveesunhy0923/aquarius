/**
 * Aquarius block tree — the single source of truth.
 *
 * Core philosophy: LaTeX is an OUTPUT format, not the input format. The user
 * edits a tree of structured blocks (like a math-aware DOM); LaTeX, KaTeX,
 * Markdown, Anki, etc. are all *serializations* of this tree.
 *
 * Design goals:
 *  - Generic & extensible: one `Block` shape, table-driven (de)serialization.
 *  - Slot-based nesting: a fraction's numerator is a `Block[]`, so any structure
 *    can nest inside any slot to arbitrary depth.
 *  - Serialization-agnostic: this file knows nothing about LaTeX. See
 *    `lib/blocks/serialize.ts` for the LaTeX/KaTeX adapter.
 */

export type BlockId = string;

/**
 * Every block type. Container blocks use `slots`; leaf blocks use `value`/`attrs`.
 * Keep this union in sync with the registry in `lib/blocks/serialize.ts`.
 */
export type BlockType =
  // ── document-level ──────────────────────────────────────────────
  | "text" // paragraph of prose; may contain inline math runs (see attrs.runs)
  // ── math leaves (atoms) ─────────────────────────────────────────
  | "symbol" // a named symbol atom, e.g. \alpha, \nabla, \rightarrow
  | "operator" // a binary/relational operator token, e.g. + - = \leq
  | "number" // a numeric literal token
  | "identifier" // a variable/function name token, e.g. x, f, sin
  // ── math structures (containers) ────────────────────────────────
  | "math" // an inline/standalone math container: an ordered row of atoms
  | "fraction" // slots: num, den
  | "root" // slots: radicand, index (index optional → square root)
  | "script" // slots: base, sup, sub (super/subscript; either may be empty)
  | "integral" // slots: integrand, lower, upper, diff
  | "bigop" // slots: operand, lower, upper; attrs.op = "sum" | "prod" | "lim" | ...
  | "matrix" // attrs.rows, attrs.cols, attrs.env; cells in slots "r{i}c{j}"
  | "group" // slots: body; attrs.delimiters = ["(",")"] | ["[","]"] | ...
  // ── rich / non-math blocks ──────────────────────────────────────
  | "tikz" // value: tikz source; attrs.shapes: canvas shape model (optional)
  | "code" // value: source; attrs.lang = "python" | "matlab" | "julia"
  | "image"; // attrs.assetId references an Asset blob in storage

/**
 * A named argument slot holds an ordered list of child blocks.
 * Slot names are conventional per block type (documented on `BlockType` above).
 */
export type Slots = Record<string, Block[]>;

/**
 * The universal block shape. Leaf blocks carry a `value` and/or `attrs`;
 * container blocks carry `slots`. A block may carry both (e.g. a `script`
 * whose base is itself nested, or a `code` block with a `lang` attr).
 */
export interface Block {
  id: BlockId;
  type: BlockType;
  /** Literal payload for leaf blocks: text, symbol command, code source, … */
  value?: string;
  /** Named child slots for container blocks (e.g. fraction → { num, den }). */
  slots?: Slots;
  /** Block-specific structured attributes (op kind, matrix dims, asset id, …). */
  attrs?: BlockAttrs;
}

/** Loosely-typed bag of block-specific attributes. Documented per block type. */
export interface BlockAttrs {
  // bigop
  op?: "sum" | "prod" | "lim" | "coprod" | "bigcup" | "bigcap";
  // matrix
  rows?: number;
  cols?: number;
  env?: "matrix" | "pmatrix" | "bmatrix" | "vmatrix" | "Vmatrix" | "cases";
  // group
  delimiters?: [open: string, close: string];
  // code
  lang?: "python" | "matlab" | "julia" | "text";
  // image
  assetId?: string;
  alt?: string;
  width?: number;
  // text: inline math runs interleaved with prose
  runs?: InlineRun[];
  // tikz canvas model (V1 constrained drawing mode)
  shapes?: unknown[];
  // free-form escape hatch — avoid relying on this
  [key: string]: unknown;
}

/**
 * A text block is a sequence of runs: plain prose segments and inline math
 * segments (each inline-math run is itself a `math` block subtree).
 */
export type InlineRun =
  | { kind: "text"; text: string }
  | { kind: "math"; block: Block };

/**
 * A document is an ordered list of top-level blocks plus its canvas mode.
 * In "flow" mode blocks stack linearly; in "spatial" mode each block carries
 * an optional position (attrs.x / attrs.y).
 */
export interface DocumentTree {
  /** Schema version of the tree; bump on breaking shape changes. */
  schema: 1;
  mode: CanvasMode;
  blocks: Block[];
}

export type CanvasMode = "flow" | "spatial";

/** Convenience: the canonical empty document. */
export function emptyDocument(mode: CanvasMode = "flow"): DocumentTree {
  return { schema: 1, mode, blocks: [] };
}

/**
 * Slot-name conventions, exported so serializers/renderers/validators agree.
 * The first entry of each list is the slot the cursor lands in on insertion.
 */
export const SLOT_NAMES: Partial<Record<BlockType, readonly string[]>> = {
  fraction: ["num", "den"],
  root: ["radicand", "index"],
  script: ["base", "sup", "sub"],
  integral: ["integrand", "lower", "upper", "diff"],
  bigop: ["operand", "lower", "upper"],
  group: ["body"],
  math: ["body"],
} as const;
