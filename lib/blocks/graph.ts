/**
 * The `graph` block — an interactive 2D figure ("drawing box") whose canonical
 * form is a structured, JSON-serializable model and whose LaTeX serialization is
 * a `tikzpicture`. Same philosophy as the rest of Aquarius: the model is the
 * source of truth; SVG (in-app) and TikZ (.tex export) are both serializations.
 *
 * This module is PURE (no React, no DOM) so it runs in Node, the browser, and
 * the serializer. It owns:
 *   - the data model (coord system, view window, points, shapes)
 *   - geometry helpers shared by the SVG renderer and the TikZ serializer
 *     (projection, point resolution, line clipping, curve sampling)
 *   - snapping ("magnet") math
 *   - block accessor/factory helpers mirroring lib/blocks/tables.ts
 *   - graphToTikz(): the LaTeX serialization
 *
 * Points are FIRST-CLASS and shapes reference them by id. Moving a vertex
 * therefore reshapes every polygon that uses it, and a *derived* midpoint point
 * (`GPoint.mid`) lets a median snap to the exact middle of a side and stay there
 * — so medians never overshoot.
 */

import { escapeLatex } from "./captions";
import { compileExpr } from "./expr";
import type { Block } from "./types";

/** Max grid lines/rings drawn in any one direction (perf + .tex size guard). */
const MAX_GRID = 400;

// ─── Model ─────────────────────────────────────────────────────────────────

export type CoordSystem = "none" | "rect" | "polar";

export interface GraphView {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

/**
 * A named point. Either a FREE point (x,y in math coords, draggable) or a
 * DERIVED midpoint of two other points (`mid: [aId, bId]`, recomputed, not
 * draggable). Derived points keep constructions (medians, midpoints) exact.
 */
export interface GPoint {
  id: string;
  name?: string;
  showName?: boolean;
  x?: number;
  y?: number;
  mid?: [string, string];
}

export type GShape =
  | { id: string; kind: "segment"; a: string; b: string; color?: string }
  | { id: string; kind: "line"; a: string; b: string; color?: string }
  | { id: string; kind: "polygon"; pts: string[]; color?: string; fillColor?: string }
  | { id: string; kind: "circle"; c: string; through: string; color?: string; fillColor?: string }
  | { id: string; kind: "ellipse"; c: string; rx: number; ry: number; rot?: number; color?: string; fillColor?: string }
  | { id: string; kind: "parabola"; vertex: string; through: string; color?: string }
  | { id: string; kind: "function"; expr: string; domain?: [number, number]; color?: string };

export type GShapeKind = GShape["kind"];

export interface GraphData {
  coords: CoordSystem;
  view: GraphView;
  /** Display size in CSS px (also drives the TikZ aspect ratio). */
  width: number;
  height: number;
  showGrid: boolean;
  /** Show numeric tick labels on the axes. */
  showNumbers: boolean;
  /** Draw arrowheads at the positive ends of the axes. */
  axisArrows: boolean;
  /** Math-unit spacing between grid lines / snap nodes (rect) and rings (polar). */
  gridStep: number;
  /** No-coordinate mode only: grid dimensions in cells (horizontal × vertical). */
  gridCols: number;
  gridRows: number;
  /**
   * No-coordinate grid style: "complete" = a fully-bounded cols×rows grid;
   * "open" = the same complete cells plus a fringe of partial outer cells that
   * bleed off the canvas (and are not counted).
   */
  gridFill: "complete" | "open";
  /** Optional figure caption (rendered below the figure; \caption{} in LaTeX). */
  caption?: string;
  points: GPoint[];
  shapes: GShape[];
}

const DEFAULT_VIEW: GraphView = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };

export function defaultGraph(): GraphData {
  return {
    coords: "rect",
    view: { ...DEFAULT_VIEW },
    width: 460,
    height: 460,
    showGrid: true,
    showNumbers: true,
    axisArrows: true,
    gridStep: 1,
    gridCols: 10,
    gridRows: 10,
    gridFill: "complete",
    points: [],
    shapes: [],
  };
}

/** Target on-screen size (px) of the longer side of a No-coordinate grid. */
const NONE_GRID_PX = 440;

/**
 * In No-coordinate mode, the view/canvas are DERIVED from the grid counts (so the
 * panel only asks for horizontal × vertical cells). "complete" fits the canvas to
 * exactly cols×rows whole cells; "open" pads a half-cell so the outer cells are
 * cut off by the edge (partial, uncounted). Other modes pass through unchanged.
 */
