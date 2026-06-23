/**
 * Sync layer public barrel.
 *
 * Reconciles the local IndexedDB `LibraryStore` with the Supabase mirror.
 * Import surface:
 *
 *   import { SyncEngine, type SyncResult, type SyncEvent } from "@/lib/sync";
 */

export { SyncEngine } from "./engine";
export type {
  Reconcilable,
  SyncDirection,
  SyncEvent,
  SyncResult,
  SyncStatus,
} from "./types";
