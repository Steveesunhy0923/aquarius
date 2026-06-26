"use client";

import type { ImageAlign, ImageItem } from "@/lib/blocks/images";
import type { Placement } from "@/lib/blocks/types";
import { FigureBox } from "./FigureBox";
import { useAssetUrl } from "./useAssetUrl";

/**
 * Editable image row: each picture is freely positioned within the block's box
 * (drag in 2D, magnets to center/siblings), selected by a click, captioned
 * inline, and can be dragged into another image block.
 */
export function ImageRowEditor({
  blockId,
  items,
  align,
  selectedIndex,
  onSelect,
  onCommit,
  onReset,
  onMoveAcross,
  onCaption,
}: {
  blockId: string;
  items: ImageItem[];
  align: ImageAlign;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onCommit: (positions: Placement[], widthFracs: number[]) => void;
  onReset: () => void;
  onMoveAcross: (fromIndex: number, toBlockId: string) => void;
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
    <FigureBox
      blockId={blockId}
      group="image"
      align={align}
      onSelect={onSelect}
      onCommit={onCommit}
      onReset={onReset}
      onMoveAcross={onMoveAcross}
      items={items.map((it, i) => ({
        key: `${i}-${it.assetId}`,
        pos: it.pos,
        width: it.width ? `${it.width}%` : undefined,
        selected: selectedIndex === i,
        content: (
          <figure className={`m-0 flex flex-col items-center ${it.width ? "w-full" : ""}`}>
            <Img item={it} />
            <input
              value={it.caption ?? ""}
              placeholder="caption…"
              onChange={(e) => onCaption(i, e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-0.5 text-center text-xs italic outline-none focus:border-accent"
            />
          </figure>
        ),
      }))}
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
