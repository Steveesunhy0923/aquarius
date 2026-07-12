"use client";

import type { ImageAlign, ImageItem } from "@/lib/blocks/images";
import type { Placement } from "@/lib/blocks/types";
import { AsyncImage, ImageEmpty } from "./AsyncImage";
import { CaptionInput } from "./CaptionInput";
import { FigureBox } from "./FigureBox";

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
  if (items.length === 0) return <ImageEmpty />;
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
            <AsyncImage item={it} draggable={false} />
            <CaptionInput value={it.caption ?? ""} onChange={(text) => onCaption(i, text)} />
          </figure>
        ),
      }))}
    />
  );
}
