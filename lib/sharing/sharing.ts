/**
 * Document sharing — collaborators by username with a role.
 *
 * Cloud-only (Supabase). Built on the `note_collaborators` table + additive RLS
 * (supabase/migrations/0006_collaborators.sql). The note OWNER adds/removes
 * collaborators and sets roles; a collaborator can read what's shared with them.
 * Kept separate from the `LibraryStore` contract since it's cloud-specific.
 */

import { noteFromRow } from "@/lib/storage/cloud";
import type { NoteMeta } from "@/lib/storage/types";
import { lookupByUsername } from "@/lib/profile/profile";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getCachedUserId } from "@/lib/supabase/session";

export type Role = "viewer" | "commenter" | "editor";
/** What the current user can do with a note. */
export type Access = "owner" | Role;

export const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: "editor", label: "Editor", hint: "Can view and edit" },
  { id: "commenter", label: "Commenter", hint: "Can view and comment" },
  { id: "viewer", label: "Viewer", hint: "Can view only" },
];

export interface Collaborator {
  userId: string;
  username: string;
  displayName: string | null;
  role: Role;
}

function client() {
  const sb = getSupabaseClient();
  if (!sb) throw new Error("Cloud is not configured.");
  return sb;
}
async function uid(): Promise<string> {
  const cached = getCachedUserId();
  if (cached) return cached;
  const { data } = await client().auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("You are not signed in.");
  return id;
}

/** Share a note with another user (by username). Owner-only. */
export async function shareNote(noteId: string, username: string, role: Role): Promise<Collaborator> {
  const me = await uid();
  const profile = await lookupByUsername(username.trim());
  if (!profile) throw new Error(`No user named “${username.trim()}”.`);
  if (profile.id === me) throw new Error("That's you — you already own this note.");
  const { error } = await client()
    .from("note_collaborators")
    .upsert({ note_id: noteId, user_id: profile.id, owner_id: me, role }, { onConflict: "note_id,user_id" });
  if (error) throw error;
  return { userId: profile.id, username: profile.username, displayName: profile.displayName, role };
}

/** Everyone a note is shared with (owner view). */
export async function listCollaborators(noteId: string): Promise<Collaborator[]> {
  const { data: rows, error } = await client()
    .from("note_collaborators")
    .select("user_id, role")
    .eq("note_id", noteId);
  if (error) throw error;
  const list = (rows ?? []) as { user_id: string; role: Role }[];
  if (list.length === 0) return [];
  const { data: profs, error: pErr } = await client()
    .from("profiles")
    .select("id, username, display_name")
    .in("id", list.map((r) => r.user_id));
  if (pErr) throw pErr;
  const byId = new Map((profs ?? []).map((p: { id: string; username: string; display_name: string | null }) => [p.id, p]));
  return list.map((r) => {
    const p = byId.get(r.user_id);
    return { userId: r.user_id, username: p?.username ?? "unknown", displayName: p?.display_name ?? null, role: r.role };
  });
}

export async function setCollaboratorRole(noteId: string, userId: string, role: Role): Promise<void> {
  const { error } = await client().from("note_collaborators").update({ role }).eq("note_id", noteId).eq("user_id", userId);
  if (error) throw error;
}

export async function removeCollaborator(noteId: string, userId: string): Promise<void> {
  const { error } = await client().from("note_collaborators").delete().eq("note_id", noteId).eq("user_id", userId);
  if (error) throw error;
}

/** The current user's access to a note: owner, a role, or null (no access). */
export async function getMyAccess(noteId: string): Promise<Access | null> {
  const me = await uid();
  const { data: note, error } = await client().from("notes").select("owner_id").eq("id", noteId).maybeSingle();
  if (error) throw error;
  if (!note) return null;
  if ((note as { owner_id: string }).owner_id === me) return "owner";
  const { data: c, error: cErr } = await client()
    .from("note_collaborators").select("role").eq("note_id", noteId).eq("user_id", me).maybeSingle();
  if (cErr) throw cErr;
  return (c as { role: Role } | null)?.role ?? null;
}

/** A note shared with the current user, plus whether they've opened it yet. */
export interface SharedNote {
  note: NoteMeta;
  role: Role;
  /** When the current user first opened it, or null while it's still "new". */
  openedAt: string | null;
}

/** Notes other users have shared with the current user. */
export async function listSharedWithMe(): Promise<SharedNote[]> {
  const me = await uid();
  const { data: collabs, error } = await client()
    .from("note_collaborators").select("note_id, role").eq("user_id", me);
  if (error) throw error;
  const rows = (collabs ?? []) as { note_id: string; role: Role }[];
  if (rows.length === 0) return [];
  const roleById = new Map(rows.map((r) => [r.note_id, r.role]));
  const openedById = await listMyOpens();
  const { data: notes, error: nErr } = await client()
    .from("notes").select("*").in("id", rows.map((r) => r.note_id)).is("deleted_at", null);
  if (nErr) throw nErr;
  return (notes ?? []).map((n) => {
    const meta = noteFromRow(n as Parameters<typeof noteFromRow>[0]);
    return {
      note: meta,
      role: roleById.get(meta.id) ?? "viewer",
      openedAt: openedById.get(meta.id) ?? null,
    };
  });
}

/** noteId → opened_at for every share the current user has opened. Degrades to
 *  "nothing opened" if the shared_note_opens migration isn't applied yet. */
async function listMyOpens(): Promise<Map<string, string>> {
  const { data, error } = await client().from("shared_note_opens").select("note_id, opened_at");
  if (error) return new Map();
  return new Map((data as { note_id: string; opened_at: string }[]).map((r) => [r.note_id, r.opened_at]));
}

/**
 * Record that the current user opened a note shared with them, moving it from
 * the "Shared with me" inbox into the library's Uncategorized section.
 * Insert-only and idempotent; silently a no-op if the migration isn't applied
 * or the caller isn't a collaborator on the note.
 */
export async function markSharedNoteOpened(noteId: string): Promise<void> {
  try {
    const me = await uid();
    await client()
      .from("shared_note_opens")
      .upsert({ note_id: noteId, user_id: me }, { onConflict: "note_id,user_id", ignoreDuplicates: true });
  } catch {
    // Best-effort marker — opening the note must never fail because of it.
  }
}
