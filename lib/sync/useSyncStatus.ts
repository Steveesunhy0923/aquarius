"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";
import { getSyncEngine } from "@/lib/storage";
import type { SyncSnapshot } from "./types";

export interface SyncState extends SyncSnapshot {
  /** `navigator.onLine` — false means the device itself has no network. */
  online: boolean;
  /** Sync now (also the "retry" for an error). */
  retry: () => void;
}

const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/**
 * Live state of the signed-in user's background sync, or null for a guest (or
 * a deployment without cloud): there is nothing to sync, so nothing to show.
 */
export function useSyncStatus(): SyncState | null {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(isOnline());
    const update = () => setOnline(isOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (loading || !userId) {
      setSnapshot(null);
      return;
    }
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attach = (): boolean => {
      const engine = getSyncEngine();
      if (!engine) return false;
      const read = () => setSnapshot(engine.snapshot());
      unsubscribe = engine.subscribe(read);
      read();
      return true;
    };
    // The engine is chosen by a user-id cache that AuthProvider fills in ITS
    // effect — which runs after this one on the first commit. One retry on the
    // next task sees it; without it the badge never appears on a cold load.
    if (!attach()) timer = setTimeout(attach, 0);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [userId, loading]);

  const retry = useCallback(() => void getSyncEngine()?.syncAll(), []);

  return snapshot ? { ...snapshot, online, retry } : null;
}
