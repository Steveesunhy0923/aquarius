"use client";

/**
 * DocumentInspector — document-wide settings, in a panel beside the page
 * instead of a strip above it.
 *
 * These are set-once-then-tune settings (typeface, leading, indent, zoom), and
 * you tune them while watching the page reflow. A horizontal bar above the
 * canvas gave them the same permanent altitude as Bold — a per-keystroke
 * action — while pushing the document itself down the screen. A side panel
 * keeps the control and its effect in view at the same time, which is the one
 * thing the strip could not do.
 *
 * Block-level properties (figure placement, table style) deliberately still
 * live next to their block; only document-wide state moved here.
 */

import { Icon } from "@/components/Icon";
import {
  FONTS,
  INDENTS,
  LINE_SPACINGS,
  fontSizeOptions,
  numLabel,
  optionsWith,
  presetPatch,
} from "@/lib/blocks/docstyle";
import { CLOSE_BTN, EYEBROW, SELECT } from "@/components/ui/primitives";
import type { DocPreset, DocumentStyle } from "@/lib/blocks/types";
import type { ReactNode } from "react";

/** One labelled control. The label is the field's accessible name via <label>. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className={EYEBROW}>{label}</span>
      {children}
    </label>
  );
}

export function DocumentInspector({
  preset,
  fontKey,
  fontFamily,
  fontSize,
  lineSpacing,
  indent,
  layout,
  zoom,
  showSource,
  canEditStyle,
  onStyle,
  onZoom,
  onToggleSource,
  onClose,
  overlay,
}: {
  preset: DocPreset;
  fontKey: string;
  fontFamily: string;
  fontSize: number;
  lineSpacing: number;
  indent: number;
  layout: "vertical" | "horizontal";
  zoom: number;
  showSource: boolean;
  /** False for a viewer/commenter: zoom and the source view still work, the rest is frozen. */
  canEditStyle: boolean;
  onStyle: (patch: Partial<DocumentStyle>) => void;
  onZoom: (z: number) => void;
  onToggleSource: () => void;
  onClose: () => void;
  /** Narrow pane: float over the canvas instead of taking a column from it.
   *  Below ~1024px the column left too little room for an A4 page and the
   *  document got clipped, which is a worse trade than covering part of it. */
  overlay?: boolean;
}) {
  return (
    <aside
      aria-label="Document settings"
      className={`print-hide flex w-60 flex-col border-l border-border bg-surface ${
        overlay ? "absolute inset-y-0 right-0 z-30 shadow-2xl" : "shrink-0"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="flex-1 text-sm font-semibold">Document</span>
        <button onClick={onClose} title="Hide document settings" aria-label="Hide document settings" className={CLOSE_BTN}>
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid gap-3.5">
          {canEditStyle && (
            <>
              {/* Switches the whole bundle (font, size, leading, indent), not just a
                  flag — a preset the page does not actually look like is worse than
                  no preset at all. */}
              <Row label="Preset">
                <select
                  value={preset}
                  onChange={(e) => onStyle(presetPatch(e.target.value as DocPreset))}
                  className={SELECT}
                  title="LaTeX: article at 11pt, justified, indented paragraphs. Plain: ragged right, no indent, gaps between paragraphs."
                >
                  <option value="latex">LaTeX — article, 11pt</option>
                  <option value="plain">Plain</option>
                </select>
              </Row>

              <Row label="Typeface">
                <select value={fontKey} onChange={(e) => onStyle({ fontFamily: e.target.value })} className={SELECT} style={{ fontFamily }}>
                  {Object.keys(FONTS).map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Row>

              <div className="grid grid-cols-2 gap-2.5">
                <Row label="Size">
                  <select value={fontSize} onChange={(e) => onStyle({ fontSize: Number(e.target.value) })} className={SELECT}>
                    {fontSizeOptions(fontSize).map((s) => <option key={s.px} value={s.px}>{s.label}</option>)}
                  </select>
                </Row>
                <Row label="Leading">
                  <select value={lineSpacing} onChange={(e) => onStyle({ lineSpacing: Number(e.target.value) })} className={SELECT}>
                    {optionsWith(LINE_SPACINGS, lineSpacing).map((s) => <option key={s} value={s}>{numLabel(s)}</option>)}
                  </select>
                </Row>
              </div>

              <Row label="Indent">
                <select value={indent} onChange={(e) => onStyle({ indent: Number(e.target.value) })} className={SELECT}>
                  {optionsWith(INDENTS, indent).map((s) => <option key={s} value={s}>{s === 0 ? "none" : `${numLabel(s)}em`}</option>)}
                </select>
              </Row>

              <div className="grid gap-1.5">
                <span className={EYEBROW}>Page flow</span>
                <div className="inline-flex overflow-hidden rounded-control border border-border text-sm" role="group" aria-label="Page flow">
                  <button onClick={() => onStyle({ pageLayout: "vertical" })} aria-pressed={layout === "vertical"} className={`flex-1 px-2 py-1 ${layout === "vertical" ? "bg-accent-soft text-accent" : "text-muted hover:bg-foreground/[0.05]"}`}>Vertical</button>
                  <button onClick={() => onStyle({ pageLayout: "horizontal" })} aria-pressed={layout === "horizontal"} className={`flex-1 px-2 py-1 ${layout === "horizontal" ? "bg-accent-soft text-accent" : "text-muted hover:bg-foreground/[0.05]"}`}>Horizontal</button>
                </div>
              </div>
            </>
          )}

          <Row label={`Zoom — ${Math.round(zoom * 100)}%`}>
            <input type="range" min={0.6} max={1.4} step={0.05} value={zoom} onChange={(e) => onZoom(Number(e.target.value))} className="w-full accent-accent" />
          </Row>

          <div className="grid gap-1.5 border-t border-border-soft pt-3">
            <span className={EYEBROW}>View</span>
            <button
              onClick={onToggleSource}
              aria-pressed={showSource}
              className={`flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-left text-sm transition ${
                showSource ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:bg-foreground/[0.04]"
              }`}
            >
              <Icon name="tex" size={17} />
              {showSource ? "Back to the editor" : "LaTeX source"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
