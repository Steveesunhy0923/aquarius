/**
 * Ink stroke model + helpers for the handwriting testbed (/ink).
 *
 * The wire format matches the local recognition server's contract exactly:
 *
 *   POST http://127.0.0.1:8787/recognize
 *   { "strokes": [{ "x": [...], "y": [...], "t": [...], "p": [...] }, ...],
 *     "mode": "math" | "text" | "chem" }
 *
 * x/y are CSS pixels, t is milliseconds relative to the first recorded point,
 * p is pressure 0..1 (optional on the wire; we always record it — mouse input
 * reports a constant 0.5).
 */

/** One ink sample. `t` is a raw event timestamp (ms); it is re-based to the
 *  session's first point only when the API payload is built. */
export interface Point {
  x: number;
  y: number;
  t: number;
  p: number;
}

/** One stroke in the API's struct-of-arrays shape. All arrays are the same length. */
export interface Stroke {
  x: number[];
  y: number[];
  t: number[];
  p: number[];
}

/** "chem" recognizes the same ink as chemistry: the server reinterprets the
 *  decoded expression as mhchem and returns `\ce{...}` (math LaTeX when the
 *  ink turns out not to be chemistry-expressible). */
export type RecognitionMode = "math" | "chem" | "text";

/** Request body for POST /recognize. */
export interface RecognizeRequest {
  strokes: Stroke[];
  mode: RecognitionMode;
}

/** Request body for POST /collect (a human-corrected training sample). */
export interface CollectRequest {
  strokes: Stroke[];
  label: string;
  predicted?: string;
  mode: RecognitionMode;
}

/** Pack an array of samples into the struct-of-arrays stroke shape. */
export function strokeFromPoints(points: readonly Point[]): Stroke {
  const s: Stroke = { x: [], y: [], t: [], p: [] };
  for (const pt of points) {
    s.x.push(pt.x);
    s.y.push(pt.y);
    s.t.push(pt.t);
    s.p.push(pt.p);
  }
  return s;
}

/** The i-th sample of a stroke as a Point. */
export function pointAt(stroke: Stroke, i: number): Point {
  return { x: stroke.x[i], y: stroke.y[i], t: stroke.t[i], p: stroke.p[i] };
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Bounding box of a set of strokes in CSS pixels; null when there is no ink. */
export function boundingBox(strokes: readonly Stroke[]): Box | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.x.length; i++) {
      if (s.x[i] < minX) minX = s.x[i];
      if (s.x[i] > maxX) maxX = s.x[i];
      if (s.y[i] < minY) minY = s.y[i];
      if (s.y[i] > maxY) maxY = s.y[i];
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/**
 * Resample a stroke to (roughly) equidistant points, `spacing` CSS px apart
 * along the arc, linearly interpolating x/y/t/p. The first and last original
 * samples are always kept. Useful to tame the very dense coalesced Pencil
 * input before shipping it anywhere.
 */
export function resample(stroke: Stroke, spacing: number): Stroke {
  const n = stroke.x.length;
  if (n <= 1 || spacing <= 0) return strokeFromPoints(Array.from({ length: n }, (_, i) => pointAt(stroke, i)));

  const out: Point[] = [pointAt(stroke, 0)];
  let carried = 0; // arc length accumulated since the last emitted point
  let prev = pointAt(stroke, 0);
  for (let i = 1; i < n; i++) {
    const curr = pointAt(stroke, i);
    let d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    while (d > 0 && carried + d >= spacing) {
      const f = (spacing - carried) / d;
      const q: Point = {
        x: lerp(prev.x, curr.x, f),
        y: lerp(prev.y, curr.y, f),
        t: lerp(prev.t, curr.t, f),
        p: lerp(prev.p, curr.p, f),
      };
      out.push(q);
      prev = q;
      carried = 0;
      d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    }
    carried += d;
    prev = curr;
  }
  const last = pointAt(stroke, n - 1);
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) out.push(last);
  return strokeFromPoints(out);
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Shape strokes for the wire: timestamps re-based so the earliest sample of the
 * session is t=0, values rounded (x/y to 0.01 px, t to 0.1 ms, p to 0.001) to
 * keep the payload small. Shared by /recognize and /collect so a saved
 * correction is byte-identical to what the model was asked to recognize.
 */
function rebaseStrokes(strokes: readonly Stroke[]): Stroke[] {
  let t0 = Infinity;
  for (const s of strokes) if (s.t.length > 0 && s.t[0] < t0) t0 = s.t[0];
  if (!Number.isFinite(t0)) t0 = 0;
  return strokes.map((s) => ({
    x: s.x.map(r2),
    y: s.y.map(r2),
    t: s.t.map((v) => r1(v - t0)),
    p: s.p.map(r3),
  }));
}

/** Build the exact JSON body for POST /recognize. */
export function buildRecognizeRequest(strokes: readonly Stroke[], mode: RecognitionMode): RecognizeRequest {
  return { strokes: rebaseStrokes(strokes), mode };
}

/**
 * Build the body for POST /collect: the same ink as the recognize call, plus
 * the correct `label` the user typed and (optionally) what the model
 * `predicted`, so the sample can be replayed as training data verbatim.
 */
export function buildCollectRequest(
  strokes: readonly Stroke[],
  label: string,
  predicted: string | undefined,
  mode: RecognitionMode,
): CollectRequest {
  return { strokes: rebaseStrokes(strokes), label, predicted, mode };
}
