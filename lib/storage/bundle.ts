/**
 * Shared helpers for portable note bundles (`.aqnote`) and cloud↔local copies.
 *
 * Pure, browser-only (no IndexedDB, no Supabase): base64 ⇄ Blob conversion and
 * the asset-id remapping used when re-importing a note (every image's
 * `attrs.assetId` is rewritten to its fresh id). Both the IndexedDB store
 * (`local.ts`) and the Supabase store (`cloud.ts`) reuse these so import/export
 * behaves identically across backends.
 */

import type { Block, DocumentTree, Slots } from "@/lib/blocks/types";
import type { EntityId } from "./types";

// ─── base64 <-> Blob (browser APIs only; NO Node Buffer) ─────────────────────

/** Encode a Blob to a base64 string using only browser APIs. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunk to avoid blowing the argument limit of String.fromCharCode on big files.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** Decode a base64 string back into a Blob with the given mime type. */
export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

// ─── Tree asset-id remapping (used by importNote on every backend) ───────────

/** Return a deep clone of `tree` with image `attrs.assetId` values remapped. */
export function remapTreeAssetIds(
  tree: DocumentTree,
  idMap: Map<EntityId, EntityId>,
): DocumentTree {
  return {
    ...tree,
    blocks: tree.blocks.map((b) => remapBlockAssetIds(b, idMap)),
  };
}

/** Deep-clone a block, remapping `attrs.assetId` on image blocks throughout. */
function remapBlockAssetIds(block: Block, idMap: Map<EntityId, EntityId>): Block {
  const next: Block = { ...block };

  if (block.attrs) {
    next.attrs = { ...block.attrs };
    if (block.type === "image" && typeof block.attrs.assetId === "string") {
      const mapped = idMap.get(block.attrs.assetId); // legacy single-image shape
      if (mapped) next.attrs.assetId = mapped;
    }
    // Current image shape: a row of items, each with its own assetId.
    if (block.type === "image" && Array.isArray(block.attrs.images)) {
      next.attrs.images = (block.attrs.images as Array<Record<string, unknown>>).map((it) => {
        const aid = it?.assetId;
        return typeof aid === "string" && idMap.has(aid)
          ? { ...it, assetId: idMap.get(aid) }
          : it;
      });
    }
    // Inline math runs can nest image blocks inside text blocks.
    if (Array.isArray(block.attrs.runs)) {
      next.attrs.runs = block.attrs.runs.map((run) =>
        run.kind === "math"
          ? { kind: "math", block: remapBlockAssetIds(run.block, idMap) }
          : run,
      );
    }
  }

  if (block.slots) {
    const slots: Slots = {};
    for (const [name, children] of Object.entries(block.slots)) {
      slots[name] = children.map((child) => remapBlockAssetIds(child, idMap));
    }
    next.slots = slots;
  }

  return next;
}
