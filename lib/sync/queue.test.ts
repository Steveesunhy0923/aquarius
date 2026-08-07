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
});
