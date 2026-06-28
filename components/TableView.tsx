"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

import type { TableData } from "@/lib/blocks/tables";
import { Katex } from "./Katex";
import { MathField } from "./MathField";

const RULE = "#334155"; // dark rule (booktabs / lines)
const GRID = "#cbd5e1"; // light grid border

/** Render a cell's stored LaTeX: math via KaTeX, plain labels as text. */
function CellDisplay({ value, editable }: { value: string; editable: boolean }) {
  const v = value.trim();
  if (!v) return <span className="text-muted">{editable ? "·" : " "}</span>;
  // Heuristic: only run KaTeX when the cell looks like math, so a text header
  // ("Name") isn't rendered as italic math while "\frac12" / "x^2" is.
  return /[\\^_{}]/.test(v) ? <Katex latex={v} /> : <span>{v}</span>;
}

/**
 * Renders a table in one of the common LaTeX styles. When `editable` (the table
 * is selected), clicking a cell opens an inline MathLive field for it: the cell
 * shows the RENDERED equation (WYSIWYG), not raw LaTeX, and you type with your
 * keyboard (the on-screen math keyboard is suppressed). One field at a time;
 * non-active cells render their math via KaTeX.
 */
export function TableView({
  data,
  editable = false,
  onCell,
}: {
  data: TableData;
  editable?: boolean;
  onCell?: (row: number, col: number, value: string) => void;
}) {
  const { style, rows } = data;
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const gridBorders = style === "grid" || style === "headershade";
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);

  const tableStyle: CSSProperties = { borderCollapse: "collapse", fontSize: "0.95em" };
  if (style === "booktabs") {
    tableStyle.borderTop = `2px solid ${RULE}`;
    tableStyle.borderBottom = `2px solid ${RULE}`;
  } else if (style === "lines" || style === "minimal") {
    tableStyle.borderTop = `1px solid ${RULE}`;
    tableStyle.borderBottom = `1px solid ${RULE}`;
  }

  return (
    <table style={tableStyle}>
      <tbody>
        {rows.map((row, r) => {
          const isHead = r === 0;
          const rowBg =
            style === "striped" && !isHead && r % 2 === 0
              ? "#f1f5f9"
              : style === "headershade" && isHead
                ? "#e2e8f0"
                : undefined;
          const headerUnderline =
            isHead && (style === "lines" || style === "booktabs")
              ? `1px solid ${RULE}`
              : undefined;
          return (
            <tr
              key={r}
              style={{
                background: rowBg,
                borderBottom: headerUnderline ?? (gridBorders ? `1px solid ${GRID}` : undefined),
              }}
            >
              {Array.from({ length: cols }, (_, c) => {
                const cellStyle: CSSProperties = {
                  padding: "4px 12px",
                  textAlign: "left",
                  fontWeight: isHead ? 600 : 400,
                  border: gridBorders ? `1px solid ${GRID}` : undefined,
                  minWidth: editable ? 44 : undefined,
                  cursor: editable ? "text" : undefined,
                  outline: "none",
                };
                const val = row[c] ?? "";
                const isActive = editable && activeCell?.r === r && activeCell?.c === c;
                return (
                  <td
                    key={c}
                    style={cellStyle}
                    // pointerdown (not mousedown): FigureBox preventDefaults the
                    // pointer event for dragging, suppressing compatibility mouse
                    // events — so stop it here and open the cell's math field.
                    onPointerDown={editable && !isActive ? (e) => { e.stopPropagation(); setActiveCell({ r, c }); } : undefined}
                  >
                    {isActive ? (
                      <MathField
                        value={val}
                        inline
                        autoFocus
                        manualKeyboard
                        onChange={(latex) => onCell?.(r, c, latex)}
                        onExit={() => setActiveCell(null)}
                        className="min-w-[2rem]"
                      />
                    ) : (
                      <CellDisplay value={val} editable={editable} />
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
