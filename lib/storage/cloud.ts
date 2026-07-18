/**
 * Aquarius cloud storage — Supabase implementation of `LibraryStore`.
 *
 * Used as the source of truth when a user is signed in (see `getStore()` in
 * ./index.ts). Mirrors the local IndexedDB store method-for-method against the
 * Postgres schema (supabase/migrations/) and the `note-assets` Storage bucket.
 * Owner scoping is enforced by RLS — `owner_id` is defaulted to `auth.uid()`
 * (migration 0004), so inserts never spell it out. Row⇄entity mapping is
 * camelCase⇄snake_case; the pure mappers are exported for unit tests.
 *
 * Browser-only (Storage download returns a Blob). Assemble a note's package from
 * its `note_packages` row plus its `assets` rows; asset bytes live in Storage.
 */

import { emptyDocument } from "@/lib/blocks/types";
import type { DocumentTree } from "@/lib/blocks/types";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getCachedUserId } from "@/lib/supabase/session";
import { bytesToPgHex, pgHexToBytes } from "@/lib/collab/bytes";
import { base64ToBlob, blobToBase64, remapSelfNoteLinks, remapTreeAssetIds } from "./bundle";
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
  Notebook,
  Subject,
} from "./types";

const BUCKET = "note-assets";
const DEFAULT_SUBJECT_COLOR = "#2563eb";
const DEFAULT_NOTEBOOK_COLOR = "#64748b";
const newId = (): EntityId => crypto.randomUUID();

// ─── Wire row shapes (snake_case) ─────────────────────────────────────────────

interface SubjectRow {
  id: string; name: string; color: string | null; icon: string | null;
  sort_order: number; created_at: string; updated_at: string;
}
interface NotebookRow {
  id: string; subject_id: string; name: string; color: string | null;
  sort_order: number; created_at: string; updated_at: string;
}
interface NoteRow {
  id: string; notebook_id: string; subject_id: string; title: string;
  sort_order: number; tags: string[]; thumbnail: string | null;
  mode: NoteMeta["mode"]; created_at: string; updated_at: string;
  deleted_at: string | null;
}
interface PackageRow {
  note_id: string; tree: DocumentTree; latex_cache: string | null; updated_at: string;
  ydoc: string | null; // Postgres bytea, returned by PostgREST as a `\x…` hex string
}
interface AssetRow {
  id: string; note_id: string; kind: AssetRef["kind"]; mime: string;
  size: number; storage_path: string; created_at: string;
}

// ─── Pure mappers (row → entity), exported for unit tests ─────────────────────

export function subjectFromRow(r: SubjectRow): Subject {
  return {
    id: r.id, name: r.name, color: r.color ?? DEFAULT_SUBJECT_COLOR,
    icon: r.icon ?? undefined, order: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at, rev: null,
  };
}
export function notebookFromRow(r: NotebookRow): Notebook {
  return {
    id: r.id, subjectId: r.subject_id, name: r.name,
    color: r.color ?? DEFAULT_NOTEBOOK_COLOR, order: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at, rev: null,
  };
}
export function noteFromRow(r: NoteRow): NoteMeta {
  return {
    id: r.id, notebookId: r.notebook_id, subjectId: r.subject_id,
    title: r.title, order: r.sort_order, tags: r.tags ?? [],
    thumbnail: r.thumbnail ?? undefined, mode: r.mode,
    createdAt: r.created_at, updatedAt: r.updated_at,
    deletedAt: r.deleted_at, dirty: false, rev: null,
  };
}
export function assetFromRow(r: AssetRow): AssetRef {
  return {
    id: r.id, noteId: r.note_id, kind: r.kind, mime: r.mime,
    size: r.size, createdAt: r.created_at,
  };
}

// ─── The store ───────────────────────────────────────────────────────────────

export class SupabaseLibraryStore implements LibraryStore {
  private get sb() {
    const c = getSupabaseClient();
    if (!c) throw new Error("Cloud storage is not configured.");
    return c;
  }

  private async uid(): Promise<string> {
    const cached = getCachedUserId();
    if (cached) return cached;
    const { data } = await this.sb.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new Error("You are not signed in.");
    return id;
  }