export function resolveGeometry(data: GraphData): GraphData {
  if (data.coords !== "none") return data;
  const cols = Math.min(60, Math.max(1, Math.round(data.gridCols))) || 1;
  const rows = Math.min(60, Math.max(1, Math.round(data.gridRows))) || 1;
  const cell = Math.max(10, Math.round(NONE_GRID_PX / Math.max(cols, rows)));
  const open = data.gridFill === "open";
  const pad = open ? 0.5 : 0;
  return {
    ...data,
    gridStep: 1,
    view: { xmin: -pad, xmax: cols + pad, ymin: -pad, ymax: rows + pad },
    width: Math.round(cell * (cols + 2 * pad)),
    height: Math.round(cell * (rows + 2 * pad)),
  };
}

// ─── Block accessors / factory (mirrors lib/blocks/tables.ts) ────────────────

const uid = (): string => crypto.randomUUID();

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Like num(), but rejects non-positive values (sizes must be > 0). */
function posNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

function sanitizeView(v: unknown): GraphView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const xmin = num(o.xmin, NaN);
  const xmax = num(o.xmax, NaN);
  const ymin = num(o.ymin, NaN);
  const ymax = num(o.ymax, NaN);
  if (![xmin, xmax, ymin, ymax].every(Number.isFinite)) return null;
  if (xmax <= xmin || ymax <= ymin) return null;
  return { xmin, xmax, ymin, ymax };
}

function isPoint(p: unknown): p is GPoint {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== "string") return false;
  const hasFree = typeof o.x === "number" && typeof o.y === "number";
  const hasMid = Array.isArray(o.mid) && o.mid.length === 2;
  return hasFree || hasMid;
}

function isShape(s: unknown): s is GShape {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.kind !== "string") return false;
  // Validate kind-specific required fields so a malformed/imported shape can
  // never reach the serializer and break its never-throw contract.
  switch (o.kind) {
    case "segment":
    case "line":
      return typeof o.a === "string" && typeof o.b === "string";
    case "polygon":
      return Array.isArray(o.pts) && o.pts.every((p) => typeof p === "string");
    case "circle":
      return typeof o.c === "string" && typeof o.through === "string";
    case "ellipse":
      return typeof o.c === "string" && typeof o.rx === "number" && typeof o.ry === "number";
    case "parabola":
      return typeof o.vertex === "string" && typeof o.through === "string";
    case "function":
      return typeof o.expr === "string";
    default:
      return false;
  }
}

/** Defensive read of a block's graph model (never throws; fills defaults). */
export function graphModel(block: Block): GraphData {
  const g = block.attrs?.graph as Partial<GraphData> | undefined;
  const d = defaultGraph();
  if (!g || typeof g !== "object") return d;
  return {
    coords: g.coords === "polar" ? "polar" : g.coords === "none" ? "none" : "rect",
    view: sanitizeView(g.view) ?? d.view,
    width: posNum(g.width, d.width),
    height: posNum(g.height, d.height),
    showGrid: g.showGrid !== false,
    showNumbers: g.showNumbers !== false,
    axisArrows: g.axisArrows !== false,
    gridStep: g.gridStep && g.gridStep > 0 ? g.gridStep : d.gridStep,
    gridCols: g.gridCols && g.gridCols > 0 ? Math.round(g.gridCols) : d.gridCols,
    gridRows: g.gridRows && g.gridRows > 0 ? Math.round(g.gridRows) : d.gridRows,
    gridFill: g.gridFill === "open" ? "open" : "complete",
    caption: typeof g.caption === "string" ? g.caption : undefined,
    points: Array.isArray(g.points) ? g.points.filter(isPoint) : [],
    shapes: Array.isArray(g.shapes) ? g.shapes.filter(isShape) : [],
  };
}

export function withGraph(block: Block, data: GraphData): Block {
  return { ...block, attrs: { ...block.attrs, graph: data } };
}

export function makeGraphBlock(data: GraphData = defaultGraph()): Block {
  return { id: uid(), type: "graph", attrs: { graph: data } };
}

export const newGraphId = uid;

// ─── Projection (math coords ⇄ screen px) ────────────────────────────────────

export interface Proj {
  sx: number;
  sy: number;
  W: number;
  H: number;
  toPx(x: number, y: number): [number, number];
  toMath(px: number, py: number): [number, number];
}

export function makeProj(view: GraphView, W: number, H: number): Proj {
  const dx = view.xmax - view.xmin || 1;
  const dy = view.ymax - view.ymin || 1;
  const sx = W / dx;
  const sy = H / dy;
  return {
    sx,
    sy,
    W,
    H,
    toPx: (x, y) => [(x - view.xmin) * sx, H - (y - view.ymin) * sy],
    toMath: (px, py) => [view.xmin + px / sx, view.ymin + (H - py) / sy],
  };
}

// ─── Point resolution ────────────────────────────────────────────────────────

