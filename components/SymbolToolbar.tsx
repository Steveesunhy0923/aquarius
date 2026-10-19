"use client";

import { Icon } from "@/components/Icon";
import { Katex } from "@/components/Katex";
import { SymbolPicker } from "@/components/SymbolPicker";
import { SymbolPresetMenu } from "@/components/SymbolPresetMenu";
import { COMPACT_BTN, ICON_BTN } from "@/components/ToolbarControls";
import { previewLatex } from "@/lib/blocks/source";
import {
  DEFAULT_PRESET_ID,
  MAX_PRESET_SYMBOLS,
  builtinPreset,
  listUserPresets,
  matchPresetId,
  type SymbolPreset,
} from "@/lib/symbolpresets";
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
// The symbol slots: a PRESET's worth of entries (lib/symbolpresets.ts), any of
// which the "Edit" button can change individually. The stock row is the General
// preset — the same eight symbols the strip has always opened with.
const DEFAULT_SYMBOLS = builtinPreset(DEFAULT_PRESET_ID)!.symbols;

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
export function SymbolToolbar({ onInsert, onText, onBrowse, keepFocus, leading, trailing, compact }: {
  onInsert: (latex: string) => void;
  /** Switch the formula holding the caret between maths and words (`\text{…}`). */
  onText?: () => void;
  onBrowse: () => void;
  /** Mousedown handler that holds the caret where it is, so a pick lands there. */
  keepFocus: (e: MouseEvent) => void;
  /** Rendered first in the strip (the math ⇄ chemistry mode switch). */
  leading?: ReactNode;
  /** Rendered last in the strip (the pin that keeps it open outside a formula). */
  trailing?: ReactNode;
  /** Laid out for the floating symbol tab (components/SymbolTab): wraps in a
   *  narrow card, no full-width bar chrome. */
  compact?: boolean;
}) {
  // In the floating tab every button is the compact size, so the strip wraps
  // into a small card instead of a full-width bar.
  const BTN = compact ? COMPACT_BTN : ICON_BTN;
  // The symbol slots, and which preset they came from (null = a hand-edited mix,
  // shown as "Custom" until saved under a name).
  const [symbols, setSymbols] = useState<string[]>(() =>
    readLS(SYM_KEY, DEFAULT_SYMBOLS).slice(0, MAX_PRESET_SYMBOLS),
  );
  const [userPresets, setUserPresets] = useState<SymbolPreset[]>(() => listUserPresets());
  const [editSyms, setEditSyms] = useState(false);
  const [slotPicker, setSlotPicker] = useState<number | null>(null);
  // Read back off the row, so the name can never disagree with what is shown.
  const presetId = matchPresetId(symbols, userPresets);

  useEffect(() => {
    // The symbol slots are a global preference shared via localStorage. In split
    // view both panes persist to the same key (last write wins; the other pane
    // converges on its next mount) — acceptable for a rare action.
    if (typeof window !== "undefined") try { localStorage.setItem(SYM_KEY, JSON.stringify(symbols)); } catch { /* noop */ }
  }, [symbols]);

  function applyPreset(p: SymbolPreset) {
    setSymbols(p.symbols.slice(0, MAX_PRESET_SYMBOLS));
    setEditSyms(false);
  }

  function onPickSymbol(latex: string) {
    // Changing a slot makes the row match no preset — it reads as "Custom"
    // until saved under a name, with no bookkeeping needed here.
    if (slotPicker != null) {
      const idx = slotPicker;
      setSymbols((a) => a.map((x, i) => (i === idx ? latex : x)));
    }
    setSlotPicker(null);
  }

  return (
    <>
      <div className={compact ? "flex flex-wrap items-center gap-1" : "print-hide flex flex-wrap items-center justify-center gap-1.5 border-b border-border px-6 py-2"}>
        {leading}
        {/* Structures — fixed defaults (not user-editable) */}
        {DEFAULT_TB1.map((latex, i) => (
          <button key={i} onMouseDown={keepFocus} onClick={() => onInsert(latex)} title={`Insert ${latex}`} aria-label={`Insert ${STRUCT_LABEL[latex] ?? latex}`} className={BTN}>
            <Katex latex={previewLatex(latex)} />
          </button>
        ))}
        {/* Words inside a formula: the visible way in to what `"` does. */}
        {onText && (
          <button onMouseDown={keepFocus} onClick={onText} title={'Type words in the formula (or press ")'} aria-label="Type words in the formula" className={BTN}>
            <span className="text-[13px] font-medium">Text</span>
          </button>
        )}
        <span className={compact ? "mx-0.5 h-5 w-px bg-border" : "mx-2 h-7 w-px bg-border"} />
        {/* Symbols — eight editable slots; "Edit" lets the user change any of them */}
        {symbols.map((latex, i) => (
          <button key={i} onMouseDown={keepFocus} onClick={() => (editSyms ? setSlotPicker(i) : onInsert(latex))} title={editSyms ? "Click to change this symbol" : `Insert ${latex}`} aria-label={editSyms ? `Change symbol ${i + 1}` : `Insert ${latex}`} className={`${BTN} ${editSyms ? "border border-dashed border-accent/60" : ""}`}>
            <Katex latex={previewLatex(latex)} />
          </button>
        ))}
        <button onMouseDown={keepFocus} onClick={() => setEditSyms((s) => !s)} title={editSyms ? "Done — finish changing symbols" : "Change the symbols"} aria-label={editSyms ? "Done changing symbols" : "Change the symbols"} aria-pressed={editSyms} className={`${BTN} ${editSyms ? "bg-accent-soft text-accent" : "text-muted"}`}><Icon name="editformula" size={17} /></button>
        <SymbolPresetMenu
          activeId={presetId}
          symbols={symbols}
          userPresets={userPresets}
          onApply={applyPreset}
          onPresetsChanged={() => setUserPresets(listUserPresets())}
          keepFocus={keepFocus}
        />
        <span className={compact ? "mx-0.5 h-5 w-px bg-border" : "mx-2 h-7 w-px bg-border"} />
        <button onMouseDown={keepFocus} onClick={onBrowse} title="Browse all functions & symbols" aria-label="Browse all functions and symbols" className={BTN}><Icon name="sigmapi" size={20} /></button>
        {trailing}
      </div>
      {slotPicker != null && (
        <SymbolPicker title="Choose a symbol for this slot" onPick={onPickSymbol} onClose={() => setSlotPicker(null)} />
      )}
    </>
  );
}
