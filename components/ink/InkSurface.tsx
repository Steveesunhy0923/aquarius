"use client";

/**
 * InkSurface — the handwriting surface, in two shapes.
 *
 *   pageMode="free"  one canvas that fills whatever box the caller gives it.
 *                    This is the historical InkCanvas (the /ink lab and the
 *                    editor's compact bottom sheet); InkCanvas.tsx is now a
 *                    thin wrapper around this mode and nothing about it changed.
 *   pageMode="a4"    a scrolling stack of A4 sheets that auto-extends as you
 *                    write, so a whole page of mixed prose + math can be
 *                    handed to the recognizer in one go.
 *
 * Captures Apple Pencil / mouse / touch with Pointer Events (pointer capture +
 * coalesced high-frequency samples + pressure) and paints with inkpaint's
 * quadratic midpoint smoothing on devicePixelRatio-scaled canvases.
 *
 * ── Three decisions worth knowing about ────────────────────────────────────
 *
 * 1. ONE CANVAS PER PAGE, not one tall canvas. WebKit on iOS (Safari *and* the
 *    WKWebView the Capacitor shell runs in) caps a canvas at maxCanvasArea =
 *    4096² = 16.78 Mpx and silently hands back a blank buffer past it — no
 *    exception. One A4 sheet at dpr 2 is 1588×2246 = 3.57 Mpx, so five stacked
 *    pages in a single canvas (17.8 Mpx) is already over, and three pages at
 *    dpr 3 likewise. Per-page canvases are bounded no matter how long the
 *    document gets.
 *
 * 2. STROKES LIVE IN DOCUMENT SPACE, pages are just viewports onto it. Page i
 *    paints with a `-pageTop(i)` translate, so a stroke's coordinates never
 *    depend on which sheet it happened to land on and the recognizer receives
 *    one coherent y-ordered page of ink. Only the pages near the viewport keep
 *    a backing store (`resizeBacking` zeroes the rest); repainting a page that
 *    scrolls back in is free because strokes — not pixels — are the source of
 *    truth.
 *
 * 3. ONE TRANSPARENT OVERLAY TAKES THE POINTER, not the individual canvases.
 *    `setPointerCapture` on canvas *i* would keep delivering events after the
 *    pen crosses onto sheet *i+1* but paint them clipped off the bottom of
 *    sheet *i*. A single overlay spanning the whole stack keeps a seam-crossing
 *    stroke continuous, and it is also the one element whose `touch-action`
 *    decides whether a finger scrolls (see the palm-rejection note below).
 *
 * Palm rejection: once any "pen" pointer has been seen this session, "touch"
 * pointers no longer draw (a resting palm reports as touch).
 */

import { Icon } from "@/components/Icon";
import { A4_H, A4_W } from "@/lib/blocks/docstyle";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { paintDot, paintSegments, paintStroke, widthFor } from "./inkpaint";
import { strokeFromPoints, type Point, type Stroke } from "./strokes";

export type InkPageMode = "free" | "a4";

/** The surface contract every ink caller has always had. */
export interface InkCanvasHandle {
  /** Remove the last committed stroke. */
  undo: () => void;
  /** Remove all ink. */
  clear: () => void;
  /** Committed strokes in the API's struct-of-arrays shape. */
  getStrokes: () => Stroke[];
}

export interface InkSurfaceHandle extends InkCanvasHandle {
  /** Document-space y of each page top, excluding 0 — the recognizer's
   *  `pageBreaks`, which it uses to forbid a text line spanning two sheets. */
  getPageBreaks: () => number[];
  getPageCount: () => number;
  addPage: () => void;
}

