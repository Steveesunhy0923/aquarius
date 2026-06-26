"use client";

import { renderItem, renderLabel, renderPoint } from "@/components/GraphView";
import {
  buildScene,
  defaultGraph,
  findSnap,
  makeProj,
  newGraphId,
  parabolaPolyline,
  resolvePoint,
  SHAPE_PALETTE,
  type CoordSystem,
  type GPoint,
  type GraphData,
  type GShape,
  type SceneItem,
  type SnapTarget,
} from "@/lib/blocks/graph";
import { isValidExpr } from "@/lib/blocks/expr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SNAP_PX = 12; // magnet radius
const HIT_PX = 9; // selection hit-test radius

type ToolId =
  | "select"
  | "point"
  | "segment"
  | "line"
  | "triangle"
  | "rectangle"
  | "circle"
  | "ellipse"
  | "parabola"
  | "function";

const TOOLS: Array<{ id: ToolId; glyph: string; label: string; needs: number }> = [
  { id: "select", glyph: "↖", label: "Select / move", needs: 0 },
  { id: "point", glyph: "•", label: "Point", needs: 1 },
  { id: "segment", glyph: "／", label: "Segment", needs: 2 },
  { id: "line", glyph: "⟋", label: "Line (infinite)", needs: 2 },
  { id: "triangle", glyph: "△", label: "Triangle", needs: 3 },
  { id: "rectangle", glyph: "▭", label: "Rectangle", needs: 2 },
  { id: "circle", glyph: "◯", label: "Circle", needs: 2 },
  { id: "ellipse", glyph: "⬭", label: "Ellipse", needs: 2 },
  { id: "parabola", glyph: "∪", label: "Parabola", needs: 2 },
  { id: "function", glyph: "ƒ", label: "Function", needs: 0 },
];

/** Tools that stay active after one use; all others revert to Select. */
const STICKY_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(["point", "segment", "line", "triangle"]);

