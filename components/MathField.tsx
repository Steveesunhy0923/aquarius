/**
 * MathField — a Desmos-style structural math editor (MathLive `<math-field>`).
 *
 * Replaces the raw-LaTeX textarea: users type into boxes (a √'s radicand, a
 * fraction's num/den, an exponent) and Tab/arrow between them. The widget both
 * reads and writes LaTeX, so the block tree keeps storing math as a LaTeX string
 * (see lib/blocks/source.ts `rawMath`) — no parser, no model change.
 *
 * The element is created IMPERATIVELY into a host <div> (not via JSX) so we don't
 * depend on a `math-field` JSX intrinsic declaration. CRUCIAL: MathLive creates
 * its internal core during `connectedCallback` (after append, possibly deferred),
 * and methods/setters like `menuItems`/`setValue`/`insert` throw "Mathfield not
 * mounted" until then — so ALL core configuration happens inside the `mount`
 * event, and the imperative handle guards on a `mounted` flag.
 */

"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { MathfieldElement, Selector } from "mathlive";

import { getSettings } from "@/lib/settings/settings";

export interface MathFieldHandle {
  /** Insert a LaTeX snippet at the caret (toolbar / symbol picker). */
  insert: (latex: string) => void;
  focus: () => void;
  /** Current value as sanitized LaTeX. */
  getValue: () => string;
  /** Run a MathLive editing command (e.g. caret navigation). */
  command: (selector: Selector) => void;
}

export interface MathFieldProps {
  /** LaTeX value (treated as an external/controlled value — see below). */
  value: string;
  onChange: (latex: string) => void;
  /** Escape pressed (commit + leave). */
  onExit?: () => void;
  autoFocus?: boolean;
  readOnly?: boolean;
  /** Inline-math default mode (for inline formulas inside prose). */
  inline?: boolean;
  /** Never auto-show the on-screen math keyboard (e.g. table cells). */
  manualKeyboard?: boolean;
  className?: string;
}

// ── Active-field registry ────────────────────────────────────────────────────
// The toolbar + SymbolPicker live far from the field in the tree; they target
// whichever field is focused via this module-level pointer instead of prop-
// drilling refs. Cleared on blur.
let active: MathFieldHandle | null = null;
export function activeMathField(): MathFieldHandle | null {
  return active;
}

// Active PLAIN-TEXT insert target (e.g. a focused table-cell textbox). The
// toolbar/SymbolPicker route raw LaTeX here when no math field is focused, so
// symbols/formulas can still be inserted into regular textbox inputs.
let activeText: ((text: string) => void) | null = null;
export function activeTextInserter(): ((text: string) => void) | null {
  return activeText;
}
export function setActiveTextInserter(fn: ((text: string) => void) | null): void {
  activeText = fn;
}

// ── Lazy, once-only MathLive load + global asset config ───────────────────────
// `mathlive` touches window/customElements at import, so it must load on the
// client only. Importing it auto-registers the <math-field> element.
let loaded: Promise<typeof import("mathlive")> | null = null;
function loadMathlive(): Promise<typeof import("mathlive")> {
  if (!loaded) {
    loaded = import("mathlive").then((m) => {
      m.MathfieldElement.fontsDirectory = "/mathlive/fonts"; // copied by `prepare-mathlive`
      m.MathfieldElement.soundsDirectory = null; // no keypress sounds
      return m;
    });
  }
  return loaded;
}

// `latex-without-placeholders` already strips empty `\placeholder{}`; this maps
// the handful of MathLive macros KaTeX / our serializer don't understand back to
// standard LaTeX so the stored string round-trips cleanly.
function sanitize(latex: string): string {
  return latex
    .replace(/\\mleft\b/g, "\\left")
    .replace(/\\mright\b/g, "\\right")
    .replace(/\\differentialD/g, "d")
    .replace(/\\exponentialE/g, "e")
    .replace(/\\imaginaryI/g, "i");
}

const OUTPUT_FORMAT = "latex-without-placeholders" as const;

