"use client";

import { Icon } from "@/components/Icon";
import type { ImageItem } from "@/lib/blocks/images";
import { useAssetUrl } from "./useAssetUrl";

const EMPTY_BOX = "rounded-lg border border-dashed border-border p-4 text-sm text-muted";

/**
 * AsyncImage — resolves an image item's asset to an object URL and renders it,
 * with a dashed placeholder while loading. Shared by the read-only ImageRow
 * and the editable ImageRowEditor (which disables native dragging).
 */
export function AsyncImage({ item, draggable }: { item: ImageItem; draggable?: boolean }) {
  const url = useAssetUrl(item.assetId);
  if (!url) return <div className={EMPTY_BOX}>Loading image…</div>;
  // eslint-disable-next-line @next/next/no-img-element -- local object-URL blob
  return (
    <img
      src={url}
      alt={item.alt ?? ""}
      draggable={draggable}
      className={`block max-h-[480px] rounded-md ${item.width ? "w-full" : "max-w-full"}`}
    />
  );
}

/** Dashed placeholder for an image block that has no source yet. */
export function ImageEmpty() {
  return (
    <div className={`flex items-center gap-1.5 ${EMPTY_BOX}`}>
      <Icon name="image" size={16} />
      image (no source)
    </div>
  );
}
