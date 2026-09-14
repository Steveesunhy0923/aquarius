"use client";

import { MathField, type MathFieldHandle } from "@/components/MathField";
import { blockToKatex } from "@/lib/blocks";
import { ceInner } from "@/lib/blocks/chem";
import { inlineMathSpans, inlineSource, rawMath } from "@/lib/blocks/source";
import { formulaPointAt, type FormulaPoint } from "@/lib/editor/caret";
import katex from "katex";
// Registers mhchem's \ce on the katex singleton, as components/Katex does.
import "katex/contrib/mhchem";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";

/**
 * One line of prose with its formulas IN it — a paragraph, or a list item.
 *
 * The words are words and each formula is its own tiny box, with no border and
 * no dollar signs: rendered maths while the caret is in the words, the MathLive
 * field (the equation editor's input) once the caret goes into it. Only what is
 * inside a formula is maths; the text either side stays ordinary text you type,
 * select and delete.
 *
 * The line's SOURCE is unchanged — prose with `$…$` spans (lib/blocks/source) —
 * so storage, collab, export and the read view all carry on as before. This
 * component turns that string into text and formula pieces, draws them into a
 * contenteditable, and turns every edit back into the string (`onChange`).
 *
 * React renders only the editable root; its children are kept in step with the
 * pieces by hand (`syncDom`), because a browser editing a contenteditable
 * rewrites nodes React would otherwise believe it owns. The open formula's field
 * is a React portal into its box.
 *
 * Callers talk to it through a textarea-like handle (value, selectionStart/End,
 * setSelectionRange, focus) whose offsets are offsets into the source, so the
 * editing logic written for a <textarea> keeps working.
 */

type TextItem = { kind: "text"; id: number; text: string };
type MathItem = { kind: "math"; id: number; latex: string };
type Item = TextItem | MathItem;

export interface LineHandle {
  /** The line's source: prose with `$…$` formulas. */
  readonly value: string;
  /** Caret / selection as offsets into `value`. */
  readonly selectionStart: number;
  readonly selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  focus(): void;
  /** The editable element itself. */
  readonly el: HTMLDivElement | null;
  /** Open a formula box at the caret, seeded with `seed` (a structure from the
   *  symbol strip) or with the selected words. A plain symbol is placed as a
   *  finished formula with the caret after it, so the words carry on. */
  openFormula(seed?: string): void;
  /** Close an open formula, keeping what it holds, caret after it. True if one
   *  was open. */
  leaveFormula(): boolean;
}

export interface RichLineProps {
  value: string;
  /** Every change. `typed` is true for words typed or deleted in the line (what
   *  autoformat and the `/` and `[[` menus watch), false for a formula edit. */
  onChange: (value: string, caret: number, typed: boolean) => void;
  /** Runs first for every key pressed in the words (never for keys typed inside
   *  a formula); `preventDefault` stops this line's own handling. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onSelectionChange?: () => void;
  onFocus?: () => void;
  /** A formula opened ("math") or closed (null) — drives the symbol strip. */
  onInlineEditor?: (kind: "math" | null) => void;
  /** A press on a chemistry formula: `index` is its span in the source. Without
   *  this, chemistry opens in the maths field like any formula. */
  onChemChip?: (index: number, inner: string) => void;
  spellCheck?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Holds an empty text piece open so the caret has somewhere to sit. */
const ZW = "​";
const clean = (s: string): string => s.replace(/​/g, "");
let nextId = 1;
const newId = (): number => nextId++;

/** A structure seed's empty boxes, as they are stored when nothing fills them. */
export const seedLatex = (seed: string): string => seed.replace(/\\placeholder\{\}/g, "");

const handles = new WeakMap<Element, LineHandle>();
/** The line an element (usually `document.activeElement`) belongs to, if any. */
export function lineHandleOf(el: Element | null | undefined): LineHandle | null {
  const root = el?.closest?.("[data-richline]");
  return root ? handles.get(root) ?? null : null;
}

// ─── pieces ⇄ source ─────────────────────────────────────────────────────────

function parse(src: string): Item[] {
  const items: Item[] = [];
  let last = 0;
  for (const s of inlineMathSpans(src)) {
    items.push({ kind: "text", id: newId(), text: src.slice(last, s.start) });
    items.push({ kind: "math", id: newId(), latex: s.latex });
    last = s.end;
  }
  items.push({ kind: "text", id: newId(), text: src.slice(last) });
  return items;
}

const itemLength = (it: Item): number => (it.kind === "text" ? it.text.length : inlineSource(it.latex).length);
const serialize = (items: Item[]): string => items.map((it) => (it.kind === "text" ? it.text : inlineSource(it.latex))).join("");
const startOf = (items: Item[], k: number): number => items.slice(0, k).reduce((n, it) => n + itemLength(it), 0);

/** Text pieces at both ends and between every two formulas; no two texts in a row. */
function normalize(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (it.kind === "text") {
      if (prev?.kind === "text") out[out.length - 1] = { ...prev, text: prev.text + it.text };
      else out.push(it);
    } else {
      if (!prev || prev.kind === "math") out.push({ kind: "text", id: newId(), text: "" });
      out.push(it);
    }
  }
  if (!out.length || out[out.length - 1].kind === "math") out.push({ kind: "text", id: newId(), text: "" });
  return out;
}

