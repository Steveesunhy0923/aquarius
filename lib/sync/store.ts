/**
 * SyncedStore — the local-first `LibraryStore` for signed-in users.
 *
 * Composition: a per-user IndexedDB mirror ("aquarius-u-<uid>", so guest data
 * never mixes with account data) + the Supabase store + the SyncEngine.
 *
 *   • Reads come from the mirror — instant and fully offline.
 *   • Writes land in the mirror first, enqueue a push op, and kick a debounced
 *     background sync. The UI never waits on the network.
 *   • Entities that are NOT in the mirror are notes shared BY OTHERS: those
 *     delegate straight to the cloud store (they are collaborative and
 *     online-only by design — the mirror only ever holds the user's own rows).
 *
 * The first sign-in on a device blocks reads briefly (bounded) while the
 * engine fills the mirror, so the library doesn't flash empty; afterwards
 * startup is instant-local with sync in the background.
 */

import type { DocumentTree } from "@/lib/blocks/types";
import { SupabaseLibraryStore } from "@/lib/storage/cloud";
import { LocalLibraryStore } from "@/lib/storage/local";
import type {
  AssetBlob,
  AssetRef,
  CreateNoteInput,
  CreateNotebookInput,
  CreateSubjectInput,
  EntityId,
  LibraryStore,
  NoteBundleFile,
  NoteMeta,
  NotePackage,
  NoteSnapshot,
  Notebook,
  SnapshotKind,
  SnapshotMeta,
  Subject,
} from "@/lib/storage/types";
import { SyncEngine } from "./engine";

const FIRST_PULL_TIMEOUT_MS = 15_000;

export class SyncedStore implements LibraryStore {
  readonly engine: SyncEngine;
  private readonly local: LocalLibraryStore;
  private readonly cloud: SupabaseLibraryStore;
  private readonly ready: Promise<void>;

  constructor(uid: string) {
    this.local = new LocalLibraryStore(`aquarius-u-${uid}`);
    this.cloud = new SupabaseLibraryStore();
    this.engine = new SyncEngine(uid, this.local, this.cloud);
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    if (this.engine.hasPulledOnce()) {
      void this.engine.syncAll();
      return;
    }
    // First run on this device: give the initial mirror fill a bounded window.
    await Promise.race([
      this.engine.syncAll().then(() => undefined),
      new Promise<void>((r) => setTimeout(r, FIRST_PULL_TIMEOUT_MS)),
    ]).catch(() => undefined);
  }

  /** Enqueue + debounce a background push after a local mutation. */
  private queued(op: Parameters<SyncEngine["queue"]["enqueue"]>[0]): void {
    this.engine.queue.enqueue(op);
    this.engine.kick();
  }

  /** Is this note in the mirror (own note) or a note shared by someone else? */
  /**
   * True when the note is in THIS user's mirror — i.e. it is ours, whether or
   * not the background push has carried it to the cloud yet. Public because
   * the editor must not ask the sharing layer about a note we already hold:
   * a freshly created note is absent from Supabase for the length of the push
   * debounce, and "not found" there is indistinguishable from "deleted".
   */
  async hasLocalCopy(noteId: EntityId): Promise<boolean> {
    await this.ready;
    return (await this.local.getNoteMeta(noteId)) !== undefined;
  }

  private async mirrored(noteId: EntityId): Promise<boolean> {
    return (await this.local.getNoteMeta(noteId)) !== undefined;
  }

  // ── Subjects ──────────────────────────────────────────────────────────────

  async listSubjects(): Promise<Subject[]> {
    await this.ready;
    return this.local.listSubjects();
  }

  async createSubject(input: CreateSubjectInput): Promise<Subject> {
    await this.ready;
    const s = await this.local.createSubject(input);
    this.queued({ kind: "subject", id: s.id });
    return s;
  }

  async updateSubject(id: EntityId, patch: Partial<Subject>): Promise<Subject> {
    await this.ready;
    const s = await this.local.updateSubject(id, patch);
    this.queued({ kind: "subject", id });
    return s;
  }

  async deleteSubject(id: EntityId): Promise<void> {
    await this.ready;
    await this.local.deleteSubject(id);
    this.engine.queue.enqueueDelete({ kind: "subject-delete", id });
    this.engine.kick();
  }