export interface InkSurfaceProps {
  pageMode?: InkPageMode;
  /** A4 sheet scale, matching the editor's zoom slider. Ignored when free. */
  zoom?: number;
  className?: string;
  /** Ink to start with, in document space — annotations restored from storage.
   *  Applied ONCE per identity change, never on every render: re-seeding while
   *  someone is drawing would discard the strokes they just made. */
  initialStrokes?: Stroke[];
  /** Fixed page geometry, for a surface whose pages are NOT A4 — e.g. the pages
   *  of an imported PDF, which have their own sizes. Overrides `zoom`. */
  pageSize?: { width: number; height: number };
  /** Fixed number of pages. Set for a PDF (its page count is what it is);
   *  omitted for a writing surface, which grows as you fill it. */
  fixedPages?: number;
  /** Rendered behind the ink of page `i` — the PDF page image. */
  renderPage?: (i: number) => React.ReactNode;
  /** Fires whenever the committed stroke set changes (stroke end, undo, clear). */
  onStrokesChange?: (strokes: Stroke[]) => void;
  /** Fires when a stroke is committed by lifting the pointer. */
  onStrokeEnd?: (strokes: Stroke[]) => void;
}

/** Sheet separation — `gap-8`, the same 32px the editor puts between pages. */
const PAGE_GAP = 32;
/** Distance from a scroll edge at which drawing starts dragging the page along. */
const EDGE_ZONE = 96;
/** Auto-scroll speed, px per animation frame (~360 px/s at 60Hz). */
const EDGE_STEP = 6;
/** Slack added to a stroke's y-extent when testing it against a page band: the
 *  extent is measured on sample centres, so a full-pressure round cap can bleed
 *  half a line width past it and must not be culled from the neighbouring sheet. */
const CULL_PAD = widthFor(1);

/** y-extent of a committed stroke, cached so page repaints can skip strokes
 *  that live on other sheets (an A4 document is mostly off-page ink). */
interface Extent {
  y0: number;
  y1: number;
}

