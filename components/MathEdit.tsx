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
  addGridRow,
  backspace,
  del,
  findRow,
  initialCursor,
  insertSnippet,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
  removeGridRow,
  typeChar,
} from "@/lib/matheditor";
import { inTextRun, typeText } from "@/lib/matheditor/ops";
import { renderMathTree } from "@/lib/matheditor/render";

export interface MathEditHandle {
  insert: (latex: string) => void;
  focus: () => void;
  /** Switch between maths and words (`\text{…}`) at the caret. */
  toggleText: () => void;
  /** Put the caret on the part of the formula at these fractions of its box. */
  placeAt: (relX: number, relY: number) => void;
}

// ── Active-field registry (mirrors components/MathField activeMathField) ───────
/** Mounted editors, by their hidden input. */
const editors = new Map<Element, MathEditHandle>();
/**
 * The structural editor holding the caret, or null: whichever mounted editor's
 * input has focus right now. Read from live focus rather than remembered from a
 * focus event, because a remembered handle goes stale — an editor that unmounts
 * while focused (Enter out of an equation) fires no blur, and its leftover
 * handle won every toolbar insert, so a symbol clicked while typing in a
 * formula box elsewhere landed in the equation the writer had already left.
 */
export function activeMathEdit(): MathEditHandle | null {
  const el = typeof document === "undefined" ? null : document.activeElement;
  return (el && editors.get(el)) ?? null;
}

export interface MathEditProps {
  /** The math block being edited (must be a structural `math` block). */
  block: Block;
  /** Called with the new block on every edit. */
  onChange: (block: Block) => void;
  /** Escape pressed. */
  onExit?: () => void;
  /** Enter outside a grid: the formula is finished, go to the next line. */
  onEnter?: () => void;
  autoFocus?: boolean;
  /** With autoFocus: open with the caret where the rendered formula was
   *  pressed, as fractions of its box (lib/editor/caret → formulaPointAt). */
  initialPoint?: { relX: number; relY: number } | null;
  className?: string;
}

