"use client";

/**
 * Shared toolbar button styling, plus the one widget that carries its own state
 * shape: the highlight split (apply + colour dropdown).
 *
 * The buttons are deliberately borderless. Block inserts now live behind the
 * labelled "Insert" menu rather than a row of glyphs, so what remains on the
 * bar is the small always-visible set, banded into groups (GROUP) instead of
 * separated by per-button outlines.
 */

import { Icon } from "@/components/Icon";
import { HIGHLIGHT_COLORS } from "@/lib/blocks/format";
import type { MouseEvent } from "react";

/** Shared sizing so every toolbar icon button is about the same size.
 *  Borderless by design: a bordered icon button is fine alone, but a strip of
 *  twenty turns into a wall of competing rectangles with no ranking between
 *  them. The affordance moves to a hover well, which only the button under the
 *  pointer pays for. */
export const ICON_BTN =
  "grid h-9 min-w-9 place-items-center rounded-md px-2 text-sm transition hover:bg-foreground/[0.06]";
/** Icon button that sits inside a grouped well (see GROUP) — slightly tighter. */
export const GROUP_BTN =
  "grid h-8 min-w-8 place-items-center rounded px-1.5 text-sm transition hover:bg-surface hover:shadow-sm";
/** A related run of buttons, banded together on a faint well instead of borders. */
export const GROUP = "flex items-center gap-0.5 rounded-lg bg-foreground/[0.04] p-1";
/** Toolbar button that keeps a word label (the rare/ambiguous actions). */
export const TEXT_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted transition hover:bg-foreground/[0.06] hover:text-foreground";

/** Borderless icon button for the top bar (drawn glyphs, not word labels).
 *  `_BASE` is layout + resting/disabled color only; `HEAD_BTN` adds the hover
 *  state. A toggle that has its own active style composes from `_BASE` so it
 *  never carries two competing `hover:` utilities (Tailwind picks the winner by
 *  emission order, which would be fragile). */
export const HEAD_BTN_BASE =
  "grid h-9 w-9 place-items-center rounded-md transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted";
export const HEAD_BTN_HOVER = "text-muted hover:bg-foreground/[0.06] hover:text-foreground";
export const HEAD_BTN = `${HEAD_BTN_BASE} ${HEAD_BTN_HOVER}`;

// ─── Highlight button (marker icon + color dropdown) ─────────────────────────
export function HighlightButton({ color, open, onToggle, onApply, onColor, keepFocus, onColorMouseDown }: {
  color: string;
  open: boolean;
  onToggle: () => void;
  onApply: () => void;
  onColor: (c: string) => void;
  keepFocus: (e: MouseEvent) => void;
  onColorMouseDown: () => void;
}) {
  return (
    <span className="relative inline-flex">
      {/* The swatch IS the button's background, so the current colour needs no
          separate chip; the chevron only opens the palette. */}
      <button onMouseDown={keepFocus} onClick={onApply} title="Highlight selection" aria-label="Highlight selection" className="relative z-30 grid h-8 w-8 place-items-center rounded-l transition hover:brightness-95" style={{ background: color, color: "#1f2937" }}><Icon name="highlight" size={15} /></button>
      <button onMouseDown={keepFocus} onClick={onToggle} title="Highlight colour" aria-label="Highlight colour" aria-expanded={open} className={`relative z-30 grid h-8 w-4 place-items-center rounded-r transition ${open ? "bg-accent-soft text-accent" : "text-muted hover:bg-foreground/[0.06]"}`}><Icon name="chevron" size={10} /></button>
      {open && (
        <>
          <button className="fixed inset-0 z-20 cursor-default" aria-hidden tabIndex={-1} onClick={onToggle} />
          <div className="absolute left-0 top-full z-30 mt-1 rounded-md border border-border bg-surface p-2 shadow-lg">
            <div className="grid grid-cols-4 gap-1">
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} onMouseDown={keepFocus} onClick={() => { onColor(c); onToggle(); }} title={c} className="h-6 w-6 rounded" style={{ background: c, outline: color.toLowerCase() === c ? "2px solid var(--foreground)" : "1px solid rgba(0,0,0,.12)", outlineOffset: "1px" }} />
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              Custom
              {/* sticky-only (no preventDefault) so the native color picker still opens while editing */}
              <input type="color" value={color} onMouseDown={onColorMouseDown} onChange={(e) => onColor(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5" />
            </label>
          </div>
        </>
      )}
    </span>
  );
}