  async reorderSubjects(orderedIds: EntityId[]): Promise<void> {
    await this.ready;
    await this.local.reorderSubjects(orderedIds);
    // Every subject's order (and updatedAt) may have moved, not just the listed.
    for (const s of await this.local.listSubjects()) this.engine.queue.enqueue({ kind: "subject", id: s.id });
    this.engine.kick();
  }

  // ── Notebooks ─────────────────────────────────────────────────────────────

  async listNotebooks(subjectId: EntityId): Promise<Notebook[]> {
    await this.ready;
    return this.local.listNotebooks(subjectId);
  }

  async createNotebook(input: CreateNotebookInput): Promise<Notebook> {
    await this.ready;
    const n = await this.local.createNotebook(input);
    this.queued({ kind: "notebook", id: n.id });
    return n;
  }

  async updateNotebook(id: EntityId, patch: Partial<Notebook>): Promise<Notebook> {
    await this.ready;
    const n = await this.local.updateNotebook(id, patch);
    this.queued({ kind: "notebook", id });
    return n;
  }

  async deleteNotebook(id: EntityId): Promise<void> {
    await this.ready;
    await this.local.deleteNotebook(id);
    this.engine.queue.enqueueDelete({ kind: "notebook-delete", id });
    this.engine.kick();
  }

  async moveNotebook(id: EntityId, toSubjectId: EntityId): Promise<void> {
    await this.ready;
    await this.local.moveNotebook(id, toSubjectId);
    this.engine.queue.enqueue({ kind: "notebook", id });
    // The move re-denormalized subjectId onto every contained note.
    const { notes } = await this.local.syncListAll();
    for (const m of notes) if (m.notebookId === id) this.engine.queue.enqueue({ kind: "note", id: m.id });
    this.engine.kick();
  }

  // ── Notes (light metadata) ────────────────────────────────────────────────

  async listNotes(notebookId: EntityId): Promise<NoteMeta[]> {
    await this.ready;
    return this.local.listNotes(notebookId);
  }

  async getNoteMeta(id: EntityId): Promise<NoteMeta | undefined> {
    await this.ready;
    return (await this.local.getNoteMeta(id)) ?? (await this.cloud.getNoteMeta(id).catch(() => undefined));
  }

  async createNote(input: CreateNoteInput): Promise<NoteMeta> {
    await this.ready;
    const m = await this.local.createNote(input);
    // Order matters for the cloud FK: the notes row before its package.
    this.engine.queue.enqueue({ kind: "note", id: m.id });
    this.queued({ kind: "package", id: m.id });
    return m;
  }

  async updateNoteMeta(id: EntityId, patch: Partial<NoteMeta>): Promise<NoteMeta> {
    await this.ready;
    if (await this.mirrored(id)) {
      const m = await this.local.updateNoteMeta(id, patch);
      this.queued({ kind: "note", id });
      return m;
    }
    return this.cloud.updateNoteMeta(id, patch); // shared note (RLS decides)
  }

  async deleteNote(id: EntityId): Promise<void> {
    await this.ready;
    if (await this.mirrored(id)) {
      await this.local.deleteNote(id);
      this.engine.queue.enqueueDelete({ kind: "note-delete", id });
      this.engine.kick();
      return;
    }
    await this.cloud.deleteNote(id);
  }

  async moveNote(id: EntityId, toNotebookId: EntityId): Promise<void> {
    await this.ready;
    await this.local.moveNote(id, toNotebookId);
    this.queued({ kind: "note", id });
  }

  async searchNotes(query: string): Promise<{ title: NoteMeta[]; content: NoteMeta[] }> {
    await this.ready;
    return this.local.searchNotes(query);
  }

  async listDeletedNotes(): Promise<NoteMeta[]> {
    await this.ready;
    return this.local.listDeletedNotes();
  }

  async listRecentNotes(limit?: number): Promise<NoteMeta[]> {
    await this.ready;
    return this.local.listRecentNotes(limit);
  }

  async listBacklinks(noteId: EntityId): Promise<NoteMeta[]> {
    await this.ready;
    const mine = await this.local.listBacklinks(noteId);
    // Best-effort merge of backlinks from notes shared with me (cloud-side scan).
    const theirs = await this.cloud.listBacklinks(noteId).catch(() => [] as NoteMeta[]);
    const seen = new Set(mine.map((n) => n.id));
    return [...mine, ...theirs.filter((n) => !seen.has(n.id))];
  }

  // ── Note packages (heavy content) ─────────────────────────────────────────

