"use client";

import type { PeerInfo } from "@/lib/collab/presence";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

/**
 * Live collaborator cursor overlay. For every remote peer with a broadcast
 * caret/selection, this draws a colored caret bar + a name flag (Google-Docs
 * style) at their position inside the block they're editing, plus a translucent
 * highlight for any selected range.
 *
 * Positions are measured from the rendered DOM (getBoundingClientRect over the
 * block's text nodes) and drawn in a fixed, pointer-events-none layer, so they
 * float correctly over the note as it scrolls. Because a peer's caret index is
 * an offset into the block's *source* text while we measure the *rendered*
 * text, positions are exact for plain prose and approximate where markup
 * differs; non-text blocks (formulas, tables, images) anchor the caret at the
 * block's leading edge (`measurable: false`).
 */

export interface RemoteCursor {
  peer: PeerInfo;
  blockId: string;
  start: number;
  end: number;
  /** Walk text nodes for a precise caret (prose/headings) vs. anchor at block start. */
  measurable: boolean;
}

interface Placement {
  key: string;
  color: string;
  name: string;
  caret: { left: number; top: number; height: number };
  rects: Array<{ left: number; top: number; width: number; height: number }>;
}

/** Find the text node + offset for a character index within `el` (clamped to the end). */
function locate(el: HTMLElement, index: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = index;
  let node = walker.nextNode() as Text | null;
  let last: Text | null = null;
  while (node) {
    const len = node.data.length;
    if (remaining <= len) return { node, offset: Math.max(0, remaining) };
    remaining -= len;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  return last ? { node: last, offset: last.data.length } : null;
}

function measure(el: HTMLElement, c: RemoteCursor): Omit<Placement, "key" | "color" | "name"> {
  const fallback = () => {
    const r = el.getBoundingClientRect();
    return { caret: { left: r.left + 2, top: r.top + 3, height: Math.min(r.height - 6, 22) || 18 }, rects: [] };
  };
  if (!c.measurable) return fallback();
  const s = locate(el, c.start);
  if (!s) return fallback();
  const caretRange = document.createRange();
  caretRange.setStart(s.node, s.offset);
  caretRange.collapse(true);
  const cr = caretRange.getBoundingClientRect();
  const lineH = parseFloat(getComputedStyle(el).lineHeight) || 18;
  // A collapsed range at a node boundary can report a zero rect — fall back.
  if (cr.height === 0 && cr.top === 0 && cr.left === 0) return fallback();
  const caret = { left: cr.left, top: cr.top, height: cr.height || lineH };
  let rects: Placement["rects"] = [];
  if (c.end > c.start) {
    const e = locate(el, c.end) ?? s;
    const sel = document.createRange();
    sel.setStart(s.node, s.offset);
    sel.setEnd(e.node, e.offset);
    rects = Array.from(sel.getClientRects()).map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }));
  }
  return { caret, rects };
}

export function CollabCursors({
  cursors,
  blockEls,
}: {
  cursors: RemoteCursor[];
  blockEls: MutableRefObject<Map<string, HTMLElement>>;
}) {
  const [placements, setPlacements] = useState<Placement[]>([]);
  const rafRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const next: Placement[] = [];
    for (const c of cursors) {
      const el = blockEls.current.get(c.blockId);
      if (!el) continue;
      const m = measure(el, c);
      next.push({ key: c.peer.userId, color: c.peer.color, name: c.peer.username, ...m });
    }
    setPlacements(next);
  }, [cursors, blockEls]);

  // Recompute on cursor changes (next paint), on scroll/resize, and on a low-
  // frequency tick to catch reflow from remote edits we don't otherwise observe.
  useEffect(() => {
    const schedule = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recompute);
    };
    schedule();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const interval = setInterval(schedule, 500);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      clearInterval(interval);
    };
  }, [recompute]);

  if (placements.length === 0) return null;

  return (
    <div className="print-hide pointer-events-none fixed inset-0 z-40">
      {placements.map((p) => (
        <div key={p.key}>
          {p.rects.map((r, i) => (
            <div key={i} className="fixed" style={{ left: r.left, top: r.top, width: r.width, height: r.height, backgroundColor: p.color, opacity: 0.22, borderRadius: 2 }} />
          ))}
          <div className="fixed" style={{ left: p.caret.left, top: p.caret.top, width: 2, height: p.caret.height, backgroundColor: p.color }} />
          <div
            className="fixed whitespace-nowrap rounded rounded-bl-none px-1.5 py-0.5 text-[10px] font-medium leading-none text-white shadow"
            style={{ left: p.caret.left, top: p.caret.top - 15, backgroundColor: p.color, transform: "translateY(0)" }}
          >
            {p.name}
          </div>
        </div>
      ))}
    </div>
  );
}
