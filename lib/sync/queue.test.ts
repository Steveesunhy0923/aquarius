import { describe, expect, it } from "vitest";

import { SyncQueue, type KVStorage } from "./queue";

function memStorage(): KVStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("SyncQueue", () => {
  it("coalesces repeated upserts, keeping the FIRST position (cloud FK order)", () => {
    const q = new SyncQueue("u1", memStorage());
    q.enqueue({ kind: "note", id: "n1" });
    q.enqueue({ kind: "package", id: "n1" });
    // A later rename must not shuffle the package ahead of the notes row.
    q.enqueue({ kind: "note", id: "n1" });
    expect(q.list().map((o) => o.kind)).toEqual(["note", "package"]);
  });

  it("re-enqueueing resets the attempt counter (payload changed)", () => {
    const q = new SyncQueue("u1", memStorage());
    q.enqueue({ kind: "note", id: "n1" });
    q.markFailed(q.list()[0]);
    expect(q.list()[0].attempts).toBe(1);
    q.enqueue({ kind: "note", id: "n1" });
    expect(q.list()[0].attempts).toBe(0);
  });

  it("a delete cancels the entity's pending upserts", () => {
    const q = new SyncQueue("u1", memStorage());
    q.enqueue({ kind: "subject", id: "s1" });
    q.enqueueDelete({ kind: "subject-delete", id: "s1" });
    expect(q.list()).toHaveLength(1);
    expect(q.list()[0].kind).toBe("subject-delete");
  });

  it("a note delete also cancels its package/asset/snapshot ops", () => {
    const q = new SyncQueue("u1", memStorage());
    q.enqueue({ kind: "note", id: "n1" });
    q.enqueue({ kind: "package", id: "n1" });
    q.enqueue({ kind: "asset", id: "a1", noteId: "n1" });
    q.enqueue({ kind: "snapshot", id: "sn1", noteId: "n1" });
    q.enqueue({ kind: "note", id: "n2" }); // unrelated — must survive
    q.enqueueDelete({ kind: "note-delete", id: "n1" });
    expect(q.list().map((o) => `${o.kind}:${o.id}`)).toEqual(["note:n2", "note-delete:n1"]);
  });

  it("persists across instances via the storage backend", () => {
    const storage = memStorage();
    const a = new SyncQueue("u1", storage);
    a.enqueue({ kind: "note", id: "n1" });
    const b = new SyncQueue("u1", storage);
    expect(b.list()).toHaveLength(1);
    b.remove(b.list()[0]);
    expect(new SyncQueue("u1", storage).length).toBe(0);
  });

  it("hasNoteWork sees meta, package, content and delete ops for the note", () => {
    const q = new SyncQueue("u1", memStorage());
    q.enqueue({ kind: "asset", id: "a1", noteId: "n1" });
    expect(q.hasNoteWork("n1")).toBe(true);
    expect(q.hasNoteWork("n2")).toBe(false);
    q.enqueueDelete({ kind: "note-delete", id: "n2" });
    expect(q.hasNoteWork("n2")).toBe(true);
  });

  it("queues are isolated per user", () => {
    const storage = memStorage();
    new SyncQueue("u1", storage).enqueue({ kind: "note", id: "n1" });
    expect(new SyncQueue("u2", storage).length).toBe(0);
  });

  // ── Two tabs: two live instances over one storage key ─────────────────────

  it("two open tabs do not erase each other's ops", () => {
    const storage = memStorage();
    const tabA = new SyncQueue("u1", storage);
    const tabB = new SyncQueue("u1", storage); // both loaded while the queue was empty
    tabA.enqueue({ kind: "package", id: "n1" });
    tabB.enqueue({ kind: "package", id: "n2" }); // used to write [n2] over [n1]
    const want = ["package:n1", "package:n2"];
    expect(tabA.list().map((o) => `${o.kind}:${o.id}`)).toEqual(want);
    expect(tabB.list().map((o) => `${o.kind}:${o.id}`)).toEqual(want);
    expect(new SyncQueue("u1", storage).list().map((o) => `${o.kind}:${o.id}`)).toEqual(want);
  });

  it("an op completed in one tab disappears from the other", () => {
    const storage = memStorage();
    const tabA = new SyncQueue("u1", storage);
    const tabB = new SyncQueue("u1", storage);
    tabA.enqueue({ kind: "note", id: "n1" });
    expect(tabB.hasNoteWork("n1")).toBe(true);
    tabB.remove(tabB.list()[0]);
    expect(tabA.length).toBe(0);
    expect(tabA.hasNoteWork("n1")).toBe(false);
  });

  // ── An op re-enqueued while it is being pushed ────────────────────────────

  it("does not remove an op that was re-enqueued during its push", () => {
    const q = new SyncQueue("u1", memStorage());
    q.enqueue({ kind: "package", id: "n1" });
    const pushing = q.list()[0]; // the engine reads the op, then awaits the network…
    q.enqueue({ kind: "package", id: "n1" }); // …and the user saves again meanwhile
    expect(q.remove(pushing)).toBe(false); // the push that finished was already stale
    expect(q.list()).toHaveLength(1);
    expect(q.remove(q.list()[0])).toBe(true); // the next push carries the newer state
    expect(q.length).toBe(0);
  });

  it("does not count a failure against an op that was re-enqueued meanwhile", () => {
    const q = new SyncQueue("u1", memStorage());
    q.enqueue({ kind: "package", id: "n1" });
    const pushing = q.list()[0];
    q.enqueue({ kind: "package", id: "n1" });
    expect(q.markFailed(pushing)).toBe(0);
    expect(q.list()[0].attempts).toBe(0);
  });

  it("removes ops persisted before `seq` existed", () => {
    const storage = memStorage();
    storage.setItem("aquarius.sync.queue.u1", JSON.stringify([{ kind: "note", id: "n1", attempts: 0 }]));
    const q = new SyncQueue("u1", storage);
    expect(q.remove(q.list()[0])).toBe(true);
    expect(q.length).toBe(0);
  });

  it("discard drops an op whatever its seq", () => {
    const q = new SyncQueue("u1", memStorage());
    q.enqueue({ kind: "note", id: "n1" });
    const stale = q.list()[0];
    q.enqueue({ kind: "note", id: "n1" });
    q.discard(stale);
    expect(q.length).toBe(0);
  });

  it("keeps working in memory when storage refuses writes", () => {
    const storage = memStorage();
    storage.setItem = () => { throw new Error("QuotaExceededError"); };
    const q = new SyncQueue("u1", storage);
    q.enqueue({ kind: "note", id: "n1" });
    q.enqueue({ kind: "package", id: "n1" });
    expect(q.list().map((o) => o.kind)).toEqual(["note", "package"]); // not reset by a re-read
  });

  it("notifies onChange on every change made through the instance", () => {
    const q = new SyncQueue("u1", memStorage());
    let n = 0;
    q.onChange = () => { n += 1; };
    q.enqueue({ kind: "note", id: "n1" });
    q.remove(q.list()[0]);
    expect(n).toBe(2);
  });
});
