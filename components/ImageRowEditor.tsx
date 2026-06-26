"use client";

import type { ImageAlign, ImageItem } from "@/lib/blocks/images";
import { SortableRow } from "./SortableRow";
import { useAssetUrl } from "./useAssetUrl";

/** Editable image row: select an image, drag it to reorder/move, caption inline. */
export function ImageRowEditor({
  blockId,
  items,
  align,
  selectedIndex,
  onSelect,
  onMove,
  onCaption,
}: {
  blockId: string;
  items: ImageItem[];
  align: ImageAlign;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onMove: (fromRowId: string, fromIndex: number, toRowId: string, toIndex: number) => void;
  onCaption: (index: number, text: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
        🖼 image (no source)
      </div>
    );
  }
  return (
    <SortableRow
      count={items.length}
      align={align}
      selectedIndex={selectedIndex}
      group="image"
      rowId={blockId}
      onSelect={onSelect}
      onMove={onMove}
      itemWidth={(i) => (items[i].width ? `${items[i].width}%` : undefined)}
      renderItem={(i) => (
        <figure
          className={`m-0 flex flex-col items-center ${items[i].width ? "w-full" : ""}`}
        >
          <Img item={items[i]} />
          <input
            value={items[i].caption ?? ""}
            placeholder="caption…"
            onChange={(e) => onCaption(i, e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-0.5 text-center text-xs italic outline-none focus:border-accent"
          />
        </figure>
      )}
    />
  );
}

function Img({ item }: { item: ImageItem }) {
  const url = useAssetUrl(item.assetId);
  if (!url) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
        Loading image…
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- local object-URL blob
  return (
    <img
      src={url}
      alt={item.alt ?? ""}
      draggable={false}
      className={`block max-h-[480px] rounded-md ${item.width ? "w-full" : "max-w-full"}`}
    />
  );
}
