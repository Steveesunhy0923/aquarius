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
 *
 * THREE THINGS THIS ENGINE MUST NEVER DO, each of which it once could:
 *
 *   1. Run as the wrong user. The cloud client is a process-wide singleton
 *      holding whoever is signed in NOW; the engine belongs to one uid for
 *      life. An engine that outlived its sign-out kept ticking: with the next
 *      account's session it listed THAT user's rows, found none of its own,
 *      and deleted its whole mirror as "removed on another device" — and
 *      pushed its queued notes into the other account, since `owner_id`
 *      defaults to auth.uid(). Hence `active()`, checked before every cloud
 *      call and again after every listing, and `dispose()`.
 *   2. Run twice at once. Every open tab has an engine over the same mirror
 *      and the same queue. A Web Lock makes a run exclusive across tabs.
 *   3. Give up on work because the session lapsed. A failed push normally
 *      counts toward MAX_ATTEMPTS and is then dropped (a poison-pill guard).
 *      An expired session fails EVERY op, every minute — five minutes of that
 *      used to empty the queue. Auth failures now stop the run instead, with
 *      the ops intact.
 */

import type { LocalLibraryStore } from "@/lib/storage/local";
import type { SupabaseLibraryStore } from "@/lib/storage/cloud";
import type { NoteMeta } from "@/lib/storage/types";
import { SyncQueue, queueStorageKey, type KVStorage, type QueuedOp } from "./queue";
import type { SyncEvent, SyncResult, SyncSnapshot, SyncStatus } from "./types";

/** Give up on an op after this many non-network failures (poison-pill guard). */
const MAX_ATTEMPTS = 5;

/** Debounce between a local write and the push that carries it. */
const KICK_MS = 2_500;

/** Background cadence: the catch-all for changes made on other devices. */
const INTERVAL_MS = 60_000;

/** How long one listing of cloud package stamps may serve a flush (below). */
const STAMPS_TTL_MS = 10_000;

/** Window event dispatched after a pull applied changes, so list UIs refresh. */
export const SYNC_APPLIED_EVENT = "aquarius:sync-applied";

const lastPullKey = (uid: string) => `aquarius.sync.lastPull.${uid}`;

/** Numeric timestamp compare — cloud stamps are "+00:00", local ones "Z". */
const ts = (iso: string | null | undefined): number => {
  const n = Date.parse(iso ?? "");
  return Number.isNaN(n) ? 0 : n;
};

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e);

/** Network-ish failures keep the op queued; anything else counts an attempt. */
function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /fetch|network|load failed|timed?\s?out|connection/i.test(messageOf(e));
}

/** The session is missing or expired: nothing about the OP is wrong, and it
 *  will succeed unchanged after the next sign-in. Never counts as an attempt. */
export function isAuthError(e: unknown): boolean {
  const o = (e ?? {}) as { status?: unknown; statusCode?: unknown; code?: unknown };
  if (o.status === 401 || o.statusCode === 401 || o.statusCode === "401") return true;
  if (o.code === "PGRST301") return true; // PostgREST: JWT invalid / expired
  return /\bjwt\b|not signed in|invalid (refresh )?token|session (expired|missing|not found)/i.test(messageOf(e));
}

/** Thrown to unwind a run whose engine was disposed or whose user signed out
 *  (or was replaced) midway. Not an error anyone should see. */
class SessionChanged extends Error {
  constructor() {
    super("sync stopped: the signed-in user changed");
    this.name = "SessionChanged";
  }
}

export interface SyncEngineOptions {
  /**
   * The id of the user the cloud client is authenticated as RIGHT NOW (null
   * when signed out). The engine only ever touches the cloud while this equals
   * its own uid. Defaults to "always me", for callers that own the session.
   */
  currentUserId?: () => string | null;
  /** Backing store for the push queue (tests); defaults to localStorage. */
  queueStorage?: KVStorage;
}

export class SyncEngine {
  readonly queue: SyncQueue;
  private _status: SyncStatus = "idle";
  private lastError: string | null = null;
  private lastSyncedAt: string | null = null;
  private readonly listeners = new Set<(e: SyncEvent) => void>();
  private running: Promise<SyncResult> | null = null;
  /** Something changed while a run was in flight — go again when it ends. */
  private rerun = false;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private disposed = false;
  private readonly currentUserId: () => string | null;
  private readonly teardown: (() => void)[] = [];