/** Resolve a point id to math coords, following derived midpoints (cycle-safe). */
export function resolvePoint(
  data: GraphData,
  id: string,
  seen: Set<string> = new Set(),
): [number, number] | null {
  if (seen.has(id)) return null; // reject path-cycles only (not shared ancestors)
  const p = data.points.find((q) => q.id === id);
  if (!p) return null;
  if (p.mid) {
    // Each branch gets its OWN path set, so a legitimate acyclic diamond
    // (Z=mid(X,Y), X=mid(A,B), Y=mid(A,C)) resolves instead of vanishing.
    const next = new Set(seen).add(id);
    const a = resolvePoint(data, p.mid[0], next);
    const b = resolvePoint(data, p.mid[1], next);
    if (!a || !b) return null;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  if (typeof p.x === "number" && typeof p.y === "number") return [p.x, p.y];
  return null;
}

// ─── Pure geometry (math space) shared by SVG + TikZ ─────────────────────────

/** Clip the infinite line through A,B to the view rectangle. Returns 2 pts or null. */
export function clipLineToView(
  view: GraphView,
  a: [number, number],
  b: [number, number],
): [[number, number], [number, number]] | null {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return null;
  // Liang–Barsky against the view box, but for an infinite line so t is unbounded.
  let t0 = -Infinity;
  let t1 = Infinity;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - view.xmin, view.xmax - x1, y1 - view.ymin, view.ymax - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null; // parallel and outside
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
  }
  if (t0 > t1) return null;
  return [
    [x1 + t0 * dx, y1 + t0 * dy],
    [x1 + t1 * dx, y1 + t1 * dy],
  ];
}

/** Vertical band (view ± one view-height) that emitted y-coords are kept within,
 *  so steep curves never exceed TeX's max dimension. Out-of-band samples break
 *  the polyline (like a discontinuity) rather than emitting huge coordinates. */
function yBand(view: GraphView): [number, number] {
  const pad = view.ymax - view.ymin;
  return [view.ymin - pad, view.ymax + pad];
}

/**
 * A vertex-form parabola through `vertex` and `through`, sampled into one or more
 * polylines in math space (split where it leaves the safe vertical band).
 */
export function parabolaPolyline(
  view: GraphView,
  vertex: [number, number],
  through: [number, number],
  samples = 160,
): Array<Array<[number, number]>> {
  const [h, k] = vertex;
  const [px, py] = through;
  const denom = (px - h) ** 2;
  if (denom === 0) return []; // degenerate (vertical) — nothing sensible to draw
  const a = (py - k) / denom;
  const [yLo, yHi] = yBand(view);
  const lines: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  const flush = () => {
    if (cur.length > 1) lines.push(cur);
    cur = [];
  };
  for (let i = 0; i <= samples; i++) {
    const x = view.xmin + ((view.xmax - view.xmin) * i) / samples;
    const y = a * (x - h) ** 2 + k;
    if (y < yLo || y > yHi) flush();
    else cur.push([x, y]);
  }
  flush();
  return lines;
}

/**
 * Sample a function shape into one or more polylines (split at discontinuities
 * / out-of-range jumps), in math space. Rect: y = f(x) over the x-domain.
 * Polar: r = f(theta) over the theta-domain → cartesian.
 */
export function functionPolylines(
  data: GraphData,
  shape: Extract<GShape, { kind: "function" }>,
  samples = 240,
): Array<Array<[number, number]>> {
  const polar = data.coords === "polar";
  const varName = polar ? "theta" : "x";
  const { fn } = compileExpr(shape.expr, [varName, "x", "t", "theta"]);
  if (!fn) return [];
  const view = data.view;
  const [lo, hi] = shape.domain ?? (polar ? [0, Math.PI * 2] : [view.xmin, view.xmax]);
  const span = hi - lo;
  if (!(span > 0)) return [];

  const lines: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  const [yLo, yHi] = yBand(view);
  // Magnitude bound for polar curves (a few view-diagonals) so r→∞ stays safe.
  const rMax = 3 * Math.max(Math.hypot(view.xmin, view.ymin), Math.hypot(view.xmax, view.ymax), 1);
  const yPad = (view.ymax - view.ymin) * 4; // asymptote-jump break threshold
  let prevY: number | null = null;

  const flush = () => {
    if (cur.length > 1) lines.push(cur);
    cur = [];
  };

  for (let i = 0; i <= samples; i++) {
    const u = lo + (span * i) / samples;
    const r = fn({ [varName]: u, x: u, t: u, theta: u });
    if (!Number.isFinite(r)) {
      flush();
      prevY = null;
      continue;
    }
    if (polar) {
      const x = r * Math.cos(u);
      const y = r * Math.sin(u);
      // Drop coordinates far outside the view so TeX never sees a huge dimension.
      if (Math.hypot(x, y) > rMax) {
        flush();
        continue;
      }
      cur.push([x, y]);
    } else {
      // Break the polyline at asymptote jumps AND clamp to the safe band.
      if (prevY != null && Math.abs(r - prevY) > yPad) flush();
      prevY = r;
      if (r < yLo || r > yHi) flush();
      else cur.push([u, r]);
    }
  }
  flush();
  return lines;
}

