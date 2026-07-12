/**
 * Note links — `[text](note://<noteId>)` in prose links to another note;
 * `note://<noteId>#<blockId>` targets one of its sections (a heading's block
 * id, stable across renames). They ride the ordinary `[text](url)` format
 * marker, so parsing/storage/collab need nothing new: only rendering (click →
 * open, hover → preview) and LaTeX export treat the scheme specially.
 */

export const NOTE_LINK_SCHEME = "note://";

export interface NoteLinkTarget {
  noteId: string;
  /** Heading block id of the linked section; absent = the whole note. */
  blockId?: string;
}

export const isNoteHref = (href: string): boolean => href.startsWith(NOTE_LINK_SCHEME);

export function makeNoteHref(noteId: string, blockId?: string): string {
  return `${NOTE_LINK_SCHEME}${noteId}${blockId ? `#${blockId}` : ""}`;
}

/** Parse a `note://id(#blockId)` href; null for anything else. */
export function parseNoteHref(href: string): NoteLinkTarget | null {
  if (!isNoteHref(href)) return null;
  const rest = href.slice(NOTE_LINK_SCHEME.length);
  const hash = rest.indexOf("#");
  const noteId = (hash < 0 ? rest : rest.slice(0, hash)).trim();
  if (!noteId) return null;
  const blockId = hash < 0 ? undefined : rest.slice(hash + 1).trim() || undefined;
  return { noteId, blockId };
}

/** The event a clicked note link dispatches; the editor route intercepts it
 *  (same-note section jumps, split panes) and un-handled clicks navigate. */
export const NOTE_LINK_EVENT = "aquarius:note-link";

/** The editor URL a note link navigates to (`?block=` scrolls after load). */
export function noteLinkUrl(t: NoteLinkTarget): string {
  return `/editor/${t.noteId}${t.blockId ? `?block=${encodeURIComponent(t.blockId)}` : ""}`;
}
