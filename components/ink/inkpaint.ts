/**
 * inkpaint — the pure stroke renderer shared by every ink surface.
 *
 * Lifted verbatim out of InkCanvas.tsx so the compact single-page surface and
 * the paged A4 surface draw pixel-identical ink: same pressure→width curve,
 * same quadratic midpoint smoothing, same incremental-repaint contract. These
 * functions know nothing about pages, transforms or devicePixelRatio — the
 * caller sets up `ctx` (transform + strokeStyle/fillStyle + round caps) and
 * hands over points in whatever coordinate space that transform expects.
 */

import type { Point } from "./strokes";

// Pen look: ~2px hairline at mouse pressure (0.5), swelling with real Pencil pressure.
const BASE_WIDTH = 2.1;
export const widthFor = (p: number) => BASE_WIDTH * (0.55 + 0.9 * p);
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function paintDot(ctx: CanvasRenderingContext2D, pt: Point) {
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
export function paintSegments(ctx: CanvasRenderingContext2D, pts: readonly Point[], from: number) {
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

export function paintStroke(ctx: CanvasRenderingContext2D, pts: readonly Point[]) {
  if (pts.length === 0) return;
  if (pts.length === 1) paintDot(ctx, pts[0]);
  else paintSegments(ctx, pts, 1);
}
