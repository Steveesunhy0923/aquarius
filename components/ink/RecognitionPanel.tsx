"use client";

/**
 * Recognition wiring + result panel for the ink testbed.
 *
 * `useRecognition` owns the conversation with the local recognition server
 * (POST http://127.0.0.1:8787/recognize): manual convert, debounced
 * auto-convert after the last stroke ends, math/text mode, and the
 * offline/error states. The small control widgets (ModeToggle / AutoToggle /
 * ConvertButton) live in the page's top bar; `RecognitionPanel` renders the
 * result — KaTeX preview, confidence, and the raw LaTeX as a copyable line.
 */

import { Katex } from "@/components/Katex";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildCollectRequest, buildRecognizeRequest, type RecognitionMode, type Stroke } from "./strokes";

const RECOGNIZE_URL = "http://127.0.0.1:8787/recognize";
const COLLECT_URL = "http://127.0.0.1:8787/collect";
export const OFFLINE_CMD = "cd ml && .venv/bin/python serve.py";
const AUTO_DELAY_MS = 800;

export interface RecognitionResult {
  latex: string;
  confidence: number;
}

/**
 * Recognition state machine. `strokes` is the committed ink; `strokeSeq`
 * increments each time a stroke ENDS (not on undo/clear) and is what the
 * auto-convert debounce keys on.
 */
export function useRecognition(strokes: Stroke[], strokeSeq: number) {
  const [mode, setMode] = useState<RecognitionMode>("math");
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
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  // Read through refs so `convert` stays stable across renders.
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const seqRef = useRef(strokeSeq);
  seqRef.current = strokeSeq;
  const abortRef = useRef<AbortController | null>(null);

  const convert = useCallback(async () => {
    const ink = strokesRef.current;
    if (ink.length === 0) return;
    const seqAtRequest = seqRef.current;
    const modeAtRequest = modeRef.current;
    abortRef.current?.abort(); // supersede any in-flight request
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(RECOGNIZE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRecognizeRequest(ink, modeRef.current)),
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
        const body = (await res.json()) as { latex?: unknown; confidence?: unknown };
        setResult({
          latex: typeof body.latex === "string" ? body.latex : "",
          confidence: typeof body.confidence === "number" ? body.confidence : 0,
        });
        setResultSeq(seqAtRequest);
        setResultMode(modeAtRequest);
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
  const collect = useCallback(async (label: string, predicted?: string): Promise<number | null> => {
    const ink = strokesRef.current;
    if (ink.length === 0 || !label.trim()) return null;
    try {
      const res = await fetch(COLLECT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCollectRequest(ink, label.trim(), predicted, modeRef.current)),
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

  return {
    mode, setMode, auto, setAuto, busy, result, resultSeq, resultMode, error, offline, convert,
    collect, collectedCount, hasInk: strokes.length > 0,
  };
}

export type Recognition = ReturnType<typeof useRecognition>;

// ─── Top-bar controls ─────────────────────────────────────────────────────────

export function ModeToggle({ mode, onMode }: { mode: RecognitionMode; onMode: (m: RecognitionMode) => void }) {
  return (
    <div className="inline-flex h-9 overflow-hidden rounded-md border border-border text-sm" role="group" aria-label="Recognition mode">
      {(["math", "text"] as const).map((m) => (
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
      title="Re-recognize shortly after each stroke"
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
      {busy ? "Converting…" : "Convert"}
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
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Recognized</p>
        {busy && <span className="text-xs text-faint">converting…</span>}
        {result && (
          <span className="ml-auto flex items-center gap-2 text-xs text-muted" title="Model confidence">
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
            Recognition server offline — start it with:{" "}
            <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-xs">{OFFLINE_CMD}</code>
          </p>
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : result ? (
          <>
            <div className="overflow-x-auto py-1">
              {!result.latex ? (
                <p className="text-sm text-faint">(empty result)</p>
              ) : rec.resultMode === "text" ? (
                <p className="whitespace-pre-wrap text-center text-lg">{result.latex}</p>
              ) : (
                <Katex latex={result.latex} display />
              )}
            </div>
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
              ? "Press Convert — or wait a beat with Auto on — to recognize your ink."
              : "Write on the canvas above; strokes are converted to LaTeX here."}
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
 */
function Correction({ rec, guess }: { rec: Recognition; guess: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(guess);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // A fresh recognition result resets the editor to the new guess.
  useEffect(() => {
    setOpen(false);
    setLabel(guess);
    setSavedAt(null);
  }, [guess]);

  const save = async () => {
    if (!label.trim() || saving) return;
    setSaving(true);
    const count = await rec.collect(label, guess);
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
          onClick={() => { setOpen(true); setLabel(guess); }}
          className="rounded-md border border-border px-2.5 py-1 text-muted transition hover:border-accent hover:text-foreground"
        >
          Not right? Fix the label
        </button>
        {savedAt !== null && (
          <span className="text-green-600">✓ Saved for training · {savedAt} collected</span>
        )}
      </div>
    );
  }

  const isText = rec.resultMode === "text";
  const valid = label.trim().length > 0;
  return (
    <div className="mt-2.5 rounded-md border border-accent/40 bg-accent-soft/40 p-2.5">
      <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">
        {isText ? "Correct text" : "Correct LaTeX"}
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
        placeholder={isText ? "e.g. Hello world" : "e.g. \\frac{x}{2} + 1"}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:border-accent"
      />
      <div className="mt-2 min-h-8 overflow-x-auto rounded-md border border-border-soft bg-surface px-2.5 py-1.5">
        {!valid ? (
          <span className="text-xs text-faint">preview</span>
        ) : isText ? (
          <p className="whitespace-pre-wrap text-sm">{label}</p>
        ) : (
          <Katex latex={label} display />
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
