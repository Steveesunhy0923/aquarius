"use client";

import { Icon } from "@/components/Icon";
import { DRAG_HANDLE } from "@/components/ui/useDragPanel";
import { useEffect, useLayoutEffect, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/**
 * The symbol tab: a small card that floats beside the formula being edited,
 * holding the symbol strip (math or chemistry).
 *
 * A bar fixed under the toolbar sits as far as it can from the formula it
 * serves, and pushes the page down while it is open. The tab instead opens just
 * under the equation or inline formula holding the caret, follows it as it
 * grows, scrolls and moves, and can be dragged anywhere. Where it was dragged is
 * kept as an offset from the formula (one for formulas, one for the top-bar
 * button), so the next formula opens it in the same place relative to itself.
 * Double-clicking the grip puts it back.
 *
 * It never takes the caret: presses on it are held (preventDefault), the same
 * way the toolbar's are, so a symbol lands in the formula still being typed.
 */

export type SymbolTabAnchor = "formula" | "bar";

const OFFSET_KEY = "aquarius.symbolTab.offset.v1";
/** Space between the tab and what it sits beside, and from the window edge. */
const GAP = 8;
const MARGIN = 8;

type Offsets = Record<SymbolTabAnchor, { x: number; y: number }>;
const ZERO: Offsets = { formula: { x: 0, y: 0 }, bar: { x: 0, y: 0 } };

function readOffsets(): Offsets {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(OFFSET_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Offsets>) : null;
    const ok = (o: unknown): o is { x: number; y: number } =>
      !!o && typeof (o as { x: unknown }).x === "number" && typeof (o as { y: unknown }).y === "number";
    return { formula: ok(v?.formula) ? v!.formula! : ZERO.formula, bar: ok(v?.bar) ? v!.bar! : ZERO.bar };
  } catch {
    return ZERO;
  }
}

function saveOffsets(o: Offsets) {
  try { window.localStorage.setItem(OFFSET_KEY, JSON.stringify(o)); } catch { /* private mode: it just resets */ }
}

export function SymbolTab({ anchor, anchorKind, mode, onMode, onClose, keepFocus, children }: {
  /** What the tab sits beside, read every frame (null: keep where it is). */
  anchor: () => DOMRect | null;
  anchorKind: SymbolTabAnchor;
  mode: "math" | "chem";
  onMode: (m: "math" | "chem") => void;
  onClose: () => void;
  /** Mousedown handler that holds the caret where it is. */
  keepFocus: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const kindRef = useRef(anchorKind);
  kindRef.current = anchorKind;
  const offsets = useRef<Offsets>(ZERO);
  const dragging = useRef(false);
  const release = useRef<(() => void) | null>(null);

  // Follow the anchor every frame: a formula grows as it is typed, the page
  // scrolls, the pane resizes. Written straight to the style — nothing here is
  // worth a React render sixty times a second.
  useLayoutEffect(() => {
    offsets.current = readOffsets();
    let frame = 0;
    let last = "";
    const tick = () => {
      const el = panel.current;
      const a = anchorRef.current();
      if (el && a) {
        const kind = kindRef.current;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Under what it serves, or above it when there is no room below.
        const baseTop = a.bottom + GAP + h <= vh - MARGIN || a.top - GAP - h < MARGIN ? a.bottom + GAP : a.top - GAP - h;
        const baseLeft = a.left + a.width / 2 - w / 2;
        const o = offsets.current[kind];
        const left = Math.round(Math.min(Math.max(baseLeft + o.x, MARGIN), Math.max(MARGIN, vw - w - MARGIN)));
        const top = Math.round(Math.min(Math.max(baseTop + o.y, MARGIN), Math.max(MARGIN, vh - h - MARGIN)));
        // A drag past the window edge must not bank offset the tab cannot show.
        if (dragging.current) offsets.current = { ...offsets.current, [kind]: { x: left - baseLeft, y: top - baseTop } };
        const key = `${left},${top}`;
        if (key !== last) {
          last = key;
          el.style.left = `${left}px`;
          el.style.top = `${top}px`;
          el.style.visibility = "visible";
        }
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => release.current?.(), []);

  function onGripDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    // No preventDefault here: cancelling the pointer press suppresses the mouse
    // events Chrome counts clicks from, and double-click (put it back) never
    // fired. The card's own mousedown handler is what keeps the caret.
    release.current?.();
    const kind = kindRef.current;
    const start = offsets.current[kind];
    const sx = e.clientX;
    const sy = e.clientY;
    const id = e.pointerId;
    dragging.current = true;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      ev.preventDefault();
      offsets.current = { ...offsets.current, [kind]: { x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy } };
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      release.current?.();
      saveOffsets(offsets.current);
    };
    const off = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      release.current = null;
    };
    release.current = off;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function putBack() {
    offsets.current = { ...offsets.current, [kindRef.current]: { x: 0, y: 0 } };
    saveOffsets(offsets.current);
  }

  return (
    <div
      ref={panel}
      role="toolbar"
      aria-label="Symbols"
      className="print-hide fixed z-30 w-max max-w-[min(390px,calc(100vw-16px))] rounded-lg border border-border bg-surface shadow-lg"
      style={{ left: 0, top: 0, visibility: "hidden" }}
      // Hold the caret in the formula for every press on the tab (menus that
      // carry a text field of their own still get to focus it).
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) e.preventDefault(); }}
    >
      <div className="flex items-center gap-1 px-1 pt-1">
        <span
          onPointerDown={onGripDown}
          onDoubleClick={putBack}
          title="Drag to move · double-click to put it back"
          aria-label="Move the symbol tab"
          className={`${DRAG_HANDLE} grid h-6 w-5 place-items-center rounded text-faint hover:text-foreground`}
        >
          <Icon name="drag" size={13} />
        </span>
        <div className="flex items-center overflow-hidden rounded border border-border" role="group" aria-label="Symbol set">
          <button onMouseDown={keepFocus} onClick={() => onMode("math")} title="Math symbols" aria-label="Show math symbols" aria-pressed={mode === "math"} className={`grid h-6 w-7 place-items-center ${mode === "math" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}><Icon name="sum" size={13} /></button>
          <button onMouseDown={keepFocus} onClick={() => onMode("chem")} title="Chemistry symbols" aria-label="Show chemistry symbols" aria-pressed={mode === "chem"} className={`grid h-6 w-7 place-items-center ${mode === "chem" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}><Icon name="flask" size={13} /></button>
        </div>
        <span className="flex-1" />
        <button onMouseDown={keepFocus} onClick={onClose} title="Close the symbol tab" aria-label="Close the symbol tab" className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-foreground/[0.06] hover:text-foreground"><Icon name="close" size={12} /></button>
      </div>
      <div className="px-1 pb-1 pt-0.5">{children}</div>
    </div>
  );
}
