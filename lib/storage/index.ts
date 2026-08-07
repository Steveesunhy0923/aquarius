/**
 * Storage entry point.
 *
 * `getStore()` returns a lazily-created singleton `LocalLibraryStore`. Because
 * IndexedDB only exists in the browser, the store is intended to be used ONLY
 * from client components / effects (e.g. inside `useEffect`, event handlers, or
 * other `"use client"` code). When evaluated on the server (SSR / RSC), there is
 * no `indexedDB`, so the singleton is replaced by a stub whose every method
 * rejects with a clear "storage unavailable on server" error rather than
 * crashing at import time.
 */

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getCachedUserId } from "@/lib/supabase/session";
import { SyncedStore } from "@/lib/sync/store";
import { LocalLibraryStore } from "./local";
import type { EntityId, LibraryStore } from "./types";

const SERVER_ERROR =
  "storage unavailable on server: getStore() may only be used from client " +
  "components/effects (IndexedDB has no server-side equivalent).";

/**
 * A stand-in returned on the server. Every `LibraryStore` method rejects with a
 * descriptive error so a stray server-side call fails loudly instead of silently
 * touching a non-existent database.
 */
function createServerStub(): LibraryStore {
  const reject = (): Promise<never> => Promise.reject(new Error(SERVER_ERROR));
  return {
    listSubjects: reject,
    createSubject: reject,
    updateSubject: reject,
    deleteSubject: reject,
    reorderSubjects: reject,
    listNotebooks: reject,
    createNotebook: reject,
    updateNotebook: reject,
    deleteNotebook: reject,
    moveNotebook: reject,
    listNotes: reject,
    getNoteMeta: reject,
    createNote: reject,
    updateNoteMeta: reject,
    deleteNote: reject,
    moveNote: reject,
    searchNotes: reject,
    listDeletedNotes: reject,
    listRecentNotes: reject,
    listBacklinks: reject,
    openNote: reject,
    saveNote: reject,
    putAsset: reject,
    getAsset: reject,
    deleteAsset: reject,
    exportNote: reject,
    importNote: reject,
    listSnapshots: reject,
    saveSnapshot: reject,
    getSnapshot: reject,
    deleteSnapshot: reject,
  };
}

let localSingleton: LocalLibraryStore | null = null;
let syncedSingleton: { uid: string; store: SyncedStore } | null = null;

/** The IndexedDB store (always local), regardless of auth — used for migration. */
export function getLocalStore(): LibraryStore {
  if (typeof indexedDB === "undefined") return createServerStub();
  if (!localSingleton) localSingleton = new LocalLibraryStore();
  return localSingleton;
}

/**
 * The active `LibraryStore`: when a user is signed in (and cloud is
 * configured), the local-first `SyncedStore` — a per-user IndexedDB mirror
 * with background push/pull against Supabase (lib/sync/) — otherwise the
 * plain local IndexedDB store (guest mode). Synchronous by design — the auth
 * session is mirrored into a module cache (lib/supabase/session.ts) so this
 * never needs to await.
 */
export function getStore(): LibraryStore {
  // Never memoize the server stub: caching it on a first SSR/prerender call
  // would poison a later client call.
  if (typeof indexedDB === "undefined") return createServerStub();
  const uid = isSupabaseConfigured() ? getCachedUserId() : null;
  if (uid) {
    if (syncedSingleton?.uid !== uid) syncedSingleton = { uid, store: new SyncedStore(uid) };
    return syncedSingleton.store;
  }
  return getLocalStore();
}

/** True when `getStore()` currently resolves to the cloud (signed-in) store. */
export function isCloudActive(): boolean {
  return isSupabaseConfigured() && Boolean(getCachedUserId());
}

/**
 * True when the note is held in the active store's OWN local data — the guest
 * database, or the signed-in user's sync mirror. Such a note is ours even if
 * the cloud has not seen it yet, which is the normal state of a note for the
 * first seconds of its life (SyncedStore pushes on a debounce). Callers use
 * this instead of asking the sharing layer, which would report a not-yet-
 * pushed note as missing. See lib/editor/access.ts.
 */
export async function isOwnLocalNote(id: EntityId): Promise<boolean> {
  const store = getStore();
  if (store instanceof SyncedStore) return store.hasLocalCopy(id);
  return (await store.getNoteMeta(id)) !== undefined;
}

/**
 * Copy the entire local IndexedDB library into the active cloud store, so a
 * guest's notes aren't stranded after signing in. Recreates the
 * subject→notebook→note structure; each note round-trips through the portable
 * bundle (content + assets). No-op unless the cloud store is active. Returns how
 * many notes were uploaded.
 */
export async function migrateLocalToCloud(): Promise<{ notes: number }> {
  if (!isCloudActive()) throw new Error("Sign in first to upload to the cloud.");
  const local = getLocalStore();
  const cloud = getStore();
  let notes = 0;
  for (const subject of await local.listSubjects()) {
    const cs = await cloud.createSubject({ name: subject.name, color: subject.color, icon: subject.icon });
    for (const nb of await local.listNotebooks(subject.id)) {
      const cnb = await cloud.createNotebook({ subjectId: cs.id, name: nb.name, color: nb.color });
      for (const note of await local.listNotes(nb.id)) {
        const bundle = await local.exportNote(note.id);
        await cloud.importNote(bundle, cnb.id);
        notes += 1;
      }
    }
  }
  return { notes };
}

export { seedDemoLibrary } from "./seed";