  constructor(
    private readonly uid: string,
    private readonly local: LocalLibraryStore,
    private readonly cloud: SupabaseLibraryStore,
    options: SyncEngineOptions = {},
  ) {
    this.currentUserId = options.currentUserId ?? (() => uid);
    this.queue = options.queueStorage ? new SyncQueue(uid, options.queueStorage) : new SyncQueue(uid);
    this.queue.onChange = () => this.emit({ type: "queue", pending: this.queue.length });
    try {
      this.lastSyncedAt = globalThis.localStorage?.getItem(lastPullKey(uid)) ?? null;
    } catch {
      // no localStorage — "never synced" is the honest answer
    }

    if (typeof window !== "undefined") {
      const onOnline = () => void this.syncAll();
      // Another tab changed the shared queue: this tab's pending count moved.
      const onStorage = (e: StorageEvent) => {
        if (e.key === queueStorageKey(uid)) this.emit({ type: "queue", pending: this.queue.length });
      };
      window.addEventListener("online", onOnline);
      window.addEventListener("storage", onStorage);
      this.interval = setInterval(() => void this.syncAll(), INTERVAL_MS);
      this.teardown.push(
        () => window.removeEventListener("online", onOnline),
        () => window.removeEventListener("storage", onStorage),
      );
      // A pull in one tab rewrites the mirror every tab reads. The other tabs'
      // own next pull finds nothing newer, so without this relay they would
      // never learn their lists are stale.
      if (typeof BroadcastChannel !== "undefined") {
        this.channel = new BroadcastChannel(`aquarius-sync-${uid}`);
        this.channel.onmessage = (e: MessageEvent) => {
          if (this.disposed) return;
          if (e.data === "applied") window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
          // Another tab just completed a clean run over the SAME mirror and
          // queue, so this account is in sync — whatever this tab's own last
          // attempt concluded. Without this a tab that once failed kept saying
          // "can't reach cloud" until its own next tick, a minute later.
          if (e.data === "synced" && !this.running && (this._status === "offline" || this._status === "error")) {
            this.lastError = null;
            this.lastSyncedAt = new Date().toISOString();
            this.setStatus("idle");
          }
        };
      }
    }
  }

  get status(): SyncStatus {
    return this._status;
  }

