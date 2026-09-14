"use client";

import { setActiveFormulaOpener, setActiveTextInserter } from "@/components/MathField";
import { RichLine, type LineHandle } from "@/components/RichLine";
import { listItems, listLevels, listOrdered, listRows, MAX_LIST_LEVEL, normalizeLevels } from "@/lib/blocks/lists";
import type { Block } from "@/lib/blocks/types";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

/**
 * A list edited as a list.
 *
 * Not a textarea of lines in a box with a preview underneath: the real `<ul>` /
 * `<ol>` markers are on screen, and each item is its own auto-growing line you
 * type straight into. Enter makes the next item, Enter on an empty one leaves
 * the list (as every document app does), Backspace at the start of an item joins
 * it to the one above, and the arrows walk off the ends into the neighbouring
 * blocks — so a list is part of the document rather than a widget inside it.
 *
 * Nesting is Google Docs': Tab at the start of an item nests it under the one
 * above, Shift+Tab lifts it out from anywhere in it (as do ⌘] and ⌘[), and
 * Enter or Backspace on a nested item steps it out a level before either would
 * leave the list or join two items.
 */
export function ListEditor({ block, focusItem, focusOffset, onItems, onOrdered, onExit, onLeave, onSplitOut, onInlineEditor, onFrontBack }: {
  block: Block;
  /** Which item to put the caret in when the editor opens (clicked item). */
  focusItem: number | null;
  /** Where in that item the caret opens; the end when absent. */
  focusOffset?: number | null;
  /** New item texts and their levels, plus which item holds the caret after. */
  onItems: (items: string[], caret: number, levels: number[]) => void;
  onOrdered: (ordered: boolean) => void;
  onExit: () => void;
  /** An arrow key off the top/bottom: hand the caret to the next block. */
  onLeave: (dir: -1 | 1) => boolean;
  /** Enter on an empty top-level item: end the list here. `before` is what this
   *  list keeps, `trailing` what carries on in a second list under the paragraph. */
  onSplitOut: (before: string[], beforeLevels: number[], trailing: string[], trailingLevels: number[]) => void;
  /** A formula opened or closed in an item (drives the symbol strip). */
  onInlineEditor?: (kind: "math" | "chem" | null) => void;
  /** Backspace at the very front of the first item: its words go up onto the
   *  line before the list (an empty first item is deleted like a blank line). */
  onFrontBack?: () => void;
}) {
  const items = listItems(block);
  const levels = listLevels(block);
  const rows = listRows(block);
  const ordered = listOrdered(block);
  // Each item is a RichLine: words, with its formulas as boxes in them.
  const refs = useRef<(LineHandle | null)[]>([]);
  /** Where to put the caret after the next render: [item, offset]. Seeded with
   *  the clicked item so the editor opens there — clamped, because an index
   *  from a previous list would otherwise point past the end of this one and
   *  leave the editor with no caret at all. */
  const pending = useRef<[number, number] | null>([
    Math.min(Math.max(focusItem ?? 0, 0), Math.max(0, items.length - 1)),
    focusOffset ?? Number.MAX_SAFE_INTEGER,
  ]);

  // Move the caret ONLY when an edit asked for it. Doing this on every render
  // would drag the caret back to the first item whenever anything else in the
  // editor re-rendered — which is to say, while typing.
  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    pending.current = null;
    const el = refs.current[want[0]];
    if (!el) return;
    el.focus();
    const at = Math.min(want[1], el.value.length);
    el.setSelectionRange(at, at);
  });

  /** The item the caret was last in — the insert target when the toolbar has
   *  taken focus for a moment and `document.activeElement` is not an item. */
  const focused = useRef(0);
  const liveItem = (): number => {
    const i = refs.current.findIndex((h) => !!h?.el && h.el.contains(document.activeElement));
    return i >= 0 ? i : focused.current;
  };

  // Which item has a formula open, if any: the symbol strip follows it.
  const [mathIn, setMathIn] = useState<number | null>(null);
  const mathOpen = mathIn !== null;
  useEffect(() => { onInlineEditor?.(mathOpen ? "math" : null); }, [mathOpen, onInlineEditor]);
  useEffect(() => () => onInlineEditor?.(null), [onInlineEditor]);

  /** Report an edit, levels kept in step with the items they belong to. */
  const emit = (nextItems: string[], caret: number, nextLevels: number[]) =>
    onItems(nextItems, caret, normalizeLevels(nextLevels, nextItems.length));

  /**
   * While this list is open it IS the document's insert target: the symbol
   * strip and the formula button land in the item holding the caret, exactly
   * as they do in a paragraph — as a formula box in the item, never as a block
   * underneath the list.
   *
   * Re-registered on every render (no dep array), not once on focus: the
   * closure has to see the CURRENT items, and a one-shot registration is undone
   * by React's development double-invoke, which runs the cleanup after the
   * focus that armed it.
   */
  useEffect(() => {
    setActiveTextInserter((text, caretInText) => {
      const i = liveItem();
      const el = refs.current[i];
      if (!el) return;
      el.leaveFormula();
      const from = el.selectionStart;
      const to = el.selectionEnd;
      const next = el.value.slice(0, from) + text + el.value.slice(to);
      pending.current = [i, from + (caretInText ?? text.length)];
      emit(items.map((it, n) => (n === i ? next : it)), i, levels);
    });
    setActiveFormulaOpener((seed) => { refs.current[liveItem()]?.openFormula(seed); });
    // A list that unmounts (Escape, a press on another line) must not stay the
    // target — the next insert would write into an item that is gone.
    return () => { setActiveTextInserter(null); setActiveFormulaOpener(null); };
  });

  const change = (i: number, text: string) => {
    // No pending caret: the line has the caret exactly where the keystroke left
    // it, and re-setting it would fight an IME mid-composition.
    emit(items.map((it, n) => (n === i ? text : it)), i, levels);
  };

  /** Nest (+1) or lift (-1) item `i` one level, as far as the outline allows:
   *  never deeper than one level under the item above. False when it can't move. */
  function shift(i: number, delta: 1 | -1, el: LineHandle): boolean {
    const cap = i === 0 ? 0 : Math.min(levels[i - 1] + 1, MAX_LIST_LEVEL);
    const want = Math.max(0, Math.min(levels[i] + delta, cap));
    if (want === levels[i]) return false;
    pending.current = [i, el.selectionStart];
    emit(items, i, levels.map((l, n) => (n === i ? want : l)));
    return true;
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>, i: number) {
    const el = refs.current[i];
    if (!el) return;
    const at = el.selectionStart;
    const end = el.selectionEnd;
    const collapsed = at === end;
    if (e.key === "Escape") { e.preventDefault(); onExit(); return; }
    if (e.nativeEvent.isComposing) return;

    // ⌘] / ⌘[ (Ctrl on Windows): Docs' increase / decrease indent, from
    // anywhere in the item.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "]" || e.key === "[")) {
      e.preventDefault();
      shift(i, e.key === "]" ? 1 : -1, el);
      return;
    }
    // Shift+Tab lifts the item wherever the caret is. Tab nests it from the
    // start of the item; in the middle of the text it types a tab, which stops
    // on the same half-inch grid. Tab never leaves the list.
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) { shift(i, -1, el); return; }
      if (at === 0) { shift(i, 1, el); return; }
      const next = el.value.slice(0, at) + "\t" + el.value.slice(end);
      pending.current = [i, at + 1];
      emit(items.map((it, n) => (n === i ? next : it)), i, levels);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (el.value.trim() === "") {
        // Enter on an EMPTY item: a nested one steps out a level, and a
        // top-level one means "I'm done listing" — the items before it stay,
        // the items after it carry on in a second list, and the caret lands in
        // a paragraph between them.
        if (levels[i] > 0) { shift(i, -1, el); return; }
        onSplitOut(items.slice(0, i), levels.slice(0, i), items.slice(i + 1), levels.slice(i + 1));
        return;
      }
      const before = el.value.slice(0, at);
      const after = el.value.slice(end);
      pending.current = [i + 1, 0];
      // The new item is a sibling: it starts at the level of the one split.
      emit([...items.slice(0, i), before, after, ...items.slice(i + 1)], i + 1, [...levels.slice(0, i + 1), levels[i], ...levels.slice(i + 1)]);
      return;
    }
    if (!collapsed) return;
    if (e.key === "Backspace" && at === 0) {
      e.preventDefault();
      // A nested item loses its indent before its text joins anything.
      if (levels[i] > 0) { shift(i, -1, el); return; }
      if (i === 0) { onFrontBack?.(); return; } // the top of the list: out to the line before
      const head = items[i - 1];
      pending.current = [i - 1, head.length];
      emit([...items.slice(0, i - 1), head + el.value, ...items.slice(i + 1)], i - 1, [...levels.slice(0, i), ...levels.slice(i + 1)]);
      return;
    }
    if (e.key === "Delete" && at === el.value.length && i < items.length - 1) {
      e.preventDefault();
      pending.current = [i, el.value.length];
      emit([...items.slice(0, i), el.value + items[i + 1], ...items.slice(i + 2)], i, [...levels.slice(0, i + 1), ...levels.slice(i + 2)]);
      return;
    }
    const up = e.key === "ArrowUp" || (e.key === "ArrowLeft" && at === 0);
    const down = e.key === "ArrowDown" || (e.key === "ArrowRight" && at === el.value.length);
    if (up && i > 0) { e.preventDefault(); pending.current = [i - 1, Number.MAX_SAFE_INTEGER]; refs.current[i - 1]?.focus(); return; }
    if (down && i < items.length - 1) { e.preventDefault(); pending.current = [i + 1, 0]; refs.current[i + 1]?.focus(); return; }
    if (up && i === 0 && onLeave(-1)) { e.preventDefault(); return; }
    if (down && i === items.length - 1 && onLeave(1)) { e.preventDefault(); }
  }

  const List = ordered ? "ol" : "ul";
  return (
    <div className="group/edit relative">
      <List className="aq-list aq-list-editor space-y-0.5 leading-relaxed">
        {rows.map((row) => (
          <li key={row.index} style={{ "--lvl": row.level } as CSSProperties}>
            <span aria-hidden className="aq-list-marker">{row.marker}</span>
            <RichLine
              ref={(h) => { refs.current[row.index] = h; }}
              value={row.text}
              spellCheck
              onChange={(text) => change(row.index, text)}
              onKeyDown={(e) => onKey(e, row.index)}
              onFocus={() => { focused.current = row.index; }}
              onInlineEditor={(kind) => setMathIn((cur) => (kind ? row.index : cur === row.index ? null : cur))}
              className="block w-full whitespace-pre-wrap break-words bg-transparent p-0 text-foreground caret-accent outline-none"
              style={{ minHeight: "1.2em" }}
            />
          </li>
        ))}
      </List>
      {/* The marker style lives out of the text's way, like the heading's. */}
      <div className="print-hide absolute -top-7 right-0 z-20 hidden items-center gap-2 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted shadow-sm group-hover/edit:flex">
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => onOrdered(false)} className={ordered ? "hover:text-foreground" : "text-accent"}>Bulleted</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => onOrdered(true)} className={ordered ? "text-accent" : "hover:text-foreground"}>Numbered</button>
      </div>
    </div>
  );
}
