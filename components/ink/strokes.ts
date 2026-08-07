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

/**
 * How Ancha is asked to read the ink.
 *
 * "auto" is the product default: Ancha segments the page herself and decides
 * per run whether it is prose or a formula, so the user never picks. The three
 * single-interpretation modes remain for the lab (and for the legacy contract):
 * "math" decodes everything as LaTeX, "text" as words, and "chem" reinterprets
 * the decoded expression as mhchem, returning `\ce{...}` (math LaTeX when the
 * ink turns out not to be chemistry-expressible).
 *
 * These string values are PERSISTED in the training corpus
 * (ml/data/corrections/collected.jsonl) — renaming one retro-invalidates every
 * sample already collected under it.
 */
export type RecognitionMode = "math" | "chem" | "text" | "auto";

/** What one recognized run of ink turned out to be. Chemistry is an
 *  interpretation of a MATH run, never a separate detection. */
export type SegmentKind = "text" | "math" | "chem";

/**
 * One recognized run of ink inside an "auto" result: a word/phrase, or a
 * formula. `strokes` indexes into the request's stroke array (indices are
 * preserved end-to-end), and `[sourceStart, sourceEnd)` slices this segment
 * out of the assembled `source` — which is what lets the UI re-label a
 * segment by splicing in place instead of re-recognizing the whole page.
 */
export interface Segment {
  id: string;
  line: number;
  page: number;
  kind: SegmentKind;
  /** Prose, for kind "text". */
  text?: string;
  /** LaTeX (or `\ce{...}`), for kind "math"/"chem". */
  latex?: string;
  /** What the text engine read here, kept even for math segments: flipping a
   *  math segment back to text is then a pure client-side splice, with no
   *  round trip. Re-reading an isolated run does NOT work — the text engine
   *  needs its line's context, which is gone by then. */
  visionText?: string;
  confidence: number;
  box: { minX: number; minY: number; maxX: number; maxY: number };
  strokes: number[];
  sourceStart: number;
  sourceEnd: number;
  /** True when this segment was produced without a text engine (no Vision on
   *  this platform), so everything was necessarily read as math. */
  degraded?: boolean;
}

/** A user's per-segment correction, replayed on the next recognize call so the
 *  fix survives further strokes. */
export interface SegmentOverride {
  strokes: number[];
  kind: SegmentKind;
}

/** Request body for POST /recognize. */
export interface RecognizeRequest {
  strokes: Stroke[];
  mode: RecognitionMode;
  /** Read formulas as chemistry (the Σ/⚗ switch). An INTERPRETATION flag, not
   *  a mode: it changes how math runs are decoded and leaves prose alone. */
  chem?: boolean;
  /** Document-space y of each ink-page top. A line may never span a page
   *  break, so the segmenter bands the strokes by these first. */
  pageBreaks?: number[];
  overrides?: SegmentOverride[];
}

/** Request body for POST /recognize/segment — re-read one run under a kind the
 *  user picked, without disturbing the rest of the page. */
export interface SegmentRequest {
  strokes: Stroke[];
  kind: SegmentKind;
}

/** Request body for POST /collect (a human-corrected training sample).
 *  `mode` is a SampleMode, not a RecognitionMode: the server files samples by
 *  what they ARE and rejects the request-only value "auto". */
