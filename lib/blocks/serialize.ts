/**
 * LaTeX / KaTeX serialization adapter for the Aquarius block tree.
 *
 * The block tree (see ./types.ts) is the single source of truth. This module is
 * one *output adapter*: it walks a tree and emits LaTeX (for documents / display)
 * or a KaTeX-renderable math string (no surrounding delimiters).
 *
 * Design: TABLE-DRIVEN. A const `LATEX_REGISTRY: Record<BlockType, Serializer>`
 * maps every BlockType to a pure serializer. Adding a block type is a one-line
 * registry entry. Every serializer is defensive: missing/empty slots never throw.
 */

import type {
  Block,
  BlockType,
  BlockAttrs,
  DocumentTree,
  InlineRun,
} from "./types";
import { escapeLatex } from "./captions";
import { formatToLatex } from "./format";
import { graphModel, graphToTikz } from "./graph";
import { headingToLatex } from "./headings";
import { imageAlign, imageItems } from "./images";
import { listItems, listMarker, listOrdered } from "./lists";
import { hasPlacement, linewidthLen, placedRowToLatex } from "./placement";
import { tableAlign, tableItems, tableRowToLatex } from "./tables";

/** A serializer turns one block subtree into a LaTeX fragment. */
type Serializer = (b: Block) => string;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/** Safely read a slot's child list (never throws on missing slots). */
function slot(b: Block, name: string): Block[] {
  const s = b.slots;
  if (!s) return [];
  const v = s[name];
  return Array.isArray(v) ? v : [];
}

/** True when a slot has no renderable children. */
function slotEmpty(b: Block, name: string): boolean {
  const list = slot(b, name);
  if (list.length === 0) return true;
  // Treat a slot containing only empty math fragments as empty.
  return list.every((child) => renderMath(child).trim().length === 0);
}

/** Serialize an ordered list of math child blocks into a single math fragment. */
function renderRow(children: Block[]): string {
  let out = "";
  for (const child of children) out += renderMath(child);
  return out;
}

/** Serialize a single slot (a row of blocks) to a math fragment. */
function renderSlot(b: Block, name: string): string {
  return renderRow(slot(b, name));
}

/**
 * Render one block as a KaTeX/LaTeX *math* fragment (no surrounding $ or \[ \]).
 * This is the recursive workhorse used by both blockToKatex and the math-mode
 * portions of documentToLatex.
 *
 * The block tree is the source of truth and may be loaded from storage (or a bad
 * import), so it can be malformed — including self-referential cycles. A module
 * -level depth budget keeps the contract "never throws": past the limit we bail
 * out with "" instead of overflowing the stack. Serialization is synchronous and
 * single-threaded, so a shared counter is safe.
 */
const MAX_RENDER_DEPTH = 256;
let renderDepth = 0;
function renderMath(b: Block): string {
  if (!b || typeof b !== "object") return "";
  if (renderDepth > MAX_RENDER_DEPTH) return "";
  const fn = LATEX_REGISTRY[b.type];
  if (!fn) return "";
  renderDepth++;
  try {
    return fn(b);
  } finally {
    renderDepth--;
  }
}

/**
 * Escape LaTeX special characters in *text mode* prose.
 *
 * Single-pass, map-based: each special char is replaced exactly once, so a
 * replacement we introduce (e.g. the braces in `\textbackslash{}`) can never be
 * re-escaped by a later pass. A naive multi-pass version turns `a\b` into
 * `a\textbackslash\{\}b` (spurious literal braces) — avoided here.
 */
