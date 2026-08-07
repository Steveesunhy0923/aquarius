"use client";

/**
 * InkInsertPanel — writing by hand, inside the note editor. A fixed bottom
 * sheet (no scrim: the note stays visible and the editing context stays live).
 *
 * You write words and formulas TOGETHER and never pick a mode: Ancha segments
 * the ink herself and decides per run which is which, so "let x² be the root"
 * comes back as prose with real inline math in it. Her per-run decisions show
 * as chips above the editable line, each one click away from being overruled.
 * The Σ/⚗ switch is not a mode either — it only says how to read the formulas
 * she finds, because chemistry genuinely cannot be inferred from ink (`Sn` is
 * tin or `\sin` by the writer's intent alone).
 *
 * The writing area has three sizes (S / M / full pages). At "Page" it becomes
 * a stack of A4 sheets that grows another sheet as you fill the last one — the
 * same rule the note's own pages follow — and the sheet boundaries are handed
 * to Ancha so a line of writing is never split across two of them.
 *
 * Insert hands the reading to the editor's dispatcher, which routes it to
 * whatever is active: a pure formula still goes to a MathLive field, table cell
 * or fresh equation block exactly as before, while a mixed reading becomes
 * prose with inline math. The sheet stays OPEN after an insert (ink cleared,
 * brief "Inserted ✓" flash) because that's the note-taking rhythm: write,
 * insert, write the next thing.
 *
 * Focus: a mousedown anywhere in the sheet except the editable line is
 * prevented from stealing focus (the same idea as the toolbar's keepFocus),
 * so the prose textarea / MathLive field / table cell that was active when
 * the sheet opened is still the active insertion target when Insert fires.
 *
 * Training: every insert backed by fresh ink is silently saved as a labelled
 * sample, because the insert IS the label — the user committed this reading to
 * their note. An edited reading goes to /collect as a correction (Ancha was
 * wrong, here is the truth); an untouched one goes to /collect/accepted (she
 * was right, ratified by use). They are stored apart on purpose: corrections
 * are oversampled x32 in a training run, and replaying the model's own output
 * at that weight would entrench it rather than teach it.
 */

import { Icon } from "@/components/Icon";
import { getSettings, setSettings, type InkCanvasSize } from "@/lib/settings/settings";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { InkSurface, type InkSurfaceHandle } from "./InkSurface";
import { MixedPreview, SegmentChips } from "./MixedResult";
import { OFFLINE_CMD, useRecognition } from "./RecognitionPanel";
import type { Stroke } from "./strokes";

/** How tall the writing area is. "page" swaps the strip for A4 sheets that
 *  extend as you fill them, the same way the note's own pages do. */