export interface CollectRequest {
  strokes: Stroke[];
  label: string;
  predicted?: string;
  mode: SampleMode;
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

/** Build the exact JSON body for POST /recognize. Optional fields are omitted
 *  rather than sent as undefined, so a plain single-mode call is byte-identical
 *  to what the pre-"auto" client sent. */
export function buildRecognizeRequest(
  strokes: readonly Stroke[],
  mode: RecognitionMode,
  opts: { chem?: boolean; pageBreaks?: readonly number[]; overrides?: readonly SegmentOverride[] } = {},
): RecognizeRequest {
  const req: RecognizeRequest = { strokes: rebaseStrokes(strokes), mode };
  if (opts.chem) req.chem = true;
  if (opts.pageBreaks?.length) req.pageBreaks = [...opts.pageBreaks];
  if (opts.overrides?.length) req.overrides = opts.overrides.map((o) => ({ strokes: [...o.strokes], kind: o.kind }));
  return req;
}

/** Build the body for POST /recognize/segment: re-read just this run's ink
 *  under an explicit kind. The strokes are rebased exactly as /recognize
 *  rebases them, so the same ink decodes to the same thing either way. */
export function buildSegmentRequest(strokes: readonly Stroke[], kind: SegmentKind): SegmentRequest {
  return { strokes: rebaseStrokes(strokes), kind };
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
  mode: SampleMode,
): CollectRequest {
  const filed = fileAs(mode, label);
  const bare = filed === "math" || filed === "chem";
  return {
    strokes: rebaseStrokes(strokes),
    label: bare ? unwrapInlineMath(label) : label,
    predicted: predicted && bare ? unwrapInlineMath(predicted) : predicted,
    mode: filed,
  };
}

/**
 * The mode a SAVED SAMPLE is filed under.
 *
 * Deliberately not `RecognitionMode`: "auto" is an instruction to the
 * recognizer ("you decide"), never an answer, so it is not a thing a stored
 * sample can BE — the server rejects it, and a sample filed under it would not
 * be routable to a decoder anyway. "mixed" is the opposite: never a request,
 * only ever the label of a whole segmented page.
 */
export type SampleMode = "math" | "chem" | "text" | "mixed";

/**
 * Resolve the mode a result should be FILED under from the mode it was
 * REQUESTED under. Only "auto" needs resolving, and the answer is in what Ancha
 * came back with: no segments at all means a single formula (the Σ/⚗ switch
 * says which kind), one segment means that run's own kind, and several means a
 * genuinely mixed page whose parent is stored non-trainable.
 */
export function sampleMode(
  mode: RecognitionMode,
  segments: readonly Segment[] | undefined,
  chem: boolean,
): SampleMode {
  if (mode !== "auto") return mode;
  if (!segments || segments.length === 0) return chem ? "chem" : "math";
  if (segments.length === 1) return segments[0].kind;
  return "mixed";
}

/**
 * Strip one enclosing `\( ... \)` from a label filed as math or chem.
 *
 * A unified reading is assembled as paragraph SOURCE, so even a page that turns
 * out to be a single formula comes back as `\(x^{2}\)` — and that is what the
 * user sees and edits in the panel. The decoder, though, is trained on bare
 * LaTeX (MathWriting's labels are `\frac{x}{2}`, never `\(\frac{x}{2}\)`), so
 * storing the wrapper would teach it to emit delimiters it must never emit.
 *
 * Only unwraps when the delimiters enclose the WHOLE string: `\(a\)+\(b\)` is
 * two runs, which is a mixed page, whose label is stored whole and untrained.
 */
export function unwrapInlineMath(label: string): string {
  const s = label.trim();
  if (!s.startsWith("\\(") || !s.endsWith("\\)")) return s;
  const inner = s.slice(2, -2);
  return inner.includes("\\)") ? s : inner.trim();
}

/**
 * The mode a sample is ACTUALLY filed under, once its label is known.
 *
 * The mode is resolved from the recognition, but the label can be anything the
 * user typed over it. If a label filed as math/chem still carries inline-math
 * delimiters after unwrapping, it is not one formula — it is a page — and
 * training the decoder on it would teach it to emit `\(` and `\)`, which it
 * must never do. Demote to "mixed": the sample is still SAVED (nothing the
 * user corrected is ever thrown away), it just stays out of the math corpus
 * until someone splits it by hand.
 */
function fileAs(mode: SampleMode, label: string): SampleMode {
  if (mode !== "math" && mode !== "chem") return mode;
  return unwrapInlineMath(label).includes("\\(") ? "mixed" : mode;
}

/** One run of an accepted page. `label` is Ancha's own reading of that run —
 *  for an accepted sample the prediction and the label are the same string. */
export interface AcceptedSegment {
  strokes: number[];
  label: string;
  kind: SegmentKind;
}

/** Request body for POST /collect/accepted — ink the user inserted UNCHANGED. */
export interface AcceptedRequest {
  strokes: Stroke[];
  label: string;
  mode: SampleMode;
  confidence?: number;
  segments?: AcceptedSegment[];
}

/**
 * Build the body for POST /collect/accepted: the same ink the recognize call
 * sent (so stroke INDICES still address the same strokes, which is what the
 * per-segment children are cut out by), the reading the user accepted, and
 * Ancha's confidence in it so a later run can filter on it.
 *
 * Segments ride along only for a genuinely mixed page — the server files
 * children under a non-trainable parent, and a single-run reading is already
 * fully described by `mode`.
 */
export function buildAcceptedRequest(
  strokes: readonly Stroke[],
  label: string,
  mode: SampleMode,
  opts: { confidence?: number; segments?: readonly Segment[] } = {},
): AcceptedRequest {
  const filed = fileAs(mode, label);
  const req: AcceptedRequest = {
    strokes: rebaseStrokes(strokes),
    label: filed === "math" || filed === "chem" ? unwrapInlineMath(label) : label,
    mode: filed,
  };
  if (typeof opts.confidence === "number") req.confidence = r3(opts.confidence);
  if (filed === "mixed" && opts.segments?.length) {
    const segments = opts.segments
      .map((s) => ({ strokes: [...s.strokes], label: (s.kind === "text" ? s.text : s.latex) ?? "", kind: s.kind }))
      .filter((s) => s.label.trim().length > 0 && s.strokes.length > 0);
    if (segments.length > 0) req.segments = segments;
  }
  return req;
}