/** `$…$` typed into the words becomes a formula as its closing `$` lands. The
 *  source is the same characters, so offsets do not move. */
function liftTypedMath(items: Item[]): Item[] | null {
  let lifted = false;
  const out: Item[] = [];
  for (const it of items) {
    if (it.kind !== "text") { out.push(it); continue; }
    const spans = inlineMathSpans(it.text).filter((s) => it.text[s.start] === "$");
    if (!spans.length) { out.push(it); continue; }
    lifted = true;
    let last = 0;
    spans.forEach((s, n) => {
      out.push({ kind: "text", id: n === 0 ? it.id : newId(), text: it.text.slice(last, s.start) });
      out.push({ kind: "math", id: newId(), latex: s.latex });
      last = s.end;
    });
    out.push({ kind: "text", id: newId(), text: it.text.slice(last) });
  }
  return lifted ? normalize(out) : null;
}

function katexHtml(latex: string): string {
  try {
    return katex.renderToString(blockToKatex(rawMath(latex)), { throwOnError: false, displayMode: false, output: "html" });
  } catch {
    return latex.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  }
}

// ─── pieces ⇄ DOM ────────────────────────────────────────────────────────────

const keyOf = (it: Item): string => `${it.kind === "text" ? "t" : "m"}${it.id}`;

/** Text of a node as the source sees it: `<br>` is a line break. */
function nodeText(n: Node): string {
  if (n.nodeName === "BR") return "\n";
  if (n.nodeType === Node.TEXT_NODE) return (n as Text).data;
  let s = "";
  n.childNodes.forEach((c) => { s += nodeText(c); });
  return s;
}

function mathById(items: Item[]): Map<string, MathItem> {
  const m = new Map<string, MathItem>();
  for (const it of items) if (it.kind === "math") m.set(String(it.id), it);
  return m;
}

function nodeLength(n: Node, math: Map<string, MathItem>): number {
  if (n instanceof HTMLElement && n.dataset.m != null) {
    const it = math.get(n.dataset.m);
    return it ? inlineSource(it.latex).length : 0;
  }
  return clean(nodeText(n)).length;
}

/** Source offset of a DOM point inside `root`. A point in a formula box counts
 *  as just after the formula. */
function offsetOf(root: HTMLElement, items: Item[], node: Node, offset: number): number {
  const math = mathById(items);
  const kids = Array.from(root.childNodes);
  let acc = 0;
  if (node === root) {
    for (let k = 0; k < Math.min(offset, kids.length); k++) acc += nodeLength(kids[k], math);
    return acc;
  }
  for (const kid of kids) {
    if (kid === node || kid.contains(node)) {
      if (kid instanceof HTMLElement && kid.dataset.m != null) return acc + nodeLength(kid, math);
      const r = document.createRange();
      r.setStart(kid, 0);
      r.setEnd(node, offset);
      return acc + clean(nodeText(r.cloneContents())).length;
    }
    acc += nodeLength(kid, math);
  }
  return acc;
}

/** Read the pieces back out of the DOM after the browser edited it. `dirty`
 *  when the DOM is not in this component's own shape any more. */
