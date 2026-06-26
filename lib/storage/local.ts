/**
 * Aquarius local-first storage — IndexedDB implementation of `LibraryStore`.
 *
 * This faithfully imitates how Notability stores files (see the long doc-comment
 * in `./types.ts`): a LIGHT library index (subjects / notebooks / note metadata)
 * is kept in stores SEPARATE from the HEAVY per-note packages (block tree +
 * latex cache), and media assets live in their OWN store as standalone blobs
 * referenced by id. Opening a note loads exactly one `NotePackage`.
 *
 * Object stores (the Notability split):
 *   subjects      → Subject     key 'id'      index 'by-order'    on 'order'
 *   notebooks     → Notebook    key 'id'      index 'by-subject'  on 'subjectId'
 *   notes         → NoteMeta    key 'id'      index 'by-notebook' on 'notebookId'
 *                                             index 'by-subject'  on 'subjectId'
 *   notePackages  → NotePackage key 'noteId'
 *   assets        → AssetBlob   key 'id'      index 'by-note'     on 'noteId'
 *
 * Client-side only: IndexedDB does not exist on the server. The SSR guard lives
 * in `./index.ts`; this class assumes `indexedDB` is present when constructed.
 */

import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from "idb";

import { emptyDocument } from "@/lib/blocks/types";
import type { Block, DocumentTree, Slots } from "@/lib/blocks/types";
import type {
  AssetBlob,
  AssetRef,
  CreateNoteInput,
  CreateNotebookInput,
  CreateSubjectInput,
  EntityId,
  ISOTimestamp,
  LibraryStore,
  NoteBundleFile,
  NoteMeta,
  NotePackage,
  Notebook,
  Subject,
} from "./types";

// ─── DB schema (typed) ───────────────────────────────────────────────────────

const DB_NAME = "aquarius";
const DB_VERSION = 1;

interface AquariusDB extends DBSchema {
  subjects: {
    key: EntityId;
    value: Subject;
    indexes: { "by-order": number };
  };
  notebooks: {
    key: EntityId;
    value: Notebook;
    indexes: { "by-subject": EntityId };
  };
  notes: {
    key: EntityId;
    value: NoteMeta;
    indexes: { "by-notebook": EntityId; "by-subject": EntityId };
  };
  notePackages: {
    key: EntityId;
    value: NotePackage;
  };
  assets: {
    key: EntityId;
    value: AssetBlob;
    indexes: { "by-note": EntityId };
  };
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function now(): ISOTimestamp {
  return new Date().toISOString();
}

function newId(): EntityId {
  return crypto.randomUUID();
}

const DEFAULT_SUBJECT_COLOR = "#2563eb";
const DEFAULT_NOTEBOOK_COLOR = "#64748b";

/** Next manual sort position = max(existing order) + 1 (or 0 when empty). */
function nextOrder(orders: number[]): number {
  if (orders.length === 0) return 0;
  return Math.max(...orders) + 1;
}

// ─── base64 <-> Blob (browser-only; NO Node Buffer) ──────────────────────────

/** Encode a Blob to a base64 string using only browser APIs. */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunk to avoid blowing the argument limit of String.fromCharCode on big files.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** Decode a base64 string back into a Blob with the given mime type. */
function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

// ─── The store ───────────────────────────────────────────────────────────────

export class LocalLibraryStore implements LibraryStore {
  private dbPromise: Promise<IDBPDatabase<AquariusDB>> | null = null;

  /** Lazily open (and memoize) the typed IndexedDB database. */
  private db(): Promise<IDBPDatabase<AquariusDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<AquariusDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          const subjects = db.createObjectStore("subjects", { keyPath: "id" });
          subjects.createIndex("by-order", "order");

          const notebooks = db.createObjectStore("notebooks", {
            keyPath: "id",
          });
          notebooks.createIndex("by-subject", "subjectId");

          const notes = db.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("by-notebook", "notebookId");
          notes.createIndex("by-subject", "subjectId");

          db.createObjectStore("notePackages", { keyPath: "noteId" });