const LATEX_TEXT_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};
function escapeLatexText(s: string): string {
  if (!s) return "";
  return s.replace(/[\\{}&%$#_~^]/g, (ch) => LATEX_TEXT_ESCAPES[ch] ?? ch);
}

/** Read attrs defensively. */
function attrs(b: Block): BlockAttrs {
  return b.attrs ?? {};
}

// ──────────────────────────────────────────────────────────────────────────
// Per-type serializers
// ──────────────────────────────────────────────────────────────────────────

/** bigop attrs.op → LaTeX operator command. */
const BIGOP_OPS: Record<NonNullable<BlockAttrs["op"]>, string> = {
  sum: "\\sum",
  prod: "\\prod",
  lim: "\\lim",
  coprod: "\\coprod",
  bigcup: "\\bigcup",
  bigcap: "\\bigcap",
};

function serializeText(b: Block): string {
  // A text block is prose, optionally interleaved with inline math runs.
  const runs = attrs(b).runs;
  let body: string;
  if (Array.isArray(runs) && runs.length > 0) {
    body = "";
    for (const run of runs as InlineRun[]) {
      if (!run) continue;
      if (run.kind === "text") {
        body += formatToLatex(run.text ?? "");
      } else if (run.kind === "math") {
        const inner = run.block ? renderMath(run.block) : "";
        body += `\\(${inner}\\)`;
      }
    }
  } else {
    body = formatToLatex(b.value ?? "");
  }

  // A colored "callout" paragraph exports as an offset quote.
  // (Colored tcolorbox/mdframed export is a planned refinement.)
  const callout = attrs(b).calloutColor;
  if (typeof callout === "string" && callout) {
    return `\\begin{quote}\n${body}\n\\end{quote}`;
  }
  return body;
}

/** heading → \section / \subsection / \subsubsection (starred if unnumbered). */
function serializeHeading(b: Block): string {
  return headingToLatex(b);
}

/** LaTeX `\item` label per marker style (non-default ones need `enumitem`). */
const LIST_LABEL: Record<string, string> = {
  disc: "$\\bullet$",
  circle: "$\\circ$",
  square: "$\\blacksquare$",
  decimal: "\\arabic*.",
  "lower-alpha": "\\alph*.",
  "lower-roman": "\\roman*.",
};

/** list → enumerate / itemize. */
function serializeList(b: Block): string {
  const ordered = listOrdered(b);
  const env = ordered ? "enumerate" : "itemize";
  const marker = listMarker(b);
  const items = listItems(b).filter((it) => it.trim());
  const lines = items.map((it) => `  \\item ${formatToLatex(it)}`);
  // Default markers need no package; others set a label via `enumitem`.
  const opt =
    marker === (ordered ? "decimal" : "disc")
      ? ""
      : `[label=${LIST_LABEL[marker]}]`; // requires \usepackage{enumitem}
  return `\\begin{${env}}${opt}\n${lines.join("\n")}\n\\end{${env}}`;
}

function serializeFraction(b: Block): string {
  return `\\frac{${renderSlot(b, "num")}}{${renderSlot(b, "den")}}`;
}

function serializeRoot(b: Block): string {
  const radicand = renderSlot(b, "radicand");
  if (slotEmpty(b, "index")) return `\\sqrt{${radicand}}`;
  return `\\sqrt[${renderSlot(b, "index")}]{${radicand}}`;
}

function serializeScript(b: Block): string {
  let out = renderSlot(b, "base");
  if (!slotEmpty(b, "sup")) out += `^{${renderSlot(b, "sup")}}`;
  if (!slotEmpty(b, "sub")) out += `_{${renderSlot(b, "sub")}}`;
  return out;
}

function serializeIntegral(b: Block): string {
  let out = "\\int";
  if (!slotEmpty(b, "lower")) out += `_{${renderSlot(b, "lower")}}`;
  if (!slotEmpty(b, "upper")) out += `^{${renderSlot(b, "upper")}}`;
  const integrand = renderSlot(b, "integrand");
  if (integrand) out += ` ${integrand}`;
  if (!slotEmpty(b, "diff")) out += ` \\,d${renderSlot(b, "diff")}`;
  return out;
}

function serializeBigop(b: Block): string {
  const op = attrs(b).op;
  const cmd = (op && BIGOP_OPS[op]) || "\\sum";
  let out = cmd;
  if (!slotEmpty(b, "lower")) out += `_{${renderSlot(b, "lower")}}`;
  if (!slotEmpty(b, "upper")) out += `^{${renderSlot(b, "upper")}}`;
  const operand = renderSlot(b, "operand");
  if (operand) out += ` ${operand}`;
  return out;
}

function serializeMatrix(b: Block): string {
  const a = attrs(b);
  const env = a.env ?? "pmatrix";
  const rows = typeof a.rows === "number" && a.rows >= 0 ? a.rows : 0;
  const cols = typeof a.cols === "number" && a.cols >= 0 ? a.cols : 0;
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const cells: string[] = [];
    for (let j = 0; j < cols; j++) {
      cells.push(renderSlot(b, `r${i}c${j}`));
    }
    lines.push(cells.join(" & "));
  }
  const body = lines.join(" \\\\ ");
  return `\\begin{${env}}${body ? ` ${body} ` : ""}\\end{${env}}`;
}

/**
 * \left / \right accept only a fixed delimiter set. Map common characters to
 * valid delimiters (e.g. `{` → `\{`, `<` → `\langle`); anything unknown becomes
 * the null delimiter `.` (a valid, invisible fence) so the render never throws.
 */
const GROUP_DELIMS: Record<string, string> = {
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "{": "\\{",
  "}": "\\}",
  "<": "\\langle",
  ">": "\\rangle",
  "|": "|",
  "\\|": "\\|",
  "": ".",
};
function mapDelim(raw: string): string {
  return GROUP_DELIMS[raw] ?? ".";
}
function serializeGroup(b: Block): string {
  const body = renderSlot(b, "body");
  const delims = attrs(b).delimiters;
  const open = mapDelim(delims && delims[0] != null ? delims[0] : "(");
  const close = mapDelim(delims && delims[1] != null ? delims[1] : ")");
  return `\\left${open} ${body} \\right${close}`;
}

/** math container: a plain ordered row of atoms/structures. */
function serializeMath(b: Block): string {
  return renderSlot(b, "body");
}

/** Leaf token serializers — emit their literal value. */
function serializeSymbol(b: Block): string {
  return b.value ?? "";
}
function serializeOperator(b: Block): string {
  return b.value ?? "";
}
function serializeNumber(b: Block): string {
  return b.value ?? "";
}
function serializeIdentifier(b: Block): string {
  return b.value ?? "";
}

/** code → an lstlisting verbatim block. Not math; used in document body. */
function serializeCode(b: Block): string {
  const a = attrs(b);
  const lang = a.lang ?? "text";
  const source = b.value ?? "";
  return `\\begin{lstlisting}[language=${lang}]\n${source}\n\\end{lstlisting}`;
}

/** Read the legacy horizontal-offset fraction (0..1) for \hspace*{x\linewidth}. */
function offsetOf(b: Block): number | null {
  const o = attrs(b).offset;
  return typeof o === "number" && o > 0.001 ? Math.min(0.99, o) : null;
}

function imgBody(it: { assetId: string; width?: number }): string {
  const w = typeof it.width === "number" ? `[width=${(it.width / 100).toFixed(2)}\\linewidth]` : "";
  return `\\includegraphics${w}{${it.assetId}}`;
}

function serializeImage(b: Block): string {
  const items = imageItems(b);
  if (items.length === 0) return "";
  const align = imageAlign(b);
  const anyCaption = items.some((it) => (it.caption ?? "").trim());

  // Free 2D placement (uncaptioned only — captioned uses a float below).
  if (!anyCaption && hasPlacement(items)) {
    return placedRowToLatex(
      items.map((it) => ({
        pos: it.pos,
        width: typeof it.width === "number" ? it.width / 100 : 0,
        body: imgBody(it),
      })),
    );
  }

  // Legacy single-offset fallback (pre-placement notes).
  const off = offsetOf(b);
  if (off !== null && !anyCaption) {
    return `\\noindent\\hspace*{${linewidthLen(off)}}${items.map(imgBody).join("\\quad ")}`;
  }
  const cmd =
    align === "left"
      ? "\\raggedright"
      : align === "right"
        ? "\\raggedleft"
        : "\\centering";

  // Any per-image caption → a figure of subfigures, each with its own \caption.
  if (anyCaption) {
    const subs = items.map((it) => {
      const frac = (
        (it.width ?? Math.max(10, Math.floor(90 / items.length))) / 100
      ).toFixed(2);
      const cap = (it.caption ?? "").trim();
      const capLine = cap ? `\n\\caption{${escapeLatex(cap)}}` : "";
      return `\\begin{subfigure}{${frac}\\linewidth}\n\\centering\n\\includegraphics[width=\\linewidth]{${it.assetId}}${capLine}\n\\end{subfigure}`;
    });
    return `% requires \\usepackage{subcaption}\n\\begin{figure}[h]\n${cmd}\n${subs.join("\\hfill\n")}\n\\end{figure}`;
  }

  // No captions → a plain aligned row of images.
  const parts = items.map((it) => {
    const w =
      typeof it.width === "number"
        ? `[width=${(it.width / 100).toFixed(2)}\\linewidth]`
        : "";
    const alt = it.alt ? `% ${it.alt.replace(/\r?\n/g, " ")}\n` : "";
    return `${alt}\\includegraphics${w}{${it.assetId}}`;
  });
  const env =
    align === "left" ? "flushleft" : align === "right" ? "flushright" : "center";
  return `\\begin{${env}}\n${parts.join("\\hfill\n")}\n\\end{${env}}`;
}

/** table → a row of centered LaTeX tabulars / subtables in the block's style. */
function serializeTable(b: Block): string {
  return tableRowToLatex(tableItems(b), tableAlign(b), offsetOf(b) ?? undefined);
}

/** tikz → value is already a tikzpicture; emit verbatim. */
function serializeTikz(b: Block): string {
  return b.value ?? "";
}

/** graph → render the structured figure model as a tikzpicture. */
function serializeGraph(b: Block): string {
  const model = graphModel(b);
  const tex = graphToTikz(model);
  const captioned = !!(model.caption ?? "").trim();

  // Free 2D placement of the single graph (uncaptioned only).
  const pos = attrs(b).pos;
  if (pos && !captioned) {
    return placedRowToLatex([{ pos, width: 0, body: tex }]);
  }

  // Legacy single-offset fallback.
  const off = offsetOf(b);
  if (off !== null && !captioned) {
    return tex.replace("\\begin{tikzpicture}", `\\noindent\\hspace*{${linewidthLen(off)}}\\begin{tikzpicture}`);
  }
  return tex;
}

// ──────────────────────────────────────────────────────────────────────────
// The table-driven registry — one entry per BlockType (exhaustive).
// ──────────────────────────────────────────────────────────────────────────

const LATEX_REGISTRY: Record<BlockType, Serializer> = {
  text: serializeText,
  heading: serializeHeading,
  list: serializeList,
  symbol: serializeSymbol,
  operator: serializeOperator,
  number: serializeNumber,
  identifier: serializeIdentifier,
  math: serializeMath,
  fraction: serializeFraction,
  root: serializeRoot,
  script: serializeScript,
  integral: serializeIntegral,
  bigop: serializeBigop,
  matrix: serializeMatrix,
  group: serializeGroup,
  tikz: serializeTikz,
  code: serializeCode,
  image: serializeImage,
  table: serializeTable,
  graph: serializeGraph,
};

/** Block types that represent standalone (non-math) document content. */
const NON_MATH_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  "text",
  "heading",
  "list",
  "code",
  "image",
  "tikz",
  "table",
  "graph",
]);

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Serialize one block subtree to LaTeX.
 *  - Non-math blocks (text/code/image/tikz) render to their natural LaTeX form.
 *  - Math blocks render as math fragments (no surrounding delimiters), so callers
 *    can place them in whatever math context they need.
 */
