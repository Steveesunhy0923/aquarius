/**
 * graph-edit — pure (React-free) editing logic behind the interactive
 * GraphEditor: the tool tables, shape construction, rotation, dependent-point
 * deletion, pixel-space hit-testing, and rubber-band preview primitives.
 * Everything operates on the model/scene types from ./graph.
 */

import type { IconName } from "@/components/Icon";
import {
  newGraphId,
  parabolaPolyline,
  resolvePoint,
  type GPoint,
  type GraphData,
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
  line: "Click two points to define an infinite line (clipped to the view).",
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