const SIZES: { key: InkCanvasSize; label: string; title: string }[] = [
  { key: "compact", label: "S", title: "Compact writing strip" },
  { key: "tall", label: "M", title: "Tall writing strip" },
  { key: "page", label: "Page", title: "Full pages — adds another when you run out of room" },
];
const SIZE_H: Record<InkCanvasSize, string> = {
  compact: "h-[38vh]",
  tall: "h-[58vh]",
  page: "h-[74vh] overflow-hidden",
};

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
  const canvas = useRef<InkSurfaceHandle>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [strokeSeq, setStrokeSeq] = useState(0); // bumps when a stroke ends (or on undo) → drives auto-convert
  // Read once at mount: settings have no React subscription, and the in-sheet
  // control below is the live source of truth for this session.
  const [size, setSizeState] = useState<InkCanvasSize>(() => getSettings().inkCanvasSize);
  const setSize = (s: InkCanvasSize) => {
    setSizeState(s);
    setSettings({ inkCanvasSize: s });
  };
  // On a paged canvas Ancha must know where the sheets break — she never lets a
  // line of writing span two of them.
  const [pageBreaks, setPageBreaks] = useState<number[]>([]);
  const rec = useRecognition(strokes, strokeSeq, { pageBreaks });
  const empty = strokes.length === 0;
  const chem = rec.chem;

  // Switching math⇄chem re-recognizes the ink that is already on the canvas —
  // the sheet has no Convert button, so the switch must act immediately. Runs
  // post-render, when useRecognition's modeRef already holds the new mode.
  // EXCEPT when the user has hand-edited the LaTeX line (diverged): a fresh
  // recognition would silently overwrite their edit with no undo — their text
  // wins, and the next stroke re-recognizes under the new mode anyway.
  const convertRef = useRef(rec.convert);
  convertRef.current = rec.convert;
  const skipConvertRef = useRef(true);
  useEffect(() => {
    if (!skipConvertRef.current) void convertRef.current();
  }, [rec.chem]);

  // The editable LaTeX line. A FRESH recognition resets it (rec.result is a
  // new object per response, and null once the ink is cleared); between
  // recognitions nothing may clobber the user's mid-edit text — `diverged`
  // explicitly records that the text no longer matches the model's
  // prediction, which gates the silent /collect training sample on Insert.
  const [latex, setLatex] = useState("");
  const [diverged, setDiverged] = useState(false);
  // Ref assignment runs every render, before the mode-switch effect fires.
  skipConvertRef.current = empty || diverged;
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
    // Every insert backed by fresh ink becomes a training sample, because the
    // insert itself is the label: the user put this reading in their note, so
    // either Ancha was right (accepted) or they fixed her first (correction).
    // Both must run BEFORE clear() — the save snapshots the ink synchronously
    // on call — and both are fire-and-forget, so a dead server never costs the
    // user their insert.
    //
    // Requires `result && !stale`: without a fresh recognition for THIS ink
    // there is no trustworthy pair to save. That covers hand-typed LaTeX with
    // no ink at all, and the case where a stroke landed after the reading was
    // computed — saving then would file the label against the wrong drawing.
    if (result && !stale) {
      const edited = tex !== result.latex.trim();
      if (edited) void rec.collect(tex, result.latex);
      else void rec.collectAccepted(tex);
    }
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
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">
          {chem ? "Handwrite — chemistry" : "Handwrite"}
        </p>
        {/* Σ/⚗ — the same switch as the symbol strip, but it no longer picks a
            MODE: Ancha always decides prose-vs-formula herself. This only says
            how to read the formulas she finds, because that part genuinely
            cannot be inferred (`Sn` is tin or `\sin` by the writer's intent). */}
        <div className="flex items-center overflow-hidden rounded-md border border-border" role="group" aria-label="Read formulas as">
          <button
            onClick={() => rec.setChem(false)}
            title="Read formulas as math"
            aria-label="Read formulas as math"
            aria-pressed={!chem}
            className={`grid h-7 min-w-8 place-items-center px-1.5 ${!chem ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}
          >
            <Icon name="sum" size={15} />
          </button>
          <button
            onClick={() => rec.setChem(true)}
            title="Read formulas as chemistry"
            aria-label="Read formulas as chemistry"
            aria-pressed={chem}
            className={`grid h-7 min-w-8 place-items-center px-1.5 ${chem ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}
          >
            <Icon name="flask" size={15} />
          </button>
        </div>
        {/* Canvas size: compact strip → tall strip → full A4 pages that extend
            as you run out of room. Persisted, because it is a working habit. */}
        <div className="flex items-center overflow-hidden rounded-md border border-border" role="group" aria-label="Canvas size">
          {SIZES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSize(s.key)}
              title={s.title}
              aria-label={s.title}
              aria-pressed={size === s.key}
              className={`h-7 px-2 text-[11px] ${size === s.key ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {rec.busy && <span className="text-xs text-faint">Ancha is reading…</span>}
        {flash && <span className="text-xs text-success">Inserted ✓</span>}
        {rec.offline && (
          <span className="text-xs text-muted">
            Ancha is offline — start her with{" "}
            <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px]">{OFFLINE_CMD}</code>
          </span>
        )}
        {!rec.offline && rec.error && <span className="text-xs text-danger">{rec.error}</span>}
        <button onClick={onClose} title="Close (Esc)" aria-label="Close handwriting panel" className={`${PANEL_ICON} ml-auto`}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className={`relative border-y border-border-soft ${SIZE_H[size]}`}>
        <InkSurface
          ref={canvas}
          pageMode={size === "page" ? "a4" : "free"}
          zoom={0.55}
          className="block h-full w-full"
          onStrokesChange={setStrokes}
          onStrokeEnd={(s) => {
            setStrokes(s);
            setStrokeSeq((n) => n + 1);
            setPageBreaks(canvas.current?.getPageBreaks() ?? []);
          }}
        />
        {empty && (
          <p className="pointer-events-none absolute inset-x-0 top-6 z-10 text-center text-sm text-faint">
            {chem
              ? "Write chemistry and notes together — Ancha sorts them out"
              : "Write words and formulas together — Ancha sorts them out"}
          </p>
        )}
      </div>

      {/* What Ancha made of each run, and one click to overrule her. */}
      {result?.segments && result.segments.length > 0 && (
        <SegmentChips segments={result.segments} onRelabel={(s, k) => void rec.relabel(s, k)} className="px-4 pt-2" />
      )}

      <div className="flex items-start gap-2.5 px-4 py-2">
        <div className="flex max-w-[30%] shrink-0 items-center overflow-x-auto pt-1.5" aria-label="Preview">
          {latex.trim() ? (
            <MixedPreview source={latex} className="text-sm" />
          ) : (
            <span className="text-xs text-faint">preview</span>
          )}
        </div>
        {result && (
          <span className="flex shrink-0 items-center gap-1.5 pt-2.5 text-xs text-muted" title="How sure Ancha is (her least certain run)">
            <span className="inline-block h-1 w-12 overflow-hidden rounded-full bg-border">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
            {pct}%
          </span>
        )}
        {/* A textarea, not an input: a unified reading spans lines, and one
            <input> would silently flatten them into a single paragraph. */}
        <textarea
          value={latex}
          rows={2}
          onChange={(e) => {
            setLatex(e.target.value);
            setDiverged(e.target.value !== (result?.latex ?? ""));
          }}
          onKeyDown={(e) => {
            // Enter inserts; Shift+Enter is the line break, since the text can
            // legitimately be several lines.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              insert();
            }
          }}
          spellCheck={false}
          placeholder="What Ancha read appears here — edit it before inserting"
          aria-label="Recognized text (editable)"
          className="min-h-9 min-w-0 flex-1 resize-y rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
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
          title={stale && !diverged ? "Waiting for Ancha to read the latest ink…" : undefined}
          className="h-9 shrink-0 rounded-md bg-accent px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          Insert
        </button>
      </div>
    </section>
  );
}