export const MathField = forwardRef<MathFieldHandle, MathFieldProps>(function MathField(
  { value, onChange, onExit, autoFocus, readOnly, inline, manualKeyboard, className },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const mfRef = useRef<MathfieldElement | null>(null);
  const mounted = useRef(false);
  // What we last emitted upward — so the external-value effect only writes back
  // a value that genuinely changed elsewhere (undo/redo, collab), never echoing
  // our own keystroke and jumping the caret.
  const lastEmitted = useRef<string>(value);
  // Latest props via refs so the mount effect can run exactly once.
  const cb = useRef({ onChange, onExit });
  cb.current = { onChange, onExit };
  const valueRef = useRef(value);
  valueRef.current = value;
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;

  const handle = useRef<MathFieldHandle>({
    insert: (latex) => {
      const mf = mfRef.current;
      if (!mf || !mounted.current) return;
      // selectionMode 'placeholder' (the default) lands the caret in the first
      // empty box (a `#?` token), so inserting e.g. \frac{#?}{#?} is tabbable.
      mf.insert(latex, { focus: true });
    },
    focus: () => mfRef.current?.focus(),
    getValue: () =>
      mounted.current && mfRef.current ? sanitize(mfRef.current.getValue(OUTPUT_FORMAT)) : lastEmitted.current,
    command: (selector) => { if (mounted.current) mfRef.current?.executeCommand(selector); },
  });
  useImperativeHandle(ref, () => handle.current, []);

  // Mount once: create + configure + attach the element.
  useEffect(() => {
    let mf: MathfieldElement | null = null;
    let cancelled = false;
    void loadMathlive().then(({ MathfieldElement }) => {
      if (cancelled || !host.current) return;
      mf = new MathfieldElement();
      mfRef.current = mf;
      // Pre-mount config goes through ATTRIBUTES (applied on connect — never
      // throws), NOT property setters (which require the mounted core).
      mf.setAttribute("default-mode", inline ? "inline-math" : "math");
      // The on-screen keyboard is opt-in (Settings → On-screen math keyboard) and
      // never auto-shows where `manualKeyboard` is forced (e.g. table cells). Read
      // the setting LIVE (re-applied on focusin below) so toggling it takes effect
      // without a remount. "manual" suppresses the auto-popup; the toggle BUTTON
      // itself is hidden via CSS unless the setting is on (app/globals.css).
      const applyKeyboardPolicy = () => {
        const allow = !manualKeyboard && getSettings().mathKeyboard;
        mf!.setAttribute("math-virtual-keyboard-policy", allow ? "auto" : "manual");
      };
      applyKeyboardPolicy();
      if (readOnly) mf.setAttribute("read-only", "true");
      mf.style.width = "100%";

      // Listeners are plain DOM events — safe to attach before mount.
      mf.addEventListener("input", () => {
        if (!mounted.current) return;
        const latex = sanitize(mf!.getValue(OUTPUT_FORMAT));
        lastEmitted.current = latex;
        cb.current.onChange(latex);
      });
      // Capture phase + stopImmediatePropagation so we preempt MathLive's own
      // keydown handling (which would otherwise let Tab blur out of the field).
      mf.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cb.current.onExit?.();
            return;
          }
          // Tab / Shift+Tab jump between the empty slots of a structure (fraction
          // num→den, an integral's bounds, …). Never let Tab blur out of the field.
          if (e.key === "Tab") {
            e.preventDefault();
            e.stopImmediatePropagation();
            mf!.executeCommand(e.shiftKey ? "moveToPreviousPlaceholder" : "moveToNextPlaceholder");
          }
        },
        true,
      );
      mf.addEventListener("focusin", () => {
        applyKeyboardPolicy(); // re-read the setting so a mid-session toggle applies
        active = handle.current;
      });
      mf.addEventListener("focusout", () => {
        if (active === handle.current) active = null;
      });

      // Core config MUST wait for the internal mathfield to exist.
      mf.addEventListener(
        "mount",
        () => {
          mounted.current = true;
          const el = mfRef.current;
          if (!el) return;
          try { el.menuItems = []; } catch { /* version without menu */ }
          el.setValue(valueRef.current, { silenceNotifications: true });
          lastEmitted.current = sanitize(valueRef.current);
          if (autoFocusRef.current) el.focus();
        },
        { once: true },
      );

      host.current.appendChild(mf);
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      if (active === handle.current) active = null;
      mf?.remove();
      mfRef.current = null;
    };
    // Mount-once: props are read via refs / handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value change (undo/redo, collab, programmatic) → write only when it
  // differs from what we emitted, so typing never re-sets and jumps the caret.
  useEffect(() => {
    const mf = mfRef.current;
    if (!mf || !mounted.current) return;
    if (sanitize(value) !== lastEmitted.current) {
      mf.setValue(value, { silenceNotifications: true });
      lastEmitted.current = sanitize(value);
    }
  }, [value]);

  // Keep readOnly in sync if it changes after mount.
  useEffect(() => {
    if (mfRef.current && mounted.current) mfRef.current.readOnly = !!readOnly;
  }, [readOnly]);

  return <div ref={host} className={className} />;
});
