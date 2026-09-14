"use client";

import { Icon } from "@/components/Icon";
import { renderItem, renderPoint, SceneBase } from "@/components/GraphView";
import { uiConfirm } from "@/components/ui/dialogs";
import { EYEBROW } from "@/components/ui/primitives";
import { DRAG_HANDLE, useDragPanel } from "@/components/ui/useDragPanel";
import {
  buildScene,
  defaultGraph,
  findSnap,
  makeProj,
  newGraphId,
  niceStep,
  panView,
  resolveGeometry,
  resolvePoint,
  SHAPE_PALETTE,
  zoomView,
  type CoordSystem,
  type GPoint,
  type GraphData,
  type GShape,
  type SceneItem,
  type SnapTarget,
} from "@/lib/blocks/graph";
import {
  buildShape,
  deletePoint,
  HINTS,
  HIT_PX,
  hitTest,
  isValidLineEquation,
  lineAnchors,
  lineEquationText,
  nextName,
  parseLineEquation,
  previewPrims,
  rotatable,
  rotatablePointIds,
  rotateShapeData,
  samePair,
  shapeCentroid,
  shapeUsesAny,
  STICKY_TOOLS,
  TOOLS,
  type Selection,
  type ToolId,
} from "@/lib/blocks/graph-edit";
import { isValidExpr } from "@/lib/blocks/expr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SNAP_PX = 12; // magnet radius
/** Frame-size limits in px — small enough to sit in a paragraph, big enough to
 *  fill the dialog, and never zero (a 0-wide canvas has no projection). */
const MIN_FRAME = 160;
const MAX_FRAME = 1600;
/** Wheel/pinch events closer together than this belong to ONE zoom gesture, and
 *  so to one undo step. */
const ZOOM_BURST_MS = 500;
/** Wheel delta → zoom factor. Tuned so a notched mouse wheel (±100) moves about
 *  16% a click and a trackpad flick stays smooth. */
const WHEEL_ZOOM = 0.0015;

const HEAD_BTN_BASE =
  "grid h-9 w-9 place-items-center rounded-md transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted";
const HEAD_BTN_HOVER = "text-muted hover:bg-foreground/[0.06] hover:text-foreground";
const HEAD_BTN = `${HEAD_BTN_BASE} ${HEAD_BTN_HOVER}`;
const TOOL_BTN_BASE = "flex h-9 items-center gap-1.5 rounded-control px-2.5 text-sm transition";
const SEG = "inline-flex rounded-control border border-border p-0.5 text-xs";
const segBtn = (on: boolean) =>
  `rounded-md px-2 py-1 transition ${on ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`;
const SECTION = `mb-1.5 ${EYEBROW}`;
const DANGER_BTN = "w-full rounded-control border border-border px-3 py-1.5 text-sm text-danger hover:border-danger";
const ZOOM_BTN = "grid h-7 w-7 place-items-center rounded-control border border-border text-muted transition hover:border-accent hover:text-foreground";

type DragState =
  | { mode: "point"; id: string }
  | { mode: "rotate"; ids: string[]; ellipseId: string | null; centroid: [number, number]; startAngle: number }
  | { mode: "rect"; start: [number, number] }
  // Shoving the paper about: the press point in MATH coords, held fixed under
  // the pointer for the whole gesture (recomputing from px each move would
  // compound rounding as the view moves out from under it).
  | { mode: "pan"; grab: [number, number] };

