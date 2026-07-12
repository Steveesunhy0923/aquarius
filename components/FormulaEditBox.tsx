"use client";

import { MathEdit } from "@/components/MathEdit";
import { MathField } from "@/components/MathField";
import type { Block } from "@/lib/blocks/types";
import { useRef, type FocusEvent, type MutableRefObject } from "react";

// ─── Formula edit box (Desmos-style structural editor via MathLive) ──────────
// Wraps <MathField> in the same chrome + sticky/click-out behavior as EditBox so
// toolbar/symbol clicks (which set `sticky`) don't blur-exit the field. The field
// is the WYSIWYG view, so no separate KaTeX preview is needed.
export function FormulaEditBox({
  draft, onChange, onExit, sticky,
}: {
  draft: string;
  onChange: (text: string, caret: number) => void;
  onExit: () => void;
  sticky: MutableRefObject<boolean>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  function onFocusOut(e: FocusEvent<HTMLDivElement>) {
    if (boxRef.current && e.relatedTarget && boxRef.current.contains(e.relatedTarget as Node)) return;
    if (sticky.current) { sticky.current = false; return; }
    onExit();
  }
  return (
    <div ref={boxRef} onBlur={onFocusOut} className="rounded-md border border-accent/40 bg-surface p-2">
      <MathField value={draft} onChange={(latex) => onChange(latex, 0)} onExit={onExit} autoFocus className="block text-lg" />
    </div>
  );
}

// ─── Structural formula editor (beta) — the block-tree editor in the same chrome.
export function StructuralFormulaBox({
  block, onChange, onExit, sticky,
}: {
  block: Block;
  onChange: (b: Block) => void;
  onExit: () => void;
  sticky: MutableRefObject<boolean>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  function onFocusOut(e: FocusEvent<HTMLDivElement>) {
    if (boxRef.current && e.relatedTarget && boxRef.current.contains(e.relatedTarget as Node)) return;
    if (sticky.current) { sticky.current = false; return; }
    onExit();
  }
  return (
    <div ref={boxRef} onBlur={onFocusOut} className="rounded-md border border-accent/40 bg-surface p-2">
      <MathEdit block={block} onChange={onChange} onExit={onExit} autoFocus />
    </div>
  );
}