// ─── Scene (SVG-ready primitives), built from the model ──────────────────────

export interface ScenePrim {
  /** A stroked (optionally closed/filled) polyline in PIXEL space. */
  t: "polyline";
  pts: Array<[number, number]>;
  closed?: boolean;
  /** Translucent fill color for a closed shape (undefined = no fill). */
  fillColor?: string;
  /** Fill solidly with the stroke color (used for axis arrowheads). */
  solid?: boolean;
  stroke: string;
  width?: number;
  dash?: boolean;
  shapeId?: string;
}
export interface SceneEllipse {
  t: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Rotation in degrees about (cx,cy), for SVG transform. */
  rot?: number;
  /** Translucent fill color (undefined = no fill). */
  fillColor?: string;
  stroke: string;
  width?: number;
  shapeId?: string;
}
export type SceneItem = ScenePrim | SceneEllipse;

export interface ScenePoint {
  id: string;
  px: number;
  py: number;
  name?: string;
  showName: boolean;
  derived: boolean;
}

/** An axis tick number, positioned in PIXEL space. */
export interface SceneLabel {
  px: number;
  py: number;
  text: string;
  anchor: "start" | "middle" | "end";
}

export interface Scene {
  grid: ScenePrim[];
  axes: ScenePrim[];
  labels: SceneLabel[];
  shapes: SceneItem[];
  points: ScenePoint[];
}

/** CSS colors that adapt to theme AND print (see app/globals.css print block). */
export const COLOR_AXIS = "currentColor";
export const COLOR_GRID = "var(--border)";
export const COLOR_SHAPE = "currentColor";

/** Default palette offered in the editor (explicit hex → survives theme/print). */
export const SHAPE_PALETTE = [
  "#4f46e5", // indigo (accent)
  "#dc2626", // red
  "#16a34a", // green
  "#ea580c", // orange
  "#0891b2", // cyan
  "#9333ea", // purple
];

function strokeFor(color?: string): string {
  return color || COLOR_SHAPE;
}

/** Build everything needed to draw the graph, in pixel space. */
export function buildScene(data: GraphData, proj: Proj): Scene {
  const hasAxes = data.coords !== "none";
  const grid = data.showGrid ? buildGrid(data, proj) : [];
  const axes = hasAxes ? buildAxes(data, proj) : [];
  const labels = hasAxes && data.showNumbers ? buildAxisLabels(data, proj) : [];
  const shapes: SceneItem[] = [];

  for (const s of data.shapes) {
    const stroke = strokeFor(s.color);
    switch (s.kind) {
      case "segment": {
        const a = resolvePoint(data, s.a);
        const b = resolvePoint(data, s.b);
        if (a && b) {
          shapes.push({ t: "polyline", pts: [proj.toPx(...a), proj.toPx(...b)], stroke, shapeId: s.id, width: 2 });
        }
        break;
      }
      case "line": {
        const a = resolvePoint(data, s.a);
        const b = resolvePoint(data, s.b);
        if (a && b) {
          const seg = clipLineToView(data.view, a, b);
          if (seg) shapes.push({ t: "polyline", pts: [proj.toPx(...seg[0]), proj.toPx(...seg[1])], stroke, shapeId: s.id, width: 2 });
        }
        break;
      }
      case "polygon": {
        const pts = s.pts.map((id) => resolvePoint(data, id)).filter((p): p is [number, number] => !!p);
        if (pts.length >= 2) {
          shapes.push({
            t: "polyline",
            pts: pts.map((p) => proj.toPx(...p)),
            closed: pts.length >= 3,
            fillColor: pts.length >= 3 ? s.fillColor : undefined,
            stroke,
            shapeId: s.id,
            width: 2,
          });
        }
        break;
      }
      case "circle": {
        const c = resolvePoint(data, s.c);
        const through = resolvePoint(data, s.through);
        if (c && through) {
          const r = Math.hypot(through[0] - c[0], through[1] - c[1]);
          const [cx, cy] = proj.toPx(...c);
          shapes.push({ t: "ellipse", cx, cy, rx: r * proj.sx, ry: r * proj.sy, fillColor: s.fillColor, stroke, shapeId: s.id, width: 2 });
        }
        break;
      }
      case "ellipse": {
        const c = resolvePoint(data, s.c);
        if (c) {
          const [cx, cy] = proj.toPx(...c);
          // Screen y is flipped, so a CCW math rotation is CW on screen → negate.
          const rot = s.rot ? (-s.rot * 180) / Math.PI : undefined;
          shapes.push({ t: "ellipse", cx, cy, rx: Math.abs(s.rx) * proj.sx, ry: Math.abs(s.ry) * proj.sy, rot, fillColor: s.fillColor, stroke, shapeId: s.id, width: 2 });
        }
        break;
      }
      case "parabola": {
        const v = resolvePoint(data, s.vertex);
        const th = resolvePoint(data, s.through);
        if (v && th) {
          for (const poly of parabolaPolyline(data.view, v, th)) {
            shapes.push({ t: "polyline", pts: poly.map((p) => proj.toPx(...p)), stroke, shapeId: s.id, width: 2 });
          }
        }
        break;
      }
      case "function": {
        for (const poly of functionPolylines(data, s)) {
          shapes.push({ t: "polyline", pts: poly.map((p) => proj.toPx(...p)), stroke, shapeId: s.id, width: 2 });
        }
        break;
      }
    }
  }

  const points: ScenePoint[] = [];
  for (const p of data.points) {
    const at = resolvePoint(data, p.id);
    if (!at) continue;
    const [px, py] = proj.toPx(...at);
    points.push({
      id: p.id,
      px,
      py,
      name: p.name,
      showName: p.showName ?? !!p.name,
      derived: !!p.mid,
    });
  }

  return { grid, axes, labels, shapes, points };
}

