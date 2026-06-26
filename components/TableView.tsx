"use client";

import type { TableData } from "@/lib/blocks/tables";
import type { CSSProperties } from "react";

const RULE = "#334155"; // dark rule (booktabs / lines)
const GRID = "#cbd5e1"; // light grid border

/**
 * Renders a table in one of the common LaTeX styles. When `editable`, each cell
 * is contentEditable and commits its text via `onCell` on blur.
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

  const tableStyle: CSSProperties = {
    borderCollapse: "collapse",
    fontSize: "0.95em",
  };
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
                  minWidth: editable ? 40 : undefined,
                  outline: "none",
                };
                return (
                  <td
                    key={c}
                    style={cellStyle}
                    contentEditable={editable}
                    suppressContentEditableWarning
                    onBlur={
                      editable && onCell
                        ? (e) => onCell(r, c, e.currentTarget.textContent ?? "")
                        : undefined
                    }
                  >
                    {row[c] ?? ""}
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
