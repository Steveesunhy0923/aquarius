"use client";

import { Icon } from "@/components/Icon";
import { Katex } from "@/components/Katex";
import { SymbolPicker } from "@/components/SymbolPicker";
import { ICON_BTN } from "@/components/ToolbarControls";
import { CHEM_SYMBOLS } from "@/lib/chemsymbols";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

const CHEM_KEY = "aquarius.chemsymbols";
// Fixed reaction-writing inserts (no longer user-editable) — the chemistry
// mirror of SymbolToolbar's structure row: arrows, states, gas/precipitate.
const DEFAULT_TB1 = ["\\ce{->}", "\\ce{<=>}", "\\ce{->[\\Delta]}", "\\ce{^}", "\\ce{v}", "\\ce{(s)}", "\\ce{(l)}", "\\ce{(g)}", "\\ce{(aq)}"];
// Human-readable names for the fixed buttons (raw \ce reads poorly aloud).
const FIXED_LABEL: Record<string, string> = {
  "\\ce{->}": "reaction arrow",
  "\\ce{<=>}": "equilibrium",
  "\\ce{->[\\Delta]}": "heated reaction arrow",
  "\\ce{^}": "gas evolved",
  "\\ce{v}": "precipitate",
  "\\ce{(s)}": "solid state",
  "\\ce{(l)}": "liquid state",
  "\\ce{(g)}": "gas state",
  "\\ce{(aq)}": "aqueous state",
};
// Eight editable species slots; the "Edit" button lets users change any of them.
const DEFAULT_SPECIES = ["\\ce{H2O}", "\\ce{CO2}", "\\ce{O2}", "\\ce{NH3}", "\\ce{H+}", "\\ce{OH-}", "\\ce{Na+}", "\\ce{SO4^2-}"];
const SLOT_COUNT = DEFAULT_SPECIES.length;

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

/** Chemistry strip — the parallel of SymbolToolbar: fixed reaction inserts plus
 *  eight editable, localStorage-backed species slots and the "browse all" entry
 *  point. Swaps in for the math strip via the toolbar's Σ/⚗ switch. */
export function ChemToolbar({ onInsert, onNewEquation, onBrowse, keepFocus, markSticky, leading, trailing }: {
  onInsert: (latex: string) => void;
  /** Insert a blank chemical-equation block and start editing it. */
  onNewEquation: () => void;
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
  // Eight editable species slots (always exactly SLOT_COUNT), changed via "Edit".
  const [species, setSpecies] = useState<string[]>(() =>
    [...readLS(CHEM_KEY, DEFAULT_SPECIES), ...DEFAULT_SPECIES].slice(0, SLOT_COUNT),
  );
  const [editSlots, setEditSlots] = useState(false);
  const [slotPicker, setSlotPicker] = useState<number | null>(null);

  useEffect(() => {
    // Same global-preference semantics as the math slots (see SymbolToolbar):
    // last write wins across split-view panes; the other converges on remount.
    if (typeof window !== "undefined") try { localStorage.setItem(CHEM_KEY, JSON.stringify(species)); } catch { /* noop */ }
  }, [species]);

  function onPickSlot(latex: string) {
    if (slotPicker != null) {
      const idx = slotPicker;
      setSpecies((a) => a.map((x, i) => (i === idx ? latex : x)));
    }
    setSlotPicker(null);
  }

  return (
    <>
      <div className="print-hide flex flex-wrap items-center justify-center gap-1.5 border-b border-border px-6 py-2">
        {leading}
        {/* New blank chemical equation */}
        <button onMouseDown={keepFocus} onClick={onNewEquation} title="Insert chemical equation" aria-label="Insert chemical equation" className={ICON_BTN}>
          <Icon name="flask" size={19} />
        </button>
        <span className="mx-2 h-7 w-px bg-border" />
        {/* Reaction pieces — fixed defaults (not user-editable) */}
        {DEFAULT_TB1.map((latex, i) => (
          <button key={i} onMouseDown={keepFocus} onClick={() => onInsert(latex)} title={`Insert ${FIXED_LABEL[latex] ?? latex}`} aria-label={`Insert ${FIXED_LABEL[latex] ?? latex}`} className={ICON_BTN}>
            <Katex latex={latex} />
          </button>
        ))}
        <span className="mx-2 h-7 w-px bg-border" />
        {/* Species — eight editable slots; "Edit" lets the user change any of them */}
        {species.map((latex, i) => (
          <button key={i} onMouseDown={(e) => { if (!editSlots) keepFocus(e); else markSticky(); }} onClick={() => (editSlots ? setSlotPicker(i) : onInsert(latex))} title={editSlots ? "Click to change this species" : `Insert ${latex}`} aria-label={editSlots ? `Change species ${i + 1}` : `Insert ${latex}`} className={`${ICON_BTN} ${editSlots ? "border border-dashed border-accent/60" : ""}`}>
            <Katex latex={latex} />
          </button>
        ))}
        <button onMouseDown={keepFocus} onClick={() => setEditSlots((s) => !s)} title={editSlots ? "Done — finish changing species" : "Change the species"} aria-label={editSlots ? "Done changing species" : "Change the species"} aria-pressed={editSlots} className={`${ICON_BTN} ${editSlots ? "bg-accent-soft text-accent" : "text-muted"}`}><Icon name="editformula" size={17} /></button>
        <span className="mx-2 h-7 w-px bg-border" />
        <button onMouseDown={keepFocus} onClick={onBrowse} title="Browse all chemistry symbols" aria-label="Browse all chemistry symbols" className={ICON_BTN}><Icon name="atom" size={20} /></button>
        {trailing}
      </div>
      {slotPicker != null && (
        <SymbolPicker
          title="Choose a species for this slot"
          symbols={CHEM_SYMBOLS}
          searchPlaceholder="Search… (e.g. water, sulfate, arrow, isotope)"
          onPick={onPickSlot}
          onClose={() => setSlotPicker(null)}
        />
      )}
    </>
  );
}
