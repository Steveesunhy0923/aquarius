"use client";

/**
 * Ancha wiring + result panel for the ink testbed.
 *
 * `useRecognition` owns the conversation with Ancha, the local recognition
 * server (POST http://127.0.0.1:8787/recognize): manual convert, debounced
 * auto-convert after the last stroke ends, the recognition mode, per-run
 * re-labelling, and the offline/error states.
 *
 * The default mode is "auto" — Ancha segments the page and decides prose vs
 * formula per run, so the user never picks. A unified result carries `source`
 * (the whole reading as paragraph source) and `segments` (her per-run calls),
 * which is what the chips and the mixed preview render. The three
 * single-interpretation modes keep the old two-field shape untouched.
 *
 * The small control widgets (ModeToggle / AutoToggle / ConvertButton) live in
 * the page's top bar; `RecognitionPanel` renders the result.
 */

import { Katex } from "@/components/Katex";
import { anchaUrl } from "@/lib/ink/endpoint";
import { MixedPreview, SegmentChips } from "./MixedResult";
import { ceInner, wrapCe } from "@/lib/blocks/chem";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildAcceptedRequest,
  buildCollectRequest,
  buildRecognizeRequest,
  buildSegmentRequest,
  sampleMode,
  type RecognitionMode,
  type SampleMode,
  type Segment,
  type SegmentKind,
  type SegmentOverride,
  type Stroke,
} from "./strokes";

// Resolved per call, not once at module load: the endpoint can be re-pointed
// at runtime from the device (see lib/ink/endpoint.ts).
const RECOGNIZE_URL = () => anchaUrl("/recognize");
const COLLECT_URL = () => anchaUrl("/collect");
const ACCEPTED_URL = () => anchaUrl("/collect/accepted");
const SEGMENT_URL = () => anchaUrl("/recognize/segment");
export const OFFLINE_CMD = "cd ml && .venv/bin/python serve.py";
const AUTO_DELAY_MS = 800;

export interface RecognitionResult {
  latex: string;
  confidence: number;
  /** "auto" only: the whole reading as paragraph source — prose with
   *  `\( ... \)` inline math. Equal to `latex` on that path; absent on the
   *  single-interpretation modes. */
  source?: string;
  /** "auto" only: one entry per recognized run, in reading order. */
  segments?: Segment[];
  /** "auto" only: which engines actually ran (text is null when Ancha had to
   *  fall back to geometry alone). */
  engine?: { layout?: string; text?: string | null; math?: string };
}

/**
 * Recognition state machine. `strokes` is the committed ink; `strokeSeq`
 * increments each time a stroke ENDS (not on undo/clear) and is what the
 * auto-convert debounce keys on.
 */
