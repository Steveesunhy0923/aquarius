"use client";

import { FONTS, FONT_SIZES, INDENTS, LINE_SPACINGS } from "@/lib/blocks/docstyle";
import type { DocumentStyle } from "@/lib/blocks/types";

/** Document-settings strip: font/size/spacing/indent selects, page-layout toggle, zoom. */
export function DocStyleBar({
  fontKey,
  fontFamily,
  fontSize,
  lineSpacing,
  indent,
  layout,
  zoom,
  onStyle,
  onZoom,
}: {
  fontKey: string;
  fontFamily: string;
  fontSize: number;
  lineSpacing: number;
  indent: number;
  layout: "vertical" | "horizontal";
  zoom: number;
  onStyle: (patch: Partial<DocumentStyle>) => void;
  onZoom: (z: number) => void;
}) {
  return (
    <div className="print-hide flex flex-wrap items-center justify-center gap-3 border-b border-border px-6 py-2 text-xs text-muted">
      <label className="flex items-center gap-1">Font
        <select value={fontKey} onChange={(e) => onStyle({ fontFamily: e.target.value })} className="rounded border border-border bg-background px-1 py-0.5" style={{ fontFamily }}>
          {Object.keys(FONTS).map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1">Size
        <select value={fontSize} onChange={(e) => onStyle({ fontSize: Number(e.target.value) })} className="rounded border border-border bg-background px-1 py-0.5">
          {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1">Spacing
        <select value={lineSpacing} onChange={(e) => onStyle({ lineSpacing: Number(e.target.value) })} className="rounded border border-border bg-background px-1 py-0.5">
          {LINE_SPACINGS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1">Indent
        <select value={indent} onChange={(e) => onStyle({ indent: Number(e.target.value) })} className="rounded border border-border bg-background px-1 py-0.5">
          {INDENTS.map((s) => <option key={s} value={s}>{s === 0 ? "none" : `${s}em`}</option>)}
        </select>
      </label>
      <span className="mx-1 h-4 w-px bg-border" />
      <span>Pages</span>
      <div className="inline-flex overflow-hidden rounded border border-border">
        <button onClick={() => onStyle({ pageLayout: "vertical" })} className={`px-2 py-0.5 ${layout === "vertical" ? "bg-accent text-white" : "hover:bg-foreground/5"}`}>Vertical</button>
        <button onClick={() => onStyle({ pageLayout: "horizontal" })} className={`px-2 py-0.5 ${layout === "horizontal" ? "bg-accent text-white" : "hover:bg-foreground/5"}`}>Horizontal</button>
      </div>
      <span className="mx-1 h-4 w-px bg-border" />
      <label className="flex items-center gap-1" title="Page size">Zoom
        <input type="range" min={0.6} max={1.4} step={0.05} value={zoom} onChange={(e) => onZoom(Number(e.target.value))} className="w-24" />
        <span className="w-9 text-right">{Math.round(zoom * 100)}%</span>
      </label>
    </div>
  );
}
