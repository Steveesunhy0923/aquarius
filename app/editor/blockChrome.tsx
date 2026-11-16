"use client";

/**
 * Small, state-free pieces of a block's chrome, split out of DocumentEditor:
 * how a heading is drawn and tuned, and whether an equation can be plotted.
 * Nothing here knows about the editor's state — each takes a block and
 * callbacks — which is what makes them safe to keep apart from it.
 */

import { blockToKatex } from "@/lib/blocks";
import { isChemBlock } from "@/lib/blocks/chem";
import { HEADING_NAMES, headingAlign, headingLevel, headingNumbered } from "@/lib/blocks/headings";
import type { ImageAlign } from "@/lib/blocks/images";
import { latexToExpr } from "@/lib/blocks/latex-expr";
import type { Block } from "@/lib/blocks/types";

/** The plottable `y = f(x)` expression for a display-math block, or null when
 *  it isn't a single-variable function (chem blocks and non-math never plot). */
export function plottableExpr(b: Block): string | null {
  if (b.type !== "math" || isChemBlock(b)) return null;
  try {
    return latexToExpr(blockToKatex(b))?.expr ?? null;
  } catch {
    return null;
  }
}

/** A heading's type, shared by the rendered heading and the input that edits it
 *  — the point of editing in place is that they are the same size and weight. */
export function headingClass(block: Block): string {
  const lvl = headingLevel(block);
  return lvl === 1 ? "text-2xl font-bold" : lvl === 2 ? "text-xl font-semibold" : lvl === 3 ? "text-lg font-semibold" : "text-base font-semibold";
}

/** Alignment and numbering for the heading being edited: a strip that appears
 *  on hover, floating clear of the text instead of pushing it down. */
export function HeadingBar({ block, onAlign, onNumbered }: {
  block: Block;
  onAlign: (a: ImageAlign) => void;
  onNumbered: (v: boolean) => void;
}) {
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <div className="print-hide absolute -top-7 right-0 z-20 hidden items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted shadow-sm group-hover/edit:flex">
      <span className="mr-0.5">{HEADING_NAMES[headingLevel(block)]}</span>
      {headingLevel(block) !== 1 && (["left", "center", "right"] as ImageAlign[]).map((a) => (
        <button key={a} onMouseDown={keep} onClick={() => onAlign(a)} title={`Align ${a}`} className={`rounded px-1 capitalize ${headingAlign(block) === a ? "text-accent" : "hover:text-foreground"}`}>{a}</button>
      ))}
      <label className="ml-1 flex items-center gap-1" onMouseDown={keep}>
        <input type="checkbox" checked={headingNumbered(block)} onChange={(e) => onNumbered(e.target.checked)} /> numbered
      </label>
    </div>
  );
}

export function HeadingDisplay({ block, number }: { block: Block; number?: string }) {
  const lvl = headingLevel(block);
  const cls = headingClass(block);
  const text = block.value || "\u00A0"; // a blank heading is a blank line, not a label
  // `aq-heading` + the level: under the LaTeX preset these absolute sizes are
  // restated as \Large / \large / \normalsize of the body (app/globals.css).
  return <div className={`aq-heading ${cls}`} data-level={lvl} style={{ textAlign: headingAlign(block) }}>{number ? `${number} ` : ""}{text}</div>;
}
