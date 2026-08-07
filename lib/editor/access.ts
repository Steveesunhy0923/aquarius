/**
 * Who may edit the note the editor has open.
 *
 * The rule lives here as a pure function because getting it wrong is invisible
 * until someone is signed in: the editor renders "This note is no longer
 * available" purely from this decision.
 *
 * The subtlety is local-first sync. `SyncedStore.createNote` writes the note to
 * this user's IndexedDB mirror and only *enqueues* the cloud push (debounced,
 * lib/sync/engine.ts), so for the first seconds of a new note's life it exists
 * locally and NOT in Supabase. Asking the sharing layer during that window
 * answers "no such note", which is indistinguishable from "deleted" — hence:
 * a note in our own mirror is ours, full stop, and the cloud is only consulted
 * for notes we don't have (shared with us, or opened by URL).
 *
 * A note deleted elsewhere disappears from the mirror when the next pull
 * applies, so re-running this after a sync still surfaces a genuine deletion.
 */

import type { Access } from "@/lib/sharing/sharing";

export type AccessResolution =
  | { kind: "access"; access: Access }
  | { kind: "gone" };

export function resolveNoteAccess(input: {
  /** The note exists in this user's own local mirror (or guest database). */
  mirroredLocally: boolean;
  /** What the sharing layer said, or null when it found no such note.
   *  `undefined` means we never asked (because we didn't need to). */
  cloudAccess?: Access | null;
}): AccessResolution {
  // Ours locally — the cloud may simply not have it yet.
  if (input.mirroredLocally) return { kind: "access", access: "owner" };
  if (input.cloudAccess) return { kind: "access", access: input.cloudAccess };
  return { kind: "gone" };
}