/** The interactive "drawing box": draw/edit a graph, then commit it to the doc. */
export function GraphEditor({
  initial,
  onPick,
  onClose,
}: {
  initial?: GraphData;
  onPick: (data: GraphData) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<GraphData>(() => initial ?? defaultGraph());
  const [tool, setTool] = useState<ToolId>("select");
  const [pending, setPending] = useState<string[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [drawColor, setDrawColor] = useState<string>(SHAPE_PALETTE[0]);
  const [cursor, setCursor] = useState<{ px: number; py: number; mx: number; my: number; snap: SnapTarget | null } | null>(null);
  const [funcExpr, setFuncExpr] = useState("sin(x)");
  const [funcDomain, setFuncDomain] = useState<[string, string]>(["", ""]);
  const [lineExpr, setLineExpr] = useState("y = 2x + 1");
  const [histLen, setHistLen] = useState(0); // mirrors history.current.length for render

  const drag = useRef<DragState | null>(null);
  // Moving the whole dialog (its header is the handle) + the scrim-press guard
  // that keeps a drag ending outside the panel from reading as "click away".
  const panel = useDragPanel();
  const pressOnScrim = useRef(false);
  const dragSnapshot = useRef<GraphData | null>(null); // pre-drag snapshot (undo + rotate base)
  const dragMoved = useRef(false);
  const preConstruct = useRef<GraphData | null>(null); // pre-construction snapshot (multi-click)
  const captionSnapshot = useRef<GraphData | null>(null); // pre-edit snapshot for the caption field
  const history = useRef<GraphData[]>([]);
  const baseline = useRef<GraphData>(initial ?? defaultGraph()); // for dirty-on-close check
  const svgRef = useRef<SVGSVGElement>(null);

  // In No-coordinate mode the view/canvas are derived from the grid counts.
  const geo = useMemo(() => resolveGeometry(data), [data]);
  const W = geo.width;
  const H = geo.height;
  const proj = useMemo(() => makeProj(geo.view, W, H), [geo.view, W, H]);
  const scene = useMemo(() => buildScene(geo, proj), [geo, proj]);
  const tolMath = SNAP_PX / Math.min(proj.sx, proj.sy);

  const pushHistory = (snapshot: GraphData) => {
    history.current.push(snapshot);
    if (history.current.length > 80) history.current.shift();
    setHistLen(history.current.length);
  };

  /** Commit a single-step change, recording history for undo. */
  const apply = useCallback((next: GraphData) => {
    pushHistory(data);
    setData(next);
  }, [data]);

  /** Finalize a multi-click construction as ONE undoable step. */
  const commitConstruct = useCallback((next: GraphData) => {
    pushHistory(preConstruct.current ?? data);
    preConstruct.current = null;
    setData(next);
  }, [data]);

  /** Abort an in-progress multi-click shape, reverting any silently-added points. */
  const cancelConstruction = useCallback(() => {
    if (preConstruct.current) setData(preConstruct.current);
    preConstruct.current = null;
    setPending([]);
  }, []);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (prev) {
      setHistLen(history.current.length);
      setData(prev);
      setPending([]);
      setSelected(null);
      preConstruct.current = null;
    }
  }, []);

  const isDirty = useCallback(() => JSON.stringify(data) !== JSON.stringify(baseline.current), [data]);
  const requestClose = useCallback(() => {
    if (!isDirty()) { onClose(); return; }
    void uiConfirm({
      title: "Discard changes",
      message: "Discard unsaved changes to this graph?",
      confirmLabel: "Discard",
      danger: true,
    }).then((ok) => { if (ok) onClose(); });
  }, [isDirty, onClose]);

  /**
   * Wheel / trackpad zoom, anchored on the pointer.
   *
   * Attached by hand rather than through React's `onWheel`, because React
   * registers wheel listeners passively at the root: `preventDefault` there is
   * ignored (with a console warning) and the dialog would scroll away under the
   * gesture instead of zooming.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || data.coords === "none") return; // no-coordinate grids have no window to move
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const [mx, my] = proj.toMath(
        ((e.clientX - r.left) * W) / (r.width || W),
        ((e.clientY - r.top) * H) / (r.height || H),
      );
      // Line-mode wheels report ~3 lines instead of ~100px; normalise so a mouse
      // and a trackpad zoom by comparable amounts.
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAbout(Math.min(2, Math.max(0.5, Math.exp(delta * WHEEL_ZOOM))), mx, my);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj, W, H, data]);

  // ── keyboard: Esc cancels pending/closes, Del removes selection, Cmd/Ctrl+Z undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        if (pending.length) cancelConstruction();
        else if (selected) setSelected(null);
        else requestClose();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected && !typing) {
        e.preventDefault();
        removeSelected();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, selected, data, undo, cancelConstruction, requestClose]);

  // ── pointer math ────────────────────────────────────────────────────────────
  function evtPos(e: { clientX: number; clientY: number }) {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / (r.width || W);
    const py = ((e.clientY - r.top) * H) / (r.height || H);
    const [mx, my] = proj.toMath(px, py);
    return { px, py, mx, my };
  }

  // ── point creation from a snap target (the "magnet" + exact-midpoint logic) ──
  function pointFromSnap(d: GraphData, snap: SnapTarget | null, mx: number, my: number): { points: GPoint[]; id: string } {
    if (snap?.type === "point") return { points: d.points, id: snap.id };
    if (snap?.type === "midpoint") {
      const existing = d.points.find((p) => p.mid && samePair(p.mid, [snap.a, snap.b]));
      if (existing) return { points: d.points, id: existing.id };
      const id = newGraphId();
      return { points: [...d.points, { id, mid: [snap.a, snap.b] }], id };
    }
    const x = snap ? snap.x : mx;
    const y = snap ? snap.y : my;
    const id = newGraphId();
    return { points: [...d.points, { id, x, y, name: nextName(d.points), showName: true }], id };
  }

  function freePoint(d: GraphData, x: number, y: number): { points: GPoint[]; id: string } {
    const id = newGraphId();
    return { points: [...d.points, { id, x, y, name: nextName(d.points), showName: true }], id };
  }

  /** An unnamed point (e.g. auto-generated rectangle corners — no label clutter). */
  function anonPoint(d: GraphData, x: number, y: number): { points: GPoint[]; id: string } {
    const id = newGraphId();
    return { points: [...d.points, { id, x, y }], id };
  }

  // ── placement (one click = one pointerdown for drawing tools) ────────────────
  // Intermediate clicks of a multi-click shape update state SILENTLY (no history);
  // the whole construction collapses into ONE undo when finalized via commitConstruct.
  function place(mx: number, my: number, snap: SnapTarget | null) {
    const color = drawColor;
    if (pending.length === 0) preConstruct.current = data; // snapshot before first click

    if (tool === "point") {
      const { points, id } = pointFromSnap(data, snap, mx, my);
      commitConstruct({ ...data, points });
      setSelected({ kind: "point", id });
      return;
    }

    if (tool === "ellipse") {
      if (pending.length === 0) {
        const { points, id } = pointFromSnap(data, snap, mx, my);
        setData({ ...data, points }); // silent intermediate
        setPending([id]);
      } else {
        const c = resolvePoint(data, pending[0]);
        if (c) {
          const ex = snap ? snap.x : mx;
          const ey = snap ? snap.y : my;
          const rx = Math.abs(ex - c[0]) || 1;
          const ry = Math.abs(ey - c[1]) || 1;
          const id = newGraphId();
          commitConstruct({ ...data, shapes: [...data.shapes, { id, kind: "ellipse", c: pending[0], rx, ry, color }] });
          setSelected({ kind: "shape", id });
        } else cancelConstruction();
        setPending([]);
        setTool("select"); // ellipse is not a sticky tool
      }
      return;
    }

    // (rectangle is drag-created in the pointer handlers, not here)

    // generic multi-point tools: segment / line / triangle / circle / parabola
    const { points, id } = pointFromSnap(data, snap, mx, my);
    if (pending.includes(id)) return; // reject a duplicate vertex (no degenerate shape)
    const nextData = { ...data, points };
    const nextPending = [...pending, id];
    const needs = TOOLS.find((t) => t.id === tool)?.needs ?? 2;
    if (nextPending.length >= needs) {
      const shape = buildShape(tool, nextPending, color);
      if (shape) {
        commitConstruct({ ...nextData, shapes: [...nextData.shapes, shape] });
        setSelected({ kind: "shape", id: shape.id });
      } else {
        commitConstruct(nextData);
      }
      setPending([]);
      if (!STICKY_TOOLS.has(tool)) setTool("select"); // circle/parabola revert
    } else {
      setData(nextData); // silent intermediate
      setPending(nextPending);
    }
  }

  // ── pointer handlers ─────────────────────────────────────────────────────────

  /** Take pointer capture, if this pointer can be captured — a synthetic or
   *  already-released pointer throws, and losing the gesture to that would be
   *  worse than dragging without capture. */
  function capture(el: Element | null | undefined, pointerId: number) {
    try {
      el?.setPointerCapture(pointerId);
    } catch {
      /* not capturable — the window still gets the moves */
    }
  }

  /** Begin a pan gesture from a press anywhere on the canvas. */
  function startPan(e: React.PointerEvent<SVGSVGElement>, pos: { mx: number; my: number }) {
    drag.current = { mode: "pan", grab: [pos.mx, pos.my] };
    dragSnapshot.current = data;
    dragMoved.current = false;
    setCursor(null); // no snap ring or rubber band while the paper moves
    capture(svgRef.current, e.pointerId);
  }

  /**
   * Two fingers on the canvas = pinch to zoom (and pan with the midpoint), the
   * gesture an iPad user will try first. Tracked here rather than through the
   * `drag` state machine because it is the only gesture that owns two pointers.
   */
  const pinch = useRef<Map<number, { px: number; py: number }>>(new Map());
  const pinchLast = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const pinchMetrics = () => {
    const [a, b] = [...pinch.current.values()];
    if (!a || !b) return null;
    const mid = proj.toMath((a.px + b.px) / 2, (a.py + b.py) / 2);
    return { dist: Math.hypot(a.px - b.px, a.py - b.py), mx: mid[0], my: mid[1] };
  };

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const pos = evtPos(e);
    if (!pos) return;

    // Second finger down: abandon whatever one-finger gesture was in progress
    // (it was the start of this pinch) and start pinching. A single touch is
    // only REMEMBERED here — it goes on to draw/drag like a mouse press.
    if (e.pointerType === "touch") {
      pinch.current.set(e.pointerId, { px: pos.px, py: pos.py });
      if (pinch.current.size === 2) {
        // Revert the stray one-finger drag, and keep ITS pre-drag snapshot as
        // the pinch's undo point (`data` here may be the dragged state).
        const before = dragSnapshot.current ?? data;
        if (dragSnapshot.current) setData(dragSnapshot.current);
        drag.current = null;
        dragSnapshot.current = before;
        dragMoved.current = false;
        pinchLast.current = pinchMetrics();
        cancelConstruction();
        return;
      }
    }

    // Middle-button drag pans in ANY tool — the mouse convention, so a drawing
    // tool doesn't have to be put down to move the view.
    if (e.button === 1) {
      e.preventDefault();
      startPan(e, pos);
      return;
    }

    if (tool === "select") {
      // Grab the rotation handle first (it floats above the selected shape).
      if (rotInfo && Math.hypot(pos.px - rotInfo.hx, pos.py - rotInfo.hy) <= HIT_PX + 3 && selShape) {
        drag.current = {
          mode: "rotate",
          ids: rotatablePointIds(selShape),
          ellipseId: selShape.kind === "ellipse" ? selShape.id : null,
          centroid: rotInfo.cm,
          startAngle: Math.atan2(pos.my - rotInfo.cm[1], pos.mx - rotInfo.cm[0]),
        };
        dragSnapshot.current = data;
        dragMoved.current = false;
        capture(svgRef.current, e.pointerId);
        return;
      }
      const hit = hitTest(scene, pos.px, pos.py);
      if (hit?.kind === "point") {
        setSelected(hit);
        const p = data.points.find((q) => q.id === hit.id);
        if (p && !p.mid) {
          drag.current = { mode: "point", id: hit.id }; // only free points are draggable
          dragSnapshot.current = data;
          dragMoved.current = false;
          capture(svgRef.current, e.pointerId);
        }
        return;
      }
      if (hit) { setSelected(hit); return; }
      // Empty canvas: drag it to move the window. A press that never moves is
      // still just a click, and still deselects (see onPointerUp).
      startPan(e, pos);
      return;
    }

    if (tool === "rectangle") {
      // Drag-create: press at one corner, release at the opposite corner.
      const snap = findSnap(geo, pos.mx, pos.my, tolMath, { midpoints: false });
      drag.current = { mode: "rect", start: [snap ? snap.x : pos.mx, snap ? snap.y : pos.my] };
      dragMoved.current = false;
      setCursor({ ...pos, snap });
      capture(svgRef.current, e.pointerId);
      return;
    }

    // The Function tool is driven from the panel, not the canvas: an equation
    // has no vertices to click. Falling through to place() would drop a stray
    // labelled point AND — because a 0-vertex tool "finishes" on its first
    // click — revert to Select, taking the equation panel away with it.
    if (tool === "function") return;

    const snap = findSnap(geo, pos.mx, pos.my, tolMath);
    place(pos.mx, pos.my, snap);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const pos = evtPos(e);
    if (!pos) return;
    const dr = drag.current;

    // Pinch (two fingers) outranks everything else on the canvas.
    if (pinch.current.has(e.pointerId)) {
      pinch.current.set(e.pointerId, { px: pos.px, py: pos.py });
      const now = pinchMetrics();
      const was = pinchLast.current;
      if (now && was && now.dist > 0 && was.dist > 0) {
        dragMoved.current = true;
        // Fingers apart → dist grows → span shrinks → zoom in. Panning comes
        // free: zooming about the CURRENT midpoint carries the view with it.
        setData((d) => {
          const view = zoomView(d.view, was.dist / now.dist, now.mx, now.my);
          return view === d.view ? d : { ...d, view };
        });
        pinchLast.current = now;
      }
      return;
    }

    if (dr?.mode === "pan") {
      // Keep the grabbed math point under the pointer: shift the view by how
      // far it has slid away from the grab.
      dragMoved.current = true;
      setData((d) => ({ ...d, view: panView(d.view, dr.grab[0] - pos.mx, dr.grab[1] - pos.my) }));
      return;
    }
    if (dr?.mode === "point") {
      const snap = findSnap(geo, pos.mx, pos.my, tolMath, { midpoints: false, exclude: new Set([dr.id]) });
      const x = snap ? snap.x : pos.mx;
      const y = snap ? snap.y : pos.my;
      dragMoved.current = true;
      setData((d) => ({ ...d, points: d.points.map((p) => (p.id === dr.id ? { ...p, x, y } : p)) }));
      setCursor({ ...pos, snap });
      return;
    }
    if (dr?.mode === "rotate") {
      const ang = Math.atan2(pos.my - dr.centroid[1], pos.mx - dr.centroid[0]);
      dragMoved.current = true;
      const base = dragSnapshot.current ?? data;
      setData(rotateShapeData(base, dr.ids, dr.ellipseId, dr.centroid, ang - dr.startAngle));
      setCursor({ ...pos, snap: null });
      return;
    }
    if (dr?.mode === "rect") {
      const snap = findSnap(geo, pos.mx, pos.my, tolMath, { midpoints: false });
      dragMoved.current = true;
      setCursor({ ...pos, snap });
      return;
    }

    const snap = tool === "select" || tool === "function" ? null : findSnap(geo, pos.mx, pos.my, tolMath);
    setCursor({ ...pos, snap });
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    // A finger leaving ends the pinch (the other one does NOT become a pan —
    // that would jerk the view as the remaining finger lifts). A lone touch was
    // only being tracked in case a second finger arrived, so it falls through
    // to the ordinary end-of-drag handling below.
    const wasPinching = pinch.current.size === 2;
    const wasTouch = pinch.current.delete(e.pointerId);
    if (wasTouch && wasPinching) {
      pinchLast.current = null;
      if (dragMoved.current && dragSnapshot.current) pushHistory(dragSnapshot.current);
      dragSnapshot.current = null;
      dragMoved.current = false;
      return;
    }

    const dr = drag.current;
    if (!dr) return;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (dr.mode === "pan") {
      // Moved → one undo step for the whole pan. Never moved → it was a click
      // on empty canvas, which clears the selection.
      if (dragMoved.current && dragSnapshot.current) pushHistory(dragSnapshot.current);
      else setSelected(null);
    } else if (dr.mode === "point" || dr.mode === "rotate") {
      // Record the PRE-drag snapshot for undo (drag mutated state directly).
      if (dragMoved.current && dragSnapshot.current) pushHistory(dragSnapshot.current);
    } else if (dr.mode === "rect") {
      const pos = evtPos(e);
      const snap = pos ? findSnap(geo, pos.mx, pos.my, tolMath, { midpoints: false }) : null;
      const ex = snap ? snap.x : pos ? pos.mx : dr.start[0];
      const ey = snap ? snap.y : pos ? pos.my : dr.start[1];
      const [sx, sy] = dr.start;
      // Require a minimum on-screen size so a stray click doesn't make a dot-rect.
      if (Math.abs((ex - sx) * proj.sx) >= 6 && Math.abs((ey - sy) * proj.sy) >= 6) {
        const color = drawColor;
        // Axis-aligned by default; A & C (the dragged corners) named, B & D anon.
        const cA = freePoint(data, sx, sy);
        let pts = cA.points;
        const b = anonPoint({ ...data, points: pts }, ex, sy);
        pts = b.points;
        const cC = freePoint({ ...data, points: pts }, ex, ey);
        pts = cC.points;
        const dd = anonPoint({ ...data, points: pts }, sx, ey);
        pts = dd.points;
        const id = newGraphId();
        apply({ ...data, points: pts, shapes: [...data.shapes, { id, kind: "polygon", pts: [cA.id, b.id, cC.id, dd.id], color }] });
        setSelected({ kind: "shape", id });
      }
      setCursor(null);
      setTool("select"); // rectangle is not a sticky tool
    }
    drag.current = null;
    dragSnapshot.current = null;
    dragMoved.current = false;
  }

  // ── mutations on the current selection ────────────────────────────────────────
  function removeSelected() {
    if (!selected) return;
    if (selected.kind === "shape") {
      apply({ ...data, shapes: data.shapes.filter((s) => s.id !== selected.id) });
    } else {
      apply(deletePoint(data, selected.id));
    }
    setSelected(null);
    setPending([]);
  }

  function updatePoint(id: string, patch: Partial<GPoint>) {
    apply({ ...data, points: data.points.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }

  /** Set the line color: the default for new shapes + the current selection. */
  function applyLine(c: string) {
    setDrawColor(c);
    if (selShape) updateShape(selShape.id, { color: c } as Partial<GShape>);
  }

  function updateShape(id: string, patch: Partial<GShape>) {
    apply({
      ...data,
      shapes: data.shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as GShape) : s)),
    });
  }

  /** Add the line `lineExpr` describes, anchored by two points inside the view. */
  function addLineFromEquation() {
    const k = parseLineEquation(lineExpr);
    if (!k) return;
    const [p, q] = lineAnchors(geo.view, k);
    // Anonymous anchors: an equation names a line, not the two points that
    // happen to hold it — labelled dots here would read as part of the answer.
    const first = anonPoint(data, p[0], p[1]);
    const second = anonPoint({ ...data, points: first.points }, q[0], q[1]);
    const id = newGraphId();
    apply({
      ...data,
      points: second.points,
      shapes: [...data.shapes, { id, kind: "line", a: first.id, b: second.id, color: drawColor }],
    });
    setSelected({ kind: "shape", id });
  }

  /**
   * Re-place a line from a retyped equation. Returns false (rejecting the edit)
   * when the text isn't a line.
   *
   * Its own anchors move when they belong to it alone; when they are shared —
   * a vertex of another shape, or the parent of a midpoint — the line gets
   * fresh anchors instead, so retyping an equation never drags an unrelated
   * shape across the canvas with it.
   */
  function applyLineEquation(shape: Extract<GShape, { kind: "line" }>, src: string): boolean {
    const k = parseLineEquation(src);
    if (!k) return false;
    const [p, q] = lineAnchors(geo.view, k);
    const ids = new Set([shape.a, shape.b]);
    const shared =
      data.shapes.some((s) => s.id !== shape.id && shapeUsesAny(s, ids)) ||
      data.points.some((pt) => (ids.has(pt.id) && pt.mid) || (pt.mid && (ids.has(pt.mid[0]) || ids.has(pt.mid[1]))));
    if (shared) {
      const first = anonPoint(data, p[0], p[1]);
      const second = anonPoint({ ...data, points: first.points }, q[0], q[1]);
      apply({
        ...data,
        points: second.points,
        shapes: data.shapes.map((s) => (s.id === shape.id ? { ...s, a: first.id, b: second.id } : s)),
      });
    } else {
      apply({
        ...data,
        points: data.points.map((pt) =>
          pt.id === shape.a ? { ...pt, x: p[0], y: p[1] } : pt.id === shape.b ? { ...pt, x: q[0], y: q[1] } : pt,
        ),
      });
    }
    return true;
  }

  function addFunction() {
    if (!isValidExpr(funcExpr, [data.coords === "polar" ? "theta" : "x", "x", "t", "theta"])) return;
    const lo = parseFloat(funcDomain[0]);
    const hi = parseFloat(funcDomain[1]);
    const domain: [number, number] | undefined =
      Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : undefined;
    const id = newGraphId();
    apply({ ...data, shapes: [...data.shapes, { id, kind: "function", expr: funcExpr, domain, color: drawColor }] });
    setSelected({ kind: "shape", id });
    setTool("select"); // function is not a sticky tool
  }

  /** Returns false (rejecting the edit) when the patch would invert the view. */
  function setView(patch: Partial<GraphData["view"]>): boolean {
    const v = { ...data.view, ...patch };
    if (!(v.xmax > v.xmin && v.ymax > v.ymin)) return false;
    apply({ ...data, view: v });
    return true;
  }

  // ── moving the window (pan / zoom / frame size) ──────────────────────────────
  /**
   * Zoom about a math point, re-stepping the grid so it stays readable.
   *
   * Continuous gestures (wheel, pinch) call this many times a second, so they
   * must not each be an undo step: `commitZoom` snapshots once at the start of a
   * burst and then writes straight to the data, the same way a point drag
   * records one snapshot at pointerdown.
   */
  const zoomLastAt = useRef(0);
  function zoomAbout(k: number, ax: number, ay: number) {
    const now = Date.now();
    if (now - zoomLastAt.current > ZOOM_BURST_MS) pushHistory(data);
    zoomLastAt.current = now;
    setData((d) => {
      const view = zoomView(d.view, k, ax, ay);
      if (view === d.view) return d; // at the zoom stops
      return { ...d, view, gridStep: niceStep(Math.min(view.xmax - view.xmin, view.ymax - view.ymin)) };
    });
  }
  /** Zoom about the middle of the view — the +/− buttons and ⌘+ / ⌘−. */
  const zoomCentre = (k: number) => {
    const v = geo.view;
    zoomAbout(k, (v.xmin + v.xmax) / 2, (v.ymin + v.ymax) / 2);
  };
  /** Back to the default window, keeping everything else. */
  function resetView() {
    apply({ ...data, view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5 }, gridStep: 1 });
  }
  /** Resize the drawing frame (the canvas in px — also the TikZ aspect ratio). */
  function setFrame(patch: { width?: number; height?: number }): boolean {
    const width = Math.round(patch.width ?? data.width);
    const height = Math.round(patch.height ?? data.height);
    if (width < MIN_FRAME || height < MIN_FRAME || width > MAX_FRAME || height > MAX_FRAME) return false;
    apply({ ...data, width, height });
    return true;
  }

  /**
   * The frame's corner grip — drag it to resize the canvas.
   *
   * Its own pointer handlers rather than the canvas drag machine: the grip sits
   * outside the SVG (resizing it while measuring pointer positions against it
   * would fight itself), and the gesture is one snapshot plus straight writes,
   * like a pan.
   */
  const sizeGrab = useRef<{ x: number; y: number; w: number; h: number; id: number } | null>(null);
  function onGripDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    sizeGrab.current = { x: e.clientX, y: e.clientY, w: data.width, h: data.height, id: e.pointerId };
    dragSnapshot.current = data;
    dragMoved.current = false;
    capture(e.currentTarget, e.pointerId);
    e.preventDefault();
  }
  function onGripMove(e: React.PointerEvent<HTMLButtonElement>) {
    const g = sizeGrab.current;
    if (!g || g.id !== e.pointerId) return;
    const clamp = (n: number) => Math.min(MAX_FRAME, Math.max(MIN_FRAME, Math.round(n)));
    dragMoved.current = true;
    setData((d) => ({ ...d, width: clamp(g.w + (e.clientX - g.x)), height: clamp(g.h + (e.clientY - g.y)) }));
  }
  function onGripUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (sizeGrab.current?.id !== e.pointerId) return;
    sizeGrab.current = null;
    if (dragMoved.current && dragSnapshot.current) pushHistory(dragSnapshot.current);
    dragSnapshot.current = null;
    dragMoved.current = false;
  }

  function setCoords(c: CoordSystem) {
    apply({ ...data, coords: c });
  }

  // ── derived render bits ───────────────────────────────────────────────────────
  const selPoint = selected?.kind === "point" ? data.points.find((p) => p.id === selected.id) : null;
  const selShape = selected?.kind === "shape" ? data.shapes.find((s) => s.id === selected.id) : null;
  /** A line's equation, derived from its two points (empty if unresolvable). */
  const lineText = (s: Extract<GShape, { kind: "line" }>): string => {
    const a = resolvePoint(geo, s.a);
    const b = resolvePoint(geo, s.b);
    return a && b ? lineEquationText(a, b) : "";
  };
  // Rotation handle for the selected (rotatable) shape — a knob floating above it.
  const rotInfo = selShape && rotatable(selShape)
    ? (() => {
        const cm = shapeCentroid(data, selShape);
        if (!cm) return null;
        const [cx, cy] = proj.toPx(...cm);
        return { cm, cx, cy, hx: cx, hy: cy - 34 };
      })()
    : null;
  // Rectangle drag-create preview (read the ref during a cursor-driven re-render).
  const rectDrag = drag.current?.mode === "rect" ? drag.current : null;
  let preview: SceneItem[] = [];
  if (rectDrag && cursor) {
    const ex = cursor.snap ? cursor.snap.x : cursor.mx;
    const ey = cursor.snap ? cursor.snap.y : cursor.my;
    const [sx, sy] = rectDrag.start;
    const corners: Array<[number, number]> = [[sx, sy], [ex, sy], [ex, ey], [sx, ey]];
    preview = [{ t: "polyline", pts: corners.map((p) => proj.toPx(...p)), closed: true, stroke: "var(--accent)", dash: true, width: 1.5 }];
  } else if (cursor && tool !== "select" && tool !== "function") {
    preview = previewPrims(data, proj, tool, pending, cursor);
  }
  const snapPx = cursor?.snap ? proj.toPx(cursor.snap.x, cursor.snap.y) : null;
  const hint = HINTS[tool];

  return (
    <div
      className="print-hide fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 p-4"
      // Dismiss only when the PRESS started on the scrim: a drag that begins on
      // the panel (moving the window, dragging a point past the canvas edge) and
      // releases out here dispatches its click on the scrim, and must not close
      // the editor and lose the graph.
      onPointerDown={(e) => { pressOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const wasScrim = pressOnScrim.current;
        pressOnScrim.current = false;
        if (wasScrim && e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panel.ref}
        style={panel.style}
        className="mt-6 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header — also the drag handle: the graph you are drawing is usually
            about something further up the note, and this gets out of its way. */}
        <div {...panel.handleProps} className={`flex items-center justify-between border-b border-border-soft px-5 py-4 ${DRAG_HANDLE}`}>
          <h2 className="text-base font-semibold">{initial ? "Edit graph" : "Insert a graph"}</h2>
          <div className="flex items-center gap-1">
            <button onClick={undo} title="Undo (⌘Z)" aria-label="Undo" className={HEAD_BTN} disabled={histLen === 0}>
              <Icon name="undo" size={18} />
            </button>
            <button onClick={requestClose} title="Cancel (Esc)" aria-label="Close" className={HEAD_BTN}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        {/* tool palette */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => { cancelConstruction(); setTool(t.id); }}
              title={t.label}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              className={`${TOOL_BTN_BASE} ${tool === t.id ? "bg-accent-soft text-accent" : HEAD_BTN_HOVER}`}
            >
              <Icon name={t.icon} size={18} />
              <span className="hidden sm:inline">{t.label.split(" ")[0]}</span>
            </button>
          ))}
          <span className="mx-1 h-7 w-px bg-border" />
          <span className="text-xs text-muted">Line</span>
          {SHAPE_PALETTE.map((c) => (
            <button key={c} onClick={() => applyLine(c)} title={c} className={`h-6 w-6 rounded-full border-2 ${drawColor === c ? "border-foreground" : "border-transparent"}`} style={{ background: c }} />
          ))}
          <input type="color" value={drawColor} onChange={(e) => applyLine(e.target.value)} title="Custom line color" className="h-7 w-7 cursor-pointer rounded-md border border-border bg-transparent p-0" />
        </div>

        <div className="flex min-h-0 flex-1">
          {/* canvas */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 overflow-auto bg-background/40 p-4">
              {/* The wrapper is exactly the canvas: it carries the resize grip
                  at the frame's corner, and stays centred like the svg did. */}
              <div className="relative mx-auto" style={{ width: W, height: H }}>
              <svg
                ref={svgRef}
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={() => setCursor(null)}
                className="block touch-none rounded-md border border-border bg-surface text-foreground"
                style={{ cursor: tool === "select" ? (drag.current?.mode === "pan" ? "grabbing" : "grab") : "crosshair" }}
              >
                <SceneBase scene={scene} />
                <g>
                  {scene.shapes.map((s, i) => (
                    <g key={`s${i}`}>
                      {s.shapeId && selected?.id === s.shapeId && <Highlight item={s} />}
                      {renderItem(s, `si${i}`)}
                    </g>
                  ))}
                </g>
                {/* rubber-band preview */}
                <g opacity={0.6}>{preview.map((p, i) => renderItem(p, `p${i}`))}</g>
                <g>
                  {scene.points.map((p) => (
                    <g key={p.id}>
                      {selected?.kind === "point" && selected.id === p.id && (
                        <circle cx={p.px} cy={p.py} r={7} fill="none" stroke="var(--accent)" strokeWidth={2} />
                      )}
                      {pending.includes(p.id) && (
                        <circle cx={p.px} cy={p.py} r={7} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="3 3" />
                      )}
                      {renderPoint(p)}
                    </g>
                  ))}
                </g>
                {/* rotation handle for the selected shape */}
                {rotInfo && (
                  <g style={{ cursor: "grab" }}>
                    <line x1={rotInfo.cx} y1={rotInfo.cy} x2={rotInfo.hx} y2={rotInfo.hy} stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="2 2" />
                    <circle cx={rotInfo.hx} cy={rotInfo.hy} r={5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />
                  </g>
                )}
                {/* snap magnet ring */}
                {snapPx && (
                  <circle cx={snapPx[0]} cy={snapPx[1]} r={6} fill="none" stroke="var(--accent)" strokeWidth={2} />
                )}
              </svg>
                {/* Frame resize grip. In No-coordinate mode the canvas size is
                    derived from the cell counts, so there is nothing to drag. */}
                {data.coords !== "none" && (
                  <button
                    onPointerDown={onGripDown}
                    onPointerMove={onGripMove}
                    onPointerUp={onGripUp}
                    onPointerCancel={onGripUp}
                    title={`Drag to resize the frame (${W} × ${H})`}
                    aria-label="Resize the graph frame"
                    className="absolute -bottom-1 -right-1 grid h-5 w-5 cursor-nwse-resize touch-none place-items-center rounded-sm border border-border bg-surface text-muted shadow-sm hover:border-accent hover:text-accent"
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
                      <path d="M7 1 1 7M7 4 4 7" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
              <p className="mt-3 text-center text-xs text-muted">{hint}</p>
              {data.coords !== "none" && (
                <p className="mt-1 text-center text-[11px] text-faint">
                  Drag the empty canvas to move the graph · scroll or pinch to zoom · drag the corner to resize the frame
                </p>
              )}
            </div>
          </div>

          {/* side panel */}
          <div className="w-64 shrink-0 space-y-4 overflow-y-auto border-l border-border p-3 text-sm">
            {/* coordinate system + view */}
            <section>
              <h3 className={SECTION}>Coordinates</h3>
              <div className={`mb-2 ${SEG}`}>
                {([["none", "No coordinate"], ["rect", "Rectangular"], ["polar", "Polar"]] as Array<[CoordSystem, string]>).map(([c, lbl]) => (
                  <button key={c} onClick={() => setCoords(c)} className={segBtn(data.coords === c)}>
                    {lbl}
                  </button>
                ))}
              </div>
              {data.coords === "none" ? (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumField label="horiz" value={data.gridCols} onCommit={(v) => v >= 1 && apply({ ...data, gridCols: Math.round(v) })} />
                    <NumField label="vert" value={data.gridRows} onCommit={(v) => v >= 1 && apply({ ...data, gridRows: Math.round(v) })} />
                  </div>
                  <div className={`mt-2 ${SEG}`}>
                    {([["complete", "Complete grid"], ["open", "Open edges"]] as Array<[GraphData["gridFill"], string]>).map(([f, lbl]) => (
                      <button key={f} onClick={() => apply({ ...data, gridFill: f })} className={segBtn(data.gridFill === f)}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  <label className="mt-2 flex items-center gap-1.5 text-xs">
                    <Toggle on={data.showGrid} onClick={() => apply({ ...data, showGrid: !data.showGrid })} /> show grid
                  </label>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted">A blank cols × rows grid (no axes). “Open edges” adds partial outer cells that aren’t counted; turn the grid off for a fully blank canvas.</p>
                </>
              ) : (
                <>
                  {/* The window: drag/scroll on the canvas does this by hand;
                      these are for saying it exactly. */}
                  <div className="mb-2 flex items-center gap-1">
                    <button onClick={() => zoomCentre(1 / 1.4)} title="Zoom in" aria-label="Zoom in" className={ZOOM_BTN}>
                      <Icon name="plus" size={14} />
                    </button>
                    <button onClick={() => zoomCentre(1.4)} title="Zoom out" aria-label="Zoom out" className={ZOOM_BTN}>
                      <Icon name="minus" size={14} />
                    </button>
                    <button onClick={resetView} title="Back to the default window (−5…5)" className="ml-auto rounded-control border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-foreground">
                      Reset view
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumField label="x min" value={data.view.xmin} onCommit={(v) => setView({ xmin: v })} />
                    <NumField label="x max" value={data.view.xmax} onCommit={(v) => setView({ xmax: v })} />
                    <NumField label="y min" value={data.view.ymin} onCommit={(v) => setView({ ymin: v })} />
                    <NumField label="y max" value={data.view.ymax} onCommit={(v) => setView({ ymax: v })} />
                    <NumField label="grid" value={data.gridStep} onCommit={(v) => v > 0 && apply({ ...data, gridStep: v })} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                    <label className="flex items-center gap-1.5">
                      <Toggle on={data.showGrid} onClick={() => apply({ ...data, showGrid: !data.showGrid })} /> grid
                    </label>
                    <label className="flex items-center gap-1.5">
                      <Toggle on={data.showNumbers} onClick={() => apply({ ...data, showNumbers: !data.showNumbers })} /> numbers
                    </label>
                    <label className="flex items-center gap-1.5">
                      <Toggle on={data.axisArrows} onClick={() => apply({ ...data, axisArrows: !data.axisArrows })} /> arrows
                    </label>
                  </div>
                </>
              )}
            </section>

            {/* frame size — how big the figure is, independent of what it shows */}
            {data.coords !== "none" && (
              <section>
                <h3 className={SECTION}>Frame</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  <NumField label="width" value={data.width} onCommit={(v) => setFrame({ width: v })} />
                  <NumField label="height" value={data.height} onCommit={(v) => setFrame({ height: v })} />
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  The figure&rsquo;s size in the note (and its aspect ratio in the .tex). Drag the corner of the canvas for the same thing by hand.
                </p>
              </section>
            )}

            {/* line entry — the typed alternative to clicking two points */}
            {tool === "line" && (
              <section>
                <h3 className={SECTION}>Line equation</h3>
                <input
                  value={lineExpr}
                  onChange={(e) => setLineExpr(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addLineFromEquation(); }}
                  placeholder="y = 2x + 1"
                  className={`w-full rounded-md border bg-background px-2 py-1 font-mono text-sm outline-none ${
                    isValidLineEquation(lineExpr) ? "border-border focus:border-accent" : "border-danger"
                  }`}
                />
                <button onClick={addLineFromEquation} className="mt-2 w-full rounded-md bg-accent px-2 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50" disabled={!isValidLineEquation(lineExpr)}>Add line</button>
                <p className="mt-1 text-[11px] leading-snug text-muted">Also takes x = 3, 2x + 3y = 6, or a bare 2x + 1. The line stays draggable afterwards.</p>
              </section>
            )}

            {/* function entry */}
            {tool === "function" && (
              <section>
                <h3 className={SECTION}>
                  {data.coords === "polar" ? "r(θ) =" : "y = f(x)"}
                </h3>
                <input
                  value={funcExpr}
                  onChange={(e) => setFuncExpr(e.target.value)}
                  placeholder={data.coords === "polar" ? "1 + cos(theta)" : "sin(x)"}
                  className={`w-full rounded-md border bg-background px-2 py-1 font-mono text-sm outline-none ${
                    isValidExpr(funcExpr, ["x", "theta", "t"]) ? "border-border focus:border-accent" : "border-danger"
                  }`}
                />
                <div className="mt-1.5 flex items-center gap-1 text-xs">
                  <span className="text-muted">domain</span>
                  <input value={funcDomain[0]} onChange={(e) => setFuncDomain([e.target.value, funcDomain[1]])} placeholder="auto" className="w-14 rounded-md border border-border bg-background px-1 text-center outline-none focus:border-accent" />
                  <Icon name="moveright" size={13} className="shrink-0 text-muted" />
                  <input value={funcDomain[1]} onChange={(e) => setFuncDomain([funcDomain[0], e.target.value])} placeholder="auto" className="w-14 rounded-md border border-border bg-background px-1 text-center outline-none focus:border-accent" />
                </div>
                <button onClick={addFunction} className="mt-2 w-full rounded-md bg-accent px-2 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50" disabled={!isValidExpr(funcExpr, ["x", "theta", "t"])}>Plot</button>
                <p className="mt-1 text-[11px] leading-snug text-muted">Use x{data.coords === "polar" ? " or theta" : ""}, +−×÷, ^, sin, cos, sqrt, ln, pi…</p>
              </section>
            )}

            {/* selected point */}
            {selPoint && (
              <section>
                <h3 className={SECTION}>Point</h3>
                <label className="mb-1.5 flex items-center gap-2">
                  <span className="text-muted">Name</span>
                  <input value={selPoint.name ?? ""} onChange={(e) => updatePoint(selPoint.id, { name: e.target.value || undefined })} className="w-full rounded-md border border-border bg-background px-2 py-0.5 outline-none focus:border-accent" />
                </label>
                <label className="mb-2 flex items-center gap-1.5 text-xs">
                  <Toggle on={selPoint.showName ?? !!selPoint.name} onClick={() => updatePoint(selPoint.id, { showName: !(selPoint.showName ?? !!selPoint.name) })} /> show label
                </label>
                {selPoint.mid ? (
                  <p className="text-xs text-muted">Midpoint (auto-updates).</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumField label="x" value={selPoint.x ?? 0} onCommit={(v) => updatePoint(selPoint.id, { x: v })} />
                    <NumField label="y" value={selPoint.y ?? 0} onCommit={(v) => updatePoint(selPoint.id, { y: v })} />
                  </div>
                )}
                <button onClick={removeSelected} className={`mt-2 ${DANGER_BTN}`}>Delete point</button>
              </section>
            )}

            {/* selected shape */}
            {selShape && (
              <section>
                <h3 className={SECTION}>{selShape.kind}</h3>
                {selShape.kind === "function" && (
                  <input value={selShape.expr} onChange={(e) => updateShape(selShape.id, { expr: e.target.value } as Partial<GShape>)} className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-sm outline-none focus:border-accent" />
                )}
                {selShape.kind === "line" && (
                  <EquationField
                    // Read back off the two points, so the equation shown is
                    // always the line on screen — including after a drag.
                    value={lineText(selShape)}
                    onCommit={(src) => applyLineEquation(selShape, src)}
                  />
                )}
                {selShape.kind === "ellipse" && (
                  <div className="mb-2 grid grid-cols-2 gap-1.5">
                    <NumField label="rx" value={selShape.rx} onCommit={(v) => v > 0 && updateShape(selShape.id, { rx: v } as Partial<GShape>)} />
                    <NumField label="ry" value={selShape.ry} onCommit={(v) => v > 0 && updateShape(selShape.id, { ry: v } as Partial<GShape>)} />
                  </div>
                )}
                <ColorField label="Line" value={"color" in selShape ? selShape.color : undefined} onChange={(c) => updateShape(selShape.id, { color: c } as Partial<GShape>)} />
                {(selShape.kind === "polygon" || selShape.kind === "circle" || selShape.kind === "ellipse") && (
                  <ColorField
                    label="Fill"
                    value={"fillColor" in selShape ? selShape.fillColor : undefined}
                    onChange={(c) => updateShape(selShape.id, { fillColor: c } as Partial<GShape>)}
                    onClear={() => updateShape(selShape.id, { fillColor: undefined } as Partial<GShape>)}
                  />
                )}
                <button onClick={removeSelected} className={DANGER_BTN}>Delete shape</button>
              </section>
            )}
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
          <input
            value={data.caption ?? ""}
            onFocus={() => { captionSnapshot.current = data; }}
            onChange={(e) => setData((d) => ({ ...d, caption: e.target.value || undefined }))}
            onBlur={() => {
              const snap = captionSnapshot.current;
              captionSnapshot.current = null;
              // Record exactly one undoable step per caption edit session.
              if (snap && snap.caption !== data.caption) pushHistory(snap);
            }}
            placeholder="Caption (optional)…"
            className="w-56 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <span className="hidden text-xs text-muted sm:inline">{data.points.length} pt · {data.shapes.length} shape</span>
          <div className="ml-auto flex gap-2">
            <button onClick={requestClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent">Cancel</button>
            <button onClick={() => onPick(data)} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">{initial ? "Save" : "Insert"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── small components ─────────────────────────────────────────────────────────

/** A Graphite toggle switch (same markup as SettingsDialog's). */
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/** Numeric field committed on blur/Enter. `onCommit` may return false to reject
 *  the value, which resets the text back to the model's current value. */
function NumField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => boolean | void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = parseFloat(text);
    if (!Number.isFinite(v) || onCommit(v) === false) setText(String(value));
  };
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="w-8 text-muted">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full rounded-md border border-border bg-background px-1 py-0.5 text-center outline-none focus:border-accent"
      />
    </label>
  );
}

/** A line's equation, committed on blur/Enter. `onCommit` returns false to
 *  reject the text, which resets the field to the line's actual equation. */
function EquationField({ value, onCommit }: { value: string; onCommit: (src: string) => boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      // Untouched text commits nothing: clicking into the field and out again
      // must not re-place the line's anchors (or spend an undo step doing it).
      onBlur={() => { if (text !== value && !onCommit(text)) setText(value); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      aria-label="Line equation"
      className={`mb-2 w-full rounded-md border bg-background px-2 py-1 font-mono text-sm outline-none ${
        isValidLineEquation(text) ? "border-border focus:border-accent" : "border-danger"
      }`}
    />
  );
}

/** Preset swatches + a native color-wheel input. `onClear` adds a "none" option. */
function ColorField({ label, value, onChange, onClear }: { label: string; value?: string; onChange: (c: string) => void; onClear?: () => void }) {
  const hex = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        <span className="flex items-center gap-1">
          {onClear && (
            <button onClick={onClear} className={`rounded border px-1 text-[10px] ${value ? "border-border text-muted hover:border-accent" : "border-accent text-accent"}`}>none</button>
          )}
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} title={`Custom ${label.toLowerCase()} color`} className="h-6 w-6 cursor-pointer rounded-md border border-border bg-transparent p-0" />
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SHAPE_PALETTE.map((c) => (
          <button key={c} onClick={() => onChange(c)} title={c} className={`h-5 w-5 rounded-full border-2 ${value === c ? "border-foreground" : "border-transparent"}`} style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

/** A translucent accent underlay marking the selected shape. */
function Highlight({ item }: { item: SceneItem }) {
  if (item.t === "ellipse") {
    return <ellipse cx={item.cx} cy={item.cy} rx={item.rx} ry={item.ry} fill="none" stroke="var(--accent)" strokeWidth={6} opacity={0.25} />;
  }
  const d = item.pts.map(([x, y]) => `${x},${y}`).join(" ");
  return item.closed ? (
    <polygon points={d} fill="none" stroke="var(--accent)" strokeWidth={6} opacity={0.25} />
  ) : (
    <polyline points={d} fill="none" stroke="var(--accent)" strokeWidth={6} opacity={0.25} />
  );
}
