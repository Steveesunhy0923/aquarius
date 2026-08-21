"use client";

import { Icon } from "@/components/Icon";
import { Katex } from "@/components/Katex";
import { SymbolPicker } from "@/components/SymbolPicker";
import { ICON_BTN } from "@/components/ToolbarControls";
import { previewLatex } from "@/lib/blocks/source";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

const SYM_KEY = "aquarius.symbols";
// Fixed default structures (no longer user-editable).
const DEFAULT_TB1 = ["\\frac{}{}", "\\sqrt{}", "^{}", "\\sum_{}^{}", "\\int_{}^{}", "\\sin", "\\cos", "\\neq", "\\pi", "\\alpha"];
// Human-readable names for the structure buttons, used as their accessible label
// (the raw LaTeX makes a poor screen-reader announcement).
const STRUCT_LABEL: Record<string, string> = {
  "\\frac{}{}": "fraction",
  "\\sqrt{}": "square root",
  "^{}": "exponent",
  "\\sum_{}^{}": "summation",
  "\\int_{}^{}": "integral",
};
// Eight editable symbol slots; the "Edit" button lets users change any of them.
const DEFAULT_SYMBOLS = ["\\infty", "\\rightarrow", "\\in", "\\leq", "\\geq", "\\neq", "\\pm", "\\times"];
const SYMBOL_COUNT = DEFAULT_SYMBOLS.length;

function readLS(key: string, fallback: string[]): string[] {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    const parsed = v ? (JSON.parse(v) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : fallback;
  } catch {
    return fallback;
  }
}

/** Functions-and-symbols strip: fixed structure inserts plus eight editable,
 *  localStorage-backed symbol slots and the "browse all" entry point. */
export function SymbolToolbar({ onInsert, onBrowse, keepFocus, markSticky, leading, trailing }: {
  onInsert: (latex: string) => void;
  onBrowse: () => void;
  /** Mousedown handler that preserves the editor's focus (sticky semantics). */
  keepFocus: (e: MouseEvent) => void;
  /** Arm the one-shot sticky flag while a block is being edited. */
  markSticky: () => void;
  /** Rendered first in the strip (the math ⇄ chemistry mode switch). */
  leading?: ReactNode;
  /** Rendered last in the strip (the pin that keeps it open outside a formula). */
  trailing?: ReactNode;
}) {
  // Eight editable symbol slots (always exactly SYMBOL_COUNT), changed via "Edit".
  const [symbols, setSymbols] = useState<string[]>(() =>
    [...readLS(SYM_KEY, DEFAULT_SYMBOLS), ...DEFAULT_SYMBOLS].slice(0, SYMBOL_COUNT),
  );
  const [editSyms, setEditSyms] = useState(false);
  const [slotPicker, setSlotPicker] = useState<number | null>(null);

  useEffect(() => {
    // The editable symbol slots are a global preference shared via localStorage.
    // In split view both panes persist to the same key (last write wins; the
    // other pane converges on its next mount) — acceptable for a rare action.
    if (typeof window !== "undefined") try { localStorage.setItem(SYM_KEY, JSON.stringify(symbols)); } catch { /* noop */ }
  }, [symbols]);

  function onPickSymbol(latex: string) {
    if (slotPicker != null) {
      const idx = slotPicker;
      setSymbols((a) => a.map((x, i) => (i === idx ? latex : x)));
    }
    setSlotPicker(null);
  }

  return (
    <>
      <div className="print-hide flex flex-wrap items-center justify-center gap-1.5 border-b border-border px-6 py-2">
        {leading}
        {/* Structures — fixed defaults (not user-editable) */}
        {DEFAULT_TB1.map((latex, i) => (
          <button key={i} onMouseDown={keepFocus} onClick={() => onInsert(latex)} title={`Insert ${latex}`} aria-label={`Insert ${STRUCT_LABEL[latex] ?? latex}`} className={ICON_BTN}>
            <Katex latex={previewLatex(latex)} />
          </button>
        ))}
        <span className="mx-2 h-7 w-px bg-border" />
        {/* Symbols — eight editable slots; "Edit" lets the user change any of them */}
        {symbols.map((latex, i) => (
          <button key={i} onMouseDown={(e) => { if (!editSyms) keepFocus(e); else markSticky(); }} onClick={() => (editSyms ? setSlotPicker(i) : onInsert(latex))} title={editSyms ? "Click to change this symbol" : `Insert ${latex}`} aria-label={editSyms ? `Change symbol ${i + 1}` : `Insert ${latex}`} className={`${ICON_BTN} ${editSyms ? "border border-dashed border-accent/60" : ""}`}>
            <Katex latex={previewLatex(latex)} />
          </button>
        ))}
        <button onMouseDown={keepFocus} onClick={() => setEditSyms((s) => !s)} title={editSyms ? "Done — finish changing symbols" : "Change the symbols"} aria-label={editSyms ? "Done changing symbols" : "Change the symbols"} aria-pressed={editSyms} className={`${ICON_BTN} ${editSyms ? "bg-accent-soft text-accent" : "text-muted"}`}><Icon name="editformula" size={17} /></button>
        <span className="mx-2 h-7 w-px bg-border" />
        <button onMouseDown={keepFocus} onClick={onBrowse} title="Browse all functions & symbols" aria-label="Browse all functions and symbols" className={ICON_BTN}><Icon name="sigmapi" size={20} /></button>
        {trailing}
      </div>
      {slotPicker != null && (
        <SymbolPicker title="Choose a symbol for this slot" onPick={onPickSymbol} onClose={() => setSlotPicker(null)} />
      )}
    </>
  );
}