          const assets = db.createObjectStore("assets", { keyPath: "id" });
          assets.createIndex("by-note", "noteId");
        },
      });
    }
    return this.dbPromise;
  }

  // ── Subjects ────────────────────────────────────────────────────────────

  async listSubjects(): Promise<Subject[]> {
    const db = await this.db();
    // 'by-order' index yields subjects already sorted by their manual position.
    return db.getAllFromIndex("subjects", "by-order");
  }

  async createSubject(input: CreateSubjectInput): Promise<Subject> {
    const db = await this.db();
    const ts = now();
    // Read siblings and write the new row in ONE tx so two concurrent creates
    // can't both read the same max order and produce a duplicate position.
    const tx = db.transaction("subjects", "readwrite");
    const store = tx.objectStore("subjects");
    const existing = await store.getAll();
    const subject: Subject = {
      id: newId(),
      name: input.name,
      color: input.color ?? DEFAULT_SUBJECT_COLOR,
      icon: input.icon,
      order: nextOrder(existing.map((s) => s.order)),
      createdAt: ts,
      updatedAt: ts,
      rev: null,
    };
    await store.put(subject);
    await tx.done;
    return subject;
  }

  async updateSubject(
    id: EntityId,
    patch: Partial<Subject>,
  ): Promise<Subject> {
    const db = await this.db();
    const current = await db.get("subjects", id);
    if (!current) throw new Error(`Subject not found: ${id}`);
    // `id` is identity; never let a patch repoint it.
    const next: Subject = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: now(),
    };
    await db.put("subjects", next);
    return next;
  }

  async deleteSubject(id: EntityId): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(
      ["subjects", "notebooks", "notes", "notePackages", "assets"],
      "readwrite",
    );
    // Cascade: subject → its notebooks → their notes → packages → assets.
    const notebooks = await tx
      .objectStore("notebooks")
      .index("by-subject")
      .getAllKeys(id);
    const notes = await tx
      .objectStore("notes")
      .index("by-subject")
      .getAllKeys(id);
    for (const noteId of notes) {
      await this.cascadeDeleteNoteWithin(tx, noteId);
    }
    for (const notebookId of notebooks) {
      await tx.objectStore("notebooks").delete(notebookId);
    }
    await tx.objectStore("subjects").delete(id);
    await tx.done;
  }

  async reorderSubjects(orderedIds: EntityId[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction("subjects", "readwrite");
    const store = tx.objectStore("subjects");
    const ts = now();
    const listed = new Set(orderedIds);
    // Explicitly-ordered ids take positions 0..n-1.
    let pos = 0;
    for (const id of orderedIds) {
      const subject = await store.get(id);
      if (!subject) continue;
      subject.order = pos++;
      subject.updatedAt = ts;
      await store.put(subject);
    }
    // Subjects NOT named in `orderedIds` keep their relative order but are
    // appended AFTER the listed ones, so positions can never collide (a partial
    // list no longer corrupts the overall ordering).
    const rest = (await store.getAll())
      .filter((s) => !listed.has(s.id))
      .sort((a, b) => a.order - b.order);
    for (const subject of rest) {
      subject.order = pos++;
      subject.updatedAt = ts;
      await store.put(subject);
    }
    await tx.done;
  }

  // ── Notebooks ───────────────────────────────────────────────────────────

  async listNotebooks(subjectId: EntityId): Promise<Notebook[]> {
    const db = await this.db();
    const notebooks = await db.getAllFromIndex(
      "notebooks",
      "by-subject",
      subjectId,
    );
    return notebooks.sort((a, b) => a.order - b.order);
  }

  async createNotebook(input: CreateNotebookInput): Promise<Notebook> {
    const db = await this.db();
    const ts = now();
    const tx = db.transaction("notebooks", "readwrite");
    const store = tx.objectStore("notebooks");
    const siblings = await store.index("by-subject").getAll(input.subjectId);
    const notebook: Notebook = {
      id: newId(),
      subjectId: input.subjectId,
      name: input.name,
      color: input.color ?? DEFAULT_NOTEBOOK_COLOR,
      order: nextOrder(siblings.map((n) => n.order)),
      createdAt: ts,
      updatedAt: ts,
      rev: null,
    };
    await store.put(notebook);
    await tx.done;
    return notebook;
  }

  async updateNotebook(
    id: EntityId,
    patch: Partial<Notebook>,
  ): Promise<Notebook> {
    const db = await this.db();
    const current = await db.get("notebooks", id);
    if (!current) throw new Error(`Notebook not found: ${id}`);
    const next: Notebook = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: now(),
    };
    await db.put("notebooks", next);
    return next;
  }

  async deleteNotebook(id: EntityId): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(
      ["notebooks", "notes", "notePackages", "assets"],
      "readwrite",
    );
    // Cascade: notebook → its notes → packages → assets.
    const notes = await tx
      .objectStore("notes")
      .index("by-notebook")
      .getAllKeys(id);
    for (const noteId of notes) {
      await this.cascadeDeleteNoteWithin(tx, noteId);
    }
    await tx.objectStore("notebooks").delete(id);
    await tx.done;
  }

  async moveNotebook(id: EntityId, toSubjectId: EntityId): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(["notebooks", "notes"], "readwrite");
    const notebookStore = tx.objectStore("notebooks");
    const notebook = await notebookStore.get(id);
    if (!notebook) throw new Error(`Notebook not found: ${id}`);
    const ts = now();
    notebook.subjectId = toSubjectId;
    notebook.updatedAt = ts;
    await notebookStore.put(notebook);
    // Keep the denormalized subjectId on every note in this notebook in sync.
    const noteStore = tx.objectStore("notes");
    const notes = await noteStore.index("by-notebook").getAll(id);
    for (const note of notes) {
      note.subjectId = toSubjectId;
      note.updatedAt = ts;
      await noteStore.put(note);
    }
    await tx.done;
  }

  // ── Notes (light metadata) ────────────────────────────────────────────────

  async listNotes(notebookId: EntityId): Promise<NoteMeta[]> {
    const db = await this.db();
    const notes = await db.getAllFromIndex(
      "notes",
      "by-notebook",
      notebookId,
    );
    return notes.filter((n) => !n.deletedAt).sort((a, b) => a.order - b.order);
  }

  async listDeletedNotes(): Promise<NoteMeta[]> {
    const db = await this.db();
    const notes = await db.getAll("notes");
    return notes
      .filter((n) => !!n.deletedAt)
      .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  }

  async listRecentNotes(limit = 50): Promise<NoteMeta[]> {
    const db = await this.db();
    const notes = await db.getAll("notes");
    return notes
      .filter((n) => !n.deletedAt)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .slice(0, Math.max(0, limit));
  }

  async getNoteMeta(id: EntityId): Promise<NoteMeta | undefined> {
    const db = await this.db();
    return db.get("notes", id);
  }

  async searchNotes(
    query: string,
  ): Promise<{ title: NoteMeta[]; content: NoteMeta[] }> {
    const q = query.trim().toLowerCase();
    if (!q) return { title: [], content: [] };
    const db = await this.db();
    const notes = (await db.getAll("notes")).filter((n) => !n.deletedAt);
    const byRecent = (a: NoteMeta, b: NoteMeta) =>
      b.updatedAt.localeCompare(a.updatedAt);

    // Tier 1: title or tag match.
    const title = notes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .sort(byRecent);

    // Tier 2: body match, excluding notes already matched above. Strip LaTeX
    // commands/markup from the cached body so the query matches the visible
    // prose, not control sequences (so "frac"/"sum" don't match \frac/\sum).
    const titleIds = new Set(title.map((n) => n.id));
    const pkgs = await db.getAll("notePackages");
    const strip = (s: string) =>
      (s || "")
        .replace(/\\[a-zA-Z]+\*?/g, " ")
        .replace(/[{}$[\]\\^_&%#~]/g, " ")
        .toLowerCase();
    const cache = new Map(pkgs.map((p) => [p.noteId, strip(p.latexCache)] as const));
    const content = notes
      .filter((n) => !titleIds.has(n.id) && (cache.get(n.id) ?? "").includes(q))
      .sort(byRecent);

    return { title, content };
  }

  async createNote(input: CreateNoteInput): Promise<NoteMeta> {
    const db = await this.db();
    const mode: DocumentTree["mode"] = input.mode ?? "flow";
    const ts = now();
    const noteId = newId();

    // One tx: validate the notebook, derive order from current siblings, and
    // write both the light meta and the heavy (empty) package atomically. The
    // sibling read lives inside the write tx so concurrent creates don't collide.
    const tx = db.transaction(
      ["notebooks", "notes", "notePackages"],
      "readwrite",
    );
    const notebook = await tx.objectStore("notebooks").get(input.notebookId);
    if (!notebook) throw new Error(`Notebook not found: ${input.notebookId}`);

    const noteStore = tx.objectStore("notes");
    const siblings = await noteStore.index("by-notebook").getAll(
      input.notebookId,
    );

    const meta: NoteMeta = {
      id: noteId,
      notebookId: input.notebookId,
      subjectId: notebook.subjectId,
      title: input.title ?? "Untitled",
      order: nextOrder(siblings.map((n) => n.order)),
      tags: [],
      thumbnail: undefined,
      mode,
      createdAt: ts,
      updatedAt: ts,
      dirty: false,
      rev: null,
    };

    // Heavy package: an empty document so opening the new note loads exactly one.
    const pkg: NotePackage = {
      noteId,
      tree: emptyDocument(mode),
      latexCache: "",
      assets: [],
      updatedAt: ts,
      rev: null,
    };

    await noteStore.put(meta);
    await tx.objectStore("notePackages").put(pkg);
    await tx.done;
    return meta;
  }

  async updateNoteMeta(
    id: EntityId,
    patch: Partial<NoteMeta>,
  ): Promise<NoteMeta> {
    const db = await this.db();
    const current = await db.get("notes", id);
    if (!current) throw new Error(`Note not found: ${id}`);
    const next: NoteMeta = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: now(),
    };
    await db.put("notes", next);
    return next;
  }

  async deleteNote(id: EntityId): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(
      ["notes", "notePackages", "assets"],
      "readwrite",
    );
    // Cascade: note meta + its heavy package + this note's asset blobs.
    await this.cascadeDeleteNoteWithin(tx, id);
    await tx.done;
  }

  async moveNote(id: EntityId, toNotebookId: EntityId): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(["notes", "notebooks"], "readwrite");
    const noteStore = tx.objectStore("notes");
    const note = await noteStore.get(id);
    if (!note) throw new Error(`Note not found: ${id}`);
    const notebook = await tx.objectStore("notebooks").get(toNotebookId);
    if (!notebook) throw new Error(`Notebook not found: ${toNotebookId}`);
    note.notebookId = toNotebookId;
    note.subjectId = notebook.subjectId; // keep the denormalized field correct
    note.updatedAt = now();
    await noteStore.put(note);
    await tx.done;
  }

  // ── Note packages (heavy content) ─────────────────────────────────────────

  async openNote(id: EntityId): Promise<NotePackage> {
    const db = await this.db();
    const pkg = await db.get("notePackages", id);
    if (!pkg) throw new Error(`Note package not found: ${id}`);
    return pkg;
  }

  async saveNote(pkg: NotePackage): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(["notePackages", "notes"], "readwrite");
    const ts = now();

    // Persist the heavy package.
    await tx
      .objectStore("notePackages")
      .put({ ...pkg, updatedAt: ts });

    // Refresh the matching light meta: bump updatedAt, carry the tree's mode,
    // mark dirty (unsynced local change). Title/thumbnail are owned by the meta
    // and are deliberately left untouched here.
    const noteStore = tx.objectStore("notes");
    const meta = await noteStore.get(pkg.noteId);
    if (meta) {
      meta.updatedAt = ts;
      meta.mode = pkg.tree.mode;
      meta.dirty = true;
      await noteStore.put(meta);
    }
    await tx.done;
  }

  // ── Assets (media stored as separate blobs) ───────────────────────────────

  async putAsset(
    noteId: EntityId,
    data: Blob,
    meta: Pick<AssetRef, "kind" | "mime">,
  ): Promise<AssetRef> {
    const db = await this.db();
    const ref: AssetRef = {
      id: newId(),
      noteId,
      kind: meta.kind,
      mime: meta.mime,
      size: data.size,
      createdAt: now(),
    };
    const blob: AssetBlob = { ...ref, data };

    const tx = db.transaction(["assets", "notePackages"], "readwrite");
    await tx.objectStore("assets").put(blob);
    // Keep the package's asset manifest (metadata only) in sync with the store.
    const pkgStore = tx.objectStore("notePackages");
    const pkg = await pkgStore.get(noteId);
    if (pkg && !pkg.assets.some((a) => a.id === ref.id)) {
      pkg.assets = [...pkg.assets, ref];
      await pkgStore.put(pkg);
    }
    await tx.done;
    return ref;
  }

  async getAsset(assetId: EntityId): Promise<AssetBlob | undefined> {
    const db = await this.db();
    return db.get("assets", assetId);
  }

  async deleteAsset(assetId: EntityId): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(["assets", "notePackages"], "readwrite");
    const assetStore = tx.objectStore("assets");
    const asset = await assetStore.get(assetId);
    await assetStore.delete(assetId);
    // Drop it from the owning package's manifest too.
    if (asset) {
      const pkgStore = tx.objectStore("notePackages");
      const pkg = await pkgStore.get(asset.noteId);
      if (pkg) {
        const filtered = pkg.assets.filter((a) => a.id !== assetId);
        if (filtered.length !== pkg.assets.length) {
          pkg.assets = filtered;
          await pkgStore.put(pkg);
        }
      }
    }
    await tx.done;
  }

  // ── Portable bundles (Notability-style single-note export/import) ─────────

  async exportNote(id: EntityId): Promise<NoteBundleFile> {
    const db = await this.db();
    // Snapshot meta + package + asset blobs in ONE consistent transaction so a
    // concurrent saveNote/putAsset/deleteAsset cannot tear the bundle (manifest
    // disagreeing with the inlined blobs). The heavy base64 conversion runs
    // AFTER tx.done — doing it inside the tx would auto-commit on the await.
    const tx = db.transaction(
      ["notes", "notePackages", "assets"],
      "readonly",
    );
    const meta = await tx.objectStore("notes").get(id);
    const pkg = await tx.objectStore("notePackages").get(id);
    const assetBlobs = await tx
      .objectStore("assets")
      .index("by-note")
      .getAll(id);
    await tx.done;

    if (!meta) throw new Error(`Note not found: ${id}`);
    if (!pkg) throw new Error(`Note package not found: ${id}`);

    // Inline every asset as base64 so the bundle is a single portable file.
    const assets = await Promise.all(
      assetBlobs.map(async (blob) => {
        const { data, ...ref } = blob;
        return { ...ref, base64: await blobToBase64(data) };
      }),
    );

    const { order: _order, dirty: _dirty, rev: _metaRev, ...metaRest } = meta;
    const { rev: _pkgRev, ...pkgRest } = pkg;

    return {
      format: "aqnote",
      version: 1,
      meta: metaRest,
      pkg: pkgRest,
      assets,
    };
  }

  async importNote(
    bundle: NoteBundleFile,
    toNotebookId: EntityId,
  ): Promise<NoteMeta> {
    const db = await this.db();
    const notebook = await db.get("notebooks", toNotebookId);
    if (!notebook) throw new Error(`Notebook not found: ${toNotebookId}`);

    // FRESH ids everywhere: a re-import is a brand-new note in this library.
    const newNoteId = newId();

    // Remap old asset id → new asset id, and rebuild AssetBlobs from base64.
    const assetIdMap = new Map<EntityId, EntityId>();
    const assetRefs: AssetRef[] = [];
    const assetBlobs: AssetBlob[] = [];
    for (const inlined of bundle.assets) {
      const { base64, id: oldId, ...rest } = inlined;
      const freshId = newId();
      assetIdMap.set(oldId, freshId);
      const ref: AssetRef = {
        ...rest,
        id: freshId,
        noteId: newNoteId,
      };
      assetRefs.push(ref);
      assetBlobs.push({ ...ref, data: base64ToBlob(base64, ref.mime) });
    }

    // Rewrite every image block's attrs.assetId to its fresh id, deep through
    // slots and inline text runs.
    const remappedTree = remapTreeAssetIds(bundle.pkg.tree, assetIdMap);

    const ts = now();
    const tx = db.transaction(
      ["notes", "notePackages", "assets"],
      "readwrite",
    );
    const noteStore = tx.objectStore("notes");
    // Derive order inside the write tx (race-safe with concurrent creates).
    const siblings = await noteStore.index("by-notebook").getAll(toNotebookId);

    const meta: NoteMeta = {
      id: newNoteId,
      notebookId: toNotebookId,
      subjectId: notebook.subjectId,
      title: bundle.meta.title,
      order: nextOrder(siblings.map((n) => n.order)),
      tags: [...bundle.meta.tags],
      thumbnail: bundle.meta.thumbnail,
      mode: bundle.meta.mode,
      createdAt: ts,
      updatedAt: ts,
      dirty: true, // freshly imported, not yet synced to the cloud
      rev: null,
    };

    const pkg: NotePackage = {
      noteId: newNoteId,
      tree: remappedTree,
      latexCache: bundle.pkg.latexCache,
      assets: assetRefs,
      updatedAt: ts,
      rev: null,
    };

    await noteStore.put(meta);
    await tx.objectStore("notePackages").put(pkg);
    const assetStore = tx.objectStore("assets");
    for (const blob of assetBlobs) {
      await assetStore.put(blob);
    }
    await tx.done;
    return meta;
  }

  // ── Internal cascade helper ───────────────────────────────────────────────

  /**
   * Delete a note's meta, its heavy package, and all of its asset blobs within
   * an already-open readwrite transaction. The tx MUST include the 'notes',
   * 'notePackages', and 'assets' stores.
   */
  private async cascadeDeleteNoteWithin(
    tx: IDBPTransaction<
      AquariusDB,
      StoreNames<AquariusDB>[],
      "readwrite"
    >,
    noteId: EntityId,
  ): Promise<void> {
    const assetKeys = await tx
      .objectStore("assets")
      .index("by-note")
      .getAllKeys(noteId);
    const assetStore = tx.objectStore("assets");
    for (const key of assetKeys) {
      await assetStore.delete(key);
    }
    await tx.objectStore("notePackages").delete(noteId);
    await tx.objectStore("notes").delete(noteId);
  }
}

