"use client";

import type { ImageAlign } from "@/lib/blocks/images";
import type { TableData } from "@/lib/blocks/tables";
import type { Placement } from "@/lib/blocks/types";
import { CaptionInput } from "./CaptionInput";
import { FigureBox } from "./FigureBox";
import { TableView } from "./TableView";

/**
 * Editable table row: each table is freely positioned within the block's box,
 * selected by a click, edited cell-by-cell when selected, captioned inline, and
 * can be dragged into another table block.
 */
export function TableRowEditor({
  blockId,
  tables,
  align,
  selectedIndex,
  onSelect,
  onCommit,
  onReset,
  onMoveAcross,
  onCell,
  onCaption,
}: {
  blockId: string;
  tables: TableData[];
  align: ImageAlign;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onCommit: (positions: Placement[], widthFracs: number[]) => void;
  onReset: () => void;
  onMoveAcross: (fromIndex: number, toBlockId: string) => void;
  onCell: (index: number, row: number, col: number, value: string) => void;
  onCaption: (index: number, text: string) => void;
}) {
  if (tables.length === 0) return null;
  return (
    <FigureBox
      blockId={blockId}
      group="table"
      align={align}
      onSelect={onSelect}
      onCommit={onCommit}
      onReset={onReset}
      onMoveAcross={onMoveAcross}
      items={tables.map((t, i) => ({
        key: `${i}-${t.style}`,
        pos: t.pos,
        selected: selectedIndex === i,
        content: (
          <figure className="m-0 flex flex-col items-center">
            <div className="overflow-x-auto">
              <TableView
                data={t}
                editable={selectedIndex === i}
                onCell={(r, c, v) => onCell(i, r, c, v)}
              />
            </div>
            <CaptionInput value={t.caption ?? ""} onChange={(text) => onCaption(i, text)} />
          </figure>
        ),
      }))}
    />
  );
}