type Selection = { kind: "point" | "shape"; id: string } | null;

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

  const drag = useRef<DragState | null>(null);
  const dragSnapshot = useRef<GraphData | null>(null); // pre-drag snapshot (undo + rotate base)
  const dragMoved = useRef(false);
  const preConstruct = useRef<GraphData | null>(null); // pre-construction snapshot (multi-click)
  const history = useRef<GraphData[]>([]);
  const baseline = useRef<GraphData>(initial ?? defaultGraph()); // for dirty-on-close check
  const svgRef = useRef<SVGSVGElement>(null);

  const W = data.width;
  const H = data.height;
  const proj = useMemo(() => makeProj(data.view, W, H), [data.view, W, H]);
  const scene = useMemo(() => buildScene(data, proj), [data, proj]);
  const tolMath = SNAP_PX / Math.min(proj.sx, proj.sy);

  const pushHistory = (snapshot: GraphData) => {
    history.current.push(snapshot);
    if (history.current.length > 80) history.current.shift();
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
      setData(prev);
      setPending([]);
      setSelected(null);
      preConstruct.current = null;
    }
  }, []);

  const isDirty = useCallback(() => JSON.stringify(data) !== JSON.stringify(baseline.current), [data]);
  const requestClose = useCallback(() => {
    if (!isDirty() || window.confirm("Discard unsaved changes to this graph?")) onClose();
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
      const snap = findSnap(data, pos.mx, pos.my, tolMath, { midpoints: false });
      drag.current = { mode: "rect", start: [snap ? snap.x : pos.mx, snap ? snap.y : pos.my] };
      dragMoved.current = false;
      setCursor({ ...pos, snap });
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const snap = findSnap(data, pos.mx, pos.my, tolMath, { midpoints: tool !== "function" });
    place(pos.mx, pos.my, snap);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const pos = evtPos(e);
    if (!pos) return;
    const dr = drag.current;

    if (dr?.mode === "point") {
      const snap = findSnap(data, pos.mx, pos.my, tolMath, { midpoints: false, exclude: new Set([dr.id]) });
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
      const snap = findSnap(data, pos.mx, pos.my, tolMath, { midpoints: false });
      dragMoved.current = true;
      setCursor({ ...pos, snap });
      return;
    }

    const snap = tool === "select" ? null : findSnap(data, pos.mx, pos.my, tolMath, { midpoints: tool !== "function" });
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
      const snap = pos ? findSnap(data, pos.mx, pos.my, tolMath, { midpoints: false }) : null;
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

  function setView(patch: Partial<GraphData["view"]>) {
    const v = { ...data.view, ...patch };
    if (v.xmax > v.xmin && v.ymax > v.ymin) apply({ ...data, view: v });
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
    <div className="print-hide fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4" onClick={requestClose}>
      <div
        className="mt-6 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-medium">{initial ? "Edit graph" : "Insert a graph"}</h2>
          <div className="flex items-center gap-2">
            <button onClick={undo} title="Undo (⌘Z)" className="rounded-md border border-border px-2 py-1 text-sm text-muted hover:border-accent disabled:opacity-40" disabled={history.current.length === 0}>↶ Undo</button>
            <button onClick={requestClose} className="px-1 text-muted hover:text-foreground" title="Cancel (Esc)">✕</button>
          </div>
        </div>

        {/* tool palette */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => { cancelConstruction(); setTool(t.id); }}
              title={t.label}
              className={`flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm ${
                tool === t.id ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent"
              }`}
            >
              <span className="text-base leading-none">{t.glyph}</span>
              <span className="hidden sm:inline">{t.label.split(" ")[0]}</span>
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-border" />
          <span className="text-xs text-muted">Line</span>
          {SHAPE_PALETTE.map((c) => (
            <button key={c} onClick={() => applyLine(c)} title={c} className={`h-6 w-6 rounded-full border-2 ${drawColor === c ? "border-foreground" : "border-transparent"}`} style={{ background: c }} />
          ))}
          <input type="color" value={drawColor} onChange={(e) => applyLine(e.target.value)} title="Custom line color" className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent p-0" />
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
                <g>{scene.grid.map((g, i) => renderItem(g, `g${i}`))}</g>
                <g>{scene.axes.map((a, i) => renderItem(a, `a${i}`))}</g>
                <g>{scene.labels.map((l, i) => renderLabel(l, `l${i}`))}</g>
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
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Coordinates</h3>
              <div className="mb-2 inline-flex overflow-hidden rounded border border-border text-xs">
                {([["none", "No coordinate"], ["rect", "Rectangular"], ["polar", "Polar"]] as Array<[CoordSystem, string]>).map(([c, lbl]) => (
                  <button key={c} onClick={() => setCoords(c)} className={`px-2 py-1 ${data.coords === c ? "bg-accent text-white" : "hover:bg-foreground/5"}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumField label="x min" value={data.view.xmin} onCommit={(v) => setView({ xmin: v })} />
                <NumField label="x max" value={data.view.xmax} onCommit={(v) => setView({ xmax: v })} />
                <NumField label="y min" value={data.view.ymin} onCommit={(v) => setView({ ymin: v })} />
                <NumField label="y max" value={data.view.ymax} onCommit={(v) => setView({ ymax: v })} />
                <NumField label="grid" value={data.gridStep} onCommit={(v) => v > 0 && apply({ ...data, gridStep: v })} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                <label className="flex items-center gap-1"><input type="checkbox" checked={data.showGrid} onChange={(e) => apply({ ...data, showGrid: e.target.checked })} /> grid</label>
                {data.coords !== "none" && (
                  <>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={data.showNumbers} onChange={(e) => apply({ ...data, showNumbers: e.target.checked })} /> numbers</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={data.axisArrows} onChange={(e) => apply({ ...data, axisArrows: e.target.checked })} /> arrows</label>
                  </>
                )}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-muted">Pick “No coordinate” (and turn off the grid) for a blank canvas to draw pure geometry.</p>
            </section>

            {/* function entry */}
            {tool === "function" && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  {data.coords === "polar" ? "r(θ) =" : "y = f(x)"}
                </h3>
                <input
                  value={funcExpr}
                  onChange={(e) => setFuncExpr(e.target.value)}
                  placeholder={data.coords === "polar" ? "1 + cos(theta)" : "sin(x)"}
                  className={`w-full rounded border bg-background px-2 py-1 font-mono text-sm outline-none ${
                    isValidExpr(funcExpr, ["x", "theta", "t"]) ? "border-border focus:border-accent" : "border-red-500"
                  }`}
                />
                <div className="mt-1.5 flex items-center gap-1 text-xs">
                  <span className="text-muted">domain</span>
                  <input value={funcDomain[0]} onChange={(e) => setFuncDomain([e.target.value, funcDomain[1]])} placeholder="auto" className="w-14 rounded border border-border bg-background px-1 text-center" />
                  <span className="text-muted">→</span>
                  <input value={funcDomain[1]} onChange={(e) => setFuncDomain([funcDomain[0], e.target.value])} placeholder="auto" className="w-14 rounded border border-border bg-background px-1 text-center" />
                </div>
                <button onClick={addFunction} className="mt-2 w-full rounded-md bg-accent px-2 py-1 text-sm font-medium text-white disabled:opacity-40" disabled={!isValidExpr(funcExpr, ["x", "theta", "t"])}>Plot</button>
                <p className="mt-1 text-[11px] leading-snug text-muted">Use x{data.coords === "polar" ? " or theta" : ""}, +−×÷, ^, sin, cos, sqrt, ln, pi…</p>
              </section>
            )}

            {/* selected point */}
            {selPoint && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Point</h3>
                <label className="mb-1.5 flex items-center gap-2">
                  <span className="text-muted">Name</span>
                  <input value={selPoint.name ?? ""} onChange={(e) => updatePoint(selPoint.id, { name: e.target.value || undefined })} className="w-full rounded border border-border bg-background px-2 py-0.5" />
                </label>
                <label className="mb-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={selPoint.showName ?? !!selPoint.name} onChange={(e) => updatePoint(selPoint.id, { showName: e.target.checked })} /> show label</label>
                {selPoint.mid ? (
                  <p className="text-xs text-muted">Midpoint (auto-updates).</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumField label="x" value={selPoint.x ?? 0} onCommit={(v) => updatePoint(selPoint.id, { x: v })} />
                    <NumField label="y" value={selPoint.y ?? 0} onCommit={(v) => updatePoint(selPoint.id, { y: v })} />
                  </div>
                )}
                <button onClick={removeSelected} className="mt-2 w-full rounded-md border border-border px-2 py-1 text-xs text-red-500 hover:border-red-500">Delete point</button>
              </section>
            )}

            {/* selected shape */}
            {selShape && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted capitalize">{selShape.kind}</h3>
                {selShape.kind === "function" && (
                  <input value={selShape.expr} onChange={(e) => updateShape(selShape.id, { expr: e.target.value } as Partial<GShape>)} className="mb-2 w-full rounded border border-border bg-background px-2 py-1 font-mono text-sm" />
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
                <button onClick={removeSelected} className="w-full rounded-md border border-border px-2 py-1 text-xs text-red-500 hover:border-red-500">Delete shape</button>
              </section>
            )}
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <span className="text-xs text-muted">{data.points.length} point(s) · {data.shapes.length} shape(s)</span>
          <div className="flex gap-2">
            <button onClick={requestClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent">Cancel</button>
            <button onClick={() => onPick(data)} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white">{initial ? "Save" : "Insert"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const HINTS: Record<ToolId, string> = {
  select: "Click a point or shape to select. Drag a point to reshape; drag the round handle above a shape to rotate it. Vertices snap to the grid and other points.",
  point: "Click to drop a point. It snaps to the grid, existing points, and side midpoints.",
  segment: "Click two points. Endpoints snap to existing points and midpoints (draw medians exactly).",
  line: "Click two points to define an infinite line (clipped to the view).",
  triangle: "Click three vertices.",
  rectangle: "Drag from one corner to the opposite corner and release. Axis-aligned by default — rotate it later with the Select tool.",
  circle: "Click the center, then a point on the circle.",
  ellipse: "Click the center, then a point setting the x- and y-radii.",
  parabola: "Click the vertex, then a point the parabola passes through.",
  function: "Type an equation in the panel and press Plot.",
};

// ─── small components ─────────────────────────────────────────────────────────

function NumField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) onCommit(v);
    else setText(String(value));
  };
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="w-8 text-muted">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full rounded border border-border bg-background px-1 py-0.5 text-center outline-none focus:border-accent"
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
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} title={`Custom ${label.toLowerCase()} color`} className="h-6 w-6 cursor-pointer rounded border border-border bg-transparent p-0" />
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
function Highlight({ item }: { item: ReturnType<typeof buildScene>["shapes"][number] }) {
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

// ─── pure helpers ─────────────────────────────────────────────────────────────

function samePair(a: [string, string], b: [string, string]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/** Which shapes can be rotated (point-based shapes + the ellipse via its rot field). */
function rotatable(s: GShape): boolean {
  return s.kind === "segment" || s.kind === "line" || s.kind === "polygon" || s.kind === "ellipse";
}

/** The free-point ids a rotation should transform (ellipse rotates via its rot field). */
function rotatablePointIds(s: GShape): string[] {
  switch (s.kind) {
    case "segment":
    case "line":
      return [s.a, s.b];
    case "polygon":
      return s.pts;
    default:
      return [];
  }
}

/** The pivot a shape rotates about (centroid of its defining points / its center). */
function shapeCentroid(data: GraphData, s: GShape): [number, number] | null {
  let pts: Array<[number, number]> = [];
  switch (s.kind) {
    case "segment":
    case "line": {
      const a = resolvePoint(data, s.a);
      const b = resolvePoint(data, s.b);
      if (a && b) pts = [a, b];
      break;
    }
    case "polygon":
      pts = s.pts.map((id) => resolvePoint(data, id)).filter((p): p is [number, number] => !!p);
      break;
    case "circle":
    case "ellipse":
      return resolvePoint(data, s.c);
    default:
      return null;
  }
  if (pts.length === 0) return null;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

/** Rotate a shape's free points about `c` by `delta` rad (ellipse: bump its rot). */
function rotateShapeData(base: GraphData, ids: string[], ellipseId: string | null, c: [number, number], delta: number): GraphData {
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  const points = base.points.map((p) => {
    if (ids.includes(p.id) && p.mid == null && typeof p.x === "number" && typeof p.y === "number") {
      const dx = p.x - c[0];
      const dy = p.y - c[1];
      return { ...p, x: c[0] + dx * cos - dy * sin, y: c[1] + dx * sin + dy * cos };
    }
    return p;
  });
  const shapes = ellipseId
    ? base.shapes.map((s) => (s.id === ellipseId && s.kind === "ellipse" ? { ...s, rot: (s.rot ?? 0) + delta } : s))
    : base.shapes;
  return { ...base, points, shapes };
}

function nextName(points: GPoint[]): string {
  const used = new Set(points.map((p) => p.name).filter(Boolean));
  for (let i = 0; i < 26; i++) {
    const n = String.fromCharCode(65 + i);
    if (!used.has(n)) return n;
  }
  for (let k = 1; ; k++) {
    for (let i = 0; i < 26; i++) {
      const n = String.fromCharCode(65 + i) + k;
      if (!used.has(n)) return n;
    }
  }
}

function buildShape(tool: ToolId, ids: string[], color: string): GShape | null {
  const id = newGraphId();
  switch (tool) {
    case "segment":
      return { id, kind: "segment", a: ids[0], b: ids[1], color };
    case "line":
      return { id, kind: "line", a: ids[0], b: ids[1], color };
    case "triangle":
      return { id, kind: "polygon", pts: [ids[0], ids[1], ids[2]], color };
    case "circle":
      return { id, kind: "circle", c: ids[0], through: ids[1], color };
    case "parabola":
      return { id, kind: "parabola", vertex: ids[0], through: ids[1], color };
    default:
      return null;
  }
}

/** Remove a point and everything that depends on it (derived points + shapes). */
function deletePoint(data: GraphData, id: string): GraphData {
  // Transitively collect derived points that reference the removed point(s).
  const dead = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of data.points) {
      if (!dead.has(p.id) && p.mid && (dead.has(p.mid[0]) || dead.has(p.mid[1]))) {
        dead.add(p.id);
        grew = true;
      }
    }
  }
  const points = data.points.filter((p) => !dead.has(p.id));
  const shapes = data.shapes.filter((s) => !shapeUsesAny(s, dead));
  return { ...data, points, shapes };
}

function shapeUsesAny(s: GShape, ids: Set<string>): boolean {
  switch (s.kind) {
    case "segment":
    case "line":
      return ids.has(s.a) || ids.has(s.b);
    case "polygon":
      return s.pts.some((p) => ids.has(p));
    case "circle":
      return ids.has(s.c) || ids.has(s.through);
    case "ellipse":
      return ids.has(s.c);
    case "parabola":
      return ids.has(s.vertex) || ids.has(s.through);
    case "function":
      return false;
  }
}

/** Hit-test a click against points (first) then shapes, using the rendered scene. */
function hitTest(scene: ReturnType<typeof buildScene>, px: number, py: number): Selection {
  for (const p of scene.points) {
    if (Math.hypot(p.px - px, p.py - py) <= HIT_PX) return { kind: "point", id: p.id };
  }
  let best: { id: string; d: number } | null = null;
  for (const s of scene.shapes) {
    if (!s.shapeId) continue;
    const d = distToItem(s, px, py);
    if (d <= HIT_PX && (!best || d < best.d)) best = { id: s.shapeId, d };
  }
  return best ? { kind: "shape", id: best.id } : null;
}

function distToItem(item: ReturnType<typeof buildScene>["shapes"][number], px: number, py: number): number {
  if (item.t === "ellipse") {
    const nx = (px - item.cx) / (item.rx || 1);
    const ny = (py - item.cy) / (item.ry || 1);
    const t = Math.hypot(nx, ny);
    return Math.abs(t - 1) * Math.min(item.rx, item.ry);
  }
  let min = Infinity;
  const pts = item.pts;
  const n = item.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    min = Math.min(min, distToSegment(px, py, a[0], a[1], b[0], b[1]));
  }
  return min;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Build dashed rubber-band primitives from the in-progress points + cursor. */
function previewPrims(
  data: GraphData,
  proj: ReturnType<typeof makeProj>,
  tool: ToolId,
  pending: string[],
  cursor: { mx: number; my: number; snap: SnapTarget | null },
): ReturnType<typeof buildScene>["shapes"] {
  const cx = cursor.snap ? cursor.snap.x : cursor.mx;
  const cy = cursor.snap ? cursor.snap.y : cursor.my;
  const cpt = proj.toPx(cx, cy);
  const anchors = pending.map((id) => resolvePoint(data, id)).filter((p): p is [number, number] => !!p);
  const out: ReturnType<typeof buildScene>["shapes"] = [];
  const stroke = "var(--accent)";
  const line = (a: [number, number], b: [number, number]) => out.push({ t: "polyline", pts: [a, b], stroke, dash: true, width: 1.5 });

  if (anchors.length === 0) return out;
  const a0 = proj.toPx(...anchors[0]);

  if (tool === "rectangle") {
    const [ax, ay] = anchors[0];
    const corners: Array<[number, number]> = [[ax, ay], [cx, ay], [cx, cy], [ax, cy]];
    out.push({ t: "polyline", pts: corners.map((p) => proj.toPx(...p)), closed: true, stroke, dash: true, width: 1.5 });
  } else if (tool === "circle") {
    const r = Math.hypot(cx - anchors[0][0], cy - anchors[0][1]);
    out.push({ t: "ellipse", cx: a0[0], cy: a0[1], rx: r * proj.sx, ry: r * proj.sy, stroke, width: 1.5 });
  } else if (tool === "ellipse") {
    const rx = Math.abs(cx - anchors[0][0]);
    const ry = Math.abs(cy - anchors[0][1]);
    out.push({ t: "ellipse", cx: a0[0], cy: a0[1], rx: rx * proj.sx, ry: ry * proj.sy, stroke, width: 1.5 });
  } else if (tool === "parabola") {
    for (const poly of parabolaPolyline(data.view, anchors[0], [cx, cy])) {
      out.push({ t: "polyline", pts: poly.map((p) => proj.toPx(...p)), stroke, dash: true, width: 1.5 });
    }
  } else {
    // segment / line / triangle: chain anchors then to the cursor
    for (let i = 0; i < anchors.length - 1; i++) line(proj.toPx(...anchors[i]), proj.toPx(...anchors[i + 1]));
    line(proj.toPx(...anchors[anchors.length - 1]), cpt);
  }
  return out;
}