function readDom(root: HTMLElement, items: Item[]): { items: Item[]; dirty: boolean } {
  const known = new Map(items.map((it) => [keyOf(it), it] as const));
  const out: Item[] = [];
  let dirty = false;
  const addText = (text: string, id?: number) => {
    const prev = out[out.length - 1];
    if (prev?.kind === "text") {
      out[out.length - 1] = { ...prev, text: prev.text + text };
      dirty = true;
    } else {
      out.push({ kind: "text", id: id ?? newId(), text });
    }
  };
  for (const kid of Array.from(root.childNodes)) {
    const el = kid instanceof HTMLElement ? kid : null;
    if (el?.dataset.m != null) {
      const it = known.get(`m${el.dataset.m}`);
      if (it) out.push(it);
      else dirty = true;
      continue;
    }
    if (el?.dataset.t != null && known.has(`t${el.dataset.t}`)) {
      if (!(el.childNodes.length === 1 && el.firstChild!.nodeType === Node.TEXT_NODE)) dirty = true;
      addText(clean(nodeText(el)), Number(el.dataset.t));
      continue;
    }
    dirty = true;
    addText(clean(nodeText(kid)));
  }
  const norm = normalize(out);
  if (norm.length !== out.length) dirty = true;
  return { items: norm, dirty };
}

/** Make the DOM match the pieces, reusing each piece's element. True when
 *  anything was touched (the selection then needs putting back). */
function syncDom(root: HTMLElement, items: Item[], active: number | null, els: Map<string, HTMLElement>): boolean {
  let changed = false;
  const want: HTMLElement[] = [];
  const keep = new Set<string>();
  for (const it of items) {
    const key = keyOf(it);
    keep.add(key);
    let el = els.get(key);
    if (!el) {
      el = document.createElement("span");
      if (it.kind === "text") {
        el.dataset.t = String(it.id);
      } else {
        el.dataset.m = String(it.id);
        el.contentEditable = "false";
        el.className = "aq-inline-math";
        // Two parts that are never swapped out, only shown and hidden: the
        // rendered formula, and the host the open field is portalled into. A
        // press on a formula therefore never detaches the node it landed on
        // (which read to the page as a press on blank space, closing it again).
        const view = document.createElement("span");
        view.className = "aq-inline-math-view";
        const edit = document.createElement("span");
        edit.className = "aq-inline-math-edit";
        el.append(view, edit);
      }
      els.set(key, el);
      changed = true;
    }
    if (it.kind === "text") {
      const content = it.text === "" ? ZW : it.text.endsWith("\n") ? it.text + ZW : it.text;
      const ok = el.childNodes.length === 1 && el.firstChild!.nodeType === Node.TEXT_NODE && (el.firstChild as Text).data === content;
      if (!ok) { el.textContent = content; changed = true; }
    } else {
      const view = el.firstElementChild as HTMLElement;
      if (active === it.id) {
        if (view.style.display !== "none") view.style.display = "none";
      } else {
        if (view.style.display === "none") view.style.display = "";
        if (el.dataset.latex !== it.latex) {
          view.innerHTML = katexHtml(it.latex);
          el.dataset.latex = it.latex;
        }
      }
    }
    want.push(el);
  }
  let ref: ChildNode | null = root.firstChild;
  for (const el of want) {
    if (ref === el) { ref = el.nextSibling; continue; }
    root.insertBefore(el, ref);
    changed = true;
  }
  while (ref) {
    const next: ChildNode | null = ref.nextSibling;
    root.removeChild(ref);
    ref = next;
    changed = true;
  }
  for (const key of Array.from(els.keys())) if (!keep.has(key)) els.delete(key);
  return changed;
}

/** DOM point for a source offset. An offset inside a formula lands after it. */
function pointAt(items: Item[], els: Map<string, HTMLElement>, offset: number): { node: Node; offset: number } | null {
  let acc = 0;
  let last: { node: Node; offset: number } | null = null;
  for (const it of items) {
    const len = itemLength(it);
    if (it.kind === "text") {
      const tn = els.get(keyOf(it))?.firstChild;
      if (tn) {
        const end = it.text === "" ? 1 : len;
        last = { node: tn, offset: end };
        if (offset <= acc + len) return { node: tn, offset: it.text === "" ? 1 : Math.max(0, Math.min(len, offset - acc)) };
      }
    }
    acc += len;
  }
  return last;
}