export function blockToLatex(block: Block): string {
  if (!block || typeof block !== "object") return "";
  return renderMath(block);
}

/**
 * Serialize one block subtree into a KaTeX-renderable math string (NO $ wrapper).
 * Non-math blocks fall back to a katex-safe \text{...} so they never break a
 * KaTeX render call.
 */
export function blockToKatex(block: Block): string {
  if (!block || typeof block !== "object") return "";
  if (NON_MATH_TYPES.has(block.type)) {
    return katexFallback(block);
  }
  return renderMath(block);
}

/** A KaTeX-safe \text{...} fallback for non-math blocks. */
function katexFallback(block: Block): string {
  let label: string;
  switch (block.type) {
    case "text":
      label = textPlain(block);
      break;
    case "code":
      label = block.value ?? "";
      break;
    case "image":
      label = `image:${attrs(block).assetId ?? ""}`;
      break;
    case "tikz":
      label = "tikz";
      break;
    case "graph":
      label = "graph";
      break;
    default:
      label = "";
  }
  return `\\text{${escapeKatexText(label)}}`;
}

/** Extract plain prose from a text block (runs flattened, no escaping). */
function textPlain(b: Block): string {
  const runs = attrs(b).runs;
  if (Array.isArray(runs) && runs.length > 0) {
    let out = "";
    for (const run of runs as InlineRun[]) {
      if (!run) continue;
      if (run.kind === "text") out += run.text ?? "";
      else if (run.kind === "math" && run.block) out += renderMath(run.block);
    }
    return out;
  }
  return b.value ?? "";
}

