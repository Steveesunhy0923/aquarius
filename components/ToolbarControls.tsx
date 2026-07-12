"use client";

/**
 * Toolbar button widgets shared by the editor's block-tools strip: the plain
 * bordered ToolButton, the split list buttons (insert + style dropdown), and
 * the highlight button (apply + color dropdown). Stateless — dropdown open
 * state is lifted to the caller.
 */

import { Icon, type IconName } from "@/components/Icon";
import { HIGHLIGHT_COLORS } from "@/lib/blocks/format";
import { BULLET_MARKERS, NUMBER_MARKERS, type ListMarker } from "@/lib/blocks/lists";
import type { MouseEvent, ReactNode } from "react";

/** Shared sizing so every toolbar icon button is about the same size. */
export const ICON_BTN =
  "grid h-9 min-w-9 place-items-center rounded-md border border-border px-2 text-sm hover:border-accent";

/** Borderless icon button for the top bar (drawn glyphs, not word labels).
 *  `_BASE` is layout + resting/disabled color only; `HEAD_BTN` adds the hover
 *  state. A toggle that has its own active style composes from `_BASE` so it
 *  never carries two competing `hover:` utilities (Tailwind picks the winner by
 *  emission order, which would be fragile). */
export const HEAD_BTN_BASE =
  "grid h-9 w-9 place-items-center rounded-md transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted";
export const HEAD_BTN_HOVER = "text-muted hover:bg-foreground/[0.06] hover:text-foreground";
export const HEAD_BTN = `${HEAD_BTN_BASE} ${HEAD_BTN_HOVER}`;

export function ToolButton({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  // The glyph is aria-hidden, so an icon-only button needs its own name; use
  // the tooltip text rather than leaning on the weak title-as-name fallback.
  return <button onClick={onClick} title={title} aria-label={title} className={ICON_BTN}>{children}</button>;
}

// ─── List buttons (icon + style-dropdown) ────────────────────────────────────
// Bullet markers preview as drawn glyphs; text markers stay literal text.
const MARKER_ICON: Partial<Record<ListMarker, IconName>> = {
  disc: "markerdisc", circle: "markercircle", square: "markersquare",
};
const MARKER_TEXT: Partial<Record<ListMarker, string>> = {
  decimal: "1.", "lower-alpha": "a.", "lower-roman": "i.",
};
const MARKER_NAME: Record<ListMarker, string> = {
  disc: "Disc", circle: "Circle", square: "Square",
  decimal: "Decimal", "lower-alpha": "Lower alpha", "lower-roman": "Lower roman",
};

export function ListToolButton({ ordered, open, onToggle, onInsert }: {
  ordered: boolean;
  open: boolean;
  onToggle: () => void;
  onInsert: (marker?: ListMarker) => void;
}) {
  const markers = ordered ? NUMBER_MARKERS : BULLET_MARKERS;
  return (
    <span className="relative inline-flex">
      <button onClick={() => onInsert()} title={ordered ? "Numbered list" : "Bulleted list"} aria-label={ordered ? "Numbered list" : "Bulleted list"} className="relative z-30 grid h-9 w-9 place-items-center rounded-l-md border border-border hover:border-accent">
        <Icon name={ordered ? "listnumber" : "list"} size={16} />
      </button>
      <button onClick={onToggle} title="List style" aria-label="List style" aria-expanded={open} className={`relative z-30 grid h-9 w-5 place-items-center rounded-r-md border border-l-0 hover:border-accent ${open ? "border-accent text-accent" : "border-border text-muted"}`}><Icon name="chevron" size={11} /></button>
      {open && (
        <>
          <button className="fixed inset-0 z-20 cursor-default" aria-hidden tabIndex={-1} onClick={onToggle} />
          <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-border bg-surface p-1 shadow-lg">
            {markers.map((m) => (
              <button key={m} onClick={() => onInsert(m)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-foreground/[0.06]">
                <span className="inline-grid w-6 place-items-center font-mono text-xs text-muted">
                  {MARKER_ICON[m] ? <Icon name={MARKER_ICON[m]} size={14} /> : MARKER_TEXT[m]}
                </span>
                {MARKER_NAME[m]}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

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
      <button onMouseDown={keepFocus} onClick={onApply} title="Highlight selection" aria-label="Highlight selection" className={`${ICON_BTN} relative z-30 rounded-r-none`} style={{ background: color, color: "#1f2937" }}><Icon name="highlight" size={16} /></button>
      <button onMouseDown={keepFocus} onClick={onToggle} title="Highlight color" aria-label="Highlight color" aria-expanded={open} className={`relative z-30 grid h-9 w-5 place-items-center rounded-r-md border border-l-0 hover:border-accent ${open ? "border-accent text-accent" : "border-border text-muted"}`}><Icon name="chevron" size={11} /></button>
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
