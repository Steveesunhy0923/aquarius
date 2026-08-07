/**
 * What the editor may do with the open note.
 *
 * There are TWO independent reasons the editor can be locked, and a single
 * `readOnly` boolean cannot express both:
 *
 *   ACCESS — who you are     (owner / editor / commenter / viewer)
 *   KIND   — what it is      (a document you authored / a file you imported)
 *
 * An imported PDF is precisely the case a boolean gets wrong: you may draw on
 * it but not type in it. So capabilities are individual bits, derived once from
 * the two axes, and every gate reads the bit it actually cares about rather
 * than a catch-all.
 */

import type { Access } from "@/lib/sharing/sharing";

/** What the open note IS, as opposed to who is looking at it. */
export type NoteKind = "document" | "pdf";

export interface EditorCapabilities {
  /** Mutate the block tree at all — insert, delete, reorder, edit text. */
  editBlocks: boolean;
  /** Change document style: font, spacing, page layout, background. */
  editDocStyle: boolean;
  /** Rename the note. Allowed on imports — naming your own copy is fine. */
  editTitle: boolean;
  /** Draw on the ink annotation layer. */
  annotate: boolean;
  /** Run code blocks (side effects, kernels). */
  runCode: boolean;
  /** Persist anything at all. */
  persist: boolean;
  /** Save or restore named versions. */
  editHistory: boolean;
  /** Open the Share dialog. */
  share: boolean;
}

/** Nothing allowed — the safe default when no editor handle is available yet. */
export const NO_CAPS: EditorCapabilities = {
  editBlocks: false,
  editDocStyle: false,
  editTitle: false,
  annotate: false,
  runCode: false,
  persist: false,
  editHistory: false,
  share: false,
};

/**
 * The single source of truth. Pure, so it can be unit-tested exhaustively.
 *
 * Note `annotate` tracks ACCESS only and ignores KIND: a viewer may not draw on
 * a shared PDF, because the RLS policies (migration 0006) admit writes only for
 * owner/editor — on any route, tree or asset or Realtime broadcast. Letting a
 * viewer draw would produce ink that silently vanishes on reload, which is the
 * exact failure the read-only banner exists to prevent.
 */
export function capabilitiesFor(input: { access: Access; kind: NoteKind }): EditorCapabilities {
  const writer = input.access === "owner" || input.access === "editor";
  const pdf = input.kind === "pdf";
  return {
    editBlocks: writer && !pdf,
    editDocStyle: writer && !pdf,
    editTitle: writer,
    annotate: writer,
    runCode: writer && !pdf,
    persist: writer,
    editHistory: writer && !pdf,
    share: input.access === "owner",
  };
}

/** Why the editor is locked, so the banner can say something true. */
export function lockReason(input: { access: Access; kind: NoteKind }): "none" | "access" | "pdf" {
  if (input.access === "viewer" || input.access === "commenter") return "access";
  return input.kind === "pdf" ? "pdf" : "none";
}
