/**
 * Persistent push queue for the sync engine.
 *
 * Ops are id-only — "push the CURRENT local state of entity X" — so repeated
 * edits coalesce into one op and the payload is read fresh at flush time.
 * Ordering rules encode the cloud FK graph:
 *
 *   • Upserts keep their FIRST queue position. A note created offline enqueues
 *     [note, package]; a later rename must not shuffle the package push ahead
 *     of the note row it references.
 *   • A delete cancels the entity's pending upserts (nothing to push anymore)
 *     — and for notes, its package/asset/snapshot ops too — then appends.
 *
 * Persisted to localStorage per user so an offline session survives reload.
 * The storage backend is injectable for tests.
 *
 * STORAGE IS THE SOURCE OF TRUTH, NOT THIS OBJECT. Every tab of the app has
 * its own SyncQueue over the same localStorage key. Each used to load the list
 * once and then write its private copy back on every change — so two open tabs
 * overwrote each other, and an op enqueued in one was erased by the next write
 * from the other. The edit behind that op stayed on the device, unpushed and
 * with nothing left to push it, until a later pull replaced it. Every method
 * now re-reads storage first (`refresh`), which makes each operation a
 * read-modify-write on the shared list. That is not a transaction, but JS is
 * single-threaded per tab and each of these bodies is synchronous, so the
 * window is a few microseconds rather than the lifetime of the tab.
 */

export type SyncOp =
  | { kind: "subject" | "notebook" | "note" | "package"; id: string }
  | { kind: "subject-delete" | "notebook-delete" | "note-delete"; id: string }
  | { kind: "asset"; id: string; noteId: string }
  | { kind: "asset-delete"; id: string }
  | { kind: "snapshot"; id: string; noteId: string }
  | { kind: "snapshot-delete"; id: string };

/**
 * `attempts` — bookkeeping so a permanently-failing op can't wedge the queue.
 *
 * `seq` — bumped every time the op is (re-)enqueued, i.e. every time the
 * payload it stands for changes. A push is slow (it awaits the network) and
 * the user keeps typing during it: the op the engine is pushing can be
 * re-enqueued mid-push. `remove`/`markFailed` therefore act only when the
 * stored op still carries the `seq` the caller read — otherwise the push that
 * just finished was of a stale payload, and the op must stay queued so the
 * newer state goes up too. Without this the last burst of typing before a
 * pause was removed from the queue by the push that had missed it.
 */
export type QueuedOp = SyncOp & { attempts: number; seq?: number };

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The localStorage key of a user's queue (also watched for cross-tab changes). */
export const queueStorageKey = (uid: string) => `aquarius.sync.queue.${uid}`;

const sameEntity = (a: SyncOp, b: SyncOp) => a.kind === b.kind && a.id === b.id;

export class SyncQueue {
  private ops: QueuedOp[] = [];
  /** The serialized list as last seen in (or written to) storage. */
  private raw: string | null = null;
  /** Storage refused a write (quota / private mode): run in-memory from here
   *  on, and stop re-reading a copy that no longer reflects this queue. */
  private detached = false;
  /** Called after every change made through THIS instance. */
  onChange: (() => void) | null = null;

  constructor(
    private readonly uid: string,
    private readonly storage: KVStorage = globalThis.localStorage,
  ) {
    this.refresh();
  }

  /** Adopt whatever is in storage, if it differs from what we last saw. */
  private refresh(): void {
    if (this.detached) return;
    let raw: string | null;
    try {
      raw = this.storage.getItem(queueStorageKey(this.uid));
    } catch {
      return; // unreadable right now — keep the in-memory list
    }
    if (raw === this.raw) return; // the common case: a string compare, no parse
    this.raw = raw;
    try {
      const parsed = raw ? (JSON.parse(raw) as QueuedOp[]) : [];
      this.ops = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.ops = [];
    }
  }

