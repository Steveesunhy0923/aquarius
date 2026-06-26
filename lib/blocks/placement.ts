/**
 * In-flow LaTeX layout for freely-positioned figure objects.
 *
 * A figure block (image / table / graph) is a BOX: width = the text width
 * (`\linewidth`), height = the tallest object. Objects carry a `Placement`
 * (`{ x, r }`, fractions of the box width). This module turns a row of placed
 * objects into normal in-flow LaTeX:
 *   - a leading `\hspace*` to the leftmost object,
 *   - `\hspace` gaps between consecutive objects (clamped ≥ 0 — no overlap in
 *     output, the accepted in-flow trade-off),
 *   - `\raisebox` for each object's vertical position.
 *
 * Pure (no DOM): all geometry is already baked into the stored fractions.
 * Kept in its own module so both serialize.ts and tables.ts can use it without
 * an import cycle.
 */

import type { Placement } from "./types";

/** Format a line-width fraction as a LaTeX length, e.g. `0.08\linewidth`. */
export function linewidthLen(frac: number): string {
  return `${parseFloat(frac.toFixed(4))}\\linewidth`;
}

/** True when any object carries a free 2D position. */
export function hasPlacement(objs: { pos?: Placement }[]): boolean {
  return objs.some((o) => !!o.pos);
}

export interface PlacedObject {
  pos?: Placement;
  /** Object width as a fraction of `\linewidth` (for inter-object gaps; 0 = unknown). */
  width: number;
  /** The LaTeX body for this object (`\includegraphics` / tabular / tikzpicture). */
  body: string;
}

/**
 * Lay placed objects into one in-flow row. Order follows `x` (ties keep input
 * order). Objects without a `pos` are treated as `{ x: 0, r: 0 }`.
 */
export function placedRowToLatex(objs: PlacedObject[]): string {
  if (objs.length === 0) return "";
  const placed = objs
    .map((o, i) => ({ o, i, x: o.pos?.x ?? 0, r: o.pos?.r ?? 0 }))
    .sort((a, b) => a.x - b.x || a.i - b.i);

  const x0 = Math.max(0, placed[0].x);
  const parts: string[] = [`\\noindent\\hspace*{${linewidthLen(x0)}}`];

  placed.forEach((cur, k) => {
    if (k > 0) {
      const prev = placed[k - 1];
      const gap = Math.max(0, cur.x - (prev.x + Math.max(0, prev.o.width)));
      parts.push(`\\hspace{${linewidthLen(gap)}}`);
    }
    const r = Math.max(0, cur.r);
    parts.push(r > 0.0005 ? `\\raisebox{${linewidthLen(r)}}{${cur.o.body}}` : cur.o.body);
  });
  return parts.join("");
}