// ─── Tree asset-id remapping (used by importNote) ────────────────────────────

/** Return a deep clone of `tree` with image `attrs.assetId` values remapped. */
function remapTreeAssetIds(
  tree: DocumentTree,
  idMap: Map<EntityId, EntityId>,
): DocumentTree {
  return {
    ...tree,
    blocks: tree.blocks.map((b) => remapBlockAssetIds(b, idMap)),
  };
}

/** Deep-clone a block, remapping `attrs.assetId` on image blocks throughout. */
function remapBlockAssetIds(
  block: Block,
  idMap: Map<EntityId, EntityId>,
): Block {
  const next: Block = { ...block };

  if (block.attrs) {
    next.attrs = { ...block.attrs };
    if (
      block.type === "image" &&
      typeof block.attrs.assetId === "string"
    ) {
      const mapped = idMap.get(block.attrs.assetId); // legacy single-image shape
      if (mapped) next.attrs.assetId = mapped;
    }
    // Current image shape: a row of items, each with its own assetId.
    if (block.type === "image" && Array.isArray(block.attrs.images)) {
      next.attrs.images = (block.attrs.images as Array<Record<string, unknown>>).map((it) => {
        const aid = it?.assetId;
        return typeof aid === "string" && idMap.has(aid)
          ? { ...it, assetId: idMap.get(aid) }
          : it;
      });
    }
    // Inline math runs can nest image blocks inside text blocks.
    if (Array.isArray(block.attrs.runs)) {
      next.attrs.runs = block.attrs.runs.map((run) =>
        run.kind === "math"
          ? { kind: "math", block: remapBlockAssetIds(run.block, idMap) }
          : run,
      );
    }
  }

  if (block.slots) {
    const slots: Slots = {};
    for (const [name, children] of Object.entries(block.slots)) {
      slots[name] = children.map((child) =>
        remapBlockAssetIds(child, idMap),
      );
    }
    next.slots = slots;
  }

  return next;
}
