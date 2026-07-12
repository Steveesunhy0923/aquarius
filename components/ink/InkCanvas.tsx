"use client";

/**
 * InkCanvas — a Notability-style handwriting surface.
 *
 * Captures Apple Pencil / mouse / touch strokes with Pointer Events (pointer
 * capture + coalesced high-frequency samples + pressure), renders them with
 * quadratic midpoint smoothing on a devicePixelRatio-scaled <canvas>, and
 * exposes the committed strokes in the recognition API's shape.
 *
 * Palm rejection: once any "pen" pointer has been seen this session, "touch"
 * pointers no longer draw (a resting palm reports as touch). The canvas sets
 * `touch-action: none`, so two-finger gestures never scroll-draw either.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { strokeFromPoints, type Point, type Stroke } from "./strokes";

export interface InkCanvasHandle {
  /** Remove the last committed stroke. */
  undo: () => void;
  /** Remove all ink. */
  clear: () => void;
  /** Committed strokes in the API's struct-of-arrays shape. */
  getStrokes: () => Stroke[];
}

// Pen look: ~2px hairline at mouse pressure (0.5), swelling with real Pencil pressure.
const BASE_WIDTH = 2.1;
const widthFor = (p: number) => BASE_WIDTH * (0.55 + 0.9 * p);
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function paintDot(ctx: CanvasRenderingContext2D, pt: Point) {
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, Math.max(0.7, widthFor(pt.p) / 2), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Paint polyline segments with quadratic midpoint smoothing: each segment runs
 * midpoint→midpoint with the shared sample as control point, in its own path so
 * the line width can follow pressure. Round caps hide the joins. Segments with
 * endpoint index < `from` are assumed already painted (incremental drawing).
 */
function paintSegments(ctx: CanvasRenderingContext2D, pts: readonly Point[], from: number) {
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const m0 = i >= 2 ? mid(pts[i - 2], a) : a;
    const m1 = mid(a, b);
    ctx.lineWidth = widthFor((a.p + b.p) / 2);
    ctx.beginPath();
    ctx.moveTo(m0.x, m0.y);
    ctx.quadraticCurveTo(a.x, a.y, m1.x, m1.y);
    ctx.stroke();
  }
}

function paintStroke(ctx: CanvasRenderingContext2D, pts: readonly Point[]) {
  if (pts.length === 0) return;
  if (pts.length === 1) paintDot(ctx, pts[0]);
  else paintSegments(ctx, pts, 1);
}

export const InkCanvas = forwardRef<
  InkCanvasHandle,
  {
    className?: string;
    /** Fires whenever the committed stroke set changes (stroke end, undo, clear). */
    onStrokesChange?: (strokes: Stroke[]) => void;
    /** Fires when a stroke is committed by lifting the pointer. */
    onStrokeEnd?: (strokes: Stroke[]) => void;
  }
>(function InkCanvas({ className, onStrokesChange, onStrokeEnd }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doneRef = useRef<Point[][]>([]); // committed strokes
  const liveRef = useRef<{ id: number; points: Point[]; painted: number } | null>(null);
  const penSeenRef = useRef(false); // palm-rejection latch

  // Latest callbacks without re-binding pointer handlers.
  const onChangeRef = useRef(onStrokesChange);
  onChangeRef.current = onStrokesChange;
  const onEndRef = useRef(onStrokeEnd);
  onEndRef.current = onStrokeEnd;

  const asStrokes = useCallback(() => doneRef.current.map(strokeFromPoints), []);

  /** 2d context with ink style applied; color follows the theme (canvas inherits `color`). */
  const ctx2d = useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    const color = getComputedStyle(canvas).color;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return ctx;
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctx2d();
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (const pts of doneRef.current) paintStroke(ctx, pts);
    const live = liveRef.current;
    if (live) {
      paintStroke(ctx, live.points);
      live.painted = live.points.length;
    }
  }, [ctx2d]);

  // Keep the backing store at CSS size × devicePixelRatio (resizing clears it,
  // so redraw). The observer fires once on observe, which does the initial sizing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      redraw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  const toPoint = (ev: PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
      t: ev.timeStamp,
      // Hovering mice report 0; treat anything non-positive as the mouse default.
      p: ev.pressure > 0 ? ev.pressure : 0.5,
    };
  };

  /** Palm rejection + button filtering. Also latches "a pen exists". */
  const accepts = (e: ReactPointerEvent<HTMLCanvasElement>): boolean => {
    if (e.pointerType === "pen") penSeenRef.current = true;
    if (e.pointerType === "touch" && penSeenRef.current) return false;
    if (e.pointerType === "mouse" && e.button !== 0 && e.buttons !== 1) return false;
    return true;
  };

  const handleDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (liveRef.current || !accepts(e)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = toPoint(e.nativeEvent);
    liveRef.current = { id: e.pointerId, points: [pt], painted: 1 };
    const ctx = ctx2d();
    if (ctx) paintDot(ctx, pt);
  };

  const handleMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const live = liveRef.current;
    if (!live || live.id !== e.pointerId) return;
    const native = e.nativeEvent;
    // Coalesced events carry the full-rate Pencil samples between frames.
    const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    for (const ev of coalesced.length > 0 ? coalesced : [native]) live.points.push(toPoint(ev));
    const ctx = ctx2d();
    if (ctx) {
      paintSegments(ctx, live.points, live.painted);
      live.painted = live.points.length;
    }
  };

  const handleUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const live = liveRef.current;
    if (!live || live.id !== e.pointerId) return;
    liveRef.current = null;
    doneRef.current.push(live.points); // single-point strokes are kept: dots matter ("i", decimal points)
    const strokes = asStrokes();
    onChangeRef.current?.(strokes);
    onEndRef.current?.(strokes);
  };

  const handleCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const live = liveRef.current;
    if (!live || live.id !== e.pointerId) return;
    liveRef.current = null; // OS took the pointer (gesture, palm) — drop the partial stroke
    redraw();
  };

  useImperativeHandle(
    ref,
    () => ({
      undo: () => {
        if (doneRef.current.length === 0) return;
        doneRef.current.pop();
        redraw();
        onChangeRef.current?.(asStrokes());
      },
      clear: () => {
        if (doneRef.current.length === 0 && !liveRef.current) return;
        doneRef.current = [];
        liveRef.current = null;
        redraw();
        onChangeRef.current?.([]);
      },
      getStrokes: asStrokes,
    }),
    [asStrokes, redraw],
  );

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ touchAction: "none" }}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
});
