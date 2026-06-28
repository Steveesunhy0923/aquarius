/**
 * MathEdit — the React shell for the structural math editor.
 *
 * Owns the `{ tree, cursor }` state (seeded from the edited math block), renders
 * it via the pure renderer, and turns key/click events into pure ops. Commits
 * the BLOCK TREE directly to the parent via `onChange(block)` — no LaTeX string,
 * so export/print/collab need no changes. A hidden input holds keyboard focus
 * (and brings up the native keyboard on touch; the toolbar is the primary input).
 *
 * Registers as the active field (`activeMathEdit()`) so the existing toolbar /
 * SymbolPicker `onInsert` can route structural inserts here.
 */

"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

import type { Block } from "@/lib/blocks/types";
import {
  type Cursor,
  type EditState,
  backspace,
  del,
  findRow,
  insertSnippet,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
  typeChar,
} from "@/lib/matheditor";
import { renderMathTree } from "@/lib/matheditor/render";

export interface MathEditHandle {
  insert: (latex: string) => void;
  focus: () => void;
}

// ── Active-field registry (mirrors components/MathField activeMathField) ───────
let active: MathEditHandle | null = null;
export function activeMathEdit(): MathEditHandle | null {
  return active;
}

export interface MathEditProps {
  /** The math block being edited (must be a structural `math` block). */
  block: Block;
  /** Called with the new block on every edit. */
  onChange: (block: Block) => void;
  /** Escape pressed. */
  onExit?: () => void;
  autoFocus?: boolean;
  className?: string;
}

export const MathEdit = forwardRef<MathEditHandle, MathEditProps>(function MathEdit(
  { block, onChange, onExit, autoFocus, className },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<EditState>(() => ({
    tree: block,
    cursor: { rowOwnerId: block.id, slot: "body", index: 0 },
  }));
  // Re-seed only when switching to a different formula (id changes), so external
  // re-renders of the same block don't clobber the live cursor.
  const seededId = useRef(block.id);
  useEffect(() => {
    if (seededId.current !== block.id) {
      seededId.current = block.id;
      setState({ tree: block, cursor: { rowOwnerId: block.id, slot: "body", index: 0 } });
    }
  }, [block]);

  const stateRef = useRef(state);
  stateRef.current = state;

  /** Apply a tree-mutating op: update state + commit the new tree upward. */
  function apply(op: (s: EditState) => EditState) {
    const next = op(stateRef.current);
    setState(next);
    if (next.tree !== stateRef.current.tree) onChange(next.tree);
  }
  /** Caret-only move: update cursor, no commit. */
  function moveCursor(fn: (tree: Block, c: Cursor) => Cursor) {
    setState((s) => ({ ...s, cursor: fn(s.tree, s.cursor) }));
  }

  const handle = useRef<MathEditHandle>({
    insert: (latex) => apply((s) => insertSnippet(s.tree, s.cursor, latex)),
    focus: () => inputRef.current?.focus(),
  });
  useImperativeHandle(ref, () => handle.current, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onExit?.(); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); moveCursor(moveLeft); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); moveCursor(moveRight); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveCursor(moveUp); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveCursor(moveDown); return; }
    if (e.key === "Tab") { e.preventDefault(); moveCursor(e.shiftKey ? moveLeft : moveRight); return; }
    if (e.key === "Backspace") { e.preventDefault(); apply((s) => backspace(s.tree, s.cursor)); return; }
    if (e.key === "Delete") { e.preventDefault(); apply((s) => del(s.tree, s.cursor)); return; }
    // A printable character (no modifier) → type it into the formula.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      apply((s) => typeChar(s.tree, s.cursor, e.key));
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault(); // keep focus on the hidden input
    inputRef.current?.focus();
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-row-owner]");
    if (!el) return;
    const rowOwnerId = el.getAttribute("data-row-owner")!;
    const slot = el.getAttribute("data-slot")!;
    const idxAttr = el.getAttribute("data-index");
    let index: number;
    if (idxAttr != null) {
      const rect = el.getBoundingClientRect();
      const i = Number(idxAttr);
      index = e.clientX > rect.left + rect.width / 2 ? i + 1 : i; // before/after this cell
    } else {
      // Clicked the slot's whitespace → place caret at the row end.
      index = findRow(stateRef.current.tree, rowOwnerId, slot)?.length ?? 0;
    }
    setState((s) => ({ ...s, cursor: { rowOwnerId, slot, index } }));
  }

  return (
    <div className={`me-field ${className ?? ""}`} onMouseDown={onMouseDown}>
      {renderMathTree(state.tree, state.cursor)}
      <input
        ref={inputRef}
        className="me-hidden-input"
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Formula editor"
        onKeyDown={onKeyDown}
        onFocus={() => { active = handle.current; }}
        onBlur={() => { if (active === handle.current) active = null; }}
      />
    </div>
  );
});
