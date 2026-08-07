"use client";

/**
 * Rendering for a UNIFIED ("auto") recognition — the reading that mixes prose
 * and formulas, which the single-mode UI had no way to show.
 *
 * `MixedPreview` typesets the assembled source the way the note will actually
 * look: prose as prose, `\( ... \)` runs through KaTeX. Passing the whole thing
 * to KaTeX instead (what the old preview did with a bare `latex` string) turns
 * every English word into a run of italic variables — "let" becomes `l·e·t` —
 * so the preview has to walk the runs.
 *
 * `SegmentChips` is the correction surface. Ancha publishes her per-run decision
 * and the UI makes it one click to overrule: a chip per run, showing what she
 * decided and how sure she was. Flipping a run TO text is instant and offline —
 * the words are already in hand as `visionText`, and re-reading an isolated run
 * without its line's context returns nothing at all, so a round trip would
 * actively lose them. The other direction asks the server for a fresh decode.
 */

import { Katex } from "@/components/Katex";
import { inlineMathSpans } from "@/lib/blocks/source";
import type { Segment, SegmentKind } from "./strokes";

/** Prose + typeset math, in reading order. Newlines are preserved as breaks. */
export function MixedPreview({ source, className }: { source: string; className?: string }) {
  const spans = inlineMathSpans(source);
  const parts: React.ReactNode[] = [];
  let at = 0;
  spans.forEach((span, i) => {
    if (span.start > at) parts.push(<span key={`t${i}`}>{source.slice(at, span.start)}</span>);
    parts.push(<Katex key={`m${i}`} latex={span.latex} />);
    at = span.end;
  });
  if (at < source.length) parts.push(<span key="tail">{source.slice(at)}</span>);
  return <span className={`whitespace-pre-wrap ${className ?? ""}`}>{parts}</span>;
}

const KIND_LABEL: Record<SegmentKind, string> = {
  text: "words",
  math: "formula",
  chem: "chemistry",
};

/** What one more click on this chip will make the run. Chemistry is only worth
 *  offering once the run is already being read as a formula. */
const NEXT: Record<SegmentKind, SegmentKind> = {
  text: "math",
  math: "chem",
  chem: "text",
};

export function SegmentChips({
  segments,
  onRelabel,
  className,
}: {
  segments: Segment[];
  onRelabel: (segment: Segment, kind: SegmentKind) => void;
  className?: string;
}) {
  if (segments.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`} aria-label="What Ancha read">
      {segments.map((seg) => {
        const shown = seg.kind === "text" ? seg.text : seg.latex;
        const next = NEXT[seg.kind];
        return (
          <button
            key={seg.id}
            onClick={() => onRelabel(seg, next)}
            title={`Ancha read this as ${KIND_LABEL[seg.kind]} (${Math.round(seg.confidence * 100)}% sure) — click to read it as ${KIND_LABEL[next]}`}
            aria-label={`${shown ?? ""}: read as ${KIND_LABEL[seg.kind]}. Click to read as ${KIND_LABEL[next]}.`}
            className={`flex max-w-[14rem] items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] transition ${
              seg.kind === "text"
                ? "border-border text-muted hover:border-accent hover:text-foreground"
                : "border-accent/40 bg-accent-soft text-accent hover:border-accent"
            }`}
          >
            <span aria-hidden className="shrink-0 font-mono text-[10px] opacity-70">
              {seg.kind === "text" ? "Aa" : seg.kind === "chem" ? "⚗" : "Σ"}
            </span>
            <span className="truncate">{shown || "—"}</span>
            {/* A low-confidence run is exactly the one worth a second look. */}
            {seg.confidence < 0.75 && (
              <span className="shrink-0 opacity-60">{Math.round(seg.confidence * 100)}%</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
