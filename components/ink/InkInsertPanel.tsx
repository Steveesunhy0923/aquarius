"use client";

/**
 * InkInsertPanel — the /ink lab's handwriting → LaTeX flow embedded in the
 * note editor. A fixed bottom sheet (no scrim: the note stays visible and the
 * editing context stays live): write on the canvas, the local recognition
 * server auto-converts the ink after each stroke (math mode only — text mode
 * is a 501 on the server), the result lands in an editable LaTeX line, and
 * Insert hands it to the editor's insertion dispatcher, which routes it to
 * whatever is active — MathLive field, table cell, inline-math box in prose,
 * or a fresh equation block. The sheet stays OPEN after an insert (ink
 * cleared, brief "Inserted ✓" flash) because that's the note-taking rhythm:
 * write, insert, write the next formula.
 *
 * Focus: a mousedown anywhere in the sheet except the LaTeX input is
 * prevented from stealing focus (the same idea as the toolbar's keepFocus),
 * so the prose textarea / MathLive field / table cell that was active when
 * the sheet opened is still the active insertion target when Insert fires.
 *
 * Training: if the user edited the recognition before inserting, the
 * (ink, corrected LaTeX) pair is silently POSTed to /collect — every manual
 * fix becomes a training sample.
 */

import { Icon } from "@/components/Icon";
import { Katex } from "@/components/Katex";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { InkCanvas, type InkCanvasHandle } from "./InkCanvas";
import { OFFLINE_CMD, useRecognition } from "./RecognitionPanel";
import type { Stroke } from "./strokes";