  /** Current state for a status indicator. */
  snapshot(): SyncSnapshot {
    return {
      status: this._status,
      pending: this.queue.length,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  subscribe(fn: (e: SyncEvent) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit(event: SyncEvent): void {
    for (const fn of [...this.listeners]) fn(event);
  }

  private setStatus(status: SyncStatus): void {
    this._status = status;
    this.emit({ type: "status", status });
  }

  private fail(message: string): void {
    this.lastError = message;
    this.emit({ type: "error", message });
  }

  /** True while this engine may touch the cloud: alive, and the session in the
   *  shared client is still this engine's user. */
  private active(): boolean {
    return !this.disposed && this.currentUserId() === this.uid;
  }

  private assertActive(): void {
    if (!this.active()) throw new SessionChanged();
  }

  /**
   * Stop for good: timers, listeners, and any run in flight (which unwinds at
   * its next cloud call). Called when the user signs out or another account
   * takes over the tab. Queued ops stay in storage for this user's next
   * sign-in. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.kickTimer) clearTimeout(this.kickTimer);
    if (this.interval) clearInterval(this.interval);
    this.kickTimer = null;
    this.interval = null;
    for (const undo of this.teardown) undo();
    this.teardown.length = 0;
    this.channel?.close();
    this.channel = null;
    this.queue.onChange = null;
    this.listeners.clear();
  }

  /** Debounced sync after a local write — coalesces bursts of edits. */
  kick(): void {
    if (this.disposed) return;
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      // A run in flight took its list of ops before this write landed; joining
      // it (as syncAll would) leaves the write waiting for the next tick.
      if (this.running) this.rerun = true;
      else void this.syncAll();
    }, KICK_MS);
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
    if (!this.active()) return Promise.resolve(this.skipped());
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.rerun) {
        this.rerun = false;
        this.kick();
      }
    });
    return this.running;
  }

  private skipped(): SyncResult {
    return { pushed: 0, pulled: 0, conflicts: 0, errors: [], status: this._status };
  }

  /**
   * One run, exclusive across every tab signed in as this user. If another tab
   * holds the lock it is already doing this work over the same mirror and the
   * same queue — including the ops this tab enqueued — so this one stands down
   * and checks back shortly rather than queueing behind it (a stalled request
   * in that tab must not be able to block this one forever).
   */
  private async run(): Promise<SyncResult> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return this.runExclusive();
    const result = await locks.request(
      `aquarius-sync-${this.uid}`,
      { ifAvailable: true },
      (lock) => (lock ? this.runExclusive() : null),
    );
    if (result) return result;
    if (this.queue.length > 0) this.rerun = true;
    return this.skipped();
  }

  private async runExclusive(): Promise<SyncResult> {
    const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [], status: "syncing" };
    if (!this.active()) return this.skipped();
    this.setStatus("syncing");
    try {
      await this.flush(result);
      await this.pull(result);
      this.lastSyncedAt = new Date().toISOString();
      try {
        localStorage.setItem(lastPullKey(this.uid), this.lastSyncedAt);
      } catch {
        // localStorage unavailable — first-pull blocking just repeats next time.
      }
      // Ops that failed (and stay queued for retry) make this an error, not a
      // success; ops merely enqueued during the run are just `pending`.
      result.status = result.errors.length > 0 ? "error" : "idle";
      if (result.status === "idle") this.lastError = null;
    } catch (err) {
      if (err instanceof SessionChanged) {
        result.status = "idle"; // signed out mid-run: nothing to report
      } else {
        const message = messageOf(err);
        result.errors.push(message);
        result.status = isNetworkError(err) ? "offline" : "error";
        if (result.status === "error") this.fail(message);
      }
    }
    if (this.disposed) return result;
    this.setStatus(result.status);
    if (result.pulled > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
      this.channel?.postMessage("applied");
    }
    if (result.status === "idle") this.channel?.postMessage("synced");
    return result;
  }

  // ── Push ──────────────────────────────────────────────────────────────────

  private async flush(result: SyncResult): Promise<void> {
    // The conflict check needs the cloud's package stamps. Listing them once
    // per op made a flush of N notes do N full listings; one listing now
    // serves the ops of the next few seconds. It is not held for the whole
    // flush, because the check exists to notice ANOTHER device's push, and a
    // long flush is exactly when one could land.
    let stamps: { at: number; value: Promise<Map<string, string>> } | null = null;
    const packageStamps = (): Promise<Map<string, string>> => {
      if (!stamps || Date.now() - stamps.at > STAMPS_TTL_MS) {
        const value = this.cloud.syncListPackageStamps();
        const entry = { at: Date.now(), value };
        value.catch(() => {
          if (stamps === entry) stamps = null; // never reuse a failed listing
        });
        stamps = entry;
      }
      return stamps.value;
    };

    for (const op of this.queue.list()) {
      this.assertActive();
      try {
        await this.pushOp(op, result, packageStamps);
        result.pushed += 1;
        // `remove` declines when the op was re-enqueued during the push: what
        // went up is already stale, so the op stays and the run repeats.
        if (!this.queue.remove(op)) this.rerun = true;
      } catch (err) {
        // A failure caused by the session going away says nothing about the op.
        if (err instanceof SessionChanged || !this.active()) throw new SessionChanged();
        if (isNetworkError(err) || isAuthError(err)) throw err; // stop; ops stay queued
        const attempts = this.queue.markFailed(op);
        const gaveUp = attempts >= MAX_ATTEMPTS;
        const message = `${gaveUp ? "gave up on" : "push"} ${op.kind} ${op.id}: ${messageOf(err)}`;
        result.errors.push(message);
        this.fail(message);
        if (gaveUp) this.queue.discard(op);
      }
    }
  }

  private async pushOp(
    op: QueuedOp,
    result: SyncResult,
    packageStamps: () => Promise<Map<string, string>>,
  ): Promise<void> {
    // `assertActive()` sits directly before each cloud call, after the local
    // read it depends on: the read is async, and the user can sign out in it.
    switch (op.kind) {
      case "subject": {
        const s = (await this.local.listSubjects()).find((x) => x.id === op.id);
        if (!s) return;
        this.assertActive();
        await this.local.syncMarkSynced("subject", op.id, await this.cloud.syncUpsertSubject(s));
        return;
      }
      case "notebook": {
        const all = await this.local.syncListAll();
        const n = all.notebooks.find((x) => x.id === op.id);
        if (!n) return;
        this.assertActive();
        await this.local.syncMarkSynced("notebook", op.id, await this.cloud.syncUpsertNotebook(n));
        return;
      }
      case "note": {
        const m = await this.local.getNoteMeta(op.id);
        if (!m) return;
        this.assertActive();
        await this.local.syncMarkSynced("note", op.id, await this.cloud.syncUpsertNote(m));
        return;
      }
      case "package": {
        const pkg = await this.local.syncGetPackage(op.id);
        if (!pkg) return;
        // Both-sides-changed detection: the cloud package moved past our last
        // synced rev → capture its tree in the version history before LWW.
        this.assertActive();
        const remote = (await packageStamps()).get(op.id);
        if (remote && ts(remote) > ts(pkg.rev)) {
          try {
            this.assertActive();
            const theirs = await this.cloud.openNote(op.id);
            await this.local.saveSnapshot(op.id, theirs.tree, {
              label: "Sync conflict — cloud version",
              kind: "manual",
            });
            result.conflicts += 1;
          } catch (e) {
            if (e instanceof SessionChanged) throw e;
            // Snapshot is best-effort; the push itself must still proceed.
          }
        }
        this.assertActive();
        await this.local.syncMarkSynced("package", op.id, await this.cloud.syncUpsertPackage(pkg));
        return;
      }
      case "asset": {
        const blob = await this.local.getAsset(op.id);
        if (!blob) return;
        const { data, ...ref } = blob;
        this.assertActive();
        await this.cloud.syncUpsertAsset(ref, data);
        return;
      }
      case "snapshot": {
        const snap = await this.local.getSnapshot(op.id);
        if (!snap) return;
        this.assertActive();
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
    this.assertActive();
    const remote = await this.cloud.syncListAllOwned();
    // Re-checked AFTER the listing, not only before it. A request that leaves
    // while the session is being replaced is answered for the new user — RLS
    // returns no rows rather than an error — and an empty listing reads below
    // as "everything was deleted remotely".
    this.assertActive();
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
    this.assertActive();
    const stamps = await this.cloud.syncListPackageStamps();
    this.assertActive();
    for (const [noteId, stamp] of stamps) {
      if (this.queue.hasNoteWork(noteId)) continue;
      const mine = await this.local.syncGetPackage(noteId);
      if (mine && ts(stamp) <= ts(mine.rev)) continue;
      this.assertActive();
      const pkg = await this.cloud.openNote(noteId);
      // A save can land while the body downloads; it enqueues work for this
      // note, and local must win until that is pushed.
      if (this.queue.hasNoteWork(noteId)) continue;
      await this.local.syncPutPackage({ ...pkg, updatedAt: stamp, rev: stamp });
      for (const ref of pkg.assets) {
        if (await this.local.getAsset(ref.id)) continue;
        try {
          this.assertActive();
          const blob = await this.cloud.getAsset(ref.id);
          if (blob) await this.local.syncPutAssetBlob(blob);
        } catch (e) {
          if (e instanceof SessionChanged || isNetworkError(e)) throw e;
          // A single unloadable asset must not sink the pull.
        }
      }
      result.pulled += 1;
    }

    // Remote deletions: previously-synced local rows (rev set) that no longer
    // exist in the cloud. Skipped when local unsynced work depends on them —
    // instead the ancestors are re-enqueued so the push resurrects them.
    //
    // This is the one destructive step, and it trusts `remote` to be complete
    // and to be OURS: hence the paginated listing (lib/storage/paginate.ts)
    // and this last check that the session has not changed under us.
    this.assertActive();
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
