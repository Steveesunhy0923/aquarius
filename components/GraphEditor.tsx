"use client";

import { Icon } from "@/components/Icon";
import { renderItem, renderPoint, SceneBase } from "@/components/GraphView";
import { uiConfirm } from "@/components/ui/dialogs";
import {
  buildScene,
  defaultGraph,
  findSnap,
  makeProj,
  newGraphId,
  resolveGeometry,
  resolvePoint,
  SHAPE_PALETTE,
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
  nextName,
  previewPrims,
  rotatable,
  rotatablePointIds,
  rotateShapeData,
  samePair,
  shapeCentroid,
  STICKY_TOOLS,
  TOOLS,
  type Selection,
  type ToolId,
} from "@/lib/blocks/graph-edit";
import { isValidExpr } from "@/lib/blocks/expr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SNAP_PX = 12; // magnet radius

const HEAD_BTN_BASE =
  "grid h-9 w-9 place-items-center rounded-md transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted";
const HEAD_BTN_HOVER = "text-muted hover:bg-foreground/[0.06] hover:text-foreground";
const HEAD_BTN = `${HEAD_BTN_BASE} ${HEAD_BTN_HOVER}`;
const TOOL_BTN_BASE = "flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm transition";
const SEG = "inline-flex rounded-lg border border-border p-0.5 text-xs";
const segBtn = (on: boolean) =>
  `rounded-md px-2 py-1 transition ${on ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`;
const SECTION = "mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted";
const DANGER_BTN = "w-full rounded-md border border-border px-3 py-1.5 text-sm text-red-500 hover:border-red-500";

type DragState =
  | { mode: "point"; id: string }
  | { mode: "rotate"; ids: string[]; ellipseId: string | null; centroid: [number, number]; startAngle: number }
  | { mode: "rect"; start: [number, number] };

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
  const [histLen, setHistLen] = useState(0); // mirrors history.current.length for render

  const drag = useRef<DragState | null>(null);
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
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const pos = evtPos(e);
    if (!pos) return;

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
        svgRef.current?.setPointerCapture(e.pointerId);
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
          svgRef.current?.setPointerCapture(e.pointerId);
        }
      } else {
        setSelected(hit ?? null);
      }
      return;
    }

    if (tool === "rectangle") {
      // Drag-create: press at one corner, release at the opposite corner.
      const snap = findSnap(geo, pos.mx, pos.my, tolMath, { midpoints: false });
      drag.current = { mode: "rect", start: [snap ? snap.x : pos.mx, snap ? snap.y : pos.my] };
      dragMoved.current = false;
      setCursor({ ...pos, snap });
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const snap = findSnap(geo, pos.mx, pos.my, tolMath, { midpoints: tool !== "function" });
    place(pos.mx, pos.my, snap);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const pos = evtPos(e);
    if (!pos) return;
    const dr = drag.current;

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

    const snap = tool === "select" ? null : findSnap(geo, pos.mx, pos.my, tolMath, { midpoints: tool !== "function" });
    setCursor({ ...pos, snap });
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const dr = drag.current;
    if (!dr) return;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (dr.mode === "point" || dr.mode === "rotate") {
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

  function setCoords(c: CoordSystem) {
    apply({ ...data, coords: c });
  }

  // ── derived render bits ───────────────────────────────────────────────────────
  const selPoint = selected?.kind === "point" ? data.points.find((p) => p.id === selected.id) : null;
  const selShape = selected?.kind === "shape" ? data.shapes.find((s) => s.id === selected.id) : null;
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
    <div className="print-hide fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 p-4" onClick={requestClose}>
      <div
        className="mt-6 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
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
              <svg
                ref={svgRef}
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={() => setCursor(null)}
                className="mx-auto block touch-none rounded-md border border-border bg-surface text-foreground"
                style={{ cursor: tool === "select" ? "default" : "crosshair" }}
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
              <p className="mt-2 text-center text-xs text-muted">{hint}</p>
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
                    isValidExpr(funcExpr, ["x", "theta", "t"]) ? "border-border focus:border-accent" : "border-red-500"
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
