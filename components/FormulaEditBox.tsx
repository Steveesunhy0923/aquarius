"use client";

import { ChemField } from "@/components/ChemField";
import { Icon } from "@/components/Icon";
import { MathEdit, type MathEditHandle } from "@/components/MathEdit";
import { MathField, type GridContext, type MathFieldHandle } from "@/components/MathField";
import { isCasesEnv } from "@/lib/blocks/mathenv";
import { pointInBox, type FormulaPoint } from "@/lib/editor/caret";
import type { Block } from "@/lib/blocks/types";
import { useRef, useState } from "react";

/**
 * GridBar — the controls for the grid the caret is inside, shown only while it
 * is inside one.
 *
 * Enter/Space add a row/column and Shift takes one away, which is quick once
 * known and invisible until then. This is the same commands with a face: it
 * says what the keys are (in the tooltips), reports the shape you are editing,
 * and gives the mouse a way in. Removing is where it earns its place — adding a
 * row by accident is easy, and hunting for the gesture that undoes it is
 * exactly the moment a matrix stops feeling smooth.
 *
 * A `cases` environment gets a different bar, because it is not a matrix: its
 * two columns ARE the notation (a value and the condition it holds under), so
 * only its cases grow, and calling them "2 × 2" invited people to edit a
 * piecewise definition as if it were a 2×2 matrix.
 */
function GridBar({ grid, run }: { grid: GridContext; run: (cmd: "addRowAfter" | "removeRow" | "addColumnAfter" | "removeColumn") => void }) {
  const btn = "inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent";
  // Keep focus in the field: these are edits to the formula being typed, not a
  // reason to end the edit session.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const cases = isCasesEnv(grid.env);
  return (
    <div className="mt-1.5 flex items-center gap-1 border-t border-border-soft px-0.5 pt-1.5">
      <span className="mr-1 text-[10px] uppercase tracking-[0.09em] text-faint">
        {cases ? `${grid.rows} ${grid.rows === 1 ? "case" : "cases"}` : `${grid.rows} × ${grid.cols}`}
      </span>
      <button onMouseDown={keep} onClick={() => run("addRowAfter")} title={cases ? "Add a case below (Enter)" : "Add a row below (Enter)"} className={btn}>
        <Icon name="plus" size={11} /> {cases ? "Case" : "Row"}
      </button>
      <button onMouseDown={keep} onClick={() => run("removeRow")} disabled={grid.rows <= 1} title={grid.rows <= 1 ? `The last ${cases ? "case" : "row"} can't be removed` : `Remove this ${cases ? "case" : "row"} (⇧Enter)`} className={btn}>
        <Icon name="minus" size={11} /> {cases ? "Case" : "Row"}
      </button>
      {!cases && (
        <>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button onMouseDown={keep} onClick={() => run("addColumnAfter")} title="Add a column after this one (Space)" className={btn}>
            <Icon name="plus" size={11} /> Column
          </button>
          <button onMouseDown={keep} onClick={() => run("removeColumn")} disabled={grid.cols <= 1} title={grid.cols <= 1 ? "The last column can't be removed" : "Remove this column (⇧Space)"} className={btn}>
            <Icon name="minus" size={11} /> Column
          </button>
        </>
      )}
      {cases && <span className="ml-1 text-[10px] text-faint">value &amp; condition</span>}
    </div>
  );
}

// ─── Formula editor (Desmos-style structural editor via MathLive) ────────────
// An equation is a LINE of the document, so it is edited where it sits: the
// MathField replaces the rendered formula in place, with no border, no surface
// and no panel around it, centred as the rendered equation is (`aq-display-edit`
// in app/globals.css). The field is the WYSIWYG view, so there is no separate
// KaTeX preview either. Enter starts the next line; leaving is otherwise
// explicit (Escape, or pressing another line) — nothing here exits on blur.
export function FormulaEditBox({
  draft, onChange, onExit, onEnter, initialPoint,
}: {
  draft: string;
  onChange: (text: string, caret: number) => void;
  onExit: () => void;
  onEnter?: () => void;
  /** Where the rendered formula was pressed: the caret opens there. */
  initialPoint?: FormulaPoint | null;
}) {
  const fieldRef = useRef<MathFieldHandle>(null);
  const [grid, setGrid] = useState<GridContext | null>(null);
  return (
    <div>
      {/* The field shrinks to its formula, so a press on the rest of the line
          lands the caret at the formula's nearer end. */}
      <div
        className="aq-display-edit cursor-text"
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          const field = e.currentTarget.querySelector("math-field");
          if (!field) { fieldRef.current?.focus(); return; }
          const at = pointInBox(field.getBoundingClientRect(), e.clientX, e.clientY);
          fieldRef.current?.placeAt(at.relX, at.relY);
        }}
      >
        <MathField ref={fieldRef} value={draft} onChange={(latex) => onChange(latex, 0)} onExit={onExit} onEnter={onEnter} onGridChange={setGrid} autoFocus initialPoint={initialPoint} className="inline-block" />
      </div>
      {grid && (
        <GridBar
          grid={grid}
          run={(cmd) => {
            fieldRef.current?.command(cmd);
            fieldRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

// ─── Chemistry editor — the chemistry mirror of FormulaEditBox. ──────────────
// `draft` is the mhchem source (the inside of \ce{...}); the page wraps it back
// into \ce on commit. Edited in place, like every other line.
export function ChemFormulaBox({
  draft, onChange, onExit, onEnter,
}: {
  draft: string;
  onChange: (src: string, caret: number) => void;
  onExit: () => void;
  onEnter?: () => void;
}) {
  return <ChemField value={draft} onChange={(src) => onChange(src, 0)} onExit={onExit} onEnter={onEnter} autoFocus display />;
}

// ─── Structural formula editor (beta) — the block-tree editor, in place. ─────
export function StructuralFormulaBox({
  block, onChange, onExit, onEnter, initialPoint,
}: {
  block: Block;
  onChange: (b: Block) => void;
  onExit: () => void;
  onEnter?: () => void;
  /** Where the rendered formula was pressed: the caret opens there. */
  initialPoint?: FormulaPoint | null;
}) {
  const editRef = useRef<MathEditHandle>(null);
  return (
    <div
      className="aq-display-edit cursor-text"
      onMouseDown={(e) => {
        // The line beside the formula: the caret goes to its nearer end.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        const field = e.currentTarget.querySelector(".me-field");
        if (!field) { editRef.current?.focus(); return; }
        const at = pointInBox(field.getBoundingClientRect(), e.clientX, e.clientY);
        editRef.current?.placeAt(at.relX, at.relY);
      }}
    >
      <MathEdit ref={editRef} block={block} onChange={onChange} onExit={onExit} onEnter={onEnter} autoFocus initialPoint={initialPoint} />
    </div>
  );
}
