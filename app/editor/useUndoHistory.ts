import { useCallback, useRef } from "react";

import type { DocumentTree } from "@/lib/blocks/types";

/** How many steps back the editor remembers. */
const HISTORY_LIMIT = 100;
/** Consecutive coalescing edits (typing) within this window are one step. */
const COALESCE_MS = 400;

/**
 * Undo / redo for one document, as stacks of whole-document snapshots.
 *
 * Trees are immutable — every edit builds a new one — so a snapshot is a
 * reference, not a copy, and a hundred of them cost little more than the
 * blocks that actually changed.
 *
 *   snapshot(coalesce)  call BEFORE mutating: records the tree as it is now.
 *                       `coalesce: true` (typing) folds a run of edits made
 *                       within COALESCE_MS into one step, so undo does not
 *                       walk back a character at a time.
 *   undo / redo         stable identities, safe in effect dependencies.
 *   reset               a freshly loaded document starts with no history.
 *
 * Split out of DocumentEditor, where it was fifty lines among three thousand.
 * It owns no React state: the stacks are refs, and the buttons that reflect
 * them re-render because the document they belong to does.
 *
 * NOT collaboration-aware: in a shared note this restores the whole tree,
 * including blocks a collaborator has changed since (docs/TODO.md).
 */
export function useUndoHistory({
  currentTree,
  canEdit,
  apply,
}: {
  /** The document as it stands (read at call time, not at render time). */
  currentTree: () => DocumentTree | undefined;
  /** Undo/redo write the tree directly, so they need their own permission
   *  check — the mutators' guard is not on this path. */
  canEdit: () => boolean;
  /** Replace the document with `tree`. Must be stable. */
  apply: (tree: DocumentTree) => void;
}) {
  const undoStack = useRef<DocumentTree[]>([]);
  const redoStack = useRef<DocumentTree[]>([]);
  const lastSnapAt = useRef(0);
  const lastSnapCoalesced = useRef(false);
  // Latest closures, so the callbacks below never go stale and never change.
  const live = useRef({ currentTree, canEdit });
  live.current = { currentTree, canEdit };

  const snapshot = useCallback((coalesce: boolean) => {
    const prev = live.current.currentTree();
    if (!prev) return;
    const now = Date.now();
    const merge = coalesce && lastSnapCoalesced.current && now - lastSnapAt.current <= COALESCE_MS;
    if (!merge) {
      undoStack.current.push(prev);
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
    }
    redoStack.current = []; // any new edit invalidates the redo stack
    lastSnapAt.current = now;
    lastSnapCoalesced.current = coalesce;
  }, []);

  const reset = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    lastSnapCoalesced.current = false;
  }, []);

  const undo = useCallback(() => {
    if (!live.current.canEdit()) return;
    const cur = live.current.currentTree();
    if (!cur || undoStack.current.length === 0) return;
    const prev = undoStack.current.pop()!;
    redoStack.current.push(cur);
    lastSnapCoalesced.current = false;
    apply(prev);
  }, [apply]);

  const redo = useCallback(() => {
    if (!live.current.canEdit()) return;
    const cur = live.current.currentTree();
    if (!cur || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(cur);
    lastSnapCoalesced.current = false;
    apply(next);
  }, [apply]);

  const canUndo = useCallback(() => undoStack.current.length > 0, []);
  const canRedo = useCallback(() => redoStack.current.length > 0, []);

  return { snapshot, reset, undo, redo, canUndo, canRedo };
}
