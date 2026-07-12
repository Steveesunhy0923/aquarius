/**
 * Aquarius sync engine — SKELETON.
 *
 * Reconciles the local IndexedDB `LibraryStore` with the Supabase Postgres
 * mirror. This file is intentionally a *type-correct scaffold*: the control flow,
 * status machine, and event plumbing are real and exercised, while the actual
 * row-level reconciliation is deferred and marked `TODO(crdt)` so the future Yjs
 * implementation has obvious seams to fill.
 *
 * NOTE: the realtime collaboration that actually shipped lives in `lib/collab/`
 * (block-level Yjs over Supabase Realtime; ydoc column, migrations 0007/0008)
 * and does not use this module. This engine is retained as the seam for a future
 * offline/background sync; no app code imports it today.
 *
 * Invariants honored by this skeleton:
 *   • Safe to import on the server — no top-level side effects, no `getStore()`
 *     at module load (only inside the constructor default, evaluated lazily).
 *   • Never throws when Supabase is unconfigured — `syncAll()` short-circuits to
 *     a `disabled` result and the per-note ops no-op.
 *   • No real network calls in the skeleton. Any future network access must be
 *     guarded behind `isSupabaseConfigured()`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
// Type-only: pulls Yjs types for the CRDT seam WITHOUT a runtime dependency.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for the CRDT seam below
import type * as Y from "yjs";

import { getStore } from "@/lib/storage";
import type { LibraryStore, NoteMeta } from "@/lib/storage/types";
import {
  getSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

import type { SyncEvent, SyncResult, SyncStatus } from "./types";

/**
 * Row shape for the `notes` table in Supabase (snake_case), as it would appear
 * over the wire. Mirrors the LIGHT `NoteMeta` 1:1. Kept local to the engine
 * because it is a transport detail, not part of the storage contract.
 */
interface NoteRow {
  id: string;
  notebook_id: string;
  subject_id: string;
  title: string;
  sort_order: number; // maps to local NoteMeta.order (column is `sort_order`)
  tags: string[];
  thumbnail: string | null;
  mode: NoteMeta["mode"];
  created_at: string;
  updated_at: string;
  rev: string | null;
}

export class SyncEngine {
  private readonly store: LibraryStore;
  private _status: SyncStatus = "idle";
  private readonly listeners = new Set<(e: SyncEvent) => void>();

  constructor(store: LibraryStore = getStore()) {
    this.store = store;
  }

  /** Current engine state. */
  get status(): SyncStatus {
    return this._status;
  }

