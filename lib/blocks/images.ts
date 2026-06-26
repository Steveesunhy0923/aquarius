/**
 * Image-row helpers.
 *
 * An `image` block is a ROW of one or more images with a horizontal alignment
 * (default center). Stored as `attrs.images: ImageItem[]` + `attrs.align`.
 * Legacy single-image blocks (`attrs.assetId`) are migrated on read.
 */

import type { Block } from "@/lib/blocks/types";

export type ImageAlign = "left" | "center" | "right";

export interface ImageItem {
  assetId: string;
  alt?: string;
  /** Display width as a percentage of the row (undefined = natural size). */
  width?: number;
  /** Per-image caption, shown under this picture (exported via \caption). */
  caption?: string;
}

const uid = (): string => crypto.randomUUID();

export function imageItems(block: Block): ImageItem[] {
  const arr = block.attrs?.images;
  if (Array.isArray(arr)) {
    return arr.filter(
      (x): x is ImageItem =>
        !!x && typeof (x as ImageItem).assetId === "string",
    );
  }
  const single = block.attrs?.assetId; // migrate legacy single-image block
  if (typeof single === "string") {
    const alt = typeof block.attrs?.alt === "string" ? block.attrs.alt : undefined;
    return [{ assetId: single, alt }];
  }
  return [];
}

export function imageAlign(block: Block): ImageAlign {
  const a = block.attrs?.align;
  return a === "left" || a === "right" ? a : "center";
}

export function makeImageBlock(
  items: ImageItem[],
  align: ImageAlign = "center",
): Block {
  return { id: uid(), type: "image", attrs: { images: items, align } };
}

export function withImages(
  block: Block,
  items: ImageItem[],
  align?: ImageAlign,
): Block {
  const attrs = {
    ...block.attrs,
    images: items,
    align: align ?? imageAlign(block),
  };
  delete attrs.assetId; // drop legacy single-image fields
  delete attrs.alt;
  return { ...block, attrs };
}