const inChip = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.("[data-m]");

// ─── the component ───────────────────────────────────────────────────────────

export const RichLine = forwardRef<LineHandle, RichLineProps>(function RichLine(props, ref) {
  const { value, spellCheck, className, style } = props;
  const cb = useRef(props);
  cb.current = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Item[] | null>(null);
  if (itemsRef.current === null) itemsRef.current = parse(value);
  const lastEmitted = useRef(value);
  const els = useRef(new Map<string, HTMLElement>());
  const activeRef = useRef<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const fieldInitial = useRef("");
  const caretAtStart = useRef(false);
  /** Where a press opened the formula, so its field opens with the caret there. */
  const fieldPoint = useRef<FormulaPoint | null>(null);
  const field = useRef<MathFieldHandle | null>(null);
  const pendingCaret = useRef<[number, number] | null>(null);
  const lastSel = useRef<[number, number]>([value.length, value.length]);
  const composing = useRef(false);

  const items = (): Item[] => itemsRef.current!;

  function emit(caret: number, typed: boolean) {
    const v = serialize(items());
    if (v === lastEmitted.current) return;
    lastEmitted.current = v;
    cb.current.onChange(v, caret, typed);
  }

  /** The selection as source offsets, or null when it is not in this line. */
  function readSelection(): [number, number] | null {
    const root = rootRef.current;
    const sel = typeof window === "undefined" ? null : window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
    const a = offsetOf(root, items(), r.startContainer, r.startOffset);
    const b = r.collapsed ? a : offsetOf(root, items(), r.endContainer, r.endOffset);
    return [Math.min(a, b), Math.max(a, b)];
  }

  function select(a: number, b: number) {
    const p = pointAt(items(), els.current, a);
    const q = a === b ? p : pointAt(items(), els.current, b);
    const sel = window.getSelection();
    if (!p || !q || !sel) return;
    const r = document.createRange();
    r.setStart(p.node, p.offset);
    r.setEnd(q.node, q.offset);
    sel.removeAllRanges();
    sel.addRange(r);
    lastSel.current = [a, b];
  }

  /** Where the caret is: inside an open formula counts as just after it. */
  function current(): [number, number] {
    const id = activeRef.current;
    if (id != null) {
      const k = items().findIndex((it) => it.id === id);
      if (k >= 0) {
        const end = startOf(items(), k) + itemLength(items()[k]);
        return [end, end];
      }
    }
    return readSelection() ?? lastSel.current;
  }

  /** The browser has edited the words: read them back, lift typed `$…$`. */
  function applyDom() {
    const root = rootRef.current;
    if (!root) return;
    const sel = readSelection();
    const { items: read, dirty } = readDom(root, items());
    const next = liftTypedMath(read) ?? read;
    itemsRef.current = next;
    const touched = syncDom(root, next, activeRef.current, els.current);
    if ((touched || dirty) && sel) select(sel[0], sel[1]);
    emit(sel ? sel[0] : serialize(next).length, true);
  }

  /** Replace [a, b) of the source with `text` (a line break, a paste). */
  function replaceRange(a: number, b: number, text: string) {
    const src = serialize(items());
    itemsRef.current = parse(src.slice(0, a) + text + src.slice(b));
    const root = rootRef.current;
    if (root) syncDom(root, items(), activeRef.current, els.current);
    select(a + text.length, a + text.length);
    emit(a + text.length, true);
  }
  function replaceSelection(text: string) {
    const [a, b] = readSelection() ?? lastSel.current;
    replaceRange(a, b, text);
  }

  function activate(id: number, where: "start" | "end", point?: FormulaPoint | null) {
    const it = items().find((x) => x.id === id);
    if (!it || it.kind !== "math") return;
    const inner = ceInner(it.latex);
    if (inner != null && cb.current.onChemChip) {
      const index = items().filter((x) => x.kind === "math" && x.latex.trim()).findIndex((x) => x.id === id);
      cb.current.onChemChip(index, inner);
      return;
    }
    fieldInitial.current = it.latex;
    caretAtStart.current = where === "start";
    fieldPoint.current = point ?? null;
    activeRef.current = id;
    setActive(id);
  }

  /** Close the open formula, reading its field first (MathLive reports its last
   *  keystroke late). An empty one is removed. `where` puts the caret before or
   *  after it; null leaves the caret to whatever closed it (a press). */
  function deactivate(where: "before" | "after" | null): boolean {
    const id = activeRef.current;
    if (id == null) return false;
    const model = items();
    const k = model.findIndex((x) => x.id === id);
    let caret = 0;
    if (k >= 0) {
      const cur = model[k] as MathItem;
      const latex = field.current?.getValue() ?? cur.latex;
      const start = startOf(model, k);
      if (latex.trim()) {
        itemsRef.current = model.map((x, n) => (n === k ? { ...cur, latex } : x));
        caret = where === "before" ? start : start + inlineSource(latex).length;
      } else {
        itemsRef.current = normalize(model.filter((_, n) => n !== k));
        caret = start;
      }
    }
    activeRef.current = null;
    field.current = null;
    setActive(null);
    emit(caret, false);
    if (where) pendingCaret.current = [caret, caret];
    return true;
  }

  function openFormula(seed: string) {
    if (activeRef.current != null) return;
    let [a, b] = readSelection() ?? lastSel.current;
    const src = serialize(items());
    const picked = src.slice(a, b);
    // A selection with formulas in it is not one formula's worth of maths.
    if (picked.includes("$")) a = b;
    const latex = seedLatex(seed) || (a === b ? "" : picked.trim());
    const id = newId();
    itemsRef.current = normalize([...parse(src.slice(0, a)), { kind: "math", id, latex }, ...parse(src.slice(b))]);
    const root = rootRef.current;
    if (root) syncDom(root, items(), null, els.current);
    const end = a + inlineSource(latex).length;
    // A plain symbol from the strip is a finished formula: the words carry on
    // after it. A structure (empty boxes to fill) or a blank formula opens.
    if (seed && !seed.includes("\\placeholder") && latex) {
      emit(end, false);
      root?.focus({ preventScroll: true });
      select(end, end);
      return;
    }
    fieldInitial.current = seed || latex;
    caretAtStart.current = false;
    fieldPoint.current = null;
    activeRef.current = id;
    setActive(id);
    emit(end, false);
  }

  function onFieldChange(latex: string) {
    const id = activeRef.current;
    if (id == null) return;
    const model = items();
    const k = model.findIndex((x) => x.id === id);
    if (k < 0) return;
    itemsRef.current = model.map((x, n) => (n === k ? { ...(x as MathItem), latex } : x));
    emit(startOf(model, k) + inlineSource(latex).length, false);
  }

  const handle = useRef<LineHandle | null>(null);
  if (!handle.current) {
    handle.current = {
      get value() { return serialize(items()); },
      get selectionStart() { return current()[0]; },
      get selectionEnd() { return current()[1]; },
      setSelectionRange(a: number, b: number) {
        if (activeRef.current != null) deactivate(null);
        rootRef.current?.focus({ preventScroll: true });
        select(a, b);
      },
      focus() {
        const root = rootRef.current;
        if (!root || root.contains(document.activeElement)) return;
        root.focus({ preventScroll: true });
        select(lastSel.current[0], lastSel.current[1]);
      },
      get el() { return rootRef.current; },
      openFormula(seed = "") { openFormula(seed); },
      leaveFormula() { return deactivate("after"); },
    };
  }
  useImperativeHandle(ref, () => handle.current!, []);

  // Keep the DOM in step with the pieces after every render: a new value from
  // outside (undo, a splice, a peer), a formula opening or closing.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    handles.set(root, handle.current!);
    if (value !== lastEmitted.current) {
      const focused = root.contains(document.activeElement);
      const at = focused ? current()[0] : null;
      itemsRef.current = parse(value);
      lastEmitted.current = value;
      if (activeRef.current != null) { activeRef.current = null; field.current = null; setActive(null); }
      syncDom(root, items(), null, els.current);
      if (at != null) select(Math.min(at, value.length), Math.min(at, value.length));
      return;
    }
    syncDom(root, items(), activeRef.current, els.current);
    const want = pendingCaret.current;
    if (want) {
      pendingCaret.current = null;
      root.focus({ preventScroll: true });
      select(want[0], want[1]);
    }
  });

  // Browser-side edits this line does itself or refuses: its own bold/italic,
  // its own undo (the page's undo owns ⌘Z), and dropped HTML.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onBefore = (ev: Event) => {
      const e = ev as InputEvent;
      if (inChip(e.target)) return;
      const t = e.inputType;
      if (t.startsWith("format") || t === "historyUndo" || t === "historyRedo" || t === "insertFromDrop") { e.preventDefault(); return; }
      if (t === "insertParagraph" || t === "insertLineBreak") { e.preventDefault(); replaceSelection("\n"); }
    };
    root.addEventListener("beforeinput", onBefore);
    return () => root.removeEventListener("beforeinput", onBefore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onSel = () => {
      const s = readSelection();
      if (!s) return;
      lastSel.current = s;
      cb.current.onSelectionChange?.();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { cb.current.onInlineEditor?.(active != null ? "math" : null); }, [active]);
  useEffect(() => () => cb.current.onInlineEditor?.(null), []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (inChip(e.target)) return; // a key typed inside a formula is MathLive's
    cb.current.onKeyDown?.(e);
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (e.key === "Enter") { e.preventDefault(); replaceSelection("\n"); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const sel = readSelection();
    if (!sel || sel[0] !== sel[1]) return;
    const at = sel[0];
    // A formula is one thing: arrowing or deleting into it from the words
    // either side opens it rather than skipping or eating it.
    let acc = 0;
    for (const it of items()) {
      const len = itemLength(it);
      if (it.kind === "math") {
        if (acc === at && (e.key === "ArrowRight" || e.key === "Delete")) { e.preventDefault(); activate(it.id, "start"); return; }
        if (acc + len === at && (e.key === "ArrowLeft" || e.key === "Backspace")) { e.preventDefault(); activate(it.id, "end"); return; }
      }
      acc += len;
    }
  }

  function onMouseDown(e: MouseEvent<HTMLDivElement>) {
    const chip = (e.target as HTMLElement).closest?.("[data-m]") as HTMLElement | null;
    if (chip) {
      const id = Number(chip.dataset.m);
      if (activeRef.current === id) return; // presses inside the open field are MathLive's
      e.preventDefault();
      // Where on the rendered formula the press landed, read before anything
      // changes — the field opens with its caret there.
      const point = formulaPointAt(chip, e.clientX, e.clientY);
      if (activeRef.current != null) deactivate(null);
      activate(id, "end", point);
      return;
    }
    // A press on the words while a formula is open closes the formula; the
    // press itself puts the caret where it landed.
    if (activeRef.current != null) deactivate(null);
  }

  function onCopy(e: ClipboardEvent<HTMLDivElement>, cut = false) {
    if (inChip(e.target)) return;
    const sel = readSelection();
    if (!sel || sel[0] === sel[1]) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", serialize(items()).slice(sel[0], sel[1]));
    if (cut) replaceRange(sel[0], sel[1], "");
  }

  const host = active != null ? ((els.current.get(`m${active}`)?.lastElementChild as HTMLElement | null) ?? null) : null;
  return (
    <>
      <div
        ref={rootRef}
        data-richline=""
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        spellCheck={spellCheck}
        className={className}
        style={style}
        onInput={(e) => { if (!inChip(e.target) && !composing.current) applyDom(); }}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onPaste={(e) => {
          if (inChip(e.target)) return;
          e.preventDefault();
          replaceSelection(e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n"));
        }}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onDrop={(e) => e.preventDefault()}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; applyDom(); }}
        onFocus={() => cb.current.onFocus?.()}
      />
      {host && active != null &&
        createPortal(
          <MathField
            key={active}
            ref={(h) => { if (h) field.current = h; }}
            value={fieldInitial.current}
            inline
            autoFocus
            caretAtStart={caretAtStart.current}
            initialPoint={fieldPoint.current}
            onChange={onFieldChange}
            onEnter={() => deactivate("after")}
            onExit={() => deactivate("after")}
            onMoveOut={(dir) => deactivate(dir === "backward" ? "before" : "after")}
            onDeleteEmpty={() => deactivate("before")}
          />,
          host,
        )}
    </>
  );
});