  /**
   * Subscribe to sync lifecycle events. Returns an unsubscribe function.
   * Multiple subscribers are supported; each receives every event.
   */
  subscribe(fn: (e: SyncEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Broadcast an event to all current listeners. */
  private emit(event: SyncEvent): void {
    for (const fn of this.listeners) {
      fn(event);
    }
  }

  /** Set status and emit a matching `status` event. */
  private setStatus(status: SyncStatus): void {
    this._status = status;
    this.emit({ type: "status", status });
  }

  /**
   * Reconcile the entire library in both directions.
   *
   * Strategy (current): pull-then-push, last-write-wins by `updatedAt`.
   * Never throws — failures are collected into `result.errors` and the engine
   * settles into the `error` status.
   */
  async syncAll(): Promise<SyncResult> {
    // Local-only mode: no cloud configured. Do nothing, report disabled.
    if (!isSupabaseConfigured()) {
      this.setStatus("disabled");
      return {
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: [],
        status: "disabled",
      };
    }

    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
      status: "syncing",
    };

    this.setStatus("syncing");

    try {
      const supabase = getSupabaseClient();
      if (supabase === null) {
        // Race-safe guard: config flipped off between the check and here.
        this.setStatus("disabled");
        return { ...result, status: "disabled" };
      }

      // ── Phase 1: PULL ──────────────────────────────────────────────────────
      // Fetch remote rows newer than our local copies and write them down,
      // resolving divergence with last-write-wins on `updatedAt`.
      // TODO(crdt): replace last-write-wins with Yjs document merge — load the
      // shared doc, apply the remote update vector, and persist the merged tree.
      // For each reconciled entity, emit a `progress` event and bump
      // `result.pulled` / `result.conflicts` accordingly.

      // ── Phase 2: PUSH ──────────────────────────────────────────────────────
      // Upload local entities that are newer than (or missing from) the cloud.
      // TODO(crdt): emit the local Yjs update vector instead of full rows, and
      // bump `result.pushed` per entity written.

      // The actual per-entity loops are deferred; the skeleton settles clean.
      this.setStatus("idle");
      result.status = "idle";
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(message);
      result.status = "error";
      this.emit({ type: "error", message });
      this.setStatus("error");
      return result;
    }
  }

  /**
   * Push a single note's metadata (and eventually its package) to the cloud.
   * No-ops when cloud is unconfigured so callers never need to guard.
   */
  async pushNote(noteId: string): Promise<void> {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseClient();
    if (supabase === null) return;

    const meta = await this.store.getNoteMeta(noteId);
    if (meta === undefined) return;

    // Map to the wire row. The upsert itself is deferred.
    const row = SyncEngine.toRow(meta);
    void row;
    void (supabase satisfies SupabaseClient);

    // TODO(crdt): upsert `row` into Supabase `notes`, then push the heavy
    // `NotePackage` as a Yjs update. Resolve server conflicts via doc merge.
  }

  /**
   * Pull a single note's metadata (and eventually its package) from the cloud.
   * No-ops when cloud is unconfigured.
   */
  async pullNote(noteId: string): Promise<void> {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseClient();
    if (supabase === null) return;

    void noteId;
    void (supabase satisfies SupabaseClient);

    // TODO(crdt): select the row by id, map via `fromRow`, and reconcile against
    // the local `NoteMeta` with last-write-wins (today) / doc merge (future),
    // e.g. `await this.store.updateNoteMeta(meta.id, SyncEngine.fromRow(row))`.
  }

  // ── Row mappers (camelCase <-> snake_case) ────────────────────────────────
  //
  // These demonstrate the local-entity <-> wire-row mapping the reconciliation
  // loops will use. Kept static and pure so they are trivially unit-testable.

  /** Local `NoteMeta` → Supabase `notes` row. */
  private static toRow(meta: NoteMeta): NoteRow {
    return {
      id: meta.id,
      notebook_id: meta.notebookId,
      subject_id: meta.subjectId,
      title: meta.title,
      sort_order: meta.order,
      tags: meta.tags,
      thumbnail: meta.thumbnail ?? null,
      mode: meta.mode,
      created_at: meta.createdAt,
      updated_at: meta.updatedAt,
      rev: meta.rev ?? null,
    };
  }

  /** Supabase `notes` row → local `NoteMeta`. */
  private static fromRow(row: NoteRow): NoteMeta {
    return {
      id: row.id,
      notebookId: row.notebook_id,
      subjectId: row.subject_id,
      title: row.title,
      order: row.sort_order,
      tags: row.tags,
      thumbnail: row.thumbnail ?? undefined,
      mode: row.mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rev: row.rev,
    };
  }

  // ── CRDT seam (future) ────────────────────────────────────────────────────
  //
  // TODO(crdt): this is where Yjs documents + a realtime provider plug in.
  //
  //   • Keep one `Y.Doc` per open note, keyed by noteId.
  //       private readonly docs = new Map<string, Y.Doc>();
  //   • Bind it to a realtime transport (e.g. a Supabase-channel provider or
  //     y-websocket) so updates flow peer↔cloud without full-row reconciliation.
  //   • On local edits, observe the doc and persist the merged tree via
  //     `this.store.saveNote(...)`; on remote updates, apply them and emit a
  //     `progress` event.
  //
  // Only the *types* are imported here (`import type * as Y from "yjs"`); no
  // provider is constructed and no runtime Yjs dependency is taken, keeping this
  // skeleton importable on the server. The `Y` namespace is referenced in this
  // illustrative type alias purely to anchor the seam:
  //
  //   type NoteDoc = Y.Doc; // (reserved — instantiated by the CRDT impl)
}
