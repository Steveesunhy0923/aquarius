/**
 * graph-edit — pure (React-free) editing logic behind the interactive
 * GraphEditor: the tool tables, shape construction, rotation, dependent-point
 * deletion, pixel-space hit-testing, and rubber-band preview primitives.
 * Everything operates on the model/scene types from ./graph.
 */

import type { IconName } from "@/components/Icon";
import { compileExpr } from "@/lib/blocks/expr";
import {
  clipLineToView,
  newGraphId,
  parabolaPolyline,
  resolvePoint,
  type GPoint,
  type GraphData,
  type GraphView,
  type GShape,
  type Proj,
  type Scene,
  type SceneItem,
  type SnapTarget,
} from "@/lib/blocks/graph";

export const HIT_PX = 9; // selection hit-test radius

export type ToolId =
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

export const TOOLS: Array<{ id: ToolId; icon: IconName; label: string; needs: number }> = [
  { id: "select", icon: "cursor", label: "Select / move", needs: 0 },
  { id: "point", icon: "point", label: "Point", needs: 1 },
  { id: "segment", icon: "segment", label: "Segment", needs: 2 },
  { id: "line", icon: "line", label: "Line (infinite)", needs: 2 },
  { id: "triangle", icon: "triangle", label: "Triangle", needs: 3 },
  { id: "rectangle", icon: "rectangle", label: "Rectangle", needs: 2 },
  { id: "circle", icon: "circle", label: "Circle", needs: 2 },
  { id: "ellipse", icon: "ellipse", label: "Ellipse", needs: 2 },
  { id: "parabola", icon: "parabola", label: "Parabola", needs: 2 },
  { id: "function", icon: "plot", label: "Function", needs: 0 },
];

/** Tools that stay active after one use; all others revert to Select. */
export const STICKY_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(["point", "segment", "line", "triangle"]);

export const HINTS: Record<ToolId, string> = {
  select: "Click a point or shape to select. Drag a point to reshape; drag the round handle above a shape to rotate it. Vertices snap to the grid and other points.",
  point: "Click to drop a point. It snaps to the grid, existing points, and side midpoints.",
  segment: "Click two points. Endpoints snap to existing points and midpoints (draw medians exactly).",
  line: "Click two points to define an infinite line (clipped to the view) — or type its equation in the panel.",
  triangle: "Click three vertices.",
  rectangle: "Drag from one corner to the opposite corner and release. Axis-aligned by default — rotate it later with the Select tool.",
  circle: "Click the center, then a point on the circle.",
  ellipse: "Click the center, then a point setting the x- and y-radii.",
  parabola: "Click the vertex, then a point the parabola passes through.",
  function: "Type an equation in the panel and press Plot.",
};

export type Selection = { kind: "point" | "shape"; id: string } | null;