  async openNote(id: EntityId): Promise<NotePackage> {
    await this.ready;
    if (await this.mirrored(id)) return this.local.openNote(id);
    return this.cloud.openNote(id); // shared note — online, collab-authoritative
  }

  async saveNote(pkg: NotePackage): Promise<void> {
    await this.ready;
    if (await this.mirrored(pkg.noteId)) {
      await this.local.saveNote(pkg);
      this.engine.queue.enqueue({ kind: "note", id: pkg.noteId }); // meta bumped
      this.queued({ kind: "package", id: pkg.noteId });
      return;
    }
    await this.cloud.saveNote(pkg);
  }

  // ── Assets ────────────────────────────────────────────────────────────────

  async putAsset(noteId: EntityId, data: Blob, meta: Pick<AssetRef, "kind" | "mime">): Promise<AssetRef> {
    await this.ready;
    if (await this.mirrored(noteId)) {
      const ref = await this.local.putAsset(noteId, data, meta);
      this.engine.queue.enqueue({ kind: "asset", id: ref.id, noteId });
      this.queued({ kind: "package", id: noteId }); // manifest changed
      return ref;
    }
    return this.cloud.putAsset(noteId, data, meta);
  }

  async getAsset(assetId: EntityId): Promise<AssetBlob | undefined> {
    await this.ready;
    return (await this.local.getAsset(assetId)) ?? (await this.cloud.getAsset(assetId).catch(() => undefined));
  }

  async deleteAsset(assetId: EntityId): Promise<void> {
    await this.ready;
    const mine = await this.local.getAsset(assetId);
    if (mine) {
      await this.local.deleteAsset(assetId);
      this.engine.queue.enqueueDelete({ kind: "asset-delete", id: assetId });
      this.queued({ kind: "package", id: mine.noteId }); // manifest changed
      return;
    }
    await this.cloud.deleteAsset(assetId);
  }

  // ── Portable bundles ──────────────────────────────────────────────────────

  async exportNote(id: EntityId): Promise<NoteBundleFile> {
    await this.ready;
    if (await this.mirrored(id)) return this.local.exportNote(id);
    return this.cloud.exportNote(id);
  }

  async importNote(bundle: NoteBundleFile, toNotebookId: EntityId): Promise<NoteMeta> {
    await this.ready;
    const m = await this.local.importNote(bundle, toNotebookId);
    this.engine.queue.enqueue({ kind: "note", id: m.id });
    this.engine.queue.enqueue({ kind: "package", id: m.id });
    const pkg = await this.local.openNote(m.id);
    for (const ref of pkg.assets) this.engine.queue.enqueue({ kind: "asset", id: ref.id, noteId: m.id });
    this.engine.kick();
    return m;
  }

  // ── Version history ───────────────────────────────────────────────────────

  async listSnapshots(noteId: EntityId): Promise<SnapshotMeta[]> {
    await this.ready;
    if (!(await this.mirrored(noteId))) return this.cloud.listSnapshots(noteId);
    // Mirror + cloud merged: other devices' snapshots live in the cloud until
    // pulled, and snapshots are immutable, so a union by id is exact.
    const mine = await this.local.listSnapshots(noteId);
    const theirs = await this.cloud.listSnapshots(noteId).catch(() => [] as SnapshotMeta[]);
    const seen = new Set(mine.map((s) => s.id));
    return [...mine, ...theirs.filter((s) => !seen.has(s.id))]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async saveSnapshot(noteId: EntityId, tree: DocumentTree, opts: { label: string; kind: SnapshotKind }): Promise<SnapshotMeta> {
    await this.ready;
    if (!(await this.mirrored(noteId))) return this.cloud.saveSnapshot(noteId, tree, opts);
    const meta = await this.local.saveSnapshot(noteId, tree, opts);
    this.queued({ kind: "snapshot", id: meta.id, noteId });
    return meta;
  }

  async getSnapshot(id: EntityId): Promise<NoteSnapshot | undefined> {
    await this.ready;
    return (await this.local.getSnapshot(id)) ?? (await this.cloud.getSnapshot(id).catch(() => undefined));
  }

  async deleteSnapshot(id: EntityId): Promise<void> {
    await this.ready;
    await this.local.deleteSnapshot(id); // no-op for cloud-only snapshots
    this.engine.queue.enqueueDelete({ kind: "snapshot-delete", id });
    this.engine.kick();
  }
}