  /** Next sort_order for a scope: max(existing) + 1 (RLS scopes to the owner). */
  private async nextOrder(table: string, scope?: { col: string; val: string }): Promise<number> {
    let q = this.sb.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1);
    if (scope) q = q.eq(scope.col, scope.val);
    const { data, error } = await q;
    if (error) throw error;
    const top = (data as { sort_order: number }[] | null)?.[0]?.sort_order;
    return (typeof top === "number" ? top : -1) + 1;
  }

  // ── Subjects ──────────────────────────────────────────────────────────────
  async listSubjects(): Promise<Subject[]> {
    const { data, error } = await this.sb.from("subjects").select("*").order("sort_order");
    if (error) throw error;
    return (data as SubjectRow[]).map(subjectFromRow);
  }
  async createSubject(input: CreateSubjectInput): Promise<Subject> {
    const sort_order = await this.nextOrder("subjects");
    const { data, error } = await this.sb
      .from("subjects")
      .insert({ name: input.name, color: input.color ?? DEFAULT_SUBJECT_COLOR, icon: input.icon ?? null, sort_order })
      .select("*").single();
    if (error) throw error;
    return subjectFromRow(data as SubjectRow);
  }
  async updateSubject(id: EntityId, patch: Partial<Subject>): Promise<Subject> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.color !== undefined) row.color = patch.color;
    if (patch.icon !== undefined) row.icon = patch.icon ?? null;
    if (patch.order !== undefined) row.sort_order = patch.order;
    const { data, error } = await this.sb.from("subjects").update(row).eq("id", id).select("*").single();
    if (error) throw error;
    return subjectFromRow(data as SubjectRow);
  }
  async deleteSubject(id: EntityId): Promise<void> {
    const { error } = await this.sb.from("subjects").delete().eq("id", id); // cascades in DB
    if (error) throw error;
  }
  async reorderSubjects(orderedIds: EntityId[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, i) => this.sb.from("subjects").update({ sort_order: i }).eq("id", id)),
    );
  }

  // ── Notebooks ───────────────────────────────────────────────────────────────
  async listNotebooks(subjectId: EntityId): Promise<Notebook[]> {
    const { data, error } = await this.sb.from("notebooks").select("*").eq("subject_id", subjectId).order("sort_order");
    if (error) throw error;
    return (data as NotebookRow[]).map(notebookFromRow);
  }
  async createNotebook(input: CreateNotebookInput): Promise<Notebook> {
    const sort_order = await this.nextOrder("notebooks", { col: "subject_id", val: input.subjectId });
    const { data, error } = await this.sb
      .from("notebooks")
      .insert({ subject_id: input.subjectId, name: input.name, color: input.color ?? DEFAULT_NOTEBOOK_COLOR, sort_order })
      .select("*").single();
    if (error) throw error;
    return notebookFromRow(data as NotebookRow);
  }
  async updateNotebook(id: EntityId, patch: Partial<Notebook>): Promise<Notebook> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.color !== undefined) row.color = patch.color;
    if (patch.order !== undefined) row.sort_order = patch.order;
    if (patch.subjectId !== undefined) row.subject_id = patch.subjectId;
    const { data, error } = await this.sb.from("notebooks").update(row).eq("id", id).select("*").single();
    if (error) throw error;
    return notebookFromRow(data as NotebookRow);
  }
  async deleteNotebook(id: EntityId): Promise<void> {
    const { error } = await this.sb.from("notebooks").delete().eq("id", id);
    if (error) throw error;
  }
  async moveNotebook(id: EntityId, toSubjectId: EntityId): Promise<void> {
    const { error } = await this.sb.from("notebooks").update({ subject_id: toSubjectId }).eq("id", id);
    if (error) throw error;
    // Keep the denormalized subject_id on every note in this notebook in sync.
    const { error: e2 } = await this.sb.from("notes").update({ subject_id: toSubjectId }).eq("notebook_id", id);
    if (e2) throw e2;
  }

  // ── Notes (light metadata) ──────────────────────────────────────────────────
  async listNotes(notebookId: EntityId): Promise<NoteMeta[]> {
    const { data, error } = await this.sb.from("notes").select("*")
      .eq("notebook_id", notebookId).is("deleted_at", null).order("sort_order");
    if (error) throw error;
    return (data as NoteRow[]).map(noteFromRow);
  }
  async getNoteMeta(id: EntityId): Promise<NoteMeta | undefined> {
    const { data, error } = await this.sb.from("notes").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? noteFromRow(data as NoteRow) : undefined;
  }
  async createNote(input: CreateNoteInput): Promise<NoteMeta> {
    const mode = input.mode ?? "flow";
    const { data: nb, error: nbErr } = await this.sb.from("notebooks").select("subject_id").eq("id", input.notebookId).single();
    if (nbErr) throw nbErr;
    const subjectId = (nb as { subject_id: string }).subject_id;
    const sort_order = await this.nextOrder("notes", { col: "notebook_id", val: input.notebookId });
    const noteId = newId();
    const { data, error } = await this.sb.from("notes").insert({
      id: noteId, notebook_id: input.notebookId, subject_id: subjectId,
      title: input.title ?? "Untitled", sort_order, tags: [], mode,
    }).select("*").single();
    if (error) throw error;
    // Heavy package: an empty document so opening the new note loads exactly one.
    const { error: pErr } = await this.sb.from("note_packages").insert({
      note_id: noteId, tree: emptyDocument(mode), latex_cache: "",
    });
    if (pErr) throw pErr;
    return noteFromRow(data as NoteRow);
  }
  async updateNoteMeta(id: EntityId, patch: Partial<NoteMeta>): Promise<NoteMeta> {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.order !== undefined) row.sort_order = patch.order;
    if (patch.tags !== undefined) row.tags = patch.tags;
    if (patch.thumbnail !== undefined) row.thumbnail = patch.thumbnail ?? null;
    if (patch.mode !== undefined) row.mode = patch.mode;
    if (patch.notebookId !== undefined) row.notebook_id = patch.notebookId;
    if (patch.subjectId !== undefined) row.subject_id = patch.subjectId;
    if (patch.deletedAt !== undefined) row.deleted_at = patch.deletedAt;
    const { data, error } = await this.sb.from("notes").update(row).eq("id", id).select("*").single();
    if (error) throw error;
    return noteFromRow(data as NoteRow);
  }
  async deleteNote(id: EntityId): Promise<void> {
    // Soft delete if currently live; hard delete if already in the trash.
    const existing = await this.getNoteMeta(id);
    if (existing && !existing.deletedAt) {
      const { error } = await this.sb.from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      return;
    }
    await this.purgeAssets(id);
    const { error } = await this.sb.from("notes").delete().eq("id", id); // cascades package + asset rows
    if (error) throw error;
  }
  async moveNote(id: EntityId, toNotebookId: EntityId): Promise<void> {
    const { data: nb, error: nbErr } = await this.sb.from("notebooks").select("subject_id").eq("id", toNotebookId).single();
    if (nbErr) throw nbErr;
    const subjectId = (nb as { subject_id: string }).subject_id;
    const { error } = await this.sb.from("notes").update({ notebook_id: toNotebookId, subject_id: subjectId }).eq("id", id);
    if (error) throw error;
  }
  async searchNotes(query: string): Promise<{ title: NoteMeta[]; content: NoteMeta[] }> {
    const q = query.trim();
    if (!q) return { title: [], content: [] };
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    // Tier 1: title or tag match.
    const { data: titleRows, error: e1 } = await this.sb.from("notes").select("*")
      .is("deleted_at", null).or(`title.ilike.${like},tags.cs.{${q}}`).order("updated_at", { ascending: false });
    if (e1) throw e1;
    const title = (titleRows as NoteRow[]).map(noteFromRow);
    const titleIds = new Set(title.map((n) => n.id));
    // Tier 2: body (latex_cache) match, excluding tier-1 hits.
    const { data: pkgRows, error: e2 } = await this.sb.from("note_packages")
      .select("note_id").ilike("latex_cache", like);
    if (e2) throw e2;
    const contentIds = (pkgRows as { note_id: string }[]).map((r) => r.note_id).filter((nid) => !titleIds.has(nid));
    let content: NoteMeta[] = [];
    if (contentIds.length) {
      const { data: rows, error: e3 } = await this.sb.from("notes").select("*")
        .is("deleted_at", null).in("id", contentIds).order("updated_at", { ascending: false });
      if (e3) throw e3;
      content = (rows as NoteRow[]).map(noteFromRow);
    }
    return { title, content };
  }
  async listDeletedNotes(): Promise<NoteMeta[]> {
    const { data, error } = await this.sb.from("notes").select("*")
      .not("deleted_at", "is", null).order("deleted_at", { ascending: false });
    if (error) throw error;
    return (data as NoteRow[]).map(noteFromRow);
  }
  async listRecentNotes(limit = 50): Promise<NoteMeta[]> {
    const { data, error } = await this.sb.from("notes").select("*")
      .is("deleted_at", null).order("updated_at", { ascending: false }).limit(Math.max(0, limit));
    if (error) throw error;
    return (data as NoteRow[]).map(noteFromRow);
  }
  async listBacklinks(noteId: EntityId): Promise<NoteMeta[]> {
    // Postgres-side tree scan via the backlink_note_ids function (migration
    // 0010) — note:// hrefs are stripped from latex_cache, so only the tree
    // JSON has them. SECURITY INVOKER: RLS keeps this to readable notes.
    const { data, error } = await this.sb.rpc("backlink_note_ids", { target: noteId });
    if (error) return []; // function not deployed yet → degrade to "no backlinks"
    const ids = (data as { note_id: string }[] | null ?? []).map((r) => r.note_id);
    if (ids.length === 0) return [];
    const { data: rows, error: e2 } = await this.sb.from("notes").select("*")
      .is("deleted_at", null).in("id", ids).order("updated_at", { ascending: false });
    if (e2) throw e2;
    return (rows as NoteRow[]).map(noteFromRow);
  }

  // ── Note packages (heavy content) ────────────────────────────────────────────
  async openNote(id: EntityId): Promise<NotePackage> {
    const { data: pkg, error } = await this.sb.from("note_packages")
      .select("note_id,tree,latex_cache,updated_at,ydoc").eq("note_id", id).maybeSingle();
    if (error) throw error;
    const { data: assetRows, error: aErr } = await this.sb.from("assets").select("*").eq("note_id", id);
    if (aErr) throw aErr;
    const assets = (assetRows as AssetRow[]).map(assetFromRow);
    if (!pkg) {
      // Note exists but its package row is missing — return an empty document.
      return { noteId: id, tree: emptyDocument("flow"), latexCache: "", assets, updatedAt: new Date(0).toISOString(), rev: null, ydoc: null };
    }
    const row = pkg as PackageRow;
    // `ydoc` is present only once a note has been co-edited; null otherwise so
    // the collab layer seeds a fresh Y.Doc from `tree`.
    const ydoc = row.ydoc ? pgHexToBytes(row.ydoc) : null;
    return { noteId: id, tree: row.tree, latexCache: row.latex_cache ?? "", assets, updatedAt: row.updated_at, rev: null, ydoc };
  }
  async saveNote(pkg: NotePackage): Promise<void> {
    const ts = new Date().toISOString();
    // Persist the authoritative Yjs snapshot (collab notes) alongside the
    // materialized read model (`tree`/`latex_cache`). For private notes `ydoc`
    // is absent and the column is left untouched (undefined is omitted by
    // supabase-js, so a prior snapshot is never clobbered with null).
    const row: Record<string, unknown> = {
      note_id: pkg.noteId, tree: pkg.tree, latex_cache: pkg.latexCache, updated_at: ts,
    };
    if (pkg.ydoc != null) row.ydoc = bytesToPgHex(pkg.ydoc);
    const { error } = await this.sb.from("note_packages").upsert(row, { onConflict: "note_id" });
    if (error) throw error;
    const { error: e2 } = await this.sb.from("notes").update({ mode: pkg.tree.mode, updated_at: ts }).eq("id", pkg.noteId);
    if (e2) throw e2;
  }

  // ── Assets (bytes in Storage, metadata in `assets`) ──────────────────────────
  async putAsset(noteId: EntityId, data: Blob, meta: Pick<AssetRef, "kind" | "mime">): Promise<AssetRef> {
    const uid = await this.uid();
    const id = newId();
    const storage_path = `${uid}/${noteId}/${id}`;
    const up = await this.sb.storage.from(BUCKET).upload(storage_path, data, { contentType: meta.mime, upsert: true });
    if (up.error) throw up.error;
    const { data: row, error } = await this.sb.from("assets")
      .insert({ id, note_id: noteId, kind: meta.kind, mime: meta.mime, size: data.size, storage_path })
      .select("*").single();
    if (error) throw error;
    return assetFromRow(row as AssetRow);
  }
  async getAsset(assetId: EntityId): Promise<AssetBlob | undefined> {
    const { data: row, error } = await this.sb.from("assets").select("*").eq("id", assetId).maybeSingle();
    if (error) throw error;
    if (!row) return undefined;
    const ar = row as AssetRow;
    const dl = await this.sb.storage.from(BUCKET).download(ar.storage_path);
    if (dl.error) throw dl.error;
    return { ...assetFromRow(ar), data: dl.data };
  }
  async deleteAsset(assetId: EntityId): Promise<void> {
    const { data: row, error } = await this.sb.from("assets").select("storage_path").eq("id", assetId).maybeSingle();
    if (error) throw error;
    if (row) await this.sb.storage.from(BUCKET).remove([(row as { storage_path: string }).storage_path]);
    const { error: e2 } = await this.sb.from("assets").delete().eq("id", assetId);
    if (e2) throw e2;
  }

  /** Remove all Storage bytes for a note before a hard delete (rows cascade). */
  private async purgeAssets(noteId: EntityId): Promise<void> {
    const { data } = await this.sb.from("assets").select("storage_path").eq("note_id", noteId);
    const paths = (data as { storage_path: string }[] | null)?.map((r) => r.storage_path) ?? [];
    if (paths.length) await this.sb.storage.from(BUCKET).remove(paths);
  }

  // ── Portable bundles (Notability-style single-note export/import) ────────────
  async exportNote(id: EntityId): Promise<NoteBundleFile> {
    const meta = await this.getNoteMeta(id);
    if (!meta) throw new Error(`Note not found: ${id}`);
    const pkg = await this.openNote(id);
    const assets = await Promise.all(
      pkg.assets.map(async (ref) => {
        const blob = await this.getAsset(ref.id);
        const base64 = blob ? await blobToBase64(blob.data) : "";
        return { ...ref, base64 };
      }),
    );
    const { order: _o, dirty: _d, rev: _r, deletedAt: _da, ...metaRest } = meta;
    const { rev: _pr, ...pkgRest } = pkg;
    return { format: "aqnote", version: 1, meta: metaRest, pkg: pkgRest, assets };
  }
  async importNote(bundle: NoteBundleFile, toNotebookId: EntityId): Promise<NoteMeta> {
    // A fresh note in this library: new note id + fresh asset ids.
    const created = await this.createNote({
      notebookId: toNotebookId,
      title: bundle.meta.title,
      mode: bundle.meta.mode,
    });
    const newNoteId = created.id;

    const assetIdMap = new Map<EntityId, EntityId>();
    const refs: AssetRef[] = [];
    for (const inlined of bundle.assets) {
      const { base64, id: oldId, kind, mime } = inlined;
      const blob = base64ToBlob(base64, mime);
      const ref = await this.putAsset(newNoteId, blob, { kind, mime });
      assetIdMap.set(oldId, ref.id);
      refs.push(ref);
    }
    // Fresh asset ids + repoint self-referential note links at the new id.
    const tree = remapSelfNoteLinks(remapTreeAssetIds(bundle.pkg.tree, assetIdMap), bundle.pkg.noteId, newNoteId);
    await this.saveNote({
      noteId: newNoteId, tree, latexCache: bundle.pkg.latexCache, assets: refs,
      updatedAt: new Date().toISOString(), rev: null,
    });
    await this.updateNoteMeta(newNoteId, { tags: [...bundle.meta.tags], thumbnail: bundle.meta.thumbnail });
    return (await this.getNoteMeta(newNoteId))!;
  }
}
