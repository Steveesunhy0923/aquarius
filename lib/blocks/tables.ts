/**
 * Tables. A `table` block is a ROW of one or more tables (like image rows),
 * with a horizontal alignment and a per-table caption. Each table has a style;
 * the same data renders as styled HTML in-app and serializes to LaTeX.
 */

import { escapeLatex } from "./captions";
import type { ImageAlign } from "./images";
import { hasPlacement, placedRowToLatex } from "./placement";
import type { Block, Placement } from "@/lib/blocks/types";

export type TableStyle =
  | "grid"
  | "lines"
  | "booktabs"
  | "plain"
  | "minimal"
  | "headershade"
  | "striped";

export interface TableData {
  style: TableStyle;
  rows: string[][];
  caption?: string;
  /** Free 2D position within the block's box (see Placement). */
  pos?: Placement;
}

export interface TableStyleInfo {
  id: TableStyle;
  name: string;
  description: string;
}

export const TABLE_STYLES: TableStyleInfo[] = [
  { id: "booktabs", name: "Booktabs", description: "Professional \\toprule / \\midrule / \\bottomrule (booktabs)." },
  { id: "grid", name: "Grid", description: "Full borders around every cell." },
  { id: "lines", name: "Horizontal lines", description: "Rules top, bottom, and under the header." },
  { id: "headershade", name: "Shaded header", description: "Colored header row with borders (colortbl/xcolor)." },
  { id: "striped", name: "Striped (zebra)", description: "Alternating row shading (xcolor [table])." },
  { id: "minimal", name: "Minimal", description: "A single rule above and below." },
  { id: "plain", name: "Plain", description: "No rules at all." },
];

const uid = (): string => crypto.randomUUID();

export function demoRows(): string[][] {
  return [
    ["Item", "Qty", "Price"],
    ["Apples", "3", "1.20"],
    ["Bread", "1", "2.50"],
  ];
}

// ── row model ────────────────────────────────────────────────────────────────

export function tableItems(block: Block): TableData[] {
  const arr = block.attrs?.tables;
  if (Array.isArray(arr)) {
    return arr.filter(
      (t): t is TableData => !!t && Array.isArray((t as TableData).rows),
    );
  }
  const single = block.attrs?.table as TableData | undefined; // migrate legacy
  if (single && Array.isArray(single.rows)) return [single];
  return [{ style: "booktabs", rows: demoRows() }];
}

export function tableAlign(block: Block): ImageAlign {
  const a = block.attrs?.align;
  return a === "left" || a === "right" ? a : "center";
}

export function makeTableRow(
  tables: TableData[],
  align: ImageAlign = "center",
): Block {
  return { id: uid(), type: "table", attrs: { tables, align } };
}

/** Convenience for the picker: a one-table row of the given style. */
export function makeTableBlock(style: TableStyle, rows: string[][]): Block {
  return makeTableRow([{ style, rows }]);
}

export function withTables(
  block: Block,
  tables: TableData[],
  align?: ImageAlign,
): Block {
  const attrs = { ...block.attrs };
  delete attrs.table; // drop legacy single-table field
  attrs.tables = tables;
  attrs.align = align ?? tableAlign(block);
  return { ...block, attrs };
}

// ── LaTeX export ─────────────────────────────────────────────────────────────

const CELL_ESC: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};
function escapeCell(s: string): string {
  return (s ?? "").replace(/[\\&%$#_{}~^]/g, (ch) => CELL_ESC[ch] ?? ch);
}

/** Just the `\begin{tabular}…\end{tabular}` (with any preceding \rowcolors). */
function tabularOf(data: TableData): string {
  const rows = data.rows.length ? data.rows : demoRows();
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const row = (r: string[]) =>
    Array.from({ length: cols }, (_, i) => escapeCell(r[i] ?? "")).join(" & ") + " \\\\";
  const colspec = (sep: string) =>
    sep + Array.from({ length: cols }, () => "c").join(sep) + sep;
  const head = rows[0] ?? [];
  const body = rows.slice(1);

  let pre = "";
  let spec = colspec("");
  let lines: string[] = [];
  switch (data.style) {
    case "grid":
      spec = colspec("|");
      lines = ["\\hline", row(head), "\\hline", ...body.flatMap((r) => [row(r), "\\hline"])];
      break;
    case "lines":
      lines = ["\\hline", row(head), "\\hline", ...body.map(row), "\\hline"];
      break;
    case "booktabs":
      pre = "% requires \\usepackage{booktabs}\n";
      lines = ["\\toprule", row(head), "\\midrule", ...body.map(row), "\\bottomrule"];
      break;
    case "minimal":
      lines = ["\\hline", row(head), ...body.map(row), "\\hline"];
      break;
    case "plain":
      lines = [row(head), ...body.map(row)];
      break;
    case "headershade":
      pre = "% requires \\usepackage[table]{xcolor}\n";
      spec = colspec("|");
      lines = ["\\hline", `\\rowcolor{gray!25} ${row(head)}`, "\\hline", ...body.flatMap((r) => [row(r), "\\hline"])];
      break;
    case "striped":
      pre = "% requires \\usepackage[table]{xcolor}\n\\rowcolors{2}{gray!12}{white}\n";
      lines = ["\\hline", row(head), "\\hline", ...body.map(row), "\\hline"];
      break;
  }
  return `${pre}\\begin{tabular}{${spec}}\n${lines.join("\n")}\n\\end{tabular}`;
}

/** Serialize a row of tables: subtables (with \caption) when captioned/multiple. */
export function tableRowToLatex(tables: TableData[], align: ImageAlign, offset?: number): string {
  if (tables.length === 0) return "";
  const cmd =
    align === "left" ? "\\raggedright" : align === "right" ? "\\raggedleft" : "\\centering";
  const anyCaption = tables.some((t) => (t.caption ?? "").trim());

  // Free 2D placement (uncaptioned). Tables have no width metric, so inter-table
  // gaps fall back to 0 (abut in order); the leading \hspace* + \raisebox apply.
  if (!anyCaption && hasPlacement(tables)) {
    return placedRowToLatex(tables.map((t) => ({ pos: t.pos, width: 0, body: tabularOf(t) })));
  }

  // Legacy free horizontal position for a single uncaptioned table (in-flow shift).
  if (typeof offset === "number" && offset > 0.001 && tables.length === 1 && !anyCaption) {
    return `\\noindent\\hspace*{${parseFloat(Math.min(0.99, offset).toFixed(4))}\\linewidth}${tabularOf(tables[0])}`;
  }

  if (tables.length > 1 || anyCaption) {
    const frac = (Math.min(0.9, 1 / Math.max(1, tables.length)) * 0.95).toFixed(2);
    const subs = tables.map((t) => {
      const cap = (t.caption ?? "").trim();
      const capLine = cap ? `\n\\caption{${escapeLatex(cap)}}` : "";
      return `\\begin{subtable}{${frac}\\linewidth}\n\\centering\n${tabularOf(t)}${capLine}\n\\end{subtable}`;
    });
    return `% requires \\usepackage{subcaption}\n\\begin{table}[h]\n${cmd}\n${subs.join("\\hfill\n")}\n\\end{table}`;
  }
  return `\\begin{center}\n${tabularOf(tables[0])}\n\\end{center}`;
}