/** "Nice" grid line positions: multiples of step within [lo,hi]. */
function multiplesIn(lo: number, hi: number, step: number): number[] {
  if (!(step > 0)) return [];
  const out: number[] = [];
  const start = Math.ceil(lo / step) * step;
  // Guard against pathological ranges producing thousands of lines.
  const count = Math.floor((hi - start) / step);
  if (count > MAX_GRID) return [];
  for (let v = start; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return out;
}

function buildGrid(data: GraphData, proj: Proj): ScenePrim[] {
  const { view, gridStep } = data;
  const out: ScenePrim[] = [];
  if (data.coords === "polar") {
    // Concentric rings + radial spokes are drawn as the grid for polar mode.
    const maxR = Math.max(Math.hypot(view.xmin, view.ymin), Math.hypot(view.xmax, view.ymax));
    if (maxR / gridStep <= MAX_GRID) {
      for (let r = gridStep; r <= maxR + 1e-9; r += gridStep) {
        const ring: Array<[number, number]> = [];
        for (let a = 0; a <= 360; a += 6) {
          const t = (a * Math.PI) / 180;
          ring.push(proj.toPx(r * Math.cos(t), r * Math.sin(t)));
        }
        out.push({ t: "polyline", pts: ring, stroke: COLOR_GRID, width: 1 });
      }
    }
    for (let a = 0; a < 360; a += 30) {
      const t = (a * Math.PI) / 180;
      out.push({ t: "polyline", pts: [proj.toPx(0, 0), proj.toPx(maxR * Math.cos(t), maxR * Math.sin(t))], stroke: COLOR_GRID, width: 1 });
    }
    return out;
  }
  for (const x of multiplesIn(view.xmin, view.xmax, gridStep)) {
    out.push({ t: "polyline", pts: [proj.toPx(x, view.ymin), proj.toPx(x, view.ymax)], stroke: COLOR_GRID, width: 1 });
  }
  for (const y of multiplesIn(view.ymin, view.ymax, gridStep)) {
    out.push({ t: "polyline", pts: [proj.toPx(view.xmin, y), proj.toPx(view.xmax, y)], stroke: COLOR_GRID, width: 1 });
  }
  return out;
}

function buildAxes(data: GraphData, proj: Proj): ScenePrim[] {
  const { view } = data;
  const out: ScenePrim[] = [];
  const hasX = view.ymin <= 0 && view.ymax >= 0;
  const hasY = view.xmin <= 0 && view.xmax >= 0;
  if (hasX) {
    const end = proj.toPx(view.xmax, 0);
    out.push({ t: "polyline", pts: [proj.toPx(view.xmin, 0), end], stroke: COLOR_AXIS, width: 1.4 });
    if (data.axisArrows) out.push(arrowHead(end, [1, 0], COLOR_AXIS));
  }
  if (hasY) {
    const end = proj.toPx(0, view.ymax);
    out.push({ t: "polyline", pts: [proj.toPx(0, view.ymin), end], stroke: COLOR_AXIS, width: 1.4 });
    if (data.axisArrows) out.push(arrowHead(end, [0, -1], COLOR_AXIS)); // screen-up
  }
  return out;
}

/** A small filled triangle at `tip`, pointing along screen-space unit `dir`. */
function arrowHead(tip: [number, number], dir: [number, number], stroke: string): ScenePrim {
  const L = 9; // length px
  const Wd = 5; // half-width px
  const [dx, dy] = dir;
  const nx = -dy;
  const ny = dx;
  const base: [number, number] = [tip[0] - dx * L, tip[1] - dy * L];
  return {
    t: "polyline",
    closed: true,
    solid: true,
    stroke,
    pts: [tip, [base[0] + nx * Wd, base[1] + ny * Wd], [base[0] - nx * Wd, base[1] - ny * Wd]],
  };
}

/** Numeric tick labels along whichever axes are visible (rect), or ring radii (polar). */
function buildAxisLabels(data: GraphData, proj: Proj): SceneLabel[] {
  const { view, gridStep } = data;
  const out: SceneLabel[] = [];
  const fmtN = (n: number) => parseFloat(n.toFixed(4)).toString();
  if (data.coords === "polar") {
    // Label ring radii along the positive x-axis.
    const maxR = Math.max(Math.hypot(view.xmin, view.ymin), Math.hypot(view.xmax, view.ymax));
    if (maxR / gridStep <= MAX_GRID) {
      for (let r = gridStep; r <= maxR + 1e-9; r += gridStep) {
        if (r > view.xmax) break;
        const [px, py] = proj.toPx(r, 0);
        out.push({ px, py: py + 12, text: fmtN(r), anchor: "middle" });
      }
    }
    return out;
  }
  const onX = view.ymin <= 0 && view.ymax >= 0;
  const onY = view.xmin <= 0 && view.xmax >= 0;
  const yBaseline = onX ? 0 : view.ymin; // park x-labels on the axis, else at the bottom
  const xBaseline = onY ? 0 : view.xmin;
  for (const x of multiplesIn(view.xmin, view.xmax, gridStep)) {
    if (x === 0) continue;
    const [px, py] = proj.toPx(x, yBaseline);
    out.push({ px, py: py + 13, text: fmtN(x), anchor: "middle" });
  }
  for (const y of multiplesIn(view.ymin, view.ymax, gridStep)) {
    if (y === 0) continue;
    const [px, py] = proj.toPx(xBaseline, y);
    out.push({ px: px - 6, py: py + 4, text: fmtN(y), anchor: "end" });
  }
  return out;
}

// ─── Snapping ("magnet") ─────────────────────────────────────────────────────

export type SnapTarget =
  | { type: "point"; id: string; x: number; y: number }
  | { type: "midpoint"; a: string; b: string; x: number; y: number }
  | { type: "grid"; x: number; y: number };

/**
 * Find the best snap target near math-coord (mx,my). Candidates, by priority:
 * existing points → segment/edge midpoints → grid nodes. `tolMath` is the snap
 * radius expressed in math units (caller converts px → math).
 */
export function findSnap(
  data: GraphData,
  mx: number,
  my: number,
  tolMath: number,
  opts: { points?: boolean; midpoints?: boolean; grid?: boolean; exclude?: Set<string> } = {},
): SnapTarget | null {
  const wantPoints = opts.points ?? true;
  const wantMid = opts.midpoints ?? true;
  const wantGrid = opts.grid ?? true;
  const exclude = opts.exclude ?? new Set<string>();
  let best: SnapTarget | null = null;
  let bestD = tolMath;

  const consider = (t: SnapTarget) => {
    const d = Math.hypot(t.x - mx, t.y - my);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  };

  if (wantPoints) {
    for (const p of data.points) {
      if (exclude.has(p.id)) continue;
      const at = resolvePoint(data, p.id);
      if (at) consider({ type: "point", id: p.id, x: at[0], y: at[1] });
    }
  }

  if (wantMid) {
    for (const m of midpointCandidates(data)) {
      if (exclude.has(m[0]) || exclude.has(m[1])) continue;
      const a = resolvePoint(data, m[0]);
      const b = resolvePoint(data, m[1]);
      if (a && b) consider({ type: "midpoint", a: m[0], b: m[1], x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 });
    }
  }

  if (wantGrid && data.gridStep > 0) {
    const gx = Math.round(mx / data.gridStep) * data.gridStep;
    const gy = Math.round(my / data.gridStep) * data.gridStep;
    consider({ type: "grid", x: gx, y: gy });
  }

  return best;
}

/** All unordered point-id pairs that form a drawable side (segments + polygon edges). */
function midpointCandidates(data: GraphData): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const s of data.shapes) {
    if (s.kind === "segment") pairs.push([s.a, s.b]);
    else if (s.kind === "polygon") {
      for (let i = 0; i < s.pts.length; i++) {
        pairs.push([s.pts[i], s.pts[(i + 1) % s.pts.length]]);
      }
    }
  }
  return pairs;
}

