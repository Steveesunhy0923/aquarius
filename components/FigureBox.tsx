"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { ImageAlign } from "@/lib/blocks/images";
import type { Placement } from "@/lib/blocks/types";

/**
 * A figure block (image / table / graph) is a BOX: width = the text column
 * (`\linewidth`), height = the tallest object. Objects inside are dragged
 * FREELY in 2D — anywhere horizontally, up/down within the box height — with
 * center magnets. On release the full set of positions is committed as
 * `Placement` fractions (see lib/blocks/placement.ts → in-flow LaTeX).
 *
 * Each object is dragged by its whole body (pointer-captured), which is the
 * robustness fix over the old 6px slider handle: a press that doesn't move is a
 * click (select / open); a press that moves repositions. Dropping over another
 * box of the same `group` moves the object into that block.
 */

const SNAP = 8; // px magnet threshold
const GAP = 12; // px default inter-object gap
const MOVE_THRESHOLD = 3; // px before a press becomes a drag

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface FigureBoxItem {
  key: string;
  pos?: Placement;
  /** CSS width for the object (e.g. "50%"); undefined = natural size. */
  width?: string;
  selected?: boolean;
  content: ReactNode;
}

type Size = { w: number; h: number };

function sameDims(
  a: { W: number; H: number; sizes: Size[] },
  b: { W: number; H: number; sizes: Size[] },
): boolean {
  if (a.W !== b.W || a.H !== b.H || a.sizes.length !== b.sizes.length) return false;
  return a.sizes.every((s, i) => s.w === b.sizes[i].w && s.h === b.sizes[i].h);
}

