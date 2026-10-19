/**
 * Coloured boxes — LaTeX's `tcolorbox`, for setting a concept apart from the
 * text around it: a definition, a theorem, a worked example.
 *
 * A box is not a block. It is a RUN of consecutive top-level blocks carrying
 * the same `attrs.box.id`, so anything a page holds — paragraphs, equations,
 * lists, tables, code — can sit inside one, every block keeps its own editing,
 * and the paginator still sees ordinary blocks: a long box breaks across pages
 * the way a `breakable` tcolorbox does. Every block of the run carries the same
 * colour and title; the renderer and the serializer read them off the first.
 *
 * One colour is the whole palette, as in tcolorbox: the frame and title bar are
 * that colour darkened (`colframe=C!80!black`), the fill a faint tint of it
 * (`colback=C!6!white`). The page mixes the same amounts (app/globals.css
 * `.aq-box`), so what exports is what was on screen.
 *
 * Not the older callout (./callouts.ts): that is ONE paragraph painted with a
 * solid fill, which the poster designs use as banners.
 */

import { escapeLatex } from "./captions";
import type { Block } from "./types";

export interface BoxStyle {
  /** Shared by every block of one box. Adjacent blocks with the same id ARE the box. */
  id: string;
  /** `#rrggbb` — the box's colour, before the frame darkens and the fill tints it. */
  color: string;
  /** Text of the title bar. Absent: a box with no bar. */
  title?: string;
}

/** The toolbar's palette: mid-tones, so both the darkened frame and the tint read. */
export const BOX_COLORS: readonly string[] = [
  "#2563eb", // blue
  "#0d9488", // teal
  "#16a34a", // green
  "#d97706", // amber
  "#dc2626", // red
  "#db2777", // pink
  "#7c3aed", // violet
  "#475569", // slate
];

export const DEFAULT_BOX_COLOR = BOX_COLORS[0];

/** The titles a concept box usually carries, offered as one-click picks. */
export const BOX_TITLES: readonly string[] = ["Definition", "Theorem", "Lemma", "Example", "Note"];

/** tcolorbox's mixes: colframe = C!80!black, colback = C!6!white. */
const FRAME_PCT = 80;
const BACK_PCT = 6;

/** A `#rrggbb` colour. */
export function isBoxColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

function normalize(box: BoxStyle): BoxStyle {
  const color = box.color.toLowerCase();
  return box.title ? { id: box.id, color, title: box.title } : { id: box.id, color };
}

/** A new box, not yet holding anything. */
export function newBox(color: string = DEFAULT_BOX_COLOR, title?: string): BoxStyle {
  return normalize({ id: crypto.randomUUID(), color, title });
}

/** The box a block sits in, or null. */
export function boxOf(b: Block | null | undefined): BoxStyle | null {
  const v = b?.attrs?.box as Partial<BoxStyle> | undefined;
  if (!v || typeof v.id !== "string" || !v.id || typeof v.color !== "string" || !isBoxColor(v.color)) return null;
  return normalize({ id: v.id, color: v.color, title: typeof v.title === "string" ? v.title : undefined });
}

/** The block in `box`, or out of any box with null. An unchanged block comes back as itself. */
export function withBox(b: Block, box: BoxStyle | null): Block {
  const next = box ? normalize(box) : null;
  const cur = boxOf(b);
  if (next ? cur && cur.id === next.id && cur.color === next.color && cur.title === next.title : b.attrs?.box === undefined) return b;
  const attrs = { ...b.attrs };
  if (next) attrs.box = next;
  else delete attrs.box;
  return { ...b, attrs };
}

/** Both blocks sit in the same box. */
export function inSameBox(a: Block | null | undefined, b: Block | null | undefined): boolean {
  const x = boxOf(a);
  const y = boxOf(b);
  return x != null && y != null && x.id === y.id;
}

/** First and last index (inclusive) of the box holding `blocks[i]`, or null. */
export function boxRun(blocks: readonly Block[], i: number): [number, number] | null {
  if (!boxOf(blocks[i])) return null;
  let start = i;
  let end = i;
  while (start > 0 && inSameBox(blocks[start - 1], blocks[i])) start--;
  while (end < blocks.length - 1 && inSameBox(blocks[end + 1], blocks[i])) end++;
  return [start, end];
}

