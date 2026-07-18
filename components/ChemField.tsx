/**
 * ChemField — the chemistry counterpart of MathField.
 *
 * Chemistry is typed as plain mhchem source — `2H2 + O2 ->[\Delta] 2H2O`,
 * `SO4^2-`, `NaCl(aq)` — which mhchem was designed to make natural, so the
 * input is a simple text field with a live rendered preview, not MathLive.
 * The stored form is still LaTeX: callers wrap the source in `\ce{...}`
 * (lib/blocks/chem.ts), so storage/serialization/export are untouched.
 *
 * Mirrors MathField's contract: an imperative handle for toolbar insertion and
 * a module-level active-field registry so the chemistry toolbar/palette can
 * target whichever field is focused without prop-drilling refs.
 */

"use client";

import { Katex } from "@/components/Katex";
import { wrapCe } from "@/lib/blocks/chem";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface ChemFieldHandle {
  /** Insert mhchem source at the caret (chemistry toolbar / palette). */
  insert: (src: string) => void;
  focus: () => void;
  /** Current mhchem source (NOT \ce-wrapped). */
  getValue: () => string;
}

// ── Active-field registry (mirror of MathField's) ────────────────────────────
let active: ChemFieldHandle | null = null;
export function activeChemField(): ChemFieldHandle | null {
  return active;
}

export const ChemField = forwardRef<ChemFieldHandle, {
  /** mhchem source (without the \ce{} wrapper). */
  value: string;
  onChange: (src: string) => void;
  /** Escape pressed (commit + leave). */
  onExit?: () => void;
  /** Enter pressed (e.g. the popover's "Done"). Falls back to onExit. */
  onEnter?: () => void;
  autoFocus?: boolean;
  /** Render the live preview as display (block) math instead of inline. */
  display?: boolean;
  className?: string;
}>(function ChemField({ value, onChange, onExit, onEnter, autoFocus, display, className }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cb = useRef({ onChange, onExit, onEnter });
  cb.current = { onChange, onExit, onEnter };

  // Semi-controlled, like MathField: the field owns its text while focused; the
  // `value` prop is applied only when it changed EXTERNALLY (undo/redo, collab),
  // never echoing our own keystroke back (which would fight the caret).
  const [text, setText] = useState(value);
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(value);
    }
  }, [value]);
  function emit(next: string) {
    lastEmitted.current = next;
    setText(next);
    cb.current.onChange(next);
  }

  const handle = useRef<ChemFieldHandle>({
    insert: (src) => {
      const el = inputRef.current;
      if (!el) return;
      const s = el.selectionStart ?? el.value.length;
      const e = el.selectionEnd ?? s;
      // Breathing space around reaction-level pieces (arrows, `+`) the way a
      // chemist would type them; species/charges splice in tight.
      const spaced = /^(?:->|<-|<=>|<->|<-->|<=>>|<<=>|\+|v|\^)(?:\[.*\])?$/.test(src.trim())
        ? ` ${src.trim()} `
        : src;
      const next = el.value.slice(0, s) + spaced + el.value.slice(e);
      const pos = s + spaced.length;
      emit(next);
      requestAnimationFrame(() => {
        const x = inputRef.current;
        if (x) { x.focus(); try { x.setSelectionRange(pos, pos); } catch { /* noop */ } }
      });
    },
    focus: () => inputRef.current?.focus(),
    getValue: () => inputRef.current?.value ?? lastEmitted.current,
  });
  useImperativeHandle(ref, () => handle.current, []);

  // Registry wiring uses NATIVE listeners (MathField's model), not React's
  // onFocus/onBlur props: React neither dispatches a synthetic focus for a
  // commit-time autoFocus (the popover would never register) nor a synthetic
  // blur when a focused field unmounts in the same commit (Escape/Done would
  // leave a dead handle silently swallowing every later chemistry insert).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onFocus = () => { active = handle.current; };
    const onBlur = () => { if (active === handle.current) active = null; };
    el.addEventListener("focusin", onFocus);
    el.addEventListener("focusout", onBlur);
    // autoFocus already ran before these listeners attached.
    if (document.activeElement === el) active = handle.current;
    return () => {
      el.removeEventListener("focusin", onFocus);
      el.removeEventListener("focusout", onBlur);
      if (active === handle.current) active = null;
    };
  }, []);

  return (
    <div className={className}>
      <input
        ref={inputRef}
        value={text}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => emit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); cb.current.onExit?.(); }
          else if (e.key === "Enter") { e.preventDefault(); (cb.current.onEnter ?? cb.current.onExit)?.(); }
        }}
        placeholder="Type chemistry, e.g. 2H2 + O2 -> 2H2O"
        className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-sm outline-none focus:border-accent"
      />
      <div className="pointer-events-none mt-2 min-h-7 border-t border-border pt-2">
        {text.trim() ? (
          <Katex display={display} latex={wrapCe(text)} />
        ) : (
          <span className="text-xs text-muted">preview</span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Formulas: H2O · charges: SO4^2- · states: (aq) (s) (g) · arrows: -&gt; &lt;=&gt; · gas/precipitate: ^ v · isotopes: ^{"{"}14{"}"}_{"{"}6{"}"}C
      </p>
    </div>
  );
});
