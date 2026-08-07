/**
 * Sync layer public barrel.
 *
 * Reconciles a signed-in user's per-user IndexedDB mirror with the Supabase
 * cloud: `SyncedStore` is the local-first `LibraryStore` that `getStore()`
 * returns when signed in; `SyncEngine` is its background push/pull spine.
 *
 *   import { SyncedStore, SYNC_APPLIED_EVENT, type SyncEvent } from "@/lib/sync";
 */

export { SyncEngine, SYNC_APPLIED_EVENT } from "./engine";
export { SyncedStore } from "./store";
export { SyncQueue, type SyncOp } from "./queue";
export type {
  Reconcilable,
  SyncDirection,
  SyncEvent,
  SyncResult,
  SyncStatus,
} from "./types";
