"use client";

import type { ImageAlign } from "@/lib/blocks/images";
import type { TableData } from "@/lib/blocks/tables";
import { SortableRow } from "./SortableRow";
import { TableView } from "./TableView";

/** Editable table row: select a table, drag it to reorder/move, caption inline. */
export function TableRowEditor({
  blockId,
  tables,
  align,
  selectedIndex,
  onSelect,
  onMove,
  onCell,
  onCaption,
}: {
  blockId: string;
  tables: TableData[];
  align: ImageAlign;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onMove: (fromRowId: string, fromIndex: number, toRowId: string, toIndex: number) => void;
  onCell: (index: number, row: number, col: number, value: string) => void;
  onCaption: (index: number, text: string) => void;
}) {
  if (tables.length === 0) return null;
  return (
    <SortableRow
      count={tables.length}
      align={align}
      selectedIndex={selectedIndex}
      group="table"
      rowId={blockId}
      onSelect={onSelect}
      onMove={onMove}
      renderItem={(i) => (
        <figure className="m-0 flex flex-col items-center">
          <div className="overflow-x-auto">
            <TableView
              data={tables[i]}
              editable={selectedIndex === i}
              onCell={(r, c, v) => onCell(i, r, c, v)}
            />
          </div>
          <input
            value={tables[i].caption ?? ""}
            placeholder="caption…"
            onChange={(e) => onCaption(i, e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-0.5 text-center text-xs italic outline-none focus:border-accent"
          />
        </figure>
      )}
    />
  );
}