  private save(): void {
    const raw = JSON.stringify(this.ops);
    if (!this.detached) {
      try {
        this.storage.setItem(queueStorageKey(this.uid), raw);
        this.raw = raw;
      } catch {
        // Quota/private-mode failure: the queue still works in-memory this session.
        this.detached = true;
      }
    }
    this.onChange?.();
  }

  get length(): number {
    this.refresh();
    return this.ops.length;
  }

  /** Pending ops in push order (a copy — mutate via the class API). */
  list(): QueuedOp[] {
    this.refresh();
    return this.ops.map((o) => ({ ...o }));
  }

  /** True when an op of this kind+id is pending (pull skips such entities). */
  has(kind: SyncOp["kind"], id: string): boolean {
    this.refresh();
    return this.ops.some((o) => o.kind === kind && o.id === id);
  }

  /** Any pending op that touches this note (meta/package/assets/snapshots). */
  hasNoteWork(noteId: string): boolean {
    this.refresh();
    return this.ops.some(
      (o) =>
        (("noteId" in o) && o.noteId === noteId) ||
        ((o.kind === "note" || o.kind === "package" || o.kind === "note-delete") && o.id === noteId),
    );
  }

  /** Enqueue an upsert; an existing op for the same entity keeps its position
   *  (and its attempt count resets — the payload it will push has changed). */
  enqueue(op: SyncOp): void {
    this.refresh();
    const existing = this.ops.find((o) => sameEntity(o, op));
    if (existing) {
      existing.attempts = 0;
      existing.seq = (existing.seq ?? 0) + 1;
    } else {
      this.ops.push({ ...op, attempts: 0, seq: 0 });
    }
    this.save();
  }

  /** Enqueue a delete, cancelling the entity's now-pointless pending upserts. */
  enqueueDelete(op: Extract<SyncOp, { kind: `${string}-delete` }>): void {
    this.refresh();
    const entity = op.kind.replace(/-delete$/, "");
    this.ops = this.ops.filter((o) => !(o.kind === entity && o.id === op.id));
    if (op.kind === "note-delete") {
      // The note's content ops die with it (cloud delete cascades anyway):
      // its package push (keyed by the note id) and its asset/snapshot ops.
      this.ops = this.ops.filter(
        (o) => !(o.kind === "package" && o.id === op.id) && !("noteId" in o && o.noteId === op.id),
      );
    }
    if (!this.ops.some((o) => sameEntity(o, op))) {
      this.ops.push({ ...op, attempts: 0, seq: 0 });
    }
    this.save();
  }

  /**
   * Remove a completed op — unless it was re-enqueued since the caller read it
   * (its `seq` moved), in which case what was just pushed is already stale and
   * the op stays. Returns whether it was removed.
   */
  remove(op: QueuedOp): boolean {
    this.refresh();
    const before = this.ops.length;
    this.ops = this.ops.filter((o) => !(sameEntity(o, op) && o.seq === op.seq));
    if (this.ops.length === before) return false;
    this.save();
    return true;
  }

  /** Drop an op regardless of `seq` — the poison-pill exit. */
  discard(op: SyncOp): void {
    this.refresh();
    const before = this.ops.length;
    this.ops = this.ops.filter((o) => !sameEntity(o, op));
    if (this.ops.length !== before) this.save();
  }

  /** Bump an op's attempt count; returns the new count. A re-enqueued op is
   *  left alone (0): the failure was of a payload that no longer exists. */
  markFailed(op: QueuedOp): number {
    this.refresh();
    const found = this.ops.find((o) => sameEntity(o, op) && o.seq === op.seq);
    if (!found) return 0;
    found.attempts += 1;
    this.save();
    return found.attempts;
  }

  clear(): void {
    this.ops = [];
    this.raw = null;
    try {
      this.storage.removeItem(queueStorageKey(this.uid));
    } catch {
      // nothing to clear from
    }
    this.onChange?.();
  }
}
