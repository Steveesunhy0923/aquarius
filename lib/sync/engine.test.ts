import { describe, expect, it } from "vitest";

import type { SupabaseLibraryStore } from "@/lib/storage/cloud";
import type { LocalLibraryStore } from "@/lib/storage/local";
import { SyncEngine, isAuthError } from "./engine";
import type { KVStorage } from "./queue";

// The engine against in-memory stand-ins for the mirror and the cloud. Only
// the members the engine calls are implemented; the casts below say so.

function memStorage(): KVStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

interface Note { id: string; notebookId: string; subjectId: string; updatedAt: string; rev?: string | null }
interface Pkg { noteId: string; tree: unknown; assets: never[]; updatedAt: string; rev?: string | null }

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";

function fakeLocal(noteIds: string[], { synced = true } = {}) {
  const notes = new Map<string, Note>(
    noteIds.map((id) => [id, { id, notebookId: "nb", subjectId: "s", updatedAt: T0, rev: synced ? T0 : null }]),
  );
  const packages = new Map<string, Pkg>(
    noteIds.map((id) => [id, { noteId: id, tree: { v: 1 }, assets: [], updatedAt: T0, rev: synced ? T0 : null }]),
  );
  const deleted: string[] = [];
  const store = {
    notes,
    packages,
    deleted,
    listSubjects: async () => [],
    syncListAll: async () => ({ subjects: [], notebooks: [], notes: [...notes.values()] }),
    getNoteMeta: async (id: string) => notes.get(id),
    syncGetPackage: async (id: string) => packages.get(id),
    syncMarkSynced: async (kind: string, id: string, rev: string) => {
      if (kind === "note") { const n = notes.get(id); if (n) n.rev = rev; }
      if (kind === "package") { const p = packages.get(id); if (p) p.rev = rev; }
    },
    syncPutNoteMeta: async (m: Note) => void notes.set(m.id, m),
    syncPutPackage: async (p: Pkg) => void packages.set(p.noteId, p),
    saveSnapshot: async () => ({}),
    getAsset: async () => undefined,
    deleteNote: async (id: string) => { deleted.push(id); notes.delete(id); packages.delete(id); },
    deleteNotebook: async () => {},
    deleteSubject: async () => {},
  };
  return store;
}

function fakeCloud(noteIds: string[]) {
  const calls = { listAll: 0, stamps: 0, upserts: [] as string[] };
  const hooks = {
    /** Runs inside syncListAllOwned, before it returns. */
    onListAll: null as null | (() => void),
    /** Runs inside every package upsert, before it resolves. */
    onUpsertPackage: null as null | ((id: string) => void | Promise<void>),
    failUpserts: null as null | (() => unknown),
    /** What the listing returns; defaults to every known note. */
    listing: null as null | (() => string[]),
  };
  const store = {
    calls,
    hooks,
    syncListAllOwned: async () => {
      calls.listAll += 1;
      hooks.onListAll?.();
      const ids = hooks.listing ? hooks.listing() : noteIds;
      return {
        subjects: [],
        notebooks: [],
        notes: ids.map((id) => ({ id, notebookId: "nb", subjectId: "s", updatedAt: T0 })),
      };
    },
    syncListPackageStamps: async () => {
      calls.stamps += 1;
      return new Map(noteIds.map((id) => [id, T0]));
    },
    syncUpsertNote: async (m: Note) => {
      if (hooks.failUpserts) throw hooks.failUpserts();
      calls.upserts.push(`note:${m.id}`);
      return T1;
    },
    syncUpsertPackage: async (p: Pkg) => {
      if (hooks.failUpserts) throw hooks.failUpserts();
      await hooks.onUpsertPackage?.(p.noteId);
      calls.upserts.push(`package:${p.noteId}`);
      return T1;
    },
    openNote: async (id: string) => ({ noteId: id, tree: { v: "cloud" }, assets: [], updatedAt: T0 }),
  };
  return store;
}

function make(noteIds: string[], opts: { synced?: boolean } = {}) {
  const local = fakeLocal(noteIds, opts);
  const cloud = fakeCloud(noteIds);
  const session = { uid: "me" as string | null };
  const engine = new SyncEngine(
    "me",
    local as unknown as LocalLibraryStore,
    cloud as unknown as SupabaseLibraryStore,
    { currentUserId: () => session.uid, queueStorage: memStorage() },
  );
  return { local, cloud, session, engine };
}

