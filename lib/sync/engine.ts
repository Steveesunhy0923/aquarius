/**
 * Aquarius sync engine — reconciles a signed-in user's local IndexedDB mirror
 * ("aquarius-u-<uid>") with the Supabase cloud. This replaces the long-lived
 * skeleton: the control flow, status machine and event plumbing are unchanged
 * in spirit, but the row-level reconciliation is now real.
 *
 * Model (see also lib/sync/store.ts):
 *   • The LOCAL MIRROR is the read/write path for the UI (local-first). Every
 *     mutation enqueues a push op (lib/sync/queue.ts).
 *   • PUSH (`flush`) drains the queue in order, reading the entity's current
 *     local state — coalescing edits — and upserting it verbatim. After each
 *     push the cloud row's `updated_at` (stamped by the DB trigger) is stored
 *     as the local `rev`, the last-synced marker.
 *   • PULL (`pull`) lists the user's own cloud rows and applies anything whose
 *     `updated_at` is newer than the local `rev`. Entities with pending push
 *     ops are skipped — local wins until pushed. Rows that vanished remotely
 *     but were previously synced (`rev` set) are deleted locally.
 *   • CONFLICTS (both sides changed the same note package): last-write-wins by
 *     timestamp order of the PUSH, but the cloud's tree is first captured as a
 *     "Sync conflict" snapshot in the note's version history (migration 0011),
 *     so nothing is ever silently lost.
 *
 * Realtime co-editing is NOT this path: lib/collab/ streams Yjs updates for
 * shared notes while they're open. The engine is the background multi-device
 * spine for everything else (and pushes `ydoc` bytes opaquely when present).
 */

import type { LocalLibraryStore } from "@/lib/storage/local";
import type { SupabaseLibraryStore } from "@/lib/storage/cloud";
import type { NoteMeta } from "@/lib/storage/types";
import { SyncQueue, type QueuedOp } from "./queue";
import type { SyncEvent, SyncResult, SyncStatus } from "./types";

/** Give up on an op after this many non-network failures (poison-pill guard). */
const MAX_ATTEMPTS = 5;

/** Window event dispatched after a pull applied changes, so list UIs refresh. */
export const SYNC_APPLIED_EVENT = "aquarius:sync-applied";

const lastPullKey = (uid: string) => `aquarius.sync.lastPull.${uid}`;

/** Numeric timestamp compare — cloud stamps are "+00:00", local ones "Z". */
const ts = (iso: string | null | undefined): number => {
  const n = Date.parse(iso ?? "");
  return Number.isNaN(n) ? 0 : n;
};

/** Network-ish failures keep the op queued; anything else counts an attempt. */
function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e);
  return /fetch|network|load failed|timed?\s?out|connection/i.test(msg);
}

