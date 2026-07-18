/**
 * Aquarius storage model — modeled on how Notability stores files.
 *
 * ─── How Notability does it (and what we imitate) ────────────────────────────
 * Notability organizes content as a 3-level library:
 *
 *      Subject  ▸  Notebook(divider)  ▸  Note
 *
 * Crucially, Notability stores each NOTE as a self-contained *package* (a bundle
 * directory on disk): the note's content lives separately from its media. A note
 * bundle contains a lightweight metadata record, the document content, any
 * embedded media (images, audio, handwriting) stored as SEPARATE files, and a
 * rendered thumbnail. The *library index* (which subjects/notebooks/notes exist,
 * their order, titles, thumbnails) is kept apart from the heavy note content so
 * the library browses instantly without loading every document.
 *
 * We replicate that separation locally:
 *
 *   ┌──────────────── LIGHT (always loaded — the "library index") ─────────────┐
 *   │  subjects        Subject[]        top-level folders                       │
 *   │  notebooks       Notebook[]       grouped under a subject                 │
 *   │  notes           NoteMeta[]       title/thumbnail/order only — NO content │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *   ┌──────────────── HEAVY (lazy-loaded per note — the "note package") ────────┐
 *   │  notePackages    NotePackage      block tree + latex cache, keyed by note │
 *   │  assets          AssetBlob        media stored as SEPARATE blobs by id    │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 * Opening a note loads exactly one NotePackage (+ its assets on demand). This is
 * what makes the library fast and each note portable: a note can be exported as
 * a single `.aqnote` bundle (metadata + tree + assets) and re-imported anywhere,
 * exactly like dragging a Notability note between libraries.
 *
 * The SAME entity shapes mirror 1:1 into the Supabase Postgres schema
 * (see `supabase/migrations/`), so local and cloud are structurally identical
 * and the sync layer is a straight row-for-row reconciliation.
 */

import type { DocumentTree } from "@/lib/blocks/types";

export type EntityId = string;
export type ISOTimestamp = string; // ISO-8601, e.g. "2026-06-23T12:00:00.000Z"

/** Where a user's data physically lives. User-selectable per the product spec. */
export type StorageMode = "local" | "cloud" | "both";

// ─── Library index entities (light) ──────────────────────────────────────────

/** Top of the hierarchy. Notability "Subject". */
export interface Subject {
  id: EntityId;
  name: string;
  /** Hex color for the spine/tab, à la Notability subject dividers. */
  color: string;
  icon?: string;
  /** Manual sort position within the library. */
  order: number;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  /** CRDT/causal sync marker; null until first cloud sync. */
  rev?: string | null;
}

/** Middle of the hierarchy. Notability "Divider"/"Notebook". */
export interface Notebook {
  id: EntityId;
  subjectId: EntityId;
  name: string;
  color: string;
  order: number;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  rev?: string | null;
}

/**
 * The LIGHT record for a note — everything the library list needs and nothing
 * more. The actual document content lives in the matching `NotePackage`.
 */
export interface NoteMeta {
  id: EntityId;
  notebookId: EntityId;
  /** Denormalized for fast filtering / breadcrumb display. */
  subjectId: EntityId;
  title: string;
  order: number;
  tags: string[];
  /** base64 PNG preview shown in the library grid (kept small). */
  thumbnail?: string;
  /** Canvas mode of the document, surfaced for the library UI. */
  mode: DocumentTree["mode"];
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  /** Whether the heavy package has unsynced local changes. */
  dirty?: boolean;
  /** When set, the note is in "Recently Deleted" (soft-deleted), not listed normally. */
  deletedAt?: ISOTimestamp | null;
  rev?: string | null;
}

// ─── Note package (heavy, lazy) ──────────────────────────────────────────────

/** A media asset referenced by the document, stored as a SEPARATE blob. */
export interface AssetRef {
  id: EntityId;
  noteId: EntityId;
  kind: "image" | "audio" | "handwriting" | "pdf";
  mime: string;
  /** Size in bytes, for quota/UX. */
  size: number;
  createdAt: ISOTimestamp;
}

/** The blob row itself (kept in its own store, like Notability's media files). */
export interface AssetBlob extends AssetRef {
  data: Blob;
}

/**
 * The self-contained content package for one note — the analogue of a Notability
 * `.note` bundle. This is what `openNote` returns and `saveNote` persists.
 */
export interface NotePackage {
  noteId: EntityId;
  /** Document content: the block tree. */
  tree: DocumentTree;
  /** Cached LaTeX serialization (regenerated from `tree`; used for search/export). */
  latexCache: string;
  /** Media belonging to this note (metadata only; blobs fetched via getAsset). */
  assets: AssetRef[];
  updatedAt: ISOTimestamp;
  rev?: string | null;
  /**
   * Authoritative Yjs document state (`Y.encodeStateAsUpdate`) for notes that
   * have been co-edited. `tree`/`latexCache` are a derived read model. Absent
   * (undefined/null) for private notes and the local store — those keep the
   * simple last-write-wins tree path. See `lib/collab/`.
   */
  ydoc?: Uint8Array | null;
}

