"use client";

/**
 * InkLab — the /ink testbed page body: a full-height handwriting canvas with a
 * Graphite top bar (mode / auto / convert / undo / clear) and the recognition
 * result panel. A lab tool, deliberately not linked from the library.
 */

import { Icon } from "@/components/Icon";
import Link from "next/link";
import { useRef, useState } from "react";
import { InkCanvas, type InkCanvasHandle } from "./InkCanvas";
import { AutoToggle, ConvertButton, ModeToggle, RecognitionPanel, useRecognition } from "./RecognitionPanel";
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
        <span className="hidden text-xs text-muted md:inline">handwriting → LaTeX</span>

        <div className="ml-auto flex items-center gap-2">
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
              Write here — Apple Pencil, finger, or mouse
            </p>
          )}
        </div>
        <RecognitionPanel rec={rec} />
      </main>
    </div>
  );
}
