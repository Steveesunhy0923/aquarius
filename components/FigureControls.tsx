"use client";

import { Icon } from "@/components/Icon";
import { imageAlign, imageItems, type ImageAlign } from "@/lib/blocks/images";
import { TABLE_STYLES, tableAlign, tableItems, type TableStyle } from "@/lib/blocks/tables";
import type { Block } from "@/lib/blocks/types";

/** Inline control panel under the selected image/table block. */
export function FigureControls({
  block,
  selected,
  onImgWidth,
  onTblStyle,
  onTblAddRow,
  onTblRemoveRow,
  onTblAddCol,
  onTblRemoveCol,
  onAlign,
  onMove,
  onAdd,
  onDelete,
  onDone,
}: {
  block: Block;
  selected: { index: number; kind: "image" | "table" };
  onImgWidth: (width: number | undefined) => void;
  onTblStyle: (style: TableStyle) => void;
  onTblAddRow: () => void;
  onTblRemoveRow: () => void;
  onTblAddCol: () => void;
  onTblRemoveCol: () => void;
  onAlign: (align: ImageAlign) => void;
  onMove: (dir: number) => void;
  onAdd: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const aligns: ImageAlign[] = ["left", "center", "right"];
  const curAlign = selected.kind === "image" ? imageAlign(block) : tableAlign(block);
  const count = selected.kind === "image" ? imageItems(block).length : tableItems(block).length;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <span className="font-medium">{selected.kind === "image" ? "Picture" : "Table"} #{selected.index + 1}</span>
      <span className="mx-1 h-5 w-px bg-border" />

      {selected.kind === "image" && (() => {
        const item = imageItems(block)[selected.index];
        if (!item) return null;
        return (
          <>
            <span className="text-muted">Size</span>
            <input type="range" min={5} max={100} value={item.width ?? 50} onChange={(e) => onImgWidth(Number(e.target.value))} className="w-40" />
            <input type="number" min={5} max={100} value={item.width ?? ""} placeholder="auto" onChange={(e) => onImgWidth(e.target.value === "" ? undefined : Number(e.target.value))} className="w-14 rounded border border-border bg-background px-1 text-center" />
            <span className="text-muted">%</span>
            <span className="mx-1 h-5 w-px bg-border" />
          </>
        );
      })()}

      {selected.kind === "table" && (() => {
        const t = tableItems(block)[selected.index];
        if (!t) return null;
        return (
          <>
            <span className="text-muted">Style</span>
            <select value={t.style} onChange={(e) => onTblStyle(e.target.value as TableStyle)} className="rounded border border-border bg-background px-1 py-0.5">
              {TABLE_STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={onTblAddRow} title="Add row" aria-label="Add row" className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:border-accent"><Icon name="plus" size={13} />Row</button>
            <button onClick={onTblRemoveRow} title="Remove row" aria-label="Remove row" className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:border-accent"><Icon name="minus" size={13} />Row</button>
            <button onClick={onTblAddCol} title="Add column" aria-label="Add column" className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:border-accent"><Icon name="plus" size={13} />Col</button>
            <button onClick={onTblRemoveCol} title="Remove column" aria-label="Remove column" className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:border-accent"><Icon name="minus" size={13} />Col</button>
            <span className="mx-1 h-5 w-px bg-border" />
          </>
        );
      })()}

      <span className="text-muted">Align</span>
      {aligns.map((a) => (
        <button key={a} onClick={() => onAlign(a)} className={`rounded px-1.5 py-0.5 capitalize ${curAlign === a ? "bg-accent text-white" : "border border-border hover:border-accent"}`}>{a}</button>
      ))}
      <span className="mx-1 h-5 w-px bg-border" />

      <button onClick={() => onMove(-1)} disabled={selected.index === 0} title="Move left" aria-label="Move left" className="grid place-items-center rounded border border-border px-1.5 py-0.5 hover:border-accent disabled:opacity-30"><Icon name="moveleft" size={14} /></button>
      <button onClick={() => onMove(1)} disabled={selected.index >= count - 1} title="Move right" aria-label="Move right" className="grid place-items-center rounded border border-border px-1.5 py-0.5 hover:border-accent disabled:opacity-30"><Icon name="moveright" size={14} /></button>
      <button onClick={onAdd} title="Add another" aria-label="Add another" className="flex items-center gap-1 rounded border border-border px-2 py-0.5 hover:border-accent"><Icon name="plus" size={13} />Add</button>
      <button onClick={onDelete} title="Delete" aria-label="Delete" className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-red-500 hover:border-red-400"><Icon name="trash" size={14} />Delete</button>
      <button onClick={onDone} title="Done" aria-label="Done" className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-0.5 hover:border-accent"><Icon name="close" size={13} />Done</button>
    </div>
  );
}