/**
 * A portable, single-file export of a note bundle — metadata + content + inlined
 * (base64) assets — that can be re-imported into any Aquarius library. Mirrors
 * exporting/sharing a single Notability note. File extension: `.aqnote` (JSON).
 */
export interface NoteBundleFile {
  format: "aqnote";
  version: 1;
  meta: Omit<NoteMeta, "order" | "dirty" | "rev">;
  pkg: Omit<NotePackage, "rev">;
  /** Assets inlined as base64 for portability. */
  assets: Array<AssetRef & { base64: string }>;
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateSubjectInput {
  name: string;
  color?: string;
  icon?: string;
}
export interface CreateNotebookInput {
  subjectId: EntityId;
  name: string;
  color?: string;
}
export interface CreateNoteInput {
  notebookId: EntityId;
  title?: string;
  mode?: DocumentTree["mode"];
}

// ─── The storage contract ────────────────────────────────────────────────────

/**
 * The interface every storage backend implements. The IndexedDB implementation
 * (`lib/storage/local.ts`) is the local-first primary; a Supabase-backed
 * implementation can satisfy the same contract for "cloud only" mode, and the
 * sync engine reconciles between two LibraryStore instances.
 */
export interface LibraryStore {
  // ── Subjects ──
  listSubjects(): Promise<Subject[]>;
  createSubject(input: CreateSubjectInput): Promise<Subject>;
  updateSubject(id: EntityId, patch: Partial<Subject>): Promise<Subject>;
  deleteSubject(id: EntityId): Promise<void>;
  reorderSubjects(orderedIds: EntityId[]): Promise<void>;

  // ── Notebooks ──
  listNotebooks(subjectId: EntityId): Promise<Notebook[]>;
  createNotebook(input: CreateNotebookInput): Promise<Notebook>;
  updateNotebook(id: EntityId, patch: Partial<Notebook>): Promise<Notebook>;
  deleteNotebook(id: EntityId): Promise<void>;
  moveNotebook(id: EntityId, toSubjectId: EntityId): Promise<void>;

  // ── Notes (light metadata) ──
  listNotes(notebookId: EntityId): Promise<NoteMeta[]>;
  getNoteMeta(id: EntityId): Promise<NoteMeta | undefined>;
  createNote(input: CreateNoteInput): Promise<NoteMeta>;
  updateNoteMeta(id: EntityId, patch: Partial<NoteMeta>): Promise<NoteMeta>;
  /**
   * PERMANENTLY deletes the note (metadata, package, and assets) — not
   * recoverable. Soft-delete to "Recently Deleted" is
   * `updateNoteMeta(id, { deletedAt })`; callers should soft-delete first and
   * only call this on already-trashed notes.
   */
  deleteNote(id: EntityId): Promise<void>;
  moveNote(id: EntityId, toNotebookId: EntityId): Promise<void>;
  /**
   * Search the whole library. `title` holds notes whose title or tags match;
   * `content` holds the remaining notes whose body (latexCache) matches.
   */
  searchNotes(query: string): Promise<{ title: NoteMeta[]; content: NoteMeta[] }>;
  /** All soft-deleted notes ("Recently Deleted"), most-recently-deleted first. */
  listDeletedNotes(): Promise<NoteMeta[]>;
  /** Most-recently-updated notes across the whole library (excludes deleted). */
  listRecentNotes(limit?: number): Promise<NoteMeta[]>;
  /**
   * Backlinks: notes whose content links to `noteId` (a `note://<noteId>` href
   * in the tree), excluding the note itself and deleted notes, most-recently-
   * updated first. Scans tree JSON — note:// hrefs are deliberately stripped
   * from latexCache (see lib/blocks/format.ts), so a body search can't find them.
   */
  listBacklinks(noteId: EntityId): Promise<NoteMeta[]>;

  // ── Note packages (heavy content) ──
  openNote(id: EntityId): Promise<NotePackage>;
  saveNote(pkg: NotePackage): Promise<void>;

  // ── Assets (media stored as separate blobs) ──
  putAsset(
    noteId: EntityId,
    data: Blob,
    meta: Pick<AssetRef, "kind" | "mime">,
  ): Promise<AssetRef>;
  getAsset(assetId: EntityId): Promise<AssetBlob | undefined>;
  deleteAsset(assetId: EntityId): Promise<void>;

  // ── Portable bundles (Notability-style single-note export/import) ──
  exportNote(id: EntityId): Promise<NoteBundleFile>;
  importNote(bundle: NoteBundleFile, toNotebookId: EntityId): Promise<NoteMeta>;
}