/**
 * Restyle the box holding `blockId` — every block of it, so the run never
 * disagrees with itself — or, with null, take its blocks out of the box.
 */
export function restyleBoxRun(blocks: Block[], blockId: string, patch: { color?: string; title?: string } | null): Block[] {
  const run = boxRun(blocks, blocks.findIndex((b) => b.id === blockId));
  if (!run) return blocks;
  const next = patch ? { ...boxOf(blocks[run[0]])!, ...patch } : null;
  return blocks.map((b, k) => (k >= run[0] && k <= run[1] ? withBox(b, next) : b));
}

/** Take the block after the box holding `blockId` into it. */
export function extendBoxRun(blocks: Block[], blockId: string): Block[] {
  const run = boxRun(blocks, blocks.findIndex((b) => b.id === blockId));
  if (!run || run[1] + 1 >= blocks.length) return blocks;
  const box = boxOf(blocks[run[0]]);
  return blocks.map((b, k) => (k === run[1] + 1 ? withBox(b, box) : b));
}

/** The same blocks with every box given a new id — for a copied fragment (a
 *  module inserted twice), whose boxes must not fuse with the ones it came from. */
export function renewBoxIds(blocks: Block[]): Block[] {
  const ids = new Map<string, string>();
  return blocks.map((b) => {
    const box = boxOf(b);
    if (!box) return b;
    if (!ids.has(box.id)) ids.set(box.id, crypto.randomUUID());
    return withBox(b, { ...box, id: ids.get(box.id)! });
  });
}

/** Where one block sits in its box: the box's style, and whether it opens or closes it. */
export interface BoxEdge {
  box: BoxStyle;
  start: boolean;
  end: boolean;
}

/** Every boxed block's place in its box, over blocks in page order. */
export function boxEdges(blocks: readonly Block[]): Map<string, BoxEdge> {
  const out = new Map<string, BoxEdge>();
  for (let i = 0; i < blocks.length; i++) {
    const run = boxRun(blocks, i);
    if (!run) continue;
    const box = boxOf(blocks[run[0]])!;
    for (let k = run[0]; k <= run[1]; k++) out.set(blocks[k].id, { box, start: k === run[0], end: k === run[1] });
    i = run[1];
  }
  return out;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The frame and title-bar colour: `C!80!black`. */
export function boxFrameColor(color: string): string {
  return (
    "#" +
    rgb(color)
      .map((c) => Math.round((c * FRAME_PCT) / 100).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** The frame is light enough that the title needs dark ink. */
function frameIsLight(color: string): boolean {
  const [r, g, b] = rgb(boxFrameColor(color));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

/** Title text colour: white on the frame, as tcolorbox sets it, unless the frame is too light for that. */
export function boxTitleInk(color: string): string {
  return frameIsLight(color) ? "#1f2937" : "#ffffff";
}

/** The custom properties `.aq-box` draws with (app/globals.css). */
export function boxCssVars(box: BoxStyle): Record<string, string> {
  return {
    "--box-color": box.color,
    "--box-frame": boxFrameColor(box.color),
    "--box-title-ink": boxTitleInk(box.color),
  };
}

/**
 * A box around its blocks' LaTeX (`body`). The colour is defined by name first:
 * tcolorbox keys take xcolor expressions, and `C!80!black` needs a C.
 */
export function boxToLatex(box: BoxStyle, body: string): string {
  const hex = box.color.slice(1).toLowerCase();
  const name = `aqbox${hex}`;
  const title = box.title?.trim();
  const opts = [
    "enhanced",
    "breakable",
    `colback=${name}!${BACK_PCT}!white`,
    `colframe=${name}!${FRAME_PCT}!black`,
    ...(title ? [`coltitle=${frameIsLight(box.color) ? "black" : "white"}`, "fonttitle=\\bfseries", `title={${escapeLatex(title)}}`] : []),
  ];
  return (
    `% requires \\usepackage[skins,breakable]{tcolorbox}\n` +
    `\\definecolor{${name}}{HTML}{${hex.toUpperCase()}}\n` +
    `\\begin{tcolorbox}[${opts.join(",")}]\n${body}\n\\end{tcolorbox}`
  );
}
