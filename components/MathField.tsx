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

import { isCasesEnv, isGridEnv, showBlankCells, zeroFillCells } from "@/lib/blocks/mathenv";
import { getSettings } from "@/lib/settings/settings";

export interface MathFieldHandle {
  /** Insert a LaTeX snippet at the caret (toolbar / symbol picker). */
  insert: (latex: string) => void;
  focus: () => void;
  /** Current value as sanitized LaTeX. */
  getValue: () => string;
  /** Run a MathLive editing command (e.g. caret navigation). */
  command: (selector: Selector) => void;
  /** Switch between maths and words (`\text{…}`) at the caret. */
  toggleText: () => void;
  /** Put the caret on the part of the formula at these fractions of its box. */
  placeAt: (relX: number, relY: number) => void;
}

export interface MathFieldProps {
  /** LaTeX value (treated as an external/controlled value — see below). */
  value: string;
  onChange: (latex: string) => void;
  /** Escape pressed (commit + leave). */
  onExit?: () => void;
  /** Enter outside a grid: the formula is finished, go to the next line. When
   *  absent, Enter keeps MathLive's own behaviour. */
  onEnter?: () => void;
  /** An arrow key ran off either end of the formula (MathLive's `move-out`):
   *  a formula inside a line of text hands the caret back to the text. */
  onMoveOut?: (dir: "forward" | "backward") => void;
  /** Backspace in an EMPTY field: the formula itself is being deleted. */
  onDeleteEmpty?: () => void;
  /** The grid the caret is inside, or null — drives the row/column (or case)
   *  controls (see GridBar in FormulaEditBox). Fires only on a change. */
  onGridChange?: (grid: GridContext | null) => void;
  autoFocus?: boolean;
  /** With autoFocus: open with the caret at the formula's start rather than its
   *  end (arrowing into it from the words on its left). */
  caretAtStart?: boolean;
  /** With autoFocus: open with the caret where the rendered formula was
   *  pressed, as fractions of its box (lib/editor/caret → formulaPointAt). */
  initialPoint?: { relX: number; relY: number } | null;
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

/**
 * Active PLAIN-TEXT insert target: a focused textbox that is not a math field
 * but can still hold maths as source — a list item, a table cell. The toolbar
 * and SymbolPicker route raw LaTeX here when no math field is focused, so a
 * symbol or a `$…$` pair lands in the line the writer is actually in instead of
 * starting a new block somewhere else.
 *
 * `caretInText` is where the caret should end up INSIDE what was inserted (so
 * `$…$` can leave it between the dollars); omitted means after it.
 */
export type TextInserter = (text: string, caretInText?: number) => void;
let activeText: TextInserter | null = null;
export function activeTextInserter(): TextInserter | null {
  return activeText;
}
export function setActiveTextInserter(fn: TextInserter | null): void {
  activeText = fn;
}

/**
 * Active INLINE-FORMULA opener: a focused line of text that can open a formula
 * box at its caret (a list item — a paragraph is reached through EditBox's
 * handle). The formula button, Insert ▸ Equation and the symbol strip call it,
 * so maths is typed in a box where the writer is rather than as `$…$` source.
 * `seed` pre-fills the box: a structure from the strip, or nothing.
 */
export type FormulaOpener = (seed: string) => void;
let activeOpener: FormulaOpener | null = null;
export function activeFormulaOpener(): FormulaOpener | null {
  return activeOpener;
}
export function setActiveFormulaOpener(fn: FormulaOpener | null): void {
  activeOpener = fn;
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

/**
 * Write LaTeX INTO the field.
 *
 * Never `setValue` directly: a stored grid keeps its unfilled cells as nothing
 * at all, and handing that back to MathLive would show an empty `cases` as one
 * big brace with no cells to click. `showBlankCells` restores the boxes; the
 * output format drops them again, so what the field emits is unchanged.
 *
 * Silenced, because every caller reports the new value itself (or knows it did
 * not change) — an echo here would race the caller's own emit.
 */
function writeField(mf: MathfieldElement, latex: string): void {
  mf.setValue(showBlankCells(latex), { silenceNotifications: true });
}

// ── "Is the caret in a grid, and which one?" ─────────────────────────────────
// Enter grows a grid by a row and Space (matrices only) by a column, so both
// keys need to know whether the caret is inside one — and, since `cases` takes
// Enter but not Space, WHICH one. Everywhere else both keys keep their ordinary
// behavior.
//
// MathLive publishes no way to ask. Its `Model` type is the opaque
// `{ mathfield }`, and `addRowAfter` cannot stand in as a probe: it returns
// `true` wherever it runs, and outside an array it rewrites the whole
// expression as `\displaylines{…}` — so a "did it work?" test would corrupt
// every formula it was asked about. What does exist, on the element's internal
// core, is the atom tree: the caret's atom has a chain of parents, and a grid
// is an `array` atom carrying its `environmentName`.
//
// That is private API, so every step is optional-chained and the whole thing is
// wrapped: if a MathLive upgrade moves it, `gridAtCaret` returns null, which
// reads as "not in a grid" and gives Space and Enter their stock behavior back.
// Nothing else depends on it.
interface CaretAtom {
  type?: string;
  value?: string;
  environmentName?: string;
  rowCount?: number;
  colCount?: number;
  /** Inside an array this is the cell's [row, column]. */
  parentBranch?: unknown;
  parent?: CaretAtom;
  children?: CaretAtom[];
  _children?: CaretAtom[];
}
interface CaretModel {
  position?: number;
  at?: (offset: number) => CaretAtom | null | undefined;
  offsetOf?: (atom: CaretAtom) => number;
}

/** The grid the caret is in: its environment, shape, and the cell it's in. */
export interface GridContext {
  env: string;
  rows: number;
  cols: number;
  row: number;
  col: number;
}

const modelOf = (mf: MathfieldElement): CaretModel | null =>
  (mf as unknown as { _mathfield?: { model?: CaretModel } })._mathfield?.model ?? null;

/** `[row, col]` when `branch` is an array cell coordinate, else null. */
function cellCoords(branch: unknown): [number, number] | null {
  return Array.isArray(branch) && typeof branch[0] === "number" && typeof branch[1] === "number"
    ? [branch[0], branch[1]]
    : null;
}

/** The innermost matrix containing the caret, plus the array atom itself. */
function gridAtCaretRaw(mf: MathfieldElement): { ctx: GridContext; array: CaretAtom; model: CaretModel } | null {
  try {
    const model = modelOf(mf);
    if (!model || typeof model.at !== "function" || typeof model.position !== "number") return null;
    let atom = model.at(model.position);
    let branch = atom?.parentBranch;
    // Bounded: a caret sits a handful of levels deep, and this must never spin
    // on a cyclic or unexpected tree.
    for (let depth = 0; atom && depth < 32; depth++, branch = atom.parentBranch, atom = atom.parent) {
      const env = atom.environmentName;
      if (atom.type !== "array" || typeof env !== "string" || !isGridEnv(env)) continue;
      const at = cellCoords(branch) ?? [0, 0];
      return {
        ctx: { env, rows: atom.rowCount ?? 1, cols: atom.colCount ?? 1, row: at[0], col: at[1] },
        array: atom,
        model,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** The innermost matrix containing the caret, if any. */
const gridAtCaret = (mf: MathfieldElement): GridContext | null => gridAtCaretRaw(mf)?.ctx ?? null;

/** The atoms of one cell, in document order, with their model offsets. Cells are
 *  branches of the array atom: every atom carries its own `[row, col]`. */
function cellAtoms(array: CaretAtom, model: CaretModel, row: number, col: number): { atom: CaretAtom; offset: number }[] {
  if (typeof model.offsetOf !== "function") return [];
  const out: { atom: CaretAtom; offset: number }[] = [];
  for (const child of array.children ?? array._children ?? []) {
    const at = cellCoords(child.parentBranch);
    if (at && at[0] === row && at[1] === col) out.push({ atom: child, offset: model.offsetOf(child) });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/**
 * Put the caret in a cell — and if that cell holds nothing but a stand-in for a
 * value (the `0` a new row arrives with, or an untouched placeholder box),
 * SELECT it, so the first thing typed replaces it instead of landing beside it.
 * A cell with real content just takes the caret at its end.
 *
 * Returns false when the cell can't be located, so callers can fall back rather
 * than silently swallowing the keystroke that asked to move.
 */
function focusCell(mf: MathfieldElement, row: number, col: number): boolean {
  const found = gridAtCaretRaw(mf);
  if (!found) return false;
  const atoms = cellAtoms(found.array, found.model, row, col);
  if (atoms.length === 0) return false;
  const content = atoms.filter((a) => a.atom.type !== "first");
  const lone = content.length === 1 ? content[0] : null;
  const standIn = lone && (lone.atom.value === "0" || lone.atom.type === "placeholder");
  if (lone && standIn) mf.selection = { ranges: [[lone.offset - 1, lone.offset]] };
  else mf.position = atoms[atoms.length - 1].offset;
  return true;
}

export const MathField = forwardRef<MathFieldHandle, MathFieldProps>(function MathField(
  { value, onChange, onExit, onEnter, onMoveOut, onDeleteEmpty, onGridChange, autoFocus, caretAtStart, initialPoint, readOnly, inline, manualKeyboard, className },
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
  const cb = useRef({ onChange, onExit, onEnter, onMoveOut, onDeleteEmpty, onGridChange });
  cb.current = { onChange, onExit, onEnter, onMoveOut, onDeleteEmpty, onGridChange };
  // Last reported matrix context, so the callback fires on change, not on
  // every caret move inside the same matrix.
  const lastGrid = useRef<string>("");
  // The cell the caret was last seen in, so entering a cell can select its
  // stand-in value exactly once — moving about inside a cell must not keep
  // re-selecting it under the user.
  const lastCell = useRef<string>("");
  const valueRef = useRef(value);
  valueRef.current = value;
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;
  const caretAtStartRef = useRef(caretAtStart);
  caretAtStartRef.current = caretAtStart;
  const initialPointRef = useRef(initialPoint);
  initialPointRef.current = initialPoint;

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
    toggleText: () => {
      const mf = mfRef.current;
      if (!mf || !mounted.current) return;
      mf.executeCommand(["switchMode", mf.mode === "text" ? "math" : "text"]);
      mf.focus();
    },
    placeAt: (relX, relY) => {
      const mf = mfRef.current;
      if (!mf || !mounted.current) return;
      // The typeset formula's own box inside the field (its content part when
      // MathLive draws no formula yet), so the fractions address the formula.
      const box =
        mf.shadowRoot?.querySelector<HTMLElement>(".ML__latex")?.getBoundingClientRect() ??
        mf.shadowRoot?.querySelector<HTMLElement>("[part=content]")?.getBoundingClientRect() ??
        mf.getBoundingClientRect();
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      const x = box.left + clamp(relX) * box.width;
      const y = box.top + clamp(relY) * box.height;
      try {
        mf.position = mf.getOffsetFromPoint(x, y);
      } catch { /* a field without layout yet keeps its caret */ }
      mf.focus();
    },
  });
  useImperativeHandle(ref, () => handle.current, []);

  /** Push a value upward (and remember it, so the external-value effect doesn't
   *  echo it straight back and jump the caret). */
  const emit = (latex: string) => {
    lastEmitted.current = latex;
    cb.current.onChange(latex);
  };

  /** Tell the caller which grid the caret is in (if any). */
  const reportGrid = () => {
    const mf = mfRef.current;
    if (!mf || !mounted.current || !cb.current.onGridChange) return;
    const grid = gridAtCaret(mf);
    const key = grid ? `${grid.env}:${grid.rows}x${grid.cols}` : "";
    if (key === lastGrid.current) return;
    lastGrid.current = key;
    cb.current.onGridChange(grid);
  };

  /**
   * Grow the grid and land ready to type.
   *
   * MathLive fills a new row with empty placeholder boxes and a new column with
   * nothing at all; in a MATRIX both become `0` here rather than at commit, so
   * the matrix on screen is always a complete one. The caret then goes to the
   * first new cell with that `0` selected — the row is ready for a number, not
   * for hunting the cell first. A new `cases` row keeps its boxes (a case with
   * no value is not zero; it is unwritten), and `writeField` keeps them visible.
   */
  const growGrid = (cmd: "addRowAfter" | "addColumnAfter") => {
    const mf = mfRef.current;
    if (!mf || !mounted.current) return;
    const before = gridAtCaret(mf);
    mf.executeCommand(cmd);
    const filled = zeroFillCells(sanitize(mf.getValue(OUTPUT_FORMAT)));
    if (filled !== lastEmitted.current) {
      writeField(mf, filled); // emitted by hand below
      emit(filled);
    }
    if (before) {
      const row = cmd === "addRowAfter";
      focusCell(mf, row ? before.row + 1 : before.row, row ? 0 : before.col + 1);
    }
    reportGrid();
  };

  /**
   * Entering a cell that holds only a `0` selects it, so typing replaces the
   * value rather than appending a digit to it — the same courtesy MathLive
   * gives its own placeholder boxes. Only on ENTERING: once the caret is in the
   * cell, the user's own selection is left alone.
   */
  const selectStandIn = () => {
    const mf = mfRef.current;
    if (!mf || !mounted.current) return;
    const grid = gridAtCaret(mf);
    const key = grid ? `${grid.row},${grid.col}` : "";
    if (key === lastCell.current) return;
    lastCell.current = key;
    if (!grid) return;
    const range = mf.selection?.ranges?.[0];
    if (range && range[0] !== range[1]) return; // a real selection — don't touch it
    focusCell(mf, grid.row, grid.col);
  };

  /** Tab between cells. Inside a matrix the cells ARE the fields to fill, and
   *  once they hold zeros there are no placeholder boxes left for MathLive's own
   *  placeholder navigation to find. */
  const stepCell = (back: boolean): boolean => {
    const mf = mfRef.current;
    const grid = mf && gridAtCaret(mf);
    if (!mf || !grid) return false;
    const flat = grid.row * grid.cols + grid.col + (back ? -1 : 1);
    if (flat < 0 || flat >= grid.rows * grid.cols) return false; // let Tab do its usual thing
    return focusCell(mf, Math.floor(flat / grid.cols), flat % grid.cols);
  };

  /**
   * Report what the field holds NOW, if MathLive has not reported it yet. Its
   * input event trails the keystroke, and Enter or Escape act at once: without
   * this, "a+b⏎" typed quickly reached the page as an empty equation.
   */
  const flushValue = () => {
    const mf = mfRef.current;
    if (!mf || !mounted.current) return;
    const current = sanitize(mf.getValue(OUTPUT_FORMAT));
    if (current !== lastEmitted.current) emit(current);
  };
  /**
   * End of an edit session: matrix cells the user never filled become 0.
   *
   * Deferred to here rather than done on every keystroke because filling as you
   * type would drop a `0` into the cell you are about to move into, and you'd
   * delete it before typing anything. Reads only refs, so the mount effect can
   * close over the first instance safely.
   */
  const fillBlanks = () => {
    const mf = mfRef.current;
    if (!mf || !mounted.current) return;
    const current = sanitize(mf.getValue(OUTPUT_FORMAT));
    const filled = zeroFillCells(current);
    if (filled === current) return;
    lastEmitted.current = filled;
    writeField(mf, filled); // no echo back through `input`
    cb.current.onChange(filled);
  };

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
        // Already reported (flushValue ran for an Enter or Escape that beat this
        // event): reporting it again would write into whatever line the caret
        // has moved on to.
        if (latex === lastEmitted.current) { reportGrid(); return; }
        lastEmitted.current = latex;
        cb.current.onChange(latex);
        reportGrid(); // typing can carry the caret in or out of a matrix
      });
      mf.addEventListener("selection-change", () => {
        reportGrid();
        selectStandIn();
      });
      // An arrow key with nowhere left to go inside the formula.
      mf.addEventListener("move-out", (ev) => {
        const fn = cb.current.onMoveOut;
        if (!fn) return;
        ev.preventDefault();
        const dir = (ev as CustomEvent<{ direction?: string }>).detail?.direction;
        fn(dir === "backward" || dir === "upward" ? "backward" : "forward");
      });
      // Capture phase + stopImmediatePropagation so we preempt MathLive's own
      // keydown handling (which would otherwise let Tab blur out of the field).
      mf.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            flushValue();
            fillBlanks();
            cb.current.onExit?.();
            return;
          }
          // `"` switches between maths and words (`\text{…}`), as the strip's
          // Text button does: the way to write "if" or "for all" in a formula.
          // Left alone while a raw \command is being typed.
          if (e.key === '"' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing && mf!.mode !== "latex") {
            e.preventDefault();
            e.stopImmediatePropagation();
            mf!.executeCommand(["switchMode", mf!.mode === "text" ? "math" : "text"]);
            return;
          }
          if (e.key === "Backspace" && cb.current.onDeleteEmpty && !sanitize(mf!.getValue(OUTPUT_FORMAT)).trim()) {
            e.preventDefault();
            e.stopImmediatePropagation();
            cb.current.onDeleteEmpty();
            return;
          }
          // Tab / Shift+Tab jump between the empty slots of a structure (fraction
          // num→den, an integral's bounds, …) — or between cells inside a matrix.
          // Never let Tab blur out of the field.
          if (e.key === "Tab") {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!stepCell(e.shiftKey)) {
              mf!.executeCommand(e.shiftKey ? "moveToPreviousPlaceholder" : "moveToNextPlaceholder");
            }
            return;
          }
          // Inside a matrix, Enter grows it by a row and Space by a column, so an
          // m×n matrix is built without ever leaving the keyboard; SHIFT takes the
          // row or column away again. Both keys are free to take on that meaning
          // there: bare Space does nothing at all in a matrix, and bare Enter
          // wraps the formula in `\displaylines{…}`, which is never what someone
          // editing a matrix wanted. Outside one, neither key is touched.
          //
          // `cases` takes Enter only. Its two columns are the notation — a value
          // and its condition — so there is no third column to add, and Space
          // keeps whatever meaning it has in the cell being typed into.
          //
          // Removal needs no guard of its own: MathLive declines to remove the
          // last row or column, so a grid can never be emptied down to the
          // cell-less `\begin{bmatrix}\end{bmatrix}` this all started from.
          const grid = e.key === "Enter" || e.key === " " ? gridAtCaret(mf!) : null;
          const row = e.key === "Enter";
          if (grid && (row || !isCasesEnv(grid.env))) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.shiftKey) {
              mf!.executeCommand(row ? "removeRow" : "removeColumn");
              reportGrid();
            } else {
              growGrid(row ? "addRowAfter" : "addColumnAfter");
            }
            return;
          }
          // Enter anywhere else ends the equation and starts the next line, as
          // Enter does after every other line of the document. Shift+Enter keeps
          // MathLive's meaning, a line break inside the formula.
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing && cb.current.onEnter) {
            e.preventDefault();
            e.stopImmediatePropagation();
            flushValue();
            fillBlanks();
            cb.current.onEnter();
          }
        },
        true,
      );
      mf.addEventListener("focusin", () => {
        applyKeyboardPolicy(); // re-read the setting so a mid-session toggle applies
        active = handle.current;
        reportGrid();
      });
      mf.addEventListener("focusout", () => {
        if (active === handle.current) active = null;
        fillBlanks();
      });

      // Core config MUST wait for the internal mathfield to exist.
      mf.addEventListener(
        "mount",
        () => {
          mounted.current = true;
          const el = mfRef.current;
          if (!el) return;
          try { el.menuItems = []; } catch { /* version without menu */ }
          writeField(el, valueRef.current);
          lastEmitted.current = sanitize(valueRef.current);
          if (autoFocusRef.current) {
            el.focus();
            if (caretAtStartRef.current) { try { el.position = 0; } catch { /* noop */ } }
            // Opened by a press on the rendered formula: the caret goes where
            // it landed, once the field has laid the formula out.
            const at = initialPointRef.current;
            if (at) requestAnimationFrame(() => handle.current.placeAt(at.relX, at.relY));
          }
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
      writeField(mf, value);
      lastEmitted.current = sanitize(value);
    }
  }, [value]);

  // Keep readOnly in sync if it changes after mount.
  useEffect(() => {
    if (mfRef.current && mounted.current) mfRef.current.readOnly = !!readOnly;
  }, [readOnly]);

  return <div ref={host} className={className} />;
});
