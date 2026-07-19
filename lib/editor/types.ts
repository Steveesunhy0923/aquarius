import type { Module } from "@/lib/templates/modules";

/**
 * Named editor actions the ⌘K command palette can invoke on the active pane.
 * Each maps to an existing DocumentEditor mutator/opener in `runCommand`.
 */
export type EditorCommand =
  | "insertParagraph"
  | "insertHeading"
  | "insertList"
  | "insertEquation"
  | "insertTable"
  | "insertGraph"
  | "insertImage"
  | "undo"
  | "redo"
  | "save"
  | "print"
  | "toggleSource"
  | "openShare"
  | "openTemplates"
  | "openSymbols"
  | "openInk"
  | "openHistory";

/** Imperative API a DocumentEditor exposes to the page (outline, note-link jumps, ⌘K palette). */
export interface DocHandle {
  scrollToBlock: (id: string) => void;
  /** Scroll the page surface to the top (whole-note link to this pane). */
  scrollToTop: () => void;
  toggleSection: (id: string) => void;
  reorderSections: (fromHeadingId: string, toHeadingId: string | null) => void;
  /** Save a heading's whole section as a reusable module (prompts for a name). */
  saveSectionAsModule: (headingId: string) => void;
  /** Insert a module (or preset stack) as a section at the cursor — ⌘K palette. */
  insertModule: (module: Module) => void;
  /** Run a named editor action — ⌘K palette. */
  runCommand: (cmd: EditorCommand) => void;
  /** False while the pane is read-only (viewer/commenter) — mutating commands are hidden. */
  canWrite: () => boolean;
}
