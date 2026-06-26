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

let singleton: LocalLibraryStore | null = null;

/** Lazily create and return the process-wide `LibraryStore` singleton. */
export function getStore(): LibraryStore {
  // Never memoize the server stub: caching it on a first SSR/prerender call
  // would poison a later client call. Only the real browser store is cached, so
  // the stub decision always reflects the CURRENT environment, not first-call
  // timing.
  if (typeof indexedDB === "undefined") return createServerStub();
  if (!singleton) singleton = new LocalLibraryStore();
  return singleton;
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
