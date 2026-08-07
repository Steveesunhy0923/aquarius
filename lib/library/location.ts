/**
 * Where the user last was in the library, so coming back from a note lands
 * them in the folder they were working in rather than the first subject.
 *
 * This is EPHEMERAL UI STATE, not a preference — it is nobody's business in the
 * Settings dialog and it must never sync between devices (the whole point is
 * "where was I on this machine"). Hence its own key rather than a field on
 * AppSettings.
 *
 * Scoped per account: signing in swaps the whole library, so a subject id from
 * the local/guest store is meaningless against a cloud one. A stale id is never
 * fatal anyway — the reader hands back whatever was stored and the caller is
 * expected to validate it against the lists it actually loaded, because a
 * subject or notebook can be deleted on another device between visits.
 */

const KEY = "aquarius.library.location.v1";

/** Which sidebar section was selected. "trash" is deliberately not persisted. */
export type LibraryView = "subject" | "shared" | "uncat";

export interface LibraryLocation {
  view: LibraryView;
  subjectId: string | null;
  notebookId: string | null;
}

const scoped = (userId: string | null) => `${KEY}:${userId ?? "local"}`;

export function readLibraryLocation(userId: string | null): LibraryLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(scoped(userId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LibraryLocation>;
    const view: LibraryView = p.view === "shared" || p.view === "uncat" ? p.view : "subject";
    return {
      view,
      subjectId: typeof p.subjectId === "string" ? p.subjectId : null,
      notebookId: typeof p.notebookId === "string" ? p.notebookId : null,
    };
  } catch {
    return null; // storage disabled, or a shape from an older build
  }
}

export function writeLibraryLocation(userId: string | null, loc: LibraryLocation): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scoped(userId), JSON.stringify(loc));
  } catch {
    /* private mode / quota — remembering the folder is not worth failing over */
  }
}