describe("SyncEngine — session safety", () => {
  it("does not touch the cloud while another account holds the session", async () => {
    const { cloud, local, session, engine } = make(["n1"]);
    engine.queue.enqueue({ kind: "note", id: "n1" });
    session.uid = "someone-else";
    await engine.syncAll();
    expect(cloud.calls).toEqual({ listAll: 0, stamps: 0, upserts: [] });
    expect(local.deleted).toEqual([]);
    expect(engine.queue.length).toBe(1); // still queued for my next sign-in
  });

  it("does not touch the cloud when signed out", async () => {
    const { cloud, session, engine } = make(["n1"]);
    session.uid = null;
    await engine.syncAll();
    expect(cloud.calls.listAll).toBe(0);
  });

  it("deletes nothing when the session changes during the listing", async () => {
    // The listing is answered for the NEW user: no rows, no error. Read at
    // face value that says every one of my notes was deleted remotely.
    const { cloud, local, session, engine } = make(["n1", "n2", "n3"]);
    cloud.hooks.listing = () => [];
    cloud.hooks.onListAll = () => { session.uid = "someone-else"; };
    const result = await engine.syncAll();
    expect(local.deleted).toEqual([]);
    expect(local.notes.size).toBe(3);
    expect(result.errors).toEqual([]); // a sign-out is not a sync error
  });

  it("DOES apply a genuine remote deletion", async () => {
    const { cloud, local, engine } = make(["n1", "n2"]);
    cloud.hooks.listing = () => ["n1"]; // n2 was deleted on another device
    await engine.syncAll();
    expect(local.deleted).toEqual(["n2"]);
  });

  it("stops for good once disposed", async () => {
    const { cloud, engine } = make(["n1"]);
    engine.queue.enqueue({ kind: "note", id: "n1" });
    engine.dispose();
    await engine.syncAll();
    engine.kick(); // must not arm a timer either
    expect(cloud.calls).toEqual({ listAll: 0, stamps: 0, upserts: [] });
    expect(engine.queue.length).toBe(1);
  });

  it("stops pushing when the session changes mid-flush", async () => {
    const { cloud, session, engine } = make(["n1", "n2", "n3"]);
    for (const id of ["n1", "n2", "n3"]) engine.queue.enqueue({ kind: "package", id });
    cloud.hooks.onUpsertPackage = (id) => { if (id === "n1") session.uid = null; };
    await engine.syncAll();
    expect(cloud.calls.upserts).toEqual(["package:n1"]);
    expect(engine.queue.list().map((o) => o.id)).toEqual(["n2", "n3"]);
  });
});

describe("SyncEngine — push", () => {
  it("lists the cloud package stamps once for a burst of package pushes", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const { cloud, engine } = make(ids);
    for (const id of ids) engine.queue.enqueue({ kind: "package", id });
    await engine.syncAll();
    expect(cloud.calls.upserts).toHaveLength(20);
    expect(cloud.calls.stamps).toBe(2); // one for the flush, one for the pull — was 21
  });

  it("keeps an op that was re-enqueued while it was being pushed", async () => {
    const { cloud, engine } = make(["n1"]);
    engine.queue.enqueue({ kind: "package", id: "n1" });
    let once = true;
    cloud.hooks.onUpsertPackage = () => {
      if (once) { once = false; engine.queue.enqueue({ kind: "package", id: "n1" }); } // a save lands mid-push
    };
    await engine.syncAll();
    expect(engine.queue.length).toBe(1); // the newer state still has to go up
    await engine.syncAll();
    expect(engine.queue.length).toBe(0);
    expect(cloud.calls.upserts).toEqual(["package:n1", "package:n1"]);
  });

  it("an expired session never burns attempts or drops the queue", async () => {
    const { cloud, engine } = make(["n1"]);
    engine.queue.enqueue({ kind: "note", id: "n1" });
    cloud.hooks.failUpserts = () => Object.assign(new Error("JWT expired"), { code: "PGRST301" });
    for (let i = 0; i < 8; i++) await engine.syncAll(); // well past MAX_ATTEMPTS
    expect(engine.queue.list()).toHaveLength(1);
    expect(engine.queue.list()[0].attempts).toBe(0);
    expect(engine.snapshot().status).toBe("error");

    cloud.hooks.failUpserts = null; // signed in again
    await engine.syncAll();
    expect(engine.queue.length).toBe(0);
    expect(engine.snapshot()).toMatchObject({ status: "idle", pending: 0, lastError: null });
  });

  it("still gives up on a genuinely poisoned op, and says so", async () => {
    const { cloud, engine } = make(["n1"]);
    engine.queue.enqueue({ kind: "note", id: "n1" });
    cloud.hooks.failUpserts = () => new Error("violates check constraint");
    const errors: string[] = [];
    engine.subscribe((e) => { if (e.type === "error") errors.push(e.message); });
    for (let i = 0; i < 5; i++) await engine.syncAll();
    expect(engine.queue.length).toBe(0);
    expect(errors.at(-1)).toMatch(/^gave up on note n1/);
  });
});

describe("SyncEngine — status", () => {
  it("reports pending work and emits when the queue changes", async () => {
    const { engine } = make(["n1"]);
    const pending: number[] = [];
    engine.subscribe((e) => { if (e.type === "queue") pending.push(e.pending); });
    engine.queue.enqueue({ kind: "note", id: "n1" });
    expect(engine.snapshot().pending).toBe(1);
    await engine.syncAll();
    expect(pending).toEqual([1, 0]);
    expect(engine.snapshot().lastSyncedAt).not.toBeNull();
  });
});

describe("isAuthError", () => {
  it("recognises expired or missing sessions", () => {
    expect(isAuthError({ code: "PGRST301", message: "JWT expired" })).toBe(true);
    expect(isAuthError({ status: 401, message: "Unauthorized" })).toBe(true);
    expect(isAuthError(new Error("You are not signed in."))).toBe(true);
  });
  it("does not mistake a permission or data error for one", () => {
    expect(isAuthError({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
    expect(isAuthError(new Error("duplicate key value violates unique constraint"))).toBe(false);
  });
});
