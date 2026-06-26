"use client";

import { getStore } from "@/lib/storage";
import { useEffect, useState } from "react";

/** Loads an asset blob from local storage and returns a (revocable) object URL. */
export function useAssetUrl(assetId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    getStore()
      .getAsset(assetId)
      .then((asset) => {
        if (asset && active) {
          objectUrl = URL.createObjectURL(asset.data);
          setUrl(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);
  return url;
}