export function samePair(a: [string, string], b: [string, string]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/** Which shapes can be rotated (point-based shapes + the ellipse via its rot field). */
export function rotatable(s: GShape): boolean {
  return s.kind === "segment" || s.kind === "line" || s.kind === "polygon" || s.kind === "ellipse";
}

/** The free-point ids a rotation should transform (ellipse rotates via its rot field). */
export function rotatablePointIds(s: GShape): string[] {
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
export function shapeCentroid(data: GraphData, s: GShape): [number, number] | null {
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
export function rotateShapeData(base: GraphData, ids: string[], ellipseId: string | null, c: [number, number], delta: number): GraphData {
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

export function nextName(points: GPoint[]): string {
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

export function buildShape(tool: ToolId, ids: string[], color: string): GShape | null {
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

// ─── Lines from an equation ──────────────────────────────────────────────────
//
// A line in the model is TWO POINTS, because that is what makes it draggable,
// rotatable and snappable like every other shape. An equation is therefore not
// a second kind of line but a second way to say where those two points go: it
// is parsed to `a·x + b·y = c`, and two anchors are dropped on that line.
//
// Nothing is stored about the equation. It is recovered from the points
// whenever it is needed (`lineEquationText`), so a line typed as `y = 2x + 1`
// and a line drawn with two clicks are the same object afterwards — dragging
// an anchor just moves the line, and the panel then shows the equation the
// dragged line actually has.

/** A line as `a·x + b·y = c`, with (a, b) ≠ (0, 0). */
export interface LineCoef {
  a: number;
  b: number;
  c: number;
}

/**
 * Parse a linear equation into `a·x + b·y = c`.
 *
 * Accepts anything the expression evaluator understands on either side of the
 * `=` — `y = 2x + 1`, `x = 3`, `2x + 3y = 6`, `y - 3 = 2(x - 1)` — plus a bare
 * expression (`2x + 1`), read as `y = …` the way a graphing calculator does.
 *
 * Both sides are compiled once and then PROBED rather than inspected: the
 * coefficients come from differences of `f(x,y) = lhs − rhs` at three points,
 * and the result is verified against `f` at several more. That both keeps the
 * parser (lib/blocks/expr.ts) as the single source of grammar truth and rejects
 * a non-linear equation (`y = x^2`) instead of silently drawing the tangent-ish
 * line its samples imply.
 */
export function parseLineEquation(src: string): LineCoef | null {
  const parts = src.split("=");
  if (parts.length > 2) return null;
  const [lhsSrc, rhsSrc] = parts.length === 2 ? parts : ["y", parts[0]];
  const lhs = compileExpr(lhsSrc, ["x", "y"]);
  const rhs = compileExpr(rhsSrc, ["x", "y"]);
  if (!lhs.fn || !rhs.fn) return null;
  const f = (x: number, y: number): number => lhs.fn!({ x, y }) - rhs.fn!({ x, y });

  let a: number;
  let b: number;
  let c: number;
  try {
    const f00 = f(0, 0);
    a = f(1, 0) - f00;
    b = f(0, 1) - f00;
    c = -f00;
  } catch {
    return null;
  }
  if (![a, b, c].every(Number.isFinite)) return null;
  if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) return null; // `1 = 1`, `y = y`

  // Verify linearity away from the probe points. The tolerance scales with the
  // magnitudes involved so large coefficients aren't rejected by rounding.
  for (const [x, y] of [[2, 3], [-4, 1.5], [7.25, -6]] as Array<[number, number]>) {
    let got: number;
    try {
      got = f(x, y);
    } catch {
      return null;
    }
    const want = a * x + b * y - c;
    const scale = Math.max(1, Math.abs(want), Math.abs(a * x), Math.abs(b * y), Math.abs(c));
    if (!Number.isFinite(got) || Math.abs(got - want) > 1e-9 * scale) return null;
  }
  return { a, b, c };
}

/** Convenience: does `src` describe a line? (drives the input's valid state) */
export function isValidLineEquation(src: string): boolean {
  return parseLineEquation(src) != null;
}

/**
 * Two distinct points ON the line, to be its defining anchors.
 *
 * They are placed a quarter and three quarters along the line's crossing of the
 * view, so both handles sit ON SCREEN and away from the edges. A line that
 * misses the view entirely (it can still be dragged into it) falls back to two
 * points spanning the view's width or height.
 */
export function lineAnchors(view: GraphView, k: LineCoef): [[number, number], [number, number]] {
  const { a, b, c } = k;
  const spanX = view.xmax - view.xmin;
  const spanY = view.ymax - view.ymin;
  // Two far-apart points on the line, chosen along whichever axis the line is
  // not parallel to (|b| ≥ |a| ⇒ solve for y, else for x).
  const far: [[number, number], [number, number]] =
    Math.abs(b) >= Math.abs(a)
      ? [
          [view.xmin - spanX, (c - a * (view.xmin - spanX)) / b],
          [view.xmax + spanX, (c - a * (view.xmax + spanX)) / b],
        ]
      : [
          [(c - b * (view.ymin - spanY)) / a, view.ymin - spanY],
          [(c - b * (view.ymax + spanY)) / a, view.ymax + spanY],
        ];
  const seg = clipLineToView(view, far[0], far[1]) ?? far;
  const at = (t: number): [number, number] => [
    seg[0][0] + (seg[1][0] - seg[0][0]) * t,
    seg[0][1] + (seg[1][1] - seg[0][1]) * t,
  ];
  return [at(0.25), at(0.75)];
}

/** Round for display: enough precision to be faithful, no 0.30000000000000004. */
function round(n: number): number {
  return Math.abs(n) < 1e-12 ? 0 : Number(n.toFixed(6));
}

/**
 * The equation of the line through A and B, as a user would write it —
 * `y = 2x + 1`, `y = -x`, `y = 3`, or `x = 3` for a vertical line.
 *
 * This is what the panel shows for a selected line, including one built by
 * clicking, so the equation field is never blank and always tells the truth
 * about the line on screen.
 */
export function lineEquationText(a: [number, number], b: [number, number]): string {
  const [x1, y1] = a;
  const [x2, y2] = b;
  if (Math.abs(x2 - x1) < 1e-12) return `x = ${round(x1)}`;
  const m = round((y2 - y1) / (x2 - x1));
  const k = round(y1 - m * x1);
  const slope = m === 0 ? "" : m === 1 ? "x" : m === -1 ? "-x" : `${m}x`;
  if (!slope) return `y = ${k}`;
  if (k === 0) return `y = ${slope}`;
  return `y = ${slope} ${k < 0 ? "-" : "+"} ${Math.abs(k)}`;
}

/** Remove a point and everything that depends on it (derived points + shapes). */
export function deletePoint(data: GraphData, id: string): GraphData {
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

export function shapeUsesAny(s: GShape, ids: Set<string>): boolean {
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
export function hitTest(scene: Scene, px: number, py: number): Selection {
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

export function distToItem(item: SceneItem, px: number, py: number): number {
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

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Build dashed rubber-band primitives from the in-progress points + cursor. */
export function previewPrims(
  data: GraphData,
  proj: Proj,
  tool: ToolId,
  pending: string[],
  cursor: { mx: number; my: number; snap: SnapTarget | null },
): SceneItem[] {
  const cx = cursor.snap ? cursor.snap.x : cursor.mx;
  const cy = cursor.snap ? cursor.snap.y : cursor.my;
  const cpt = proj.toPx(cx, cy);
  const anchors = pending.map((id) => resolvePoint(data, id)).filter((p): p is [number, number] => !!p);
  const out: SceneItem[] = [];
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