// ─── TikZ serialization ──────────────────────────────────────────────────────

/** Trim a number to ≤4 decimals without trailing zeros (TikZ-friendly). */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return parseFloat(n.toFixed(4)).toString();
}

function coord(p: [number, number]): string {
  return `(${fmt(p[0])},${fmt(p[1])})`;
}

/** xcolor needs a definition for arbitrary hex; emit one per distinct color (line + fill). */
function colorDefs(data: GraphData): { defs: string[]; nameOf: (hex?: string) => string } {
  const map = new Map<string, string>();
  let i = 0;
  const add = (c?: string) => {
    if (c && /^#?[0-9a-fA-F]{6}$/.test(c) && !map.has(c)) map.set(c, `aqg${i++}`);
  };
  for (const s of data.shapes) {
    add("color" in s ? s.color : undefined);
    add("fillColor" in s ? s.fillColor : undefined);
  }
  const defs = Array.from(map.entries()).map(
    ([hex, name]) => `\\definecolor{${name}}{HTML}{${hex.replace("#", "").toUpperCase()}}`,
  );
  return { defs, nameOf: (hex) => (hex && map.has(hex) ? map.get(hex)! : "") };
}

/** Build the bracketed `\draw`/`\filldraw` option group for a shape's colors. */
function shapeOpts(nameOf: (hex?: string) => string, lineHex?: string, fillHex?: string, extra?: string): { cmd: string; opt: string } {
  const parts: string[] = [];
  const ln = nameOf(lineHex);
  const fl = nameOf(fillHex);
  if (ln) parts.push(`draw=${ln}`);
  if (fl) parts.push(`fill=${fl}`, "fill opacity=0.25");
  if (extra) parts.push(extra);
  return { cmd: fl ? "\\filldraw" : "\\draw", opt: parts.length ? `[${parts.join(",")}]` : "" };
}

/**
 * Serialize the graph model to a standalone `tikzpicture`. Uses explicit x/y unit
 * lengths so the math coordinate system maps 1:1 into the picture (and the aspect
 * ratio matches the on-screen SVG).
 */
export function graphToTikz(data: GraphData): string {
  data = resolveGeometry(data); // derive view/canvas from grid counts in "none" mode
  const { view } = data;
  // Fit the longer axis to ~8cm; keep the on-screen aspect ratio.
  const ratio = data.height / data.width;
  const aspect = data.width > 0 && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const wCm = 8;
  const hCm = 8 * aspect;
  const xunit = (wCm / (view.xmax - view.xmin)).toFixed(4);
  const yunit = (hCm / (view.ymax - view.ymin)).toFixed(4);

  const { defs, nameOf } = colorDefs(data);
  const lines: string[] = [];
  lines.push(...defs);
  lines.push(`\\begin{tikzpicture}[x=${xunit}cm,y=${yunit}cm]`);
  lines.push(`\\clip ${coord([view.xmin, view.ymin])} rectangle ${coord([view.xmax, view.ymax])};`);

  // Grid + axes
  if (data.showGrid) {
    if (data.coords === "polar") {
      const maxR = Math.max(Math.hypot(view.xmin, view.ymin), Math.hypot(view.xmax, view.ymax));
      if (maxR / data.gridStep <= MAX_GRID) {
        for (let r = data.gridStep; r <= maxR + 1e-9; r += data.gridStep) {
          lines.push(`\\draw[help lines] (0,0) circle (${fmt(r)});`);
        }
      }
      for (let a = 0; a < 360; a += 30) {
        lines.push(`\\draw[help lines] (0,0) -- (${a}:${fmt(maxR)});`);
      }
    } else if (data.coords === "none") {
      // Explicit lines (integer-anchored) so partial outer cells match the SVG.
      for (const x of multiplesIn(view.xmin, view.xmax, data.gridStep)) {
        lines.push(`\\draw[help lines] (${fmt(x)},${fmt(view.ymin)}) -- (${fmt(x)},${fmt(view.ymax)});`);
      }
      for (const y of multiplesIn(view.ymin, view.ymax, data.gridStep)) {
        lines.push(`\\draw[help lines] (${fmt(view.xmin)},${fmt(y)}) -- (${fmt(view.xmax)},${fmt(y)});`);
      }
    } else {
      lines.push(
        `\\draw[help lines,step=${fmt(data.gridStep)}] ${coord([view.xmin, view.ymin])} grid ${coord([view.xmax, view.ymax])};`,
      );
    }
  }
  if (data.coords !== "none") {
    const arr = data.axisArrows ? "->" : "-";
    const onX = view.ymin <= 0 && view.ymax >= 0;
    const onY = view.xmin <= 0 && view.xmax >= 0;
    if (onX) lines.push(`\\draw[${arr}] (${fmt(view.xmin)},0) -- (${fmt(view.xmax)},0) node[right]{$x$};`);
    if (onY) lines.push(`\\draw[${arr}] (0,${fmt(view.ymin)}) -- (0,${fmt(view.ymax)}) node[above]{$y$};`);
    if (data.showNumbers && data.coords === "rect") {
      const yBaseline = onX ? 0 : view.ymin;
      const xBaseline = onY ? 0 : view.xmin;
      for (const x of multiplesIn(view.xmin, view.xmax, data.gridStep)) {
        if (x !== 0) lines.push(`\\node[below,font=\\scriptsize] at (${fmt(x)},${fmt(yBaseline)}) {${fmt(x)}};`);
      }
      for (const y of multiplesIn(view.ymin, view.ymax, data.gridStep)) {
        if (y !== 0) lines.push(`\\node[left,font=\\scriptsize] at (${fmt(xBaseline)},${fmt(y)}) {${fmt(y)}};`);
      }
    }
  }

  // Shapes
  for (const s of data.shapes) {
    const lineHex = "color" in s ? s.color : undefined;
    const fillHex = "fillColor" in s ? s.fillColor : undefined;
    switch (s.kind) {
      case "segment": {
        const a = resolvePoint(data, s.a);
        const b = resolvePoint(data, s.b);
        const { cmd, opt } = shapeOpts(nameOf, lineHex);
        if (a && b) lines.push(`${cmd}${opt} ${coord(a)} -- ${coord(b)};`);
        break;
      }
      case "line": {
        const a = resolvePoint(data, s.a);
        const b = resolvePoint(data, s.b);
        const { cmd, opt } = shapeOpts(nameOf, lineHex);
        if (a && b) {
          const seg = clipLineToView(view, a, b);
          if (seg) lines.push(`${cmd}${opt} ${coord(seg[0])} -- ${coord(seg[1])};`);
        }
        break;
      }
      case "polygon": {
        const pts = s.pts.map((id) => resolvePoint(data, id)).filter((p): p is [number, number] => !!p);
        if (pts.length >= 2) {
          const { cmd, opt } = shapeOpts(nameOf, lineHex, pts.length >= 3 ? fillHex : undefined);
          const path = pts.map(coord).join(" -- ");
          lines.push(`${cmd}${opt} ${path}${pts.length >= 3 ? " -- cycle" : ""};`);
        }
        break;
      }
      case "circle": {
        const c = resolvePoint(data, s.c);
        const through = resolvePoint(data, s.through);
        const { cmd, opt } = shapeOpts(nameOf, lineHex, fillHex);
        if (c && through) {
          const r = Math.hypot(through[0] - c[0], through[1] - c[1]);
          lines.push(`${cmd}${opt} ${coord(c)} circle (${fmt(r)});`);
        }
        break;
      }
      case "ellipse": {
        const c = resolvePoint(data, s.c);
        if (c) {
          const extra = s.rot ? `rotate around={${fmt((s.rot * 180) / Math.PI)}:${coord(c)}}` : undefined;
          const { cmd, opt } = shapeOpts(nameOf, lineHex, fillHex, extra);
          lines.push(`${cmd}${opt} ${coord(c)} ellipse (${fmt(Math.abs(s.rx))} and ${fmt(Math.abs(s.ry))});`);
        }
        break;
      }
      case "parabola": {
        const v = resolvePoint(data, s.vertex);
        const th = resolvePoint(data, s.through);
        const { cmd, opt } = shapeOpts(nameOf, lineHex);
        if (v && th) {
          for (const poly of parabolaPolyline(view, v, th)) {
            if (poly.length > 1) lines.push(`${cmd}${opt} plot coordinates {${poly.map(coord).join(" ")}};`);
          }
        }
        break;
      }
      case "function": {
        const { cmd, opt } = shapeOpts(nameOf, lineHex);
        for (const poly of functionPolylines(data, s)) {
          if (poly.length > 1) lines.push(`${cmd}${opt} plot coordinates {${poly.map(coord).join(" ")}};`);
        }
        break;
      }
    }
  }

  // Points + labels
  for (const p of data.points) {
    const at = resolvePoint(data, p.id);
    if (!at) continue;
    lines.push(`\\fill ${coord(at)} circle (1.6pt);`);
    if ((p.showName ?? !!p.name) && p.name) {
      // Text mode (matches the SVG's plain-text labels) via the project's
      // text-mode escaper — avoids math-mode accent/line-break pitfalls.
      lines.push(`\\node[above right,font=\\small] at ${coord(at)} {${escapeLatex(p.name)}};`);
    }
  }

  lines.push("\\end{tikzpicture}");

  const caption = (data.caption ?? "").trim();
  const body = lines.join("\n");
  if (caption) {
    // A captioned figure (\caption needs a float environment).
    return `% requires \\usepackage{tikz}\n\\begin{figure}[h]\n\\centering\n${body}\n\\caption{${escapeLatex(caption)}}\n\\end{figure}`;
  }
  return `% requires \\usepackage{tikz}\n${body}`;
}
