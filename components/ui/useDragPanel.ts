"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

/**
 * useDragPanel — make a centred modal panel draggable by its header.
 *
 * A dialog that covers the thing you are working from is a dialog you have to
 * close to see the answer: the graph editor hides the equation the graph is of,
 * the symbol browser hides the formula you are inserting into. Moving it aside
 * is the fix, and it costs nothing to keep — nothing here runs until a pointer
 * actually goes down on the handle.
 *
 * The panel stays in normal (centred) layout until the first drag, then flips to
 * fixed positioning at the exact pixels it was already occupying, so it does not
 * jump on grab. Its measured width comes along, because `w-full max-w-*` would
 * otherwise resolve against the viewport once it leaves the centring container.
 *
 * Pointer events (not mouse) so a pen or a finger on the iPad drags too. The
 * move/up listeners go on the WINDOW rather than using `setPointerCapture`: a
 * captured pointer stops Chrome from ever synthesizing `dblclick`, which is the
 * gesture that puts the panel back, and window listeners are what make a fast
 * drag — where the pointer outruns the panel and leaves the header — keep
 * moving instead of dying on the first event that lands somewhere else.
 */

/** How much of the panel must stay on screen, in px — enough that the header is
 *  always there to grab and drag back. */
const KEEP = 72;

export interface DragPanel {
  /** Attach to the panel being moved. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Spread onto the drag handle — typically the panel's header bar. */
  handleProps: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onDoubleClick: () => void;
    title: string;
  };
  /** Panel style — undefined until it has actually been moved. */
  style: CSSProperties | undefined;
  /** True once the panel has been dragged off centre. */
  moved: boolean;
  /** Put it back in the middle. */
  recentre: () => void;
}

interface Box {
  x: number;
  y: number;
  /** The panel's measured width, kept when it leaves the centring container. */
  w: number;
}

/** Interactive things inside a header that must keep their own behavior — a
 *  press on the close button is a press on the close button, not a grab. */
const NO_DRAG = "button, a, input, select, textarea, label, [contenteditable], [data-no-drag]";

export function useDragPanel(): DragPanel {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  /** Removes the window listeners of the press in progress, if any. */
  const release = useRef<(() => void) | null>(null);

  const clamp = useCallback((x: number, y: number, w: number): { x: number; y: number } => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: Math.min(Math.max(x, KEEP - w), vw - KEEP),
      // Never above the top edge: the header must stay reachable.
      y: Math.min(Math.max(y, 0), Math.max(0, vh - KEEP / 2)),
    };
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return; // left button / primary contact only
    if ((e.target as HTMLElement).closest(NO_DRAG)) return;
    const el = ref.current;
    if (!el) return;
    release.current?.(); // a stray earlier press, e.g. an up we never saw
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const w = r.width;
    const id = e.pointerId;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      ev.preventDefault();
      setBox({ w, ...clamp(ev.clientX - dx, ev.clientY - dy, w) });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      release.current?.();
    };
    const off = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      release.current = null;
    };
    release.current = off;
    // `passive: false` so a touch-drag's preventDefault actually holds.
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [clamp]);

  const recentre = useCallback(() => {
    release.current?.();
    setBox(null);
  }, []);

  // A window that shrinks under a panel parked near an edge would otherwise
  // leave it unreachable.
  useEffect(() => {
    if (!box) return;
    const onResize = () => setBox((prev) => (prev ? { ...prev, ...clamp(prev.x, prev.y, prev.w) } : prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [box, clamp]);

  // Unmounting mid-drag (Escape closes the dialog) must not leave listeners on.
  useEffect(() => () => release.current?.(), []);

  return {
    ref,
    handleProps: {
      onPointerDown,
      onDoubleClick: recentre,
      title: "Drag to move (double-click to recentre)",
    },
    style: box ? { position: "fixed", left: box.x, top: box.y, width: box.w, margin: 0 } : undefined,
    moved: box != null,
    recentre,
  };
}

/** The classes a drag handle wants: the grab cursor, no text selection, and no
 *  touch-scrolling stealing the gesture on a tablet. */
export const DRAG_HANDLE = "cursor-grab select-none touch-none active:cursor-grabbing";