export function FigureBox({
  blockId,
  group,
  align,
  items,
  onSelect,
  onCommit,
  onReset,
  onMoveAcross,
}: {
  blockId: string;
  group: string;
  align: ImageAlign;
  items: FigureBoxItem[];
  onSelect: (index: number) => void;
  /** Commit every object's resolved position (and measured width fraction). */
  onCommit: (positions: Placement[], widthFracs: number[]) => void;
  /** Clear all placements in this block (double-click) → back to default layout. */
  onReset?: () => void;
  /** Drop onto a different box of the same group → move the object there. */
  onMoveAcross?: (fromIndex: number, toBlockId: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [dims, setDims] = useState<{ W: number; H: number; sizes: Size[] }>({ W: 0, H: 0, sizes: [] });
  const [live, setLive] = useState<{ index: number; left: number; top: number; snapX: boolean; snapY: boolean } | null>(null);
  const drag = useRef<{ index: number; startX: number; startY: number; baseLeft: number; baseTop: number; left: number; top: number; moved: boolean } | null>(null);

  const n = items.length;

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const W = box.clientWidth;
      const sizes: Size[] = [];
      for (let i = 0; i < n; i++) {
        const el = itemRefs.current[i];
        sizes.push(el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 });
      }
      const H = sizes.reduce((m, s) => Math.max(m, s.h), 0);
      const next = { W, H, sizes };
      setDims((prev) => (sameDims(prev, next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    itemRefs.current.slice(0, n).forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [n]);

  const { W, H, sizes } = dims;

  function defaultLayout(): { left: number; top: number }[] {
    const total = sizes.reduce((s, d) => s + d.w, 0) + GAP * Math.max(0, n - 1);
    let x =
      align === "left" ? 0 : align === "right" ? Math.max(0, W - total) : Math.max(0, (W - total) / 2);
    const out: { left: number; top: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = sizes[i] ?? { w: 0, h: 0 };
      out.push({ left: x, top: Math.max(0, H - s.h) });
      x += s.w + GAP;
    }
    return out;
  }

  /** Resolved pixel position of object i (its stored placement, else default). */
  function resolved(i: number): { left: number; top: number } {
    const p = items[i]?.pos;
    const s = sizes[i] ?? { w: 0, h: 0 };
    if (p && W > 0) {
      return {
        left: clamp(p.x * W, 0, Math.max(0, W - s.w)),
        top: clamp(H - p.r * W - s.h, 0, Math.max(0, H - s.h)),
      };
    }
    return defaultLayout()[i] ?? { left: 0, top: 0 };
  }

  /** Snap a dragged object to box + sibling centers/edges. */
  function magnets(i: number, left: number, top: number) {
    const s = sizes[i] ?? { w: 0, h: 0 };
    const cx = left + s.w / 2;
    const xTargets = [W / 2];
    const yTargets = [0, Math.max(0, (H - s.h) / 2), Math.max(0, H - s.h)];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const r = resolved(j);
      const sj = sizes[j] ?? { w: 0, h: 0 };
      xTargets.push(r.left + sj.w / 2);
      yTargets.push(r.top, r.top + (sj.h - s.h) / 2, r.top + sj.h - s.h);
    }
    let snapX = false;
    for (const t of xTargets)
      if (Math.abs(cx - t) <= SNAP) { left = clamp(t - s.w / 2, 0, Math.max(0, W - s.w)); snapX = true; break; }
    let snapY = false;
    for (const t of yTargets)
      if (Math.abs(top - t) <= SNAP) { top = clamp(t, 0, Math.max(0, H - s.h)); snapY = true; break; }
    return { left, top, snapX, snapY };
  }

  function onDown(e: ReactPointerEvent, i: number) {
    const t = e.target as HTMLElement;
    if (t.closest("input,textarea,select,button,a,[contenteditable=true]")) return;
    e.preventDefault();
    e.stopPropagation();
    const base = resolved(i);
    drag.current = { index: i, startX: e.clientX, startY: e.clientY, baseLeft: base.left, baseTop: base.top, left: base.left, top: base.top, moved: false };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
  }
  function onMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < MOVE_THRESHOLD) return;
    d.moved = true;
    const s = sizes[d.index] ?? { w: 0, h: 0 };
    const left0 = clamp(d.baseLeft + dx, 0, Math.max(0, W - s.w));
    const top0 = clamp(d.baseTop + dy, 0, Math.max(0, H - s.h));
    const m = magnets(d.index, left0, top0);
    d.left = m.left;
    d.top = m.top;
    setLive({ index: d.index, left: m.left, top: m.top, snapX: m.snapX, snapY: m.snapY });
  }
  function onUp(e: ReactPointerEvent) {
    const d = drag.current;
    drag.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setLive(null);
    if (!d) return;
    if (!d.moved) { onSelect(d.index); return; } // a click, not a drag
    if (W <= 0) return; // measurement guard — keep prior positions
    if (onMoveAcross) {
      const to = boxAt(e.clientX, e.clientY, group, blockId);
      if (to) { onMoveAcross(d.index, to); return; }
    }
    const positions: Placement[] = [];
    const widthFracs: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = sizes[i] ?? { w: 0, h: 0 };
      const px = i === d.index ? { left: d.left, top: d.top } : resolved(i);
      positions.push({
        x: clamp(px.left / W, 0, 1),
        r: clamp((H - px.top - s.h) / W, 0, Math.max(0, (H - s.h) / W)),
      });
      widthFracs.push(W > 0 ? s.w / W : 0);
    }
    onCommit(positions, widthFracs);
  }

  const liveSize = live ? sizes[live.index] ?? { w: 0, h: 0 } : null;

  return (
    <div
      ref={boxRef}
      data-fgroup={group}
      data-fblock={blockId}
      className="relative w-full"
      style={{ height: H > 0 ? H : undefined, minHeight: H > 0 ? undefined : 1 }}
    >
      {live && liveSize && (
        <>
          {live.snapX && (
            <div className="pointer-events-none absolute top-0 z-40 w-px bg-accent" style={{ left: live.left + liveSize.w / 2, height: H }} />
          )}
          {live.snapY && (
            <div className="pointer-events-none absolute left-0 right-0 z-40" style={{ top: live.top + liveSize.h / 2, borderTop: "1px solid var(--accent)" }} />
          )}
        </>
      )}
      {items.map((it, i) => {
        const dragging = live?.index === i;
        const p = dragging && live ? { left: live.left, top: live.top } : resolved(i);
        return (
          <div
            key={it.key}
            ref={(el) => { itemRefs.current[i] = el; }}
            data-fidx={i}
            onPointerDown={(e) => onDown(e, i)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={onReset ? (e) => { e.preventDefault(); e.stopPropagation(); onReset(); } : undefined}
            title="Drag to position · double-click to reset layout"
            className={`absolute touch-none rounded-md ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{
              left: p.left,
              top: p.top,
              width: it.width,
              zIndex: dragging ? 50 : it.selected ? 30 : undefined,
              outline: it.selected ? "2px solid var(--accent)" : undefined,
              outlineOffset: "3px",
              opacity: dragging ? 0.9 : 1,
            }}
          >
            {it.content}
          </div>
        );
      })}
    </div>
  );
}

function boxAt(x: number, y: number, group: string, selfId: string): string | null {
  const boxes = Array.from(document.querySelectorAll(`[data-fgroup="${group}"]`)) as HTMLElement[];
  for (const el of boxes) {
    const id = el.getAttribute("data-fblock");
    if (!id || id === selfId) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
  }
  return null;
}