// Borderless icon button, same feel as the lab's top-bar buttons.
const PANEL_ICON =
  "grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function InkInsertPanel({
  onInsert,
  onClose,
  markSticky,
  suspendEscape = false,
}: {
  onInsert: (latex: string) => void;
  onClose: () => void;
  /** Arms the editor's one-shot blur absorber so focusing the panel's LaTeX
   *  input doesn't close the block editor (same contract as SymbolToolbar). */
  markSticky?: () => void;
  /** True while another overlay (symbol browser, table picker, …) is above the
   *  sheet — its Escape must not also close this. */
  suspendEscape?: boolean;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const canvas = useRef<InkCanvasHandle>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [strokeSeq, setStrokeSeq] = useState(0); // bumps when a stroke ends (or on undo) → drives auto-convert
  const rec = useRecognition(strokes, strokeSeq); // mode stays "math", auto stays on
  const empty = strokes.length === 0;

  // The editable LaTeX line. A FRESH recognition resets it (rec.result is a
  // new object per response, and null once the ink is cleared); between
  // recognitions nothing may clobber the user's mid-edit text — `diverged`
  // explicitly records that the text no longer matches the model's
  // prediction, which gates the silent /collect training sample on Insert.
  const [latex, setLatex] = useState("");
  const [diverged, setDiverged] = useState(false);
  const result = rec.result;
  useEffect(() => {
    setLatex(result?.latex ?? "");
    setDiverged(false);
  }, [result]);

  // Brief "Inserted ✓" flash after each insert.
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(id);
  }, [flash]);

  // Escape closes the sheet — but LAST in the pecking order: a bubble-phase
  // window listener that yields to (a) anything that already handled the key
  // (EditBox's textarea exits block-edit with preventDefault), (b) an overlay
  // stacked above us (suspendEscape), and (c) focus inside an editing surface
  // outside the sheet (MathLive popover, table cell), which owns its own
  // Escape semantics.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const suspendRef = useRef(suspendEscape);
  suspendRef.current = suspendEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || suspendRef.current) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && !rootRef.current?.contains(ae) && ae.closest("textarea, math-field, [contenteditable='true']")) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Keep the editor's focus context alive: only the LaTeX input may take
   *  focus — drawing and button clicks must not blur the active field. When
   *  the input DOES take focus, arm the editor's one-shot blur absorber so
   *  the block editor survives that single focus loss. */
  const holdFocus = (e: ReactMouseEvent<HTMLElement>) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable], math-field")) {
      markSticky?.();
      return;
    }
    e.preventDefault();
  };

  const undoStroke = () => {
    canvas.current?.undo();
    setStrokeSeq((n) => n + 1); // re-recognize the remaining ink (convert() no-ops when none is left)
  };

  // The displayed recognition is STALE when ink changed after it was computed
  // (undo, or a stroke added inside the auto-convert debounce/round-trip) —
  // inserting it would commit the wrong LaTeX and clear() would destroy the
  // newer ink. A user-edited line (diverged) is their explicit intent and may
  // always insert; it just never logs a training sample against stale ink.
  const stale = !empty && (rec.busy || rec.resultSeq !== strokeSeq);

  const insert = () => {
    const tex = latex.trim();
    if (!tex || (stale && !diverged)) return;
    // Manual fix → training data, fire-and-forget. Must run BEFORE clear():
    // collect() snapshots the ink synchronously on call.
    if (diverged && result && !stale && tex !== result.latex.trim()) void rec.collect(tex, result.latex);
    onInsert(tex);
    canvas.current?.clear();
    // Explicit reset — the strokes→[] → result→null chain no-ops when result
    // was already null (offline / hand-typed LaTeX with no ink).
    setLatex("");
    setDiverged(false);
    setFlash(true);
  };

  const pct = result ? Math.round(clamp01(result.confidence) * 100) : 0;

  return (
    <section
      ref={rootRef}
      aria-label="Handwriting input"
      onMouseDown={holdFocus}
      className="print-hide absolute inset-x-0 bottom-0 z-40 border-t border-border bg-surface shadow-[0_-10px_30px_-10px_rgba(0,0,0,0.3)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center gap-3 px-4 py-1.5">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Handwrite math</p>
        {rec.busy && <span className="text-xs text-faint">converting…</span>}
        {flash && <span className="text-xs text-success">Inserted ✓</span>}
        {rec.offline && (
          <span className="text-xs text-muted">
            Recognition server offline — start it with{" "}
            <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px]">{OFFLINE_CMD}</code>
          </span>
        )}
        {!rec.offline && rec.error && <span className="text-xs text-danger">{rec.error}</span>}
        <button onClick={onClose} title="Close (Esc)" aria-label="Close handwriting panel" className={`${PANEL_ICON} ml-auto`}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="relative h-[38vh] border-y border-border-soft">
        <InkCanvas
          ref={canvas}
          className="block h-full w-full"
          onStrokesChange={setStrokes}
          onStrokeEnd={(s) => {
            setStrokes(s);
            setStrokeSeq((n) => n + 1);
          }}
        />
        {empty && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-faint">
            Write a formula — Apple Pencil, finger, or mouse
          </p>
        )}
      </div>

      <div className="flex items-center gap-2.5 px-4 py-2">
        <div className="flex max-w-[30%] shrink-0 items-center overflow-x-auto" aria-label="Preview">
          {latex.trim() ? <Katex latex={latex} /> : <span className="text-xs text-faint">preview</span>}
        </div>
        {result && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted" title="Model confidence">
            <span className="inline-block h-1 w-12 overflow-hidden rounded-full bg-border">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
            {pct}%
          </span>
        )}
        <input
          value={latex}
          onChange={(e) => {
            setLatex(e.target.value);
            setDiverged(e.target.value !== (result?.latex ?? ""));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              insert();
            }
          }}
          spellCheck={false}
          placeholder="Recognized LaTeX appears here — edit it before inserting"
          aria-label="LaTeX (editable)"
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none focus:border-accent"
        />
        <button onClick={undoStroke} disabled={empty} title="Undo stroke" aria-label="Undo stroke" className={PANEL_ICON}>
          <Icon name="undo" size={16} />
        </button>
        <button onClick={() => canvas.current?.clear()} disabled={empty} title="Clear ink" aria-label="Clear ink" className={PANEL_ICON}>
          <Icon name="trash" size={16} />
        </button>
        <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
        <button
          onClick={onClose}
          className="h-9 shrink-0 rounded-md border border-border px-3 text-sm text-muted transition hover:border-accent hover:text-foreground"
        >
          Cancel
        </button>
        <button
          onClick={insert}
          disabled={!latex.trim() || (stale && !diverged)}
          title={stale && !diverged ? "Waiting for recognition of the latest ink…" : undefined}
          className="h-9 shrink-0 rounded-md bg-accent px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          Insert
        </button>
      </div>
    </section>
  );
}
