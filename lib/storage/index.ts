/**
 * Storage entry point.
 *
 * `getStore()` returns a lazily-created singleton `LocalLibraryStore`. Because
 * IndexedDB only exists in the browser, the store is intended to be used ONLY
 * from client components / effects (e.g. inside `useEffect`, event handlers, or
 * other `"use client"` code). When evaluated on the server (SSR / RSC), there is
 * no `indexedDB`, so the singleton is replaced by a stub whose every method
 * rejects with a clear "storage unavailable on server" error rather than
 * crashing at import time.
 */

import { emptyDocument } from "@/lib/blocks/types";
import type { Block, DocumentTree } from "@/lib/blocks/types";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getCachedUserId } from "@/lib/supabase/session";
import { SupabaseLibraryStore } from "./cloud";
import { LocalLibraryStore } from "./local";
import type { LibraryStore } from "./types";

const SERVER_ERROR =
  "storage unavailable on server: getStore() may only be used from client " +
  "components/effects (IndexedDB has no server-side equivalent).";

/**
 * A stand-in returned on the server. Every `LibraryStore` method rejects with a
 * descriptive error so a stray server-side call fails loudly instead of silently
 * touching a non-existent database.
 */
function createServerStub(): LibraryStore {
  const reject = (): Promise<never> => Promise.reject(new Error(SERVER_ERROR));
  return {
    listSubjects: reject,
    createSubject: reject,
    updateSubject: reject,
    deleteSubject: reject,
    reorderSubjects: reject,
    listNotebooks: reject,
    createNotebook: reject,
    updateNotebook: reject,
    deleteNotebook: reject,
    moveNotebook: reject,
    listNotes: reject,
    getNoteMeta: reject,
    createNote: reject,
    updateNoteMeta: reject,
    deleteNote: reject,
    moveNote: reject,
    searchNotes: reject,
    listDeletedNotes: reject,
    listRecentNotes: reject,
    openNote: reject,
    saveNote: reject,
    putAsset: reject,
    getAsset: reject,
    deleteAsset: reject,
    exportNote: reject,
    importNote: reject,
  };
}

let localSingleton: LocalLibraryStore | null = null;
let cloudSingleton: SupabaseLibraryStore | null = null;

/** The IndexedDB store (always local), regardless of auth — used for migration. */
export function getLocalStore(): LibraryStore {
  if (typeof indexedDB === "undefined") return createServerStub();
  if (!localSingleton) localSingleton = new LocalLibraryStore();
  return localSingleton;
}

/**
 * The active `LibraryStore`: the Supabase cloud store when a user is signed in
 * (and cloud is configured), otherwise the local IndexedDB store (guest mode).
 * Synchronous by design — the auth session is mirrored into a module cache
 * (lib/supabase/session.ts) so this never needs to await.
 */
export function getStore(): LibraryStore {
  // Never memoize the server stub: caching it on a first SSR/prerender call
  // would poison a later client call.
  if (typeof indexedDB === "undefined") return createServerStub();
  if (isSupabaseConfigured() && getCachedUserId()) {
    if (!cloudSingleton) cloudSingleton = new SupabaseLibraryStore();
    return cloudSingleton;
  }
  if (!localSingleton) localSingleton = new LocalLibraryStore();
  return localSingleton;
}

/** True when `getStore()` currently resolves to the cloud (signed-in) store. */
export function isCloudActive(): boolean {
  return isSupabaseConfigured() && Boolean(getCachedUserId());
}

/**
 * Copy the entire local IndexedDB library into the active cloud store, so a
 * guest's notes aren't stranded after signing in. Recreates the
 * subject→notebook→note structure; each note round-trips through the portable
 * bundle (content + assets). No-op unless the cloud store is active. Returns how
 * many notes were uploaded.
 */
export async function migrateLocalToCloud(): Promise<{ notes: number }> {
  if (!isCloudActive()) throw new Error("Sign in first to upload to the cloud.");
  const local = getLocalStore();
  const cloud = getStore();
  let notes = 0;
  for (const subject of await local.listSubjects()) {
    const cs = await cloud.createSubject({ name: subject.name, color: subject.color, icon: subject.icon });
    for (const nb of await local.listNotebooks(subject.id)) {
      const cnb = await cloud.createNotebook({ subjectId: cs.id, name: nb.name, color: nb.color });
      for (const note of await local.listNotes(nb.id)) {
        const bundle = await local.exportNote(note.id);
        await cloud.importNote(bundle, cnb.id);
        notes += 1;
      }
    }
  }
  return { notes };
}

// ─── Demo seed ───────────────────────────────────────────────────────────────

/** Build the canonical Pythagoras document: a^2 + b^2 = c^2. */
function pythagorasTree(): DocumentTree {
  const id = (): string => crypto.randomUUID();

  // A `script` whose base is an identifier and whose `sup` is the exponent 2.
  const squared = (name: string): Block => ({
    id: id(),
    type: "script",
    slots: {
      base: [{ id: id(), type: "identifier", value: name }],
      sup: [{ id: id(), type: "number", value: "2" }],
    },
  });

  const op = (value: string): Block => ({
    id: id(),
    type: "operator",
    value,
  });

  // math container: a^2 + b^2 = c^2
  const equation: Block = {
    id: id(),
    type: "math",
    slots: {
      body: [
        squared("a"),
        op("+"),
        squared("b"),
        op("="),
        squared("c"),
      ],
    },
  };

  // A short prose intro, then the standalone equation.
  const intro: Block = {
    id: id(),
    type: "text",
    value: "The Pythagorean theorem relates the sides of a right triangle:",
    attrs: {
      runs: [
        {
          kind: "text",
          text: "The Pythagorean theorem relates the sides of a right triangle:",
        },
      ],
    },
  };

  const doc = emptyDocument("flow");
  doc.blocks = [intro, equation];
  return doc;
}

/**
 * Seed a friendly starter library — but ONLY when the library is empty (no
 * subjects). Safe to call on every client boot: it is idempotent and does
 * nothing once any subject exists.
 */
export async function seedDemoLibrary(store: LibraryStore): Promise<void> {
  const subjects = await store.listSubjects();
  if (subjects.length > 0) return;

  const subject = await store.createSubject({
    name: "Welcome",
    color: "#2563eb",
  });
  const notebook = await store.createNotebook({
    subjectId: subject.id,
    name: "Getting Started",
  });
  const note = await store.createNote({
    notebookId: notebook.id,
    title: "Pythagoras",
    mode: "flow",
  });

  // Fill the heavy package with the a^2 + b^2 = c^2 document.
  const pkg = await store.openNote(note.id);
  await store.saveNote({ ...pkg, tree: pythagorasTree() });
}
