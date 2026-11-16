/**
 * Sync-engine type surface.
 *
 * These types describe the *reconciliation* contract between the local
 * IndexedDB `LibraryStore` and the Supabase Postgres mirror. The shapes here are
 * deliberately backend-agnostic: today the engine does last-write-wins by
 * `updatedAt`; tomorrow a Yjs/CRDT implementation will fill the same seams
 * (see `engine.ts`, `TODO(crdt)`), so the public types are designed to outlive
 * the current skeleton.
 */

/** Lifecycle state of the sync engine, surfaced to the UI. */
export type SyncStatus =
  | "idle"
  | "syncing"
  | "offline"
  | "error"
  /** Cloud not configured for this deployment (local-only mode). */
  | "disabled";

/** Aggregate outcome of a sync run. */
export interface SyncResult {
  /** Number of local entities written up to the cloud. */
  pushed: number;
  /** Number of cloud entities written down to local. */
  pulled: number;
  /** Number of entities that diverged and required conflict resolution. */
  conflicts: number;
  /** Human-readable errors collected during the run (run does not throw). */
  errors: string[];
  /** Engine status at the moment the run resolved. */
  status: SyncStatus;
}

/** Which way data flows during a reconciliation. */
export type SyncDirection = "push" | "pull" | "both";

/**
 * Events emitted to `SyncEngine.subscribe` listeners. A discriminated union so
 * consumers can `switch (e.type)` exhaustively.
 */
export type SyncEvent =
  | { type: "status"; status: SyncStatus }
  /** The push queue changed (in this tab or another): `pending` ops remain. */
  | { type: "queue"; pending: number }
  | { type: "progress"; entity: string; done: number; total: number }
  | { type: "error"; message: string };

/** Everything a status indicator needs, read in one go (`SyncEngine.snapshot`). */
export interface SyncSnapshot {
  status: SyncStatus;
  /** Local changes not yet pushed to the cloud. */
  pending: number;
  /** The most recent failure, cleared by the next clean run. */
  lastError: string | null;
  /** ISO time of the last run that completed push + pull, if any. */
  lastSyncedAt: string | null;
}

/**
 * Minimal shape every reconcilable record must expose. `LibraryStore` entities
 * (`Subject`, `Notebook`, `NoteMeta`, `NotePackage`, …) all satisfy this, which
 * lets the engine reconcile them generically.
 */
export interface Reconcilable {
  /** Stable primary key, identical across local and cloud. */
  id: string;
  /** ISO-8601 last-modified marker; basis for last-write-wins. */
  updatedAt: string;
  /** CRDT/causal revision marker; null until first cloud sync. */
  rev?: string | null;
}