export class SyncEngine {
  readonly queue: SyncQueue;
  private _status: SyncStatus = "idle";
  private readonly listeners = new Set<(e: SyncEvent) => void>();
  private running: Promise<SyncResult> | null = null;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly uid: string,
    private readonly local: LocalLibraryStore,
    private readonly cloud: SupabaseLibraryStore,
  ) {
    this.queue = new SyncQueue(uid);
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => void this.syncAll());
      setInterval(() => void this.syncAll(), 60_000);
    }
  }

  get status(): SyncStatus {
    return this._status;
  }

  subscribe(fn: (e: SyncEvent) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit(event: SyncEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  private setStatus(status: SyncStatus): void {
    this._status = status;
    this.emit({ type: "status", status });
  }

  /** Debounced sync after a local write — coalesces bursts of edits. */
  kick(): void {
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => void this.syncAll(), 2_500);
  }

  /** True once a full pull has ever succeeded for this user on this device. */
  hasPulledOnce(): boolean {
    try {
      return localStorage.getItem(lastPullKey(this.uid)) !== null;
    } catch {
      return false;
    }
  }

  /** Push then pull. Re-entrant calls share the in-flight run. Never throws. */
  syncAll(): Promise<SyncResult> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<SyncResult> {
    const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [], status: "syncing" };
    this.setStatus("syncing");
    try {
      await this.flush(result);
      await this.pull(result);
      try {
        localStorage.setItem(lastPullKey(this.uid), new Date().toISOString());
      } catch {
        // localStorage unavailable — first-pull blocking just repeats next time.
      }
      result.status = this.queue.length > 0 ? "offline" : "idle";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(message);
      result.status = isNetworkError(err) ? "offline" : "error";
      if (result.status === "error") this.emit({ type: "error", message });
    }
    this.setStatus(result.status);
    if (result.pulled > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
    }
    return result;
  }

  // ── Push ──────────────────────────────────────────────────────────────────

  private async flush(result: SyncResult): Promise<void> {
    for (const op of this.queue.list()) {
      try {
        await this.pushOp(op, result);
        this.queue.remove(op);
        result.pushed += 1;
      } catch (err) {
        if (isNetworkError(err)) throw err; // stop; ops stay queued for later
        const attempts = this.queue.markFailed(op);
        const message = `push ${op.kind} ${op.id}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(message);
        this.emit({ type: "error", message });
        if (attempts >= MAX_ATTEMPTS) this.queue.remove(op);
      }
    }
  }

  private async pushOp(op: QueuedOp, result: SyncResult): Promise<void> {
    switch (op.kind) {
      case "subject": {
        const s = (await this.local.listSubjects()).find((x) => x.id === op.id);
        if (!s) return;
        await this.local.syncMarkSynced("subject", op.id, await this.cloud.syncUpsertSubject(s));
        return;
      }
      case "notebook": {
        const all = await this.local.syncListAll();
        const n = all.notebooks.find((x) => x.id === op.id);
        if (!n) return;
        await this.local.syncMarkSynced("notebook", op.id, await this.cloud.syncUpsertNotebook(n));
        return;
      }
      case "note": {
        const m = await this.local.getNoteMeta(op.id);
        if (!m) return;
        await this.local.syncMarkSynced("note", op.id, await this.cloud.syncUpsertNote(m));
        return;
      }
      case "package": {
        const pkg = await this.local.syncGetPackage(op.id);
        if (!pkg) return;
        // Both-sides-changed detection: the cloud package moved past our last
        // synced rev → capture its tree in the version history before LWW.
        const stamps = await this.cloud.syncListPackageStamps();
        const remote = stamps.get(op.id);
        if (remote && ts(remote) > ts(pkg.rev)) {
          try {
            const theirs = await this.cloud.openNote(op.id);
            await this.local.saveSnapshot(op.id, theirs.tree, {
              label: "Sync conflict — cloud version",
              kind: "manual",
            });
            result.conflicts += 1;
          } catch {
            // Snapshot is best-effort; the push itself must still proceed.
          }
        }
        await this.local.syncMarkSynced("package", op.id, await this.cloud.syncUpsertPackage(pkg));
        return;
      }
      case "asset": {
        const blob = await this.local.getAsset(op.id);
        if (!blob) return;
        const { data, ...ref } = blob;
        await this.cloud.syncUpsertAsset(ref, data);
        return;
      }
      case "snapshot": {
        const snap = await this.local.getSnapshot(op.id);
        if (!snap) return;
        await this.cloud.syncUpsertSnapshot(snap);
        return;
      }
      case "subject-delete":
        return void (await this.cloud.deleteSubject(op.id));
      case "notebook-delete":
        return void (await this.cloud.deleteNotebook(op.id));
      case "note-delete":
        return void (await this.cloud.syncDeleteNoteHard(op.id));
      case "asset-delete":
        return void (await this.cloud.deleteAsset(op.id));
      case "snapshot-delete":
        return void (await this.cloud.deleteSnapshot(op.id));
    }
  }

  // ── Pull ──────────────────────────────────────────────────────────────────

  private async pull(result: SyncResult): Promise<void> {
    const remote = await this.cloud.syncListAllOwned();
    const localAll = await this.local.syncListAll();

    // Subjects / notebooks / notes: apply remote rows newer than our last-synced
    // rev; skip anything with pending local ops (local wins until pushed).
    const localSubjects = new Map(localAll.subjects.map((s) => [s.id, s]));
    for (const s of remote.subjects) {
      if (this.queue.has("subject", s.id) || this.queue.has("subject-delete", s.id)) continue;
      const mine = localSubjects.get(s.id);
      if (!mine || ts(s.updatedAt) > ts(mine.rev)) {
        await this.local.syncPutSubject({ ...s, rev: s.updatedAt });
        result.pulled += 1;
      }
    }
    const localNotebooks = new Map(localAll.notebooks.map((n) => [n.id, n]));
    for (const n of remote.notebooks) {
      if (this.queue.has("notebook", n.id) || this.queue.has("notebook-delete", n.id)) continue;
      const mine = localNotebooks.get(n.id);
      if (!mine || ts(n.updatedAt) > ts(mine.rev)) {
        await this.local.syncPutNotebook({ ...n, rev: n.updatedAt });
        result.pulled += 1;
      }
    }
    const localNotes = new Map(localAll.notes.map((n) => [n.id, n]));
    for (const m of remote.notes) {
      if (this.queue.hasNoteWork(m.id)) continue;
      const mine = localNotes.get(m.id);
      if (!mine || ts(m.updatedAt) > ts(mine.rev)) {
        await this.local.syncPutNoteMeta({ ...m, rev: m.updatedAt, dirty: false });
        result.pulled += 1;
      }
    }

    // Packages: fetch bodies whose cloud stamp moved past the local rev, and
    // prefetch their asset bytes so pulled notes work fully offline.
    const stamps = await this.cloud.syncListPackageStamps();
    for (const [noteId, stamp] of stamps) {
      if (this.queue.hasNoteWork(noteId)) continue;
      const mine = await this.local.syncGetPackage(noteId);
      if (mine && ts(stamp) <= ts(mine.rev)) continue;
      const pkg = await this.cloud.openNote(noteId);
      await this.local.syncPutPackage({ ...pkg, updatedAt: stamp, rev: stamp });
      for (const ref of pkg.assets) {
        if (await this.local.getAsset(ref.id)) continue;
        try {
          const blob = await this.cloud.getAsset(ref.id);
          if (blob) await this.local.syncPutAssetBlob(blob);
        } catch (e) {
          if (isNetworkError(e)) throw e;
          // A single unloadable asset must not sink the pull.
        }
      }
      result.pulled += 1;
    }

    // Remote deletions: previously-synced local rows (rev set) that no longer
    // exist in the cloud. Skipped when local unsynced work depends on them —
    // instead the ancestors are re-enqueued so the push resurrects them.
    const remoteSubjectIds = new Set(remote.subjects.map((s) => s.id));
    const remoteNotebookIds = new Set(remote.notebooks.map((n) => n.id));
    const remoteNoteIds = new Set(remote.notes.map((n) => n.id));
    const noteHasPendingWork = (m: NoteMeta) => this.queue.hasNoteWork(m.id);

    for (const m of localAll.notes) {
      if (m.rev && !remoteNoteIds.has(m.id) && !noteHasPendingWork(m)) {
        await this.local.deleteNote(m.id);
        result.pulled += 1;
      }
    }
    for (const n of localAll.notebooks) {
      if (!n.rev || remoteNotebookIds.has(n.id)) continue;
      const dependants = localAll.notes.filter((m) => m.notebookId === n.id && noteHasPendingWork(m));
      if (dependants.length > 0) {
        this.queue.enqueue({ kind: "notebook", id: n.id }); // resurrect remotely
        continue;
      }
      await this.local.deleteNotebook(n.id);
      result.pulled += 1;
    }
    for (const s of localAll.subjects) {
      if (!s.rev || remoteSubjectIds.has(s.id)) continue;
      const dependants = localAll.notes.filter((m) => m.subjectId === s.id && noteHasPendingWork(m));
      if (dependants.length > 0) {
        this.queue.enqueue({ kind: "subject", id: s.id });
        continue;
      }
      await this.local.deleteSubject(s.id);
      result.pulled += 1;
    }
  }
}