function extentOf(pts: readonly Point[]): Extent {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return Number.isFinite(y0) ? { y0, y1 } : { y0: 0, y1: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const InkSurface = forwardRef<InkSurfaceHandle, InkSurfaceProps>(function InkSurface(
  { pageMode = "free", zoom = 1, className, initialStrokes, pageSize, fixedPages, renderPage, onStrokesChange, onStrokeEnd },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null); // the scroll viewport (a4) / the root (free)
  const stackRef = useRef<HTMLDivElement | null>(null); // document origin: its top-left is (0,0)
  const overlayRef = useRef<HTMLDivElement | null>(null); // the single pointer-capture surface
  const canvasesRef = useRef<(HTMLCanvasElement | null)[]>([]);

  const doneRef = useRef<Point[][]>([]); // committed strokes, DOCUMENT space
  const extentsRef = useRef<Extent[]>([]); // parallel to doneRef
  const liveRef = useRef<{ id: number; points: Point[]; painted: number } | null>(null);
  const penSeenRef = useRef(false); // palm-rejection latch (read inside handlers)

  // The latch also drives `touch-action`, so it has to survive into the style —
  // hence a state mirror of the ref. See the iPad note on the overlay below.
  const [penSeen, setPenSeen] = useState(false);

  const [pageCount, setPageCount] = useState(1);
  // How many leading pages actually carry ink. Pages [0, inkPages) are
  // "content" and get a number; the sheet after them is the blank trailing one.
  const [inkPages, setInkPages] = useState(0);
  // Pages the user asked for explicitly ("add page"). A floor under the count
  // derived from the ink, so writing then undoing never takes them away.
  const manualPagesRef = useRef(1);
  const pageCountRef = useRef(1);
  pageCountRef.current = pageMode === "a4" ? (fixedPages ?? pageCount) : 1;

  // Which pages keep a backing store: everything intersecting the viewport ±1.
  const [win, setWin] = useState<[number, number]>([0, 0]);
  const winRef = useRef<[number, number]>([0, 0]);
  winRef.current = win;

  // Latest callbacks without re-binding pointer handlers.
  const onChangeRef = useRef(onStrokesChange);
  onChangeRef.current = onStrokesChange;
  const onEndRef = useRef(onStrokeEnd);
  onEndRef.current = onStrokeEnd;

  const paged = pageMode === "a4";
  const pageW = Math.round(pageSize ? pageSize.width : A4_W * zoom);
  const pageH = Math.round(pageSize ? pageSize.height : A4_H * zoom);
  const pitch = pageH + PAGE_GAP;

  const asStrokes = useCallback(() => doneRef.current.map(strokeFromPoints), []);

  // Restore saved ink. Keyed on IDENTITY, not contents: this must run when the
  // surface is handed a different note's annotations, and must NOT run again
  // when our own onStrokesChange round-trips back through the parent — that
  // would wipe whatever is being drawn right now.
  const seededRef = useRef<Stroke[] | undefined>(undefined);
  if (initialStrokes && seededRef.current !== initialStrokes) {
    seededRef.current = initialStrokes;
    doneRef.current = initialStrokes.map((st) =>
      st.x.map((_, i) => ({ x: st.x[i], y: st.y[i], t: st.t[i], p: st.p?.[i] ?? 0.5 })),
    );
    extentsRef.current = doneRef.current.map(extentOf);
  }

  /** Document-space y of page i's top edge. Free mode is a single page at 0. */
  const pageTop = useCallback((i: number) => (paged ? i * pitch : 0), [paged, pitch]);

  /**
   * A 2d context for page i, already translated into document space and
   * carrying the ink style. Ink color follows the theme: the canvas inherits
   * `color` from the sheet, exactly as the free surface always has.
   */
  const ctxFor = useCallback(
    (i: number): CanvasRenderingContext2D | null => {
      const canvas = canvasesRef.current[i];
      if (!canvas || canvas.width === 0) return null; // outside the bitmap window
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const color = getComputedStyle(canvas).color;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, -pageTop(i) * dpr);
      return ctx;
    },
    [pageTop],
  );

  /** Repaint one page from the stroke list. Does NOT advance `live.painted` —
   *  only `repaint()` may, since that counter is shared by every page. */
  const paintPage = useCallback(
    (i: number) => {
      const canvas = canvasesRef.current[i];
      const ctx = canvas ? ctxFor(i) : null;
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const top = pageTop(i);
      const cssH = canvas.height / dpr;
      ctx.clearRect(0, top, canvas.width / dpr, cssH);
      const extents = extentsRef.current;
      doneRef.current.forEach((pts, s) => {
        const e = extents[s];
        if (e && (e.y1 < top - CULL_PAD || e.y0 > top + cssH + CULL_PAD)) return;
        paintStroke(ctx, pts);
      });
      const live = liveRef.current;
      if (live) paintStroke(ctx, live.points);
    },
    [ctxFor, pageTop],
  );

  /** Repaint every page that currently owns a bitmap. */
  const repaint = useCallback(() => {
    const [lo, hi] = winRef.current;
    for (let i = lo; i <= hi; i++) paintPage(i);
    const live = liveRef.current;
    if (live) live.painted = live.points.length;
  }, [paintPage]);

  /**
   * Bring page i's backing store in line with its CSS size — or drop it
   * entirely when the page has scrolled out of the window. Assigning `.width`
   * clears the bitmap, so every caller repaints afterwards.
   */
  const resizeBacking = useCallback(
    (i: number) => {
      const canvas = canvasesRef.current[i];
      if (!canvas) return;
      const [lo, hi] = winRef.current;
      if (i < lo || i > hi) {
        if (canvas.width !== 0) {
          canvas.width = 0;
          canvas.height = 0;
        }
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    [],
  );

  // Keep every mounted canvas at CSS size × dpr. One observer for the whole
  // stack; it fires once per element on observe, which does the initial sizing.
  const roRef = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const i = canvasesRef.current.indexOf(entry.target as HTMLCanvasElement);
        if (i >= 0) resizeBacking(i);
      }
      repaint();
    });
    roRef.current = ro;
    // Callback refs run before effects, so the first pages are already stored.
    for (const canvas of canvasesRef.current) if (canvas) ro.observe(canvas);
    return () => {
      ro.disconnect();
      roRef.current = null;
    };
  }, [resizeBacking, repaint]);

  // Stable per-index callback refs: a fresh closure every render would make
  // React run ref(null)→ref(el) each time, and the unobserve/observe churn
  // would clear and repaint every bitmap on every keystroke elsewhere.
  const refCbs = useRef(new Map<number, (el: HTMLCanvasElement | null) => void>());
  const canvasRef = (i: number) => {
    let cb = refCbs.current.get(i);
    if (!cb) {
      cb = (el: HTMLCanvasElement | null) => {
        const prev = canvasesRef.current[i];
        if (prev && prev !== el) roRef.current?.unobserve(prev);
        canvasesRef.current[i] = el;
        if (el && el !== prev) roRef.current?.observe(el);
      };
      refCbs.current.set(i, cb);
    }
    return cb;
  };

  /** Pages intersecting the viewport, widened by one on each side so a scroll
   *  never reveals an unpainted sheet. */
  const computeWindow = useCallback((): [number, number] => {
    const n = pageCountRef.current;
    if (!paged) return [0, 0];
    const sc = scrollRef.current;
    const stack = stackRef.current;
    if (!sc || !stack) return [0, Math.min(1, n - 1)];
    const sr = sc.getBoundingClientRect();
    const kr = stack.getBoundingClientRect();
    const top = sr.top - kr.top; // document-space y at the top of the viewport
    const lo = clamp(Math.floor(top / pitch) - 1, 0, n - 1);
    const hi = clamp(Math.floor((top + sr.height) / pitch) + 1, lo, n - 1);
    return [lo, hi];
  }, [paged, pitch]);

  const updateWindow = useCallback(() => {
    const next = computeWindow();
    const [lo, hi] = winRef.current;
    if (next[0] === lo && next[1] === hi) return;
    winRef.current = next; // paint calls in this same tick must see the new window
    setWin(next);
  }, [computeWindow]);

  // Scroll / viewport-resize → recompute the window (rAF-coalesced: a flick
  // fires far more scroll events than there are frames to repaint in).
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !paged) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateWindow();
      });
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(sc);
    updateWindow();
    return () => {
      sc.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [paged, updateWindow]);

  // Window (or page count) moved: hand out / take back backing stores, repaint.
  useEffect(() => {
    for (let i = 0; i < canvasesRef.current.length; i++) resizeBacking(i);
    repaint();
  }, [win, pageCount, resizeBacking, repaint]);

  // A newly appended page must be considered for the window immediately —
  // otherwise the sheet you just wrote onto scrolls in without a bitmap.
  useEffect(() => {
    updateWindow();
  }, [pageCount, updateWindow]);

  // ── Pointer input ─────────────────────────────────────────────────────────

  /** Client → document coordinates. Re-reads the overlay rect per sample, so a
   *  mid-stroke scroll (auto-scroll below) stays coordinate-correct for free. */
  const toPoint = (clientX: number, clientY: number, t: number, pressure: number): Point => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      t,
      // Hovering mice report 0; treat anything non-positive as the mouse default.
      p: pressure > 0 ? pressure : 0.5,
    };
  };

  const fromEvent = (ev: PointerEvent): Point => toPoint(ev.clientX, ev.clientY, ev.timeStamp, ev.pressure);

  /** Paint the samples added since the last call, on every live page. */
  const paintLive = () => {
    const live = liveRef.current;
    if (!live) return;
    const [lo, hi] = winRef.current;
    for (let i = lo; i <= hi; i++) {
      const ctx = ctxFor(i);
      if (!ctx) continue;
      if (live.painted === 0) paintStroke(ctx, live.points);
      else paintSegments(ctx, live.points, live.painted);
    }
    live.painted = live.points.length;
  };

  /** Palm rejection + button filtering. Also latches "a pen exists". */
  const accepts = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    if (e.pointerType === "pen") {
      penSeenRef.current = true;
      if (!penSeen) setPenSeen(true);
    }
    if (e.pointerType === "touch" && penSeenRef.current) return false;
    if (e.pointerType === "mouse" && e.button !== 0 && e.buttons !== 1) return false;
    return true;
  };

  // Auto-scroll while drawing into the top/bottom edge of the viewport: the
  // page comes up to meet the pen instead of the user having to stop, scroll,
  // and start a new stroke. Each tick also appends a sample at the (unchanged)
  // pointer position, whose DOCUMENT coordinate has moved — that is what makes
  // the ink keep flowing while the pointer is held still.
  const edgeRef = useRef(0); // -1 up, 0 idle, +1 down
  const lastClientRef = useRef<{ x: number; y: number; p: number } | null>(null);
  const rafRef = useRef(0);

  const stopAutoScroll = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    edgeRef.current = 0;
  };

  const tickAutoScroll = () => {
    rafRef.current = 0;
    const sc = scrollRef.current;
    const live = liveRef.current;
    const last = lastClientRef.current;
    if (!sc || !live || !last || edgeRef.current === 0) return;
    const before = sc.scrollTop;
    sc.scrollTop = before + edgeRef.current * EDGE_STEP;
    if (sc.scrollTop === before) return; // hit the end of the document — stop pumping
    live.points.push(toPoint(last.x, last.y, performance.now(), last.p));
    paintLive();
    rafRef.current = requestAnimationFrame(tickAutoScroll);
  };

  const updateEdge = (clientY: number) => {
    const sc = scrollRef.current;
    if (!sc || !paged) return;
    const r = sc.getBoundingClientRect();
    const dir = clientY > r.bottom - EDGE_ZONE ? 1 : clientY < r.top + EDGE_ZONE ? -1 : 0;
    edgeRef.current = dir;
    if (dir !== 0 && !rafRef.current) rafRef.current = requestAnimationFrame(tickAutoScroll);
  };

  /** Document y -> true when it falls in the blank strip BETWEEN two sheets.
   *  No canvas covers that strip, so anything drawn there would be captured and
   *  recognized while leaving no visible mark — invisible ink. */
  const inPageGap = useCallback(
    (y: number) => paged && y >= 0 && y % pitch > pageH,
    [paged, pitch, pageH],
  );

  const handleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (liveRef.current || !accepts(e)) return;
    const start = fromEvent(e.nativeEvent);
    // A stroke may CROSS a seam (the single capture overlay is what makes that
    // render continuously on both sheets), but it may not START in the gap:
    // there is no paper there, so the pen must simply not write.
    if (inPageGap(start.y)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = start;
    liveRef.current = { id: e.pointerId, points: [pt], painted: 0 };
    lastClientRef.current = { x: e.clientX, y: e.clientY, p: pt.p };
    const [lo, hi] = winRef.current;
    for (let i = lo; i <= hi; i++) {
      const ctx = ctxFor(i);
      if (ctx) paintDot(ctx, pt);
    }
    liveRef.current.painted = 1;
  };

  const handleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const live = liveRef.current;
    if (!live || live.id !== e.pointerId) return;
    const native = e.nativeEvent;
    // Coalesced events carry the full-rate Pencil samples between frames.
    const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    for (const ev of coalesced.length > 0 ? coalesced : [native]) live.points.push(fromEvent(ev));
    lastClientRef.current = { x: e.clientX, y: e.clientY, p: e.pressure > 0 ? e.pressure : 0.5 };
    paintLive();
    updateEdge(e.clientY);
  };

  const commit = (points: Point[]) => {
    doneRef.current.push(points); // single-point strokes are kept: dots matter ("i", decimal points)
    extentsRef.current.push(extentOf(points));
  };

  /**
   * Re-derive the page count FROM THE INK, the way the note editor re-packs its
   * document sheets on every render (EditorClient's `paginate` + "always one
   * blank page at the end"). Deriving rather than accumulating is what makes
   * undo and clear give the pages back: a monotone counter would leave you
   * staring at three blank sheets after clearing the canvas.
   *
   * `manualPages` is the floor the explicit "add page" button sets, so a user
   * who asks for room ahead of writing keeps it.
   */
  const syncPages = useCallback(() => {
    if (!paged || fixedPages) return; // a PDF has exactly the pages it has
    let needed = 0;
    for (const e of extentsRef.current) {
      needed = Math.max(needed, Math.floor(Math.max(0, e.y1) / pitch) + 1);
    }
    setInkPages(needed);
    setPageCount(Math.max(needed + 1, 1, manualPagesRef.current)); // + one blank trailing sheet
  }, [paged, pitch, fixedPages]);

  /** Explicit "add page": raise the floor, then re-derive. */
  const addPage = useCallback(() => {
    manualPagesRef.current = pageCountRef.current + 1;
    setPageCount(manualPagesRef.current);
  }, []);

  const handleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const live = liveRef.current;
    if (!live || live.id !== e.pointerId) return;
    liveRef.current = null;
    stopAutoScroll();
    commit(live.points);
    syncPages();
    const strokes = asStrokes();
    onChangeRef.current?.(strokes);
    onEndRef.current?.(strokes);
  };

  const handleCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const live = liveRef.current;
    if (!live || live.id !== e.pointerId) return;
    liveRef.current = null; // OS took the pointer (gesture, palm) — drop the partial stroke
    stopAutoScroll();
    repaint();
  };

  useEffect(() => stopAutoScroll, []);

  useImperativeHandle(
    ref,
    () => ({
      undo: () => {
        if (doneRef.current.length === 0) return;
        doneRef.current.pop();
        extentsRef.current.pop();
        repaint();
        syncPages();
        onChangeRef.current?.(asStrokes());
      },
      clear: () => {
        if (doneRef.current.length === 0 && !liveRef.current) return;
        doneRef.current = [];
        extentsRef.current = [];
        liveRef.current = null;
        manualPagesRef.current = 1; // clearing the ink also gives back the pages
        repaint();
        syncPages();
        onChangeRef.current?.([]);
      },
      getStrokes: asStrokes,
      getPageBreaks: () =>
        Array.from({ length: Math.max(0, pageCountRef.current - 1) }, (_, i) => (i + 1) * pitch),
      getPageCount: () => pageCountRef.current,
      addPage: () => addPage(),
    }),
    [asStrokes, repaint, pitch, syncPages, addPage],
  );

  const pages = paged ? Array.from({ length: fixedPages ?? pageCount }, (_, i) => i) : [0];

  return (
    <div
      ref={scrollRef}
      className={
        paged
          ? `print-hide relative overflow-y-auto overscroll-contain p-8 ${className ?? ""}`
          : `relative ${className ?? ""}`
      }
    >
      {/* The stack's top-left IS the document origin, so it is sized to exactly
          one page wide and centred as a whole — `items-center` on a full-width
          stack would put x=0 somewhere off the sheet. The ink stack stays
          VERTICAL even when the note itself is laid out horizontally: the
          segmenter's reading order is y order. */}
      <div
        ref={stackRef}
        className={paged ? "relative mx-auto flex flex-col gap-8" : "absolute inset-0"}
        style={paged ? { width: pageW } : undefined}
      >
        {pages.map((i) =>
          paged ? (
            <div
              key={i}
              className="relative shrink-0 bg-surface text-foreground shadow-xl ring-1 ring-border"
              style={{ width: pageW, height: pageH }}
            >
              {renderPage && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">{renderPage(i)}</div>
              )}
              <canvas ref={canvasRef(i)} className="relative block h-full w-full" />
              {/* Exactly the editor's rule (EditorClient's sheet footer): a
                  page is numbered unless it is the trailing blank one. So ink
                  on page 1 alone shows "1" and nothing under the empty sheet
                  that follows — never "1, 2". */}
              <span className="pointer-events-none absolute bottom-1.5 right-3 text-[10px] text-muted">
                {i < pageCount - 1 || i < inkPages ? i + 1 : null}
              </span>
            </div>
          ) : (
            <canvas key={i} ref={canvasRef(i)} className="block h-full w-full" />
          ),
        )}

        {/* The single capture surface. `touch-action` is the iPad story:
            `none` while no Pencil has been seen (so a finger can draw), then
            `pan-y` once the palm-rejection latch trips — at that point
            accepts() already refuses touch, so the gesture may as well become
            a scroll. Without this the old fixed `none` meant that on a
            page-tall surface a finger could neither draw NOR scroll: the ink
            swallowed the gesture and drew nothing. ASSUMPTION, to be observed
            on real hardware per the repo's verify-at-runtime rule: WebKit is
            expected to keep delivering Pencil pointermove under `pan-y`. */}
        <div
          ref={overlayRef}
          className="absolute inset-0"
          style={{ touchAction: penSeen ? "pan-y" : "none" }}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleCancel}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      {paged && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => setPageCount((n) => n + 1)}
            title="Add a page"
            className="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted transition hover:border-accent hover:text-foreground"
          >
            <Icon name="newnote" size={15} />
            Add page
          </button>
        </div>
      )}
    </div>
  );
});