/**
 * Escape characters that would break a KaTeX \text{...} argument.
 *
 * Uses macros KaTeX actually defines in text mode. Notably `\backslash` is a
 * MATH-mode symbol and is UNDEFINED inside \text{} — it must be `\textbackslash`
 * (verified against katex@0.16.11). Caret/tilde likewise need the text-mode
 * `\textasciicircum`/`\textasciitilde`, not bare `\^`/`\~` (accents). Single-pass
 * so introduced braces are never re-escaped. Newlines collapse to spaces.
 */
const KATEX_TEXT_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash ",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "%": "\\%",
  _: "\\_",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
};
function escapeKatexText(s: string): string {
  if (!s) return "";
  return s
    .replace(/[\\{}$&#%_^~]/g, (ch) => KATEX_TEXT_ESCAPES[ch] ?? ch)
    .replace(/\r?\n/g, " ");
}

/**
 * Serialize a whole document tree into a LaTeX body.
 *  - Text paragraphs are emitted as prose (with inline \( ... \) math runs),
 *    separated from neighbours by a blank line.
 *  - Standalone math blocks are emitted as display math: \[ ... \].
 *  - Other standalone blocks (code/image/tikz) emit their natural LaTeX form.
 * Blocks are joined with blank lines so the result is a valid document body.
 */
export function documentToLatex(tree: DocumentTree): string {
  if (!tree || !Array.isArray(tree.blocks)) return "";
  const parts: string[] = [];
  for (const block of tree.blocks) {
    if (!block || typeof block !== "object") continue;
    parts.push(renderTopLevel(block));
  }
  const body = parts.join("\n\n");
  // Chemistry (\ce/\pu) needs mhchem; flagged once for the whole document since
  // the commands can appear in any math fragment (unlike the per-figure/table
  // "% requires" comments, which annotate one specific environment).
  if (tree.blocks.some((b) => b && typeof b === "object" && usesMhchem(b))) {
    return `% requires \\usepackage[version=4]{mhchem}\n\n${body}`;
  }
  return body;
}

const MHCHEM_RE = /\\(?:ce|pu)\{/;

/** True when a top-level block's COMPILED LaTeX uses \ce/\pu. Verbatim and
 *  escaped surfaces (code listings, image-alt comments, table cells, list
 *  items) can contain the literal characters without needing the package, so
 *  only real math fragments — and tikz, which compiles as LaTeX — count. */
function usesMhchem(block: Block): boolean {
  switch (block.type) {
    case "code":
    case "image":
    case "table":
    case "graph":
    case "heading":
    case "list":
      return false;
    case "text": {
      const runs = block.attrs?.runs as InlineRun[] | undefined;
      return Boolean(runs?.some((r) => r.kind === "math" && MHCHEM_RE.test(renderMath(r.block))));
    }
    case "tikz":
      return MHCHEM_RE.test(blockToLatex(block));
    default:
      return MHCHEM_RE.test(renderMath(block)); // math-typed blocks
  }
}

/** Render a top-level block in document context. */
function renderTopLevel(block: Block): string {
  if (NON_MATH_TYPES.has(block.type)) {
    // Prose / code / image / tikz render to their natural body LaTeX.
    return blockToLatex(block);
  }
  // Any math-typed block standing alone becomes a centered display equation.
  const math = renderMath(block);
  return `$$ ${math} $$`;
}
