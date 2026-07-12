"use client";

import {
  buildScene,
  graphModel,
  makeProj,
  resolveGeometry,
  type GraphData,
  type Scene,
  type SceneItem,
  type SceneLabel,
  type ScenePoint,
} from "@/lib/blocks/graph";
import type { Block } from "@/lib/blocks/types";

/**
 * Static, read-only SVG rendering of a graph block — reused by the WYSIWYG page
 * (via BlockView), the library cover thumbnail, and print/PDF. Colors use
 * `currentColor` / CSS variables so the figure renders dark-on-white under the
 * print stylesheet. The interactive editor (GraphEditor) draws the same scene
 * with pointer handlers layered on top.
 */
export function GraphView({ block, data }: { block?: Block; data?: GraphData }) {
  const raw = data ?? (block ? graphModel(block) : null);
  if (!raw) return null;
  const model = resolveGeometry(raw); // No-coordinate mode derives view/canvas from grid counts
  const W = model.width;
  const H = model.height;
  const proj = makeProj(model.view, W, H);
  const scene = buildScene(model, proj);

  const caption = (model.caption ?? "").trim();
  return (
    <figure className="m-0 flex flex-col items-center text-foreground">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="max-w-full rounded-md border border-border bg-surface"
        style={{ height: "auto" }}
        role="img"
        aria-label="graph figure"
      >
        <SceneBase scene={scene} />
        <g>{scene.shapes.map((s, i) => renderItem(s, `s${i}`))}</g>
        <g>{scene.points.map((p) => renderPoint(p))}</g>
      </svg>
      {caption && <figcaption className="mt-1 text-center text-sm italic text-muted">{caption}</figcaption>}
    </figure>
  );
}

/** The static grid/axes/tick-label layers — shared by the viewer and the editor. */
export function SceneBase({ scene }: { scene: Scene }) {
  return (
    <>
      <g>{scene.grid.map((g, i) => renderItem(g, `g${i}`))}</g>
      <g>{scene.axes.map((a, i) => renderItem(a, `a${i}`))}</g>
      <g>{scene.labels.map((l, i) => renderLabel(l, `l${i}`))}</g>
    </>
  );
}

/** Render one scene primitive (shared shape of the editor's drawing). */
export function renderItem(item: SceneItem, key: string) {
  if (item.t === "ellipse") {
    return (
      <ellipse
        key={key}
        cx={item.cx}
        cy={item.cy}
        rx={item.rx}
        ry={item.ry}
        fill={item.fillColor ?? "none"}
        fillOpacity={item.fillColor ? 0.25 : undefined}
        stroke={item.stroke}
        strokeWidth={item.width ?? 1.5}
        transform={item.rot ? `rotate(${item.rot} ${item.cx} ${item.cy})` : undefined}
      />
    );
  }
  const d = item.pts.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
  if (item.closed) {
    return (
      <polygon
        key={key}
        points={d}
        fill={item.solid ? item.stroke : item.fillColor ?? "none"}
        fillOpacity={item.solid ? 1 : item.fillColor ? 0.25 : undefined}
        stroke={item.stroke}
        strokeWidth={item.width ?? 1.5}
        strokeDasharray={item.dash ? "5 4" : undefined}
      />
    );
  }
  return (
    <polyline
      key={key}
      points={d}
      fill="none"
      stroke={item.stroke}
      strokeWidth={item.width ?? 1.5}
      strokeDasharray={item.dash ? "5 4" : undefined}
    />
  );
}

/** Render a point handle + optional label. */
export function renderPoint(p: ScenePoint) {
  return (
    <g key={p.id}>
      <circle
        cx={p.px}
        cy={p.py}
        r={p.derived ? 2.6 : 3.4}
        fill={p.derived ? "var(--surface)" : "currentColor"}
        stroke="currentColor"
        strokeWidth={1.2}
      />
      {p.showName && p.name && (
        <text x={p.px + 6} y={p.py - 6} fontSize={13} fill="currentColor" className="select-none">
          {p.name}
        </text>
      )}
    </g>
  );
}

/** Render an axis tick number. */
export function renderLabel(l: SceneLabel, key: string) {
  return (
    <text key={key} x={l.px} y={l.py} fontSize={11} textAnchor={l.anchor} fill="currentColor" className="select-none" opacity={0.7}>
      {l.text}
    </text>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
