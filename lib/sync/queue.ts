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
 */

export type SyncOp =
  | { kind: "subject" | "notebook" | "note" | "package"; id: string }
  | { kind: "subject-delete" | "notebook-delete" | "note-delete"; id: string }
  | { kind: "asset"; id: string; noteId: string }
  | { kind: "asset-delete"; id: string }
  | { kind: "snapshot"; id: string; noteId: string }
  | { kind: "snapshot-delete"; id: string };

/** Attempt bookkeeping so a permanently-failing op can't wedge the queue. */
export type QueuedOp = SyncOp & { attempts: number };

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const key = (uid: string) => `aquarius.sync.queue.${uid}`;

export class SyncQueue {
  private ops: QueuedOp[];

  constructor(
    private readonly uid: string,
    private readonly storage: KVStorage = globalThis.localStorage,
  ) {
    this.ops = this.load();
  }

  private load(): QueuedOp[] {
    try {
      const raw = this.storage.getItem(key(this.uid));
      const parsed = raw ? (JSON.parse(raw) as QueuedOp[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      this.storage.setItem(key(this.uid), JSON.stringify(this.ops));
    } catch {
      // Quota/private-mode failure: the queue still works in-memory this session.
    }
  }

  get length(): number {
    return this.ops.length;
  }

  /** Pending ops in push order (a copy — mutate via the class API). */
  list(): QueuedOp[] {
    return [...this.ops];
  }

  /** True when an op of this kind+id is pending (pull skips such entities). */
  has(kind: SyncOp["kind"], id: string): boolean {
    return this.ops.some((o) => o.kind === kind && o.id === id);
  }

  /** Any pending op that touches this note (meta/package/assets/snapshots). */
  hasNoteWork(noteId: string): boolean {
    return this.ops.some(
      (o) =>
        (("noteId" in o) && o.noteId === noteId) ||
        ((o.kind === "note" || o.kind === "package" || o.kind === "note-delete") && o.id === noteId),
    );
  }

  /** Enqueue an upsert; an existing op for the same entity keeps its position
   *  (and its attempt count resets — the payload it will push has changed). */
  enqueue(op: SyncOp): void {
    const existing = this.ops.find((o) => o.kind === op.kind && o.id === op.id);
    if (existing) {
      existing.attempts = 0;
    } else {
      this.ops.push({ ...op, attempts: 0 });
    }
    this.save();
  }

  /** Enqueue a delete, cancelling the entity's now-pointless pending upserts. */
  enqueueDelete(op: Extract<SyncOp, { kind: `${string}-delete` }>): void {
    const entity = op.kind.replace(/-delete$/, "");
    this.ops = this.ops.filter((o) => !(o.kind === entity && o.id === op.id));
    if (op.kind === "note-delete") {
      // The note's content ops die with it (cloud delete cascades anyway):
      // its package push (keyed by the note id) and its asset/snapshot ops.
      this.ops = this.ops.filter(
        (o) => !(o.kind === "package" && o.id === op.id) && !("noteId" in o && o.noteId === op.id),
      );
    }
    if (!this.ops.some((o) => o.kind === op.kind && o.id === op.id)) {
      this.ops.push({ ...op, attempts: 0 });
    }
    this.save();
  }

  /** Remove a completed op. */
  remove(op: QueuedOp): void {
    this.ops = this.ops.filter((o) => !(o.kind === op.kind && o.id === op.id));
    this.save();
  }

  /** Bump an op's attempt count; returns the new count. */
  markFailed(op: QueuedOp): number {
    const found = this.ops.find((o) => o.kind === op.kind && o.id === op.id);
    if (!found) return 0;
    found.attempts += 1;
    this.save();
    return found.attempts;
  }

  clear(): void {
    this.ops = [];
    this.storage.removeItem(key(this.uid));
  }
}