export function useRecognition(
  strokes: Stroke[],
  strokeSeq: number,
  opts: {
    /** Where the ink pages break (document-space y). Ancha forbids a line
     *  spanning two sheets, so a paged canvas must hand these over. */
    pageBreaks?: number[];
    initialMode?: RecognitionMode;
  } = {},
) {
  // "auto" is the default: Ancha decides text-vs-math per run, so the user never
  // picks. The single-interpretation modes remain reachable from the lab.
  const [mode, setMode] = useState<RecognitionMode>(opts.initialMode ?? "auto");
  // Chemistry is an INTERPRETATION of the formula runs, not a fourth mode —
  // `Sn` is tin or `\sin` purely by the writer's intent, so it stays a switch
  // the user throws while text-vs-math is detected.
  const [chem, setChem] = useState(false);
  // Runs the user re-labelled by hand, replayed on every later call so the fix
  // survives the next stroke.
  const [overrides, setOverrides] = useState<SegmentOverride[]>([]);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  // Which strokeSeq the current `result` was computed FROM — consumers compare
  // it against their live strokeSeq to detect a stale recognition (ink changed
  // after the request went out, or a debounce/re-convert is still pending).
  const [resultSeq, setResultSeq] = useState<number | null>(null);
  // Which MODE produced the current result: "text" results are plain words and
  // must not be typeset through KaTeX.
  const [resultMode, setResultMode] = useState<RecognitionMode>("math");
  // What that result is FILED as when saved. Resolved when the response lands,
  // not when the user saves: "auto" is not a corpus label, and the answer
  // depends on the segments Ancha returned and the Σ/⚗ switch AS IT WAS at
  // request time — both of which can have moved on by the time Save is hit.
  const [resultSampleMode, setResultSampleMode] = useState<SampleMode>("math");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  // Read through refs so `convert` stays stable across renders.
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const chemRef = useRef(chem);
  chemRef.current = chem;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const pageBreaksRef = useRef(opts.pageBreaks);
  pageBreaksRef.current = opts.pageBreaks;
  const seqRef = useRef(strokeSeq);
  seqRef.current = strokeSeq;
  const abortRef = useRef<AbortController | null>(null);
  // The current result and its filing mode, readable from the stable save
  // callbacks below without making them depend on either.
  const resultRef = useRef(result);
  resultRef.current = result;
  const sampleModeRef = useRef(resultSampleMode);
  sampleModeRef.current = resultSampleMode;

  const convert = useCallback(async () => {
    const ink = strokesRef.current;
    if (ink.length === 0) return;
    const seqAtRequest = seqRef.current;
    const modeAtRequest = modeRef.current;
    const chemAtRequest = chemRef.current;
    abortRef.current?.abort(); // supersede any in-flight request
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(RECOGNIZE_URL(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildRecognizeRequest(ink, modeRef.current, {
            chem: chemRef.current,
            pageBreaks: pageBreaksRef.current,
            overrides: overridesRef.current,
          }),
        ),
        signal: ac.signal,
      });
      setOffline(false);
      if (!res.ok) {
        let detail = `Recognition failed (HTTP ${res.status})`;
        try {
          const body: unknown = await res.json();
          const d = (body as { detail?: unknown })?.detail;
          if (typeof d === "string" && d) detail = d;
        } catch {
          /* non-JSON error body */
        }
        setResult(null);
        setResultSeq(null);
        setError(detail);
      } else {
        const body = (await res.json()) as {
          latex?: unknown;
          confidence?: unknown;
          source?: unknown;
          segments?: unknown;
          engine?: unknown;
        };
        const next: RecognitionResult = {
          latex: typeof body.latex === "string" ? body.latex : "",
          confidence: typeof body.confidence === "number" ? body.confidence : 0,
          source: typeof body.source === "string" ? body.source : undefined,
          segments: Array.isArray(body.segments) ? (body.segments as Segment[]) : undefined,
          engine: (body.engine as RecognitionResult["engine"]) ?? undefined,
        };
        setResult(next);
        setResultSeq(seqAtRequest);
        setResultMode(modeAtRequest);
        setResultSampleMode(sampleMode(modeAtRequest, next.segments, chemAtRequest));
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // superseded or cleared
      setResult(null);
      setError(null);
      setOffline(true); // network-level failure → server not running
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, []);

  // Auto-convert: re-recognize AUTO_DELAY_MS after the last stroke ends.
  useEffect(() => {
    if (!auto || strokeSeq === 0) return;
    const id = setTimeout(() => void convert(), AUTO_DELAY_MS);
    return () => clearTimeout(id);
  }, [auto, strokeSeq, convert]);

  // Ink fully cleared → drop stale results and cancel anything in flight.
  useEffect(() => {
    if (strokes.length > 0) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setResult(null);
    setResultSeq(null);
    setError(null);
  }, [strokes.length]);

  // ── Correction capture: save the current ink under a human-typed label as
  // training data. Returns the running collected-sample count, or null on
  // failure (e.g. server offline).
  const [collectedCount, setCollectedCount] = useState<number | null>(null);
  // `mode` defaults to the filing mode frozen with the result, NOT the live
  // toggle: flipping Σ/⚗ between recognize and save would otherwise file a
  // \ce{...} label under mode:"math" and silently misroute it in the corpora.
  const collect = useCallback(async (label: string, predicted?: string, mode?: SampleMode): Promise<number | null> => {
    const ink = strokesRef.current;
    if (ink.length === 0 || !label.trim()) return null;
    try {
      const res = await fetch(COLLECT_URL(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCollectRequest(ink, label.trim(), predicted, mode ?? sampleModeRef.current)),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { count?: unknown };
      const count = typeof body.count === "number" ? body.count : null;
      setCollectedCount(count);
      return count;
    } catch {
      return null; // network failure → server not running
    }
  }, []);

  // ── Acceptance capture: the user INSERTED Ancha's reading without editing
  // it, so she was right and they ratified it by using the result. Saved to
  // the separate accepted store (never the x32-oversampled corrections file)
  // as a self-labelled training pair. Fire-and-forget from the caller's side:
  // a failure here must never block or complicate the insert the user asked
  // for, so every path returns null instead of throwing.
  const [acceptedCount, setAcceptedCount] = useState<number | null>(null);
  const collectAccepted = useCallback(async (label: string): Promise<number | null> => {
    const ink = strokesRef.current;
    const current = resultRef.current;
    if (ink.length === 0 || !label.trim()) return null;
    try {
      const res = await fetch(ACCEPTED_URL(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildAcceptedRequest(ink, label.trim(), sampleModeRef.current, {
            confidence: current?.confidence,
            segments: current?.segments,
          }),
        ),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { count?: unknown };
      const count = typeof body.count === "number" ? body.count : null;
      setAcceptedCount(count);
      return count;
    } catch {
      return null; // network failure → server not running
    }
  }, []);

  // ── Per-segment re-label ──────────────────────────────────────────────────
  // Flipping a run to text is a PURE CLIENT SPLICE: `visionText` is already in
  // hand, and re-reading an isolated word without its line's context returns no
  // observation at all, so a round trip would lose the words. The other
  // direction genuinely needs a fresh decode.
  const relabel = useCallback(
    async (segment: Segment, kind: SegmentKind): Promise<void> => {
      setOverrides((prev) => [...prev.filter((o) => o.strokes[0] !== segment.strokes[0]), { strokes: segment.strokes, kind }]);
      const ink = strokesRef.current;
      const own = segment.strokes.map((i) => ink[i]).filter(Boolean);
      const splice = (text: string) =>
        setResult((prev) => {
          if (!prev?.source || !prev.segments) return prev;
          const source = prev.source.slice(0, segment.sourceStart) + text + prev.source.slice(segment.sourceEnd);
          const delta = text.length - (segment.sourceEnd - segment.sourceStart);
          return {
            ...prev,
            latex: source,
            source,
            segments: prev.segments.map((s) =>
              s.id === segment.id
                ? { ...s, kind, text: kind === "text" ? text : undefined, latex: kind === "text" ? undefined : text.slice(2, -2), sourceEnd: s.sourceEnd + delta }
                : s.sourceStart > segment.sourceStart
                  ? { ...s, sourceStart: s.sourceStart + delta, sourceEnd: s.sourceEnd + delta }
                  : s,
            ),
          };
        });

      if (kind === "text") {
        splice(segment.visionText ?? segment.text ?? "");
        return;
      }
      if (own.length === 0) return;
      try {
        const res = await fetch(SEGMENT_URL(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildSegmentRequest(own, kind)),
        });
        if (!res.ok) return;
        const body = (await res.json()) as { latex?: unknown };
        if (typeof body.latex === "string" && body.latex) splice(`\\(${body.latex}\\)`);
      } catch {
        /* server offline — the override still stands for the next recognition */
      }
    },
    [],
  );

  // A fresh page of ink invalidates every run-level correction: the indices
  // those overrides carry refer to a stroke array that no longer exists.
  useEffect(() => {
    if (strokes.length === 0) setOverrides([]);
  }, [strokes.length]);

  return {
    mode, setMode, chem, setChem, auto, setAuto, busy, result, resultSeq, resultMode, resultSampleMode, error, offline,
    convert, collect, collectedCount, collectAccepted, acceptedCount, relabel, overrides, hasInk: strokes.length > 0,
  };
}

export type Recognition = ReturnType<typeof useRecognition>;

// ─── Top-bar controls ─────────────────────────────────────────────────────────

/** The lab's raw mode switch. "auto" is what the product ships; the three
 *  single-interpretation modes stay exposed here so a reading can be compared
 *  against forcing one engine over the whole page. */
export function ModeToggle({ mode, onMode }: { mode: RecognitionMode; onMode: (m: RecognitionMode) => void }) {
  return (
    <div className="inline-flex h-9 overflow-hidden rounded-md border border-border text-sm" role="group" aria-label="Recognition mode">
      {(["auto", "math", "chem", "text"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onMode(m)}
          aria-pressed={mode === m}
          className={`px-3 capitalize ${mode === m ? "bg-accent text-white" : "text-muted hover:bg-foreground/[0.06] hover:text-foreground"}`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export function AutoToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      title="Let Ancha re-read shortly after each stroke"
      className={`h-9 rounded-md border px-3 text-sm transition ${
        on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:border-accent hover:text-foreground"
      }`}
    >
      Auto
    </button>
  );
}

export function ConvertButton({ busy, disabled, onClick }: { busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-9 rounded-md bg-accent px-3.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
    >
      {busy ? "Reading…" : "Convert"}
    </button>
  );
}

// ─── Result panel ─────────────────────────────────────────────────────────────

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function RecognitionPanel({ rec }: { rec: Recognition }) {
  const { busy, result, error, offline, hasInk } = rec;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.latex);
      setCopied(true);
    } catch {
      /* clipboard unavailable — leave the raw line selectable */
    }
  };

  const pct = result ? Math.round(clamp01(result.confidence) * 100) : 0;

  return (
    <section aria-label="Recognition result" className="shrink-0 rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border-soft px-4 py-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Ancha reads</p>
        {busy && <span className="text-xs text-faint">reading…</span>}
        {result && (
          <span className="ml-auto flex items-center gap-2 text-xs text-muted" title="How sure Ancha is (her least certain run)">
            <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-border">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
            {pct}%
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        {offline ? (
          <p className="text-sm text-muted">
            Ancha is offline — start her with:{" "}
            <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-xs">{OFFLINE_CMD}</code>
          </p>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : result ? (
          <>
            <div className="overflow-x-auto py-1">
              {!result.latex ? (
                <p className="text-sm text-faint">(empty result)</p>
              ) : result.source !== undefined ? (
                // Unified reading: prose stays prose. Handing the whole thing
                // to KaTeX would turn every word into italic variables.
                <MixedPreview source={result.source} className="text-lg" />
              ) : rec.resultMode === "text" ? (
                <p className="whitespace-pre-wrap text-center text-lg">{result.latex}</p>
              ) : (
                <Katex latex={result.latex} display />
              )}
            </div>
            {result.segments && result.segments.length > 0 && (
              <SegmentChips segments={result.segments} onRelabel={(s, k) => void rec.relabel(s, k)} className="mt-2" />
            )}
            {/* Ancha had no text engine here, so everything was necessarily read
                as a formula — say so rather than let it look like a bad read. */}
            {result.engine && result.engine.text == null && result.segments?.some((s) => s.degraded) && (
              <p className="mt-2 text-xs text-muted">
                No text engine on this machine — Ancha read everything as formulas.
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md border border-border-soft bg-background px-2.5 py-1.5 font-mono text-xs text-muted">
                {result.latex || " "}
              </code>
              <button
                onClick={() => void copy()}
                className="h-8 shrink-0 rounded-md border border-border px-2.5 text-xs text-muted transition hover:border-accent hover:text-foreground"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <Correction rec={rec} guess={result.latex} />
          </>
        ) : (
          <p className="text-sm text-faint">
            {hasInk
              ? "Press Convert — or wait a beat with Auto on — and Ancha will read your ink."
              : "Write on the canvas above; words and formulas together. Ancha's reading appears here."}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * "Wrong? Fix it" correction capture. Reveals an editor pre-filled with the
 * model's guess; the user edits it to the correct LaTeX (with a live preview)
 * and saves. The (ink + correct label) pair is POSTed to /collect as training
 * data. Available on every result, since even a confident answer can be wrong.
 *
 * Chem results are corrected as plain mhchem SOURCE ("2H2 + O2 -> 2H2O") —
 * the app's chemistry editing convention — and stored wrapped as \ce{...},
 * the same LaTeX form the recognizer returns.
 */
function Correction({ rec, guess }: { rec: Recognition; guess: string }) {
  const isChem = rec.resultMode === "chem";
  // Chem edits the inner mhchem source. A math-FALLBACK guess (server couldn't
  // express the ink as chemistry, so it's not \ce) prefills EMPTY: prefilling
  // raw math LaTeX into the mhchem field would get \ce-wrapped on save,
  // storing corrupt labels like \ce{\sqrt{2}}.
  const editable = (g: string) => (isChem ? (ceInner(g) ?? "") : g);
  // What gets stored/previewed: always one balanced \ce{...} — ceInner strips
  // a (possibly unbalanced-typo) user wrapper, wrapCe re-closes it.
  const stored = (s: string) => (isChem ? wrapCe(ceInner(s) ?? s) : s.trim());
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(editable(guess));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // A fresh recognition result resets the editor to the new guess.
  useEffect(() => {
    setOpen(false);
    setLabel(editable(guess));
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editable is render-stable per resultMode
  }, [guess, isChem]);

  const save = async () => {
    if (!label.trim() || saving) return;
    setSaving(true);
    // No explicit mode: collect() files under the mode frozen with the result,
    // which is the one that produced the guess being corrected.
    const count = await rec.collect(stored(label), guess);
    setSaving(false);
    if (count !== null) {
      setSavedAt(count);
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-2.5 flex items-center gap-2 text-xs">
        <button
          onClick={() => { setOpen(true); setLabel(editable(guess)); }}
          className="rounded-md border border-border px-2.5 py-1 text-muted transition hover:border-accent hover:text-foreground"
        >
          Not right? Fix the label
        </button>
        {savedAt !== null && (
          <span className="text-success">✓ Saved for training · {savedAt} collected</span>
        )}
      </div>
    );
  }

  const isText = rec.resultMode === "text";
  const valid = label.trim().length > 0;
  return (
    <div className="mt-2.5 rounded-md border border-accent/40 bg-accent-soft/40 p-2.5">
      <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">
        {isText ? "Correct text" : isChem ? "Correct chemistry (mhchem)" : "Correct LaTeX"}
      </label>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void save(); }
          if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
        }}
        spellCheck={false}
        placeholder={isText ? "e.g. Hello world" : isChem ? "e.g. 2H2 + O2 -> 2H2O" : "e.g. \\frac{x}{2} + 1"}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:border-accent"
      />
      <div className="mt-2 min-h-8 overflow-x-auto rounded-md border border-border-soft bg-surface px-2.5 py-1.5">
        {!valid ? (
          <span className="text-xs text-faint">preview</span>
        ) : isText ? (
          <p className="whitespace-pre-wrap text-sm">{label}</p>
        ) : (
          <Katex latex={stored(label)} display />
        )}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1 text-xs text-muted hover:bg-foreground/[0.04]">
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={!valid || saving}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save correction"}
        </button>
      </div>
    </div>
  );
}