export const MathEdit = forwardRef<MathEditHandle, MathEditProps>(function MathEdit(
  { block, onChange, onExit, onEnter, autoFocus, initialPoint, className },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The caret opens in the first empty slot — for a formula created from a
  // template (a matrix, a `cases`) that is the first cell, not the space before
  // the whole structure, where the first keystroke would land beside it.
  const [state, setState] = useState<EditState>(() => ({ tree: block, cursor: initialCursor(block) }));
  // Re-seed only when switching to a different formula (id changes), so external
  // re-renders of the same block don't clobber the live cursor.
  const seededId = useRef(block.id);
  useEffect(() => {
    if (seededId.current !== block.id) {
      seededId.current = block.id;
      setState({ tree: block, cursor: initialCursor(block) });
    }
  }, [block]);

  const stateRef = useRef(state);
  stateRef.current = state;
  // Words mode (`\text{…}`): typing `"`, or the strip's Text button, switches
  // between maths and words; in words mode every key typed is a character of
  // the words, spaces included. Moving the caret into the middle of existing
  // words turns it on, and out of them turns it off.
  const [textMode, setTextMode] = useState(false);
  const textModeRef = useRef(textMode);
  textModeRef.current = textMode;

  /** Apply a tree-mutating op: update state + commit the new tree upward. */
  function apply(op: (s: EditState) => EditState) {
    const next = op(stateRef.current);
    setState(next);
    if (next.tree !== stateRef.current.tree) onChange(next.tree);
  }
  /** Caret-only move: update cursor, no commit. */
  function moveCursor(fn: (tree: Block, c: Cursor) => Cursor) {
    const s = stateRef.current;
    const cursor = fn(s.tree, s.cursor);
    setState({ ...s, cursor });
    setTextMode(inTextRun(s.tree, cursor));
  }

  const handle = useRef<MathEditHandle>({
    insert: (latex) => apply((s) => insertSnippet(s.tree, s.cursor, latex)),
    focus: () => inputRef.current?.focus(),
    toggleText: () => {
      setTextMode((t) => !t);
      inputRef.current?.focus();
    },
    placeAt: (relX, relY) => placeAt(relX, relY),
  });

  /**
   * Put the caret on the part of the formula at these fractions of its box: the
   * innermost row cell nearest that point (a press between two cells of a
   * fraction's numerator lands in the numerator, not beside the fraction), and
   * before or after it by which half the point falls in.
   */
  function placeAt(relX: number, relY: number) {
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const x = box.left + clamp(relX) * box.width;
    const y = box.top + clamp(relY) * box.height;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    root.querySelectorAll<HTMLElement>(".me-cell[data-row-owner], .me-empty[data-row-owner]").forEach((cell) => {
      const r = cell.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      // Distance first; among cells the point is inside, the smallest (innermost).
      const score = (dx * dx + dy * dy) * 1e6 + r.width * r.height;
      if (score < bestScore) { bestScore = score; best = cell; }
    });
    const cell = best as HTMLElement | null;
    inputRef.current?.focus();
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    const i = Number(cell.dataset.index ?? 0);
    const index = cell.classList.contains("me-empty") ? 0 : x > r.left + r.width / 2 ? i + 1 : i;
    const cursor = { rowOwnerId: cell.dataset.rowOwner!, slot: cell.dataset.slot!, index };
    setState((s) => ({ ...s, cursor }));
    setTextMode(inTextRun(stateRef.current.tree, cursor));
  }
  useImperativeHandle(ref, () => handle.current, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  // Opened by a press on the rendered formula: the caret goes where it landed,
  // once this editor has laid the formula out.
  const initialPointRef = useRef(initialPoint);
  useEffect(() => {
    const at = initialPointRef.current;
    if (!autoFocus || !at) return;
    const frame = requestAnimationFrame(() => placeAt(at.relX, at.relY));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Registered for as long as it is mounted; `activeMathEdit` asks focus which
  // one is live. A mount-scoped pair also survives React's development
  // double-invoke, which a focus-event registration did not (re-focusing an
  // already-focused input fires nothing to register it again).
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    editors.set(input, handle.current);
    return () => { editors.delete(input); };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onExit?.(); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); moveCursor(moveLeft); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); moveCursor(moveRight); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveCursor(moveUp); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveCursor(moveDown); return; }
    if (e.key === "Tab") { e.preventDefault(); moveCursor(e.shiftKey ? moveLeft : moveRight); return; }
    // Inside a grid, Enter adds a row below (a further case of a `cases`) and
    // ⇧Enter takes one away — the only way a system of equations can grow. The
    // ops leave the tree untouched outside a grid, and there a plain Enter ends
    // the equation and starts the next line, as it does after any other line.
    if (e.key === "Enter") {
      e.preventDefault();
      const s = stateRef.current;
      const next = (e.shiftKey ? removeGridRow : addGridRow)(s.tree, s.cursor);
      if (next.tree === s.tree && !e.shiftKey && onEnter) { onEnter(); return; }
      apply(() => next);
      return;
    }
    if (e.key === "Backspace") { e.preventDefault(); apply((s) => backspace(s.tree, s.cursor)); return; }
    if (e.key === "Delete") { e.preventDefault(); apply((s) => del(s.tree, s.cursor)); return; }
    // `"` switches between maths and words, as the strip's Text button does:
    // the way to write "if" or "for all" inside an equation.
    if (e.key === '"' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setTextMode((t) => !t);
      return;
    }
    // A printable character (no modifier) → type it into the formula: a
    // character of words in words mode (spaces included), maths otherwise.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const words = textModeRef.current;
      apply((s) => (words ? typeText : typeChar)(s.tree, s.cursor, e.key));
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
    const cursor = { rowOwnerId, slot, index };
    setState((s) => ({ ...s, cursor }));
    setTextMode(inTextRun(stateRef.current.tree, cursor));
  }

  return (
    <div ref={rootRef} className={`me-field ${textMode ? "me-textmode" : ""} ${className ?? ""}`} onMouseDown={onMouseDown}>
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
      />
    </div>
  );
});
