"use client";

/**
 * InkLab — the /ink testbed page body: a full-height handwriting canvas with a
 * Graphite top bar (mode / auto / convert / undo / clear) and Ancha's result
 * panel. A lab tool, deliberately not linked from the library.
 */

import { anchaUrl } from "@/lib/ink/endpoint";
import { EndpointField } from "./EndpointField";
import { Icon } from "@/components/Icon";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { InkCanvas, type InkCanvasHandle } from "./InkCanvas";
import { AutoToggle, ConvertButton, ModeToggle, RecognitionPanel, useRecognition } from "./RecognitionPanel";
import { ReviewDialog } from "./ReviewPanel";
import type { Stroke } from "./strokes";

// Borderless icon button, same feel as the editor's top-bar buttons.
const HEAD_ICON =
  "grid h-9 w-9 place-items-center rounded-md text-muted transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted";

export function InkLab() {
  const canvas = useRef<InkCanvasHandle>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [strokeSeq, setStrokeSeq] = useState(0); // bumps only when a stroke ENDS → drives auto-convert
  const rec = useRecognition(strokes, strokeSeq);
  const empty = strokes.length === 0;

  // Collected-samples review: badge count seeded from the server, kept true
  // by every save (rec.collectedCount) and by deletes inside the dialog.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [collected, setCollected] = useState<number | null>(null);
  // Bumped when the endpoint is re-pointed, so the badge re-probes the new host.
  const [endpointRev, setEndpointRev] = useState(0);
  useEffect(() => {
    fetch(anchaUrl("/collect"))
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { count?: number } | null) => {
        if (typeof b?.count === "number") setCollected(b.count);
      })
      .catch(() => {}); // Ancha offline — badge just shows no number
  }, [endpointRev]);
  useEffect(() => {
    if (rec.collectedCount !== null) setCollected(rec.collectedCount);
  }, [rec.collectedCount]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <Link href="/" title="Library" aria-label="Back to library" className={HEAD_ICON}>
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-sm font-semibold">Ink lab</h1>
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
          testbed
        </span>
        <span className="hidden text-xs text-muted md:inline">Ancha · handwriting → LaTeX</span>

        <div className="ml-auto flex items-center gap-2">
          {/* Where Ancha is. Only ever needs touching on a real iPad, where the
              default loopback address points at the tablet, not the Mac. */}
          <EndpointField onChanged={() => setEndpointRev((n) => n + 1)} />
          <button
            onClick={() => setReviewOpen(true)}
            title="Review the samples collected for Ancha"
            className="h-9 rounded-md border border-border px-3 text-sm text-muted transition hover:border-accent hover:text-foreground"
          >
            Review{collected !== null ? ` · ${collected}` : ""}
          </button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ModeToggle mode={rec.mode} onMode={rec.setMode} />
          <AutoToggle on={rec.auto} onToggle={() => rec.setAuto(!rec.auto)} />
          <ConvertButton busy={rec.busy} disabled={empty} onClick={() => void rec.convert()} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <button
            className={HEAD_ICON}
            disabled={empty}
            onClick={() => canvas.current?.undo()}
            title="Undo stroke"
            aria-label="Undo stroke"
          >
            <Icon name="undo" size={17} />
          </button>
          <button
            className={HEAD_ICON}
            disabled={empty}
            onClick={() => canvas.current?.clear()}
            title="Clear canvas"
            aria-label="Clear canvas"
          >
            <Icon name="trash" size={17} />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
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
              Write here — words and formulas together; Ancha sorts them out
            </p>
          )}
        </div>
        <RecognitionPanel rec={rec} />
      </main>
      {reviewOpen && <ReviewDialog onClose={() => setReviewOpen(false)} onCount={setCollected} />}
    </div>
  );
}
