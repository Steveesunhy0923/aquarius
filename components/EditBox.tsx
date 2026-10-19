"use client";

import { ChemField } from "@/components/ChemField";
import { Icon } from "@/components/Icon";
import { RichLine, type LineHandle } from "@/components/RichLine";
import { ModuleSlashMenu } from "@/components/ModuleSlashMenu";
import { NoteLinkMenu } from "@/components/NoteLinkMenu";
import { CALLOUT_COLORS, isHexColor } from "@/lib/blocks/callouts";
import { indentCss } from "@/lib/blocks/indent";
import { listTrigger } from "@/lib/blocks/lists";
import { wrapCe } from "@/lib/blocks/chem";
import { makeNoteHref } from "@/lib/blocks/notelink";
import { replaceInlineMathSpan } from "@/lib/blocks/source";
import { deleteSavedModule, searchModules, type Module } from "@/lib/templates/modules";
import { getStore } from "@/lib/storage";
import type { NoteMeta } from "@/lib/storage/types";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

// ─── In-place paragraph editor ───────────────────────────────────────────────
//
// A paragraph is edited WHERE IT SITS: the line (a RichLine) carries the document's own
// type, indent and width, with no border, no preview pane and no button rows, so
// clicking a sentence puts a caret in it instead of opening a box under it (the
// caret lands on the clicked character — see lib/editor/caret.ts). Enter starts
// the next paragraph, Shift+Enter keeps a line break inside this one, and
// Backspace in an empty paragraph steps back into the one above.
//
// Maths is typed, not dialogued: `$x^2$` inline, `$$…$$` for an equation of its
// own (lib/blocks/source.ts). The line is a RichLine: the words are words and
// each formula is a tiny box in them — rendered maths, or the MathLive field
// once the caret goes in — with no dollar signs on screen.
export interface EditBoxHandle {
  /** Open a formula box at the caret (over any selection, which seeds it when
   *  `seed` is empty), optionally seeded with a structure. */
  openMath: (seed: string) => void;
  /** Open the inline-chemistry editor, optionally seeded with mhchem source. */
  openChem: (seed: string) => void;
  /** Close an open inline formula (box or chemistry popover), keeping what was
   *  typed into it. Returns true if one was open. Lets a click on blank document space close the
   *  formula layer WITHOUT discarding what was typed into it. */
  commitInline: () => boolean;
}
export const EditBox = forwardRef<EditBoxHandle, {
  taRef: RefObject<LineHandle | null>;
  para: boolean;
  draft: string;
  color: string | null;
  onChange: (text: string, caret: number) => void;
  onColor: (c: string | null) => void;
  onExit: () => void;
  /** Insert a module (a Block[] section) after this block — enables the `/` menu.
   *  `cleanedDraft` is the draft with the `/query` removed; the parent commits
   *  it and splices the module in ONE tree update (a single undo step). */
  onInsertModule?: (m: Module, cleanedDraft: string) => void;
  /** Open the module builder on a saved module (pencil in the `/` menu).
   *  Like onInsertModule, `cleanedDraft` is the draft minus the `/query` — the
   *  parent commits it (or drops the paragraph) and ends the edit itself. */
  onEditModule?: (m: Module, cleanedDraft: string) => void;
  /** The inline `[[query` menu's "browse" escape hatch: open the full note-link
   *  picker; [from,to) is the `[[query` range the parent replaces with the
   *  picked link. (Typing `[[` itself opens the inline menu, not the picker.) */
  onNoteLink?: (from: number, to: number) => void;
  /** Reports which inline formula editor is open ("math" | "chem"), or null.
   *  The symbol strip is contextual — it follows a formula caret — and an inline
   *  formula inside a PARAGRAPH is a formula caret even though the block is
   *  still a text block. Without this signal the strip stays hidden and the
   *  popover's own promise ("the toolbar & Σ symbols insert here too") is a lie. */
  onInlineEditor?: (kind: "math" | "chem" | null) => void;
  /** Enter: commit `before` into this block and start a new paragraph holding
   *  `after`, with the caret at its start. */
  onSplit?: (before: string, after: string) => void;
  /** Backspace at the very start of an empty paragraph: drop it and put the
   *  caret back at the end of the block above. */
  onBackOut?: () => void;
  /** An arrow key that ran off the top/bottom (or either end) of this block:
   *  carry the caret into the neighbouring one. Returns true if it went. */
  onStep?: (dir: -1 | 1, edge: "start" | "end") => boolean;
  /** Backspace at the start of a paragraph that still has text: join it onto
   *  the block above. Delete at the end: pull the next one up. */
  onMerge?: (dir: -1 | 1, text: string) => void;
  /** This paragraph's indent, in steps (lib/blocks/indent.ts). */
  indent?: number;
  /** Move the whole paragraph one indent step in (+1) or out (-1). False when
   *  it is already as far as it goes. */
  onIndent?: (delta: 1 | -1) => boolean;
  /** "- " or "1. " typed at the start of the paragraph: make it a list item
   *  holding `rest` (lib/blocks/lists → listTrigger). */
  onAutoList?: (ordered: boolean, rest: string) => void;
}>(function EditBox(
  { taRef, para, draft, color, onChange, onColor, onExit, onInsertModule, onEditModule, onNoteLink, onInlineEditor, onSplit, onBackOut, onStep, onMerge, indent = 0, onIndent, onAutoList },
  ref,
) {
  // The fill strip belongs to the older solid-fill callout (lib/blocks/callouts,
  // the poster designs' banners), so it shows only on a paragraph that already
  // has a fill. Coloured boxes are made from the top bar (components/BoxMenu).
  const [showColors, setShowColors] = useState(false);
  useEffect(() => { if (color) setShowColors(true); }, [color]);
  // A formula open in the line (RichLine reports it): the symbol strip follows.
  const [inlineMath, setInlineMath] = useState(false);
  /** Buttons around the text must not steal the caret out of it. */
  const keepCaret = (e: { preventDefault: () => void }) => e.preventDefault();
  const [hexDraft, setHexDraft] = useState(color ?? "");
  useEffect(() => setHexDraft(color ?? ""), [color]);

  // Inline-math: a small MathLive popover for building/editing a formula inside
  // prose without typing \(…\). Edits go through the SOURCE STRING (the nth
  // \(…\) span) so the existing commit→paragraphFromSource round-trip is the one
  // source of truth. `initial` seeds the box (a structure picked from the
  // toolbar, or the existing formula being edited); `caret` is where a new
  // formula will be spliced. `chem` swaps the MathLive box for the chemistry
  // editor (initial is then mhchem source; the commit re-wraps it in \ce{...},
  // so the span itself stays ordinary inline math).
  const [mathPopover, setMathPopover] = useState<
    | { mode: "insert"; caret: number; initial: string; chem?: boolean }
    | { mode: "edit"; index: number; initial: string; chem?: boolean }
    | null
  >(null);

  // Slash-insert: typing "/" at a word start opens a fuzzy-filtered module menu
  // below the box; the query is the text between the "/" and the caret. The
  // textarea keeps focus — arrows/Enter/Escape are intercepted in onKeyDown.
  const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
  const [slashActive, setSlashActive] = useState(0);
  const [modulesRev, setModulesRev] = useState(0); // bumped when a saved module is deleted
  const slashMatches = useMemo(
    () => (slash ? searchModules(slash.query) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slash, modulesRev],
  );

  /** Track the slash state across a text change (open, refine, or dismiss). */
  function trackSlash(text: string, caret: number) {
    if (slash) {
      const q = text.slice(slash.start + 1, caret);
      if (caret <= slash.start || text[slash.start] !== "/" || q.includes("\n")) setSlash(null);
      else {
        setSlash({ start: slash.start, query: q });
        setSlashActive(0);
      }
      return;
    }
    // Opens only for a "/" just typed at the start of a word (never mid-URL),
    // and never while the note-link menu owns the keyboard.
    if (!link && caret > 0 && text[caret - 1] === "/" && (caret === 1 || /\s/.test(text[caret - 2]))) {
      setSlash({ start: caret - 1, query: "" });
      setSlashActive(0);
    }
  }

  // A programmatic draft mutation (toolbar bold/link, Tab indent) bypasses
  // trackSlash; if the recorded "/query" no longer matches the text, dismiss —
  // otherwise a later pick would splice the wrong range.
  useEffect(() => {
    if (!slash) return;
    if (draft[slash.start] !== "/" || draft.slice(slash.start + 1, slash.start + 1 + slash.query.length) !== slash.query) {
      setSlash(null);
    }
  }, [draft, slash]);

  /** Caret-only moves (arrows, Home/End, clicks) don't fire onChange — re-derive
   *  the query from the new caret, or dismiss when the caret leaves the run. */
  function trackSlashSelect(ta: LineHandle) {
    if (!slash) return;
    const caret = ta.selectionStart ?? 0;
    if (ta.selectionEnd !== caret || caret <= slash.start || ta.value[slash.start] !== "/") { setSlash(null); return; }
    const q = ta.value.slice(slash.start + 1, caret);
    if (q.includes("\n")) { setSlash(null); return; }
    if (q !== slash.query) {
      setSlash({ start: slash.start, query: q });
      setSlashActive(0);
    }
  }

  // Note-link autocomplete: typing "[[" opens an inline note search below the
  // box; the query is the text between the "[[" and the caret. Same machine
  // shape as the slash menu; `linkActive` ranges over results + the final
  // "browse" row (which falls back to the full NoteLinkPicker).
  const [link, setLink] = useState<{ start: number; query: string } | null>(null);
  const [linkActive, setLinkActive] = useState(0);
  const [linkNotes, setLinkNotes] = useState<NoteMeta[]>([]);
  const linkQuery = link ? link.query : null;

  // Async results: recents for an empty query, debounced search otherwise.
  useEffect(() => {
    if (linkQuery === null) return;
    let alive = true;
    const q = linkQuery.trim();
    const t = setTimeout(() => {
      const fetching = q
        ? getStore().searchNotes(q).then((r) => {
            const seen = new Set<string>();
            return [...r.title, ...r.content].filter((n) => !seen.has(n.id) && seen.add(n.id));
          })
        : getStore().listRecentNotes(6);
      fetching
        .then((list) => { if (alive) setLinkNotes(list.slice(0, 6)); })
        .catch(() => { if (alive) setLinkNotes([]); });
    }, q ? 150 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [linkQuery]);

  /** Track the link state across a text change (refine or dismiss; opening
   *  happens in onChange where "a single typed `[`" can be verified). */
  function trackLink(text: string, caret: number) {
    if (!link) return;
    const q = text.slice(link.start + 2, caret);
    if (caret < link.start + 2 || text.slice(link.start, link.start + 2) !== "[[" || q.includes("\n") || q.includes("]")) {
      setLink(null);
    } else if (q !== link.query) {
      setLink({ start: link.start, query: q });
      setLinkActive(0);
    }
  }

  // Dismiss after a programmatic draft mutation desyncs the recorded range
  // (same guard as the slash menu).
  useEffect(() => {
    if (!link) return;
    if (draft.slice(link.start, link.start + 2) !== "[[" || draft.slice(link.start + 2, link.start + 2 + link.query.length) !== link.query) {
      setLink(null);
    }
  }, [draft, link]);

  /** Caret-only moves: re-derive the query or dismiss when leaving the run. */
  function trackLinkSelect(ta: LineHandle) {
    if (!link) return;
    const caret = ta.selectionStart ?? 0;
    if (ta.selectionEnd !== caret || caret < link.start + 2 || ta.value.slice(link.start, link.start + 2) !== "[[") { setLink(null); return; }
    const q = ta.value.slice(link.start + 2, caret);
    if (q.includes("\n") || q.includes("]")) { setLink(null); return; }
    if (q !== link.query) {
      setLink({ start: link.start, query: q });
      setLinkActive(0);
    }
  }

  /** Splice `[title](note://id)` over the verified `[[query` range. */
  function pickNote(n: NoteMeta) {
    if (!link) return;
    const cur = taRef.current?.value ?? draft;
    const end = link.start + 2 + link.query.length;
    if (cur.slice(link.start, link.start + 2) !== "[[" || cur.slice(link.start + 2, end) !== link.query) { setLink(null); return; }
    // Square brackets and inline-math delimiters would break the [text](url) marker.
    const label = (n.title || "Untitled").replace(/\\[()]/g, "").replace(/[[\]]/g, "").trim() || "note";
    const marker = `[${label}](${makeNoteHref(n.id)})`;
    const pos = link.start + marker.length;
    setLink(null);
    onChange(cur.slice(0, link.start) + marker + cur.slice(end), pos);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) { ta.focus(); try { ta.setSelectionRange(pos, pos); } catch { /* noop */ } }
    });
  }

  /** The menu's last row: hand the `[[query` range to the full picker. */
  function browseNotes() {
    if (!link) return;
    const { start, query } = link;
    setLink(null);
    onNoteLink?.(start, start + 2 + query.length);
  }

  /** Hand the module + the draft-without-`/query` to the page (one tree update). */
  function pickModule(m: Module) {
    if (!slash) return;
    const cur = taRef.current?.value ?? draft;
    const end = slash.start + 1 + slash.query.length;
    // Never splice a range that isn't verifiably the "/query" run.
    if (cur[slash.start] !== "/" || cur.slice(slash.start + 1, end) !== slash.query) { setSlash(null); return; }
    const cleaned = cur.slice(0, slash.start) + cur.slice(end);
    setSlash(null);
    onInsertModule?.(m, cleaned);
  }

  /** Remove a saved (custom) module from the menu in place. */
  function removeSavedModule(m: Module) {
    deleteSavedModule(m.id);
    setModulesRev((v) => v + 1);
    setSlashActive(0);
  }

  /** Pencil on a saved module: hand the page the draft minus the `/query` and
   *  close the menu — the page commits it, ends the edit, opens the builder. */
  function editSavedModule(m: Module) {
    if (!slash) return;
    const cur = taRef.current?.value ?? draft;
    const end = slash.start + 1 + slash.query.length;
    const clean = cur[slash.start] === "/" && cur.slice(slash.start + 1, end) === slash.query;
    setSlash(null);
    onEditModule?.(m, clean ? cur.slice(0, slash.start) + cur.slice(end) : cur);
  }

  // Open a formula box at the caret: blank (the formula button), a structure
  // to fill (\frac{\placeholder{}}{\placeholder{}} from the strip), or a plain
  // symbol, which is placed as a finished formula with the words carrying on.
  const openMath = useCallback((seed: string) => {
    setSlash(null); // a formula owns the keyboard now
    setLink(null);
    taRef.current?.openFormula(seed);
  }, [taRef]);
  const openChem = useCallback((seed: string) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? ta?.value.length ?? 0;
    setSlash(null);
    setLink(null);
    setMathPopover({ mode: "insert", caret, initial: seed, chem: true });
  }, [taRef]);
  // The popovers own their draft; mirror it here so commitInline (a blank-space
  // click) can commit the same value Done would.
  const inlineValue = useRef("");
  const commitInline = useCallback(() => {
    // A formula open in the line: keep what it holds, caret after it.
    if (taRef.current?.leaveFormula()) return true;
    if (!mathPopover) return false;
    commitMath(mathPopover.chem ? wrapCe(inlineValue.current) : inlineValue.current);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mathPopover, taRef]);
  useImperativeHandle(ref, () => ({ openMath, openChem, commitInline }), [openMath, openChem, commitInline]);

  // Mirror the popover's open state to the parent, and report "closed" on
  // unmount so ending the edit can never leave the strip stranded open.
  const inlineKind = inlineMath ? "math" : mathPopover ? (mathPopover.chem ? "chem" : "math") : null;
  useEffect(() => {
    onInlineEditor?.(inlineKind);
  }, [inlineKind, onInlineEditor]);
  useEffect(() => () => onInlineEditor?.(null), [onInlineEditor]);

  function commitMath(latex: string) {
    // Read the popover state directly (NOT via a setState updater): calling the
    // parent's onChange inside an updater runs it during render and trips
    // React's setState-in-render warning.
    const pop = mathPopover;
    if (!pop) return;
    setMathPopover(null);
    const cur = taRef.current?.value ?? draft; // live source (popover doesn't touch the textarea)
    if (pop.mode === "insert") {
      if (latex.trim()) {
        const c = Math.min(pop.caret, cur.length);
        const ins = `$${latex}$`;
        onChange(cur.slice(0, c) + ins + cur.slice(c), c + ins.length);
      }
    } else {
      onChange(replaceInlineMathSpan(cur, pop.index, latex), cur.length);
    }
  }

  /** Words typed in the line: list autoformat, the `/` and `[[` menus, then the
   *  commit. (A formula's own edits skip all three.) */
  function onTyped(text: string, caret: number) {
    // Google Docs' list autoformat: a bullet ("- ", "* ") or "1. " typed at the
    // start of the paragraph makes it a list item, its existing text and all.
    // Only a single typed space completes it — never a paste or a deletion.
    if (para && onAutoList && text.length === draft.length + 1 && text[caret - 1] === " ") {
      const hit = listTrigger(text, caret);
      if (hit) { onAutoList(hit.ordered, hit.rest); return; }
    }
    if (para && onInsertModule) trackSlash(text, caret);
    if (para && onNoteLink) {
      trackLink(text, caret);
      // "[[" completed by a SINGLE typed "[" (never deletions/cuts/pastes that
      // happen to end at "[[") → inline note menu.
      if (
        !link &&
        text.length === draft.length + 1 &&
        caret >= 2 && text[caret - 1] === "[" && text[caret - 2] === "[" &&
        (caret < 3 || text[caret - 3] !== "[")
      ) {
        setSlash(null); // "[[" typed into a /query hands the keyboard over
        setLink({ start: caret - 2, query: "" });
        setLinkActive(0);
      }
    }
    onChange(text, caret);
  }

  // Keep Tab inside the box (its default focus-move would blur → exit). Escape
  // commits/leaves. Tab/Shift+Tab indent/outdent prose; in formula mode it only
  // holds focus (a literal tab is meaningless whitespace in LaTeX). Reads the
  // live textarea value, mirroring spliceAtCaret.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Note-link menu open: it owns the navigation keys the same way the slash
    // menu does below. `linkActive` includes the trailing "browse" row.
    if (link && !mathPopover && !e.nativeEvent.isComposing) {
      const last = linkNotes.length; // index of the browse row
      if (e.key === "Escape") { e.preventDefault(); setLink(null); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setLinkActive((a) => Math.min(a + 1, last)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setLinkActive((a) => Math.max(a - 1, 0)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = Math.min(linkActive, last);
        if (idx < linkNotes.length) pickNote(linkNotes[idx]);
        else browseNotes();
        return;
      }
    }
    // Slash menu open: it owns the navigation keys (Escape closes the MENU, not
    // the block editor — the branch below must run before the exit handling).
    // Skipped while the math popover is up (it owns the keyboard) and during an
    // IME composition (Enter/arrows there confirm/navigate the composition).
    if (slash && !mathPopover && !e.nativeEvent.isComposing) {
      if (e.key === "Escape") { e.preventDefault(); setSlash(null); return; }
      if (e.key === "ArrowDown" && slashMatches.length > 0) { e.preventDefault(); setSlashActive((a) => Math.min(a + 1, slashMatches.length - 1)); return; }
      if (e.key === "ArrowUp" && slashMatches.length > 0) { e.preventDefault(); setSlashActive((a) => Math.max(a - 1, 0)); return; }
      if (e.key === "Enter" && slashMatches.length > 0) {
        e.preventDefault();
        pickModule(slashMatches[Math.min(slashActive, slashMatches.length - 1)]);
        return;
      }
    }
    if (e.key === "Escape") { e.preventDefault(); onExit(); return; }
    // ⌘] / ⌘[ (Ctrl on Windows): Docs' increase / decrease indent. They move
    // the whole paragraph from wherever the caret is.
    if (para && onIndent && (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "]" || e.key === "[")) {
      e.preventDefault();
      onIndent(e.key === "]" ? 1 : -1);
      return;
    }
    // Enter starts the next paragraph, the way clicking the line below does —
    // one block per paragraph is what the outline, pagination and section moves
    // all work in. Shift+Enter keeps a soft line break inside this one.
    if (e.key === "Enter" && para && onSplit && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const ta = taRef.current!;
      const at = ta.selectionStart ?? ta.value.length;
      const to = ta.selectionEnd ?? at;
      onSplit(ta.value.slice(0, at), ta.value.slice(to));
      return;
    }
    // The caret walks out of a block the way it walks along a line: Up/Down from
    // the first/last line, Left/Right off either end. Without this, every block
    // is a keyboard dead end and the document reads as a stack of boxes.
    if (para && !e.nativeEvent.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const ta = taRef.current!;
      const at = ta.selectionStart ?? 0;
      const collapsed = at === (ta.selectionEnd ?? at);
      const firstLine = ta.value.lastIndexOf("\n", at - 1) === -1;
      const lastLine = ta.value.indexOf("\n", at) === -1;
      // Backspace at the very start of an indented paragraph takes a step of
      // indent off first, as in Docs — before it would join the paragraph
      // above or remove an empty one.
      if (collapsed && at === 0 && e.key === "Backspace" && indent > 0 && onIndent?.(-1)) {
        e.preventDefault();
        return;
      }
      if (collapsed && onStep) {
        if ((e.key === "ArrowUp" && firstLine) || (e.key === "ArrowLeft" && at === 0)) {
          if (onStep(-1, "end")) { e.preventDefault(); return; }
        }
        if ((e.key === "ArrowDown" && lastLine) || (e.key === "ArrowRight" && at === ta.value.length)) {
          if (onStep(1, "start")) { e.preventDefault(); return; }
        }
      }
      // Backspace/Delete at the seam join the two paragraphs, as in any
      // document app — the block boundary is not a wall.
      if (collapsed && onMerge && ta.value !== "") {
        if (e.key === "Backspace" && at === 0) { e.preventDefault(); onMerge(-1, ta.value); return; }
        if (e.key === "Delete" && at === ta.value.length) { e.preventDefault(); onMerge(1, ta.value); return; }
      }
    }
    // Backspace with nothing left to delete: leave the empty paragraph behind
    // and carry on editing the one above, rather than sitting in a dead block.
    if (e.key === "Backspace" && para && onBackOut && !e.nativeEvent.isComposing) {
      const ta = taRef.current!;
      if (ta.value === "" || (ta.selectionStart === 0 && ta.selectionEnd === 0 && ta.value.trim() === "")) {
        e.preventDefault();
        onBackOut();
        return;
      }
    }
    if (e.key !== "Tab") return;
    e.preventDefault();
    if (!para) return; // formula: keep focus, don't inject whitespace into LaTeX
    const ta = taRef.current!;
    const value = ta.value;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    // Google Docs: Tab at the START of a paragraph, or over a selection that
    // spans its lines, indents the whole paragraph a step, and Shift+Tab takes
    // a step off from anywhere in it. Only a Tab in the middle of a line types
    // a tab character, and that stops on the same half-inch grid. Shift+Tab in
    // a paragraph with no indent left still strips a typed leading tab (below).
    if (onIndent) {
      if (e.shiftKey) {
        if (onIndent(-1)) return;
      } else if (start === 0 || value.slice(start, end).includes("\n")) {
        onIndent(1);
        return;
      }
    }
    const restore = (s: number, en: number) =>
      requestAnimationFrame(() => { try { ta.setSelectionRange(s, en); } catch { /* noop */ } });
    const outdent = (line: string): number =>
      line.startsWith("\t") ? 1 : line.startsWith("  ") ? 2 : line.startsWith(" ") ? 1 : 0;

    // Multi-line selection → indent/outdent every line it touches (never replace).
    if (value.slice(start, end).includes("\n")) {
      const from = value.lastIndexOf("\n", start - 1) + 1;
      const lines = value.slice(from, end).split("\n");
      let firstDelta = 0;
      let totalDelta = 0;
      const out = lines.map((line, i) => {
        // A selection ending on a line boundary yields a trailing "" = the next
        // line; leave it untouched.
        if (i === lines.length - 1 && line === "") return line;
        const delta = e.shiftKey ? -outdent(line) : 1;
        if (i === 0) firstDelta = delta;
        totalDelta += delta;
        return e.shiftKey ? line.slice(-delta) : "\t" + line;
      });
      if (totalDelta === 0) return; // nothing to outdent
      const next = value.slice(0, from) + out.join("\n") + value.slice(end);
      onChange(next, end + totalDelta);
      restore(Math.max(from, start + firstDelta), end + totalDelta);
      return;
    }

    // Single line: outdent the line, or insert a tab at the caret.
    if (e.shiftKey) {
      const from = value.lastIndexOf("\n", start - 1) + 1;
      const drop = outdent(value.slice(from));
      if (!drop) return;
      const pos = Math.max(from, start - drop);
      onChange(value.slice(0, from) + value.slice(from + drop), pos);
      restore(pos, pos);
      return;
    }
    const pos = start + 1;
    onChange(value.slice(0, start) + "\t" + value.slice(end), pos);
    restore(pos, pos);
  }

  return (
    // The indent moves the whole paragraph, the colour strip and popovers with it.
    <div className="group/edit relative" style={para && indent > 0 ? { marginLeft: indentCss(indent) } : undefined}>
      {para && showColors && (
        <div className="absolute -top-9 right-0 z-20 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 shadow-md">
          <span className="mr-1 text-xs text-muted">Fill:</span>
          <button onClick={() => onColor(null)} className={`rounded border px-2 py-0.5 text-xs ${color ? "border-border text-muted" : "border-accent text-accent"}`}>None</button>
          {CALLOUT_COLORS.map((c) => (
            <button key={c} onClick={() => onColor(c)} title={c} className="h-6 w-6 rounded" style={{ background: c, outline: color === c ? "2px solid var(--foreground)" : "1px solid rgba(0,0,0,.12)", outlineOffset: "1px" }} />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <input type="color" value={color ?? "#fef3c7"} onChange={(e) => onColor(e.target.value)} title="Custom color (wheel)" className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5" />
          <input type="text" value={hexDraft} onChange={(e) => { const v = e.target.value; setHexDraft(v); if (isHexColor(v)) onColor(v); }} placeholder="#RRGGBB" spellCheck={false} className="w-24 rounded border border-border bg-background px-2 py-0.5 font-mono text-xs outline-none focus:border-accent" />
          <button onMouseDown={keepCaret} onClick={() => setShowColors(false)} title="Close" aria-label="Close the fill colours" className="ml-1 text-muted hover:text-foreground"><Icon name="close" size={12} /></button>
        </div>
      )}
      <RichLine
        ref={taRef}
        value={draft}
        spellCheck
        onKeyDown={onKeyDown}
        onChange={(text, caret, typed) => (typed ? onTyped(text, caret) : onChange(text, caret))}
        onSelectionChange={() => { const ta = taRef.current; if (ta) { trackSlashSelect(ta); trackLinkSelect(ta); } }}
        onInlineEditor={(kind) => setInlineMath(kind === "math")}
        onChemChip={(index, inner) => { setSlash(null); setLink(null); setMathPopover({ mode: "edit", index, initial: inner, chem: true }); }}
        // Typed like the paragraph it replaces (aq-para carries the document
        // preset's indent), no border, no surface: the point is that nothing
        // moves or changes when you click into it.
        className="aq-para block w-full whitespace-pre-wrap break-words bg-transparent p-0 text-foreground caret-accent outline-none"
        style={{ minHeight: "1.2em" }}
      />
      {mathPopover?.chem && (
        // Key by target: retargeting the popover must REMOUNT it, or its
        // `latest` ref would keep the previous target's content.
        <InlineChemPopover
          key={mathPopover.mode === "edit" ? `e${mathPopover.index}` : `i${mathPopover.caret}`}
          initial={mathPopover.initial}
          onCommit={commitMath}
          onCancel={() => setMathPopover(null)}
          onValue={(v) => { inlineValue.current = v; }}
        />
      )}
      {slash && !mathPopover && !link && (
        <ModuleSlashMenu
          query={slash.query}
          modules={slashMatches}
          active={Math.min(slashActive, Math.max(0, slashMatches.length - 1))}
          onHover={setSlashActive}
          onPick={pickModule}
          onEdit={onEditModule ? editSavedModule : undefined}
          onDelete={removeSavedModule}
        />
      )}
      {link && !mathPopover && (
        <NoteLinkMenu
          query={link.query}
          notes={linkNotes}
          active={Math.min(linkActive, linkNotes.length)}
          onHover={setLinkActive}
          onPick={pickNote}
          onBrowse={browseNotes}
        />
      )}
    </div>
  );
});

// ─── Inline-chemistry popover — chemistry inside prose (maths uses RichLine). ────
// `initial` is mhchem source; Done commits the \ce-wrapped LaTeX through the
// same commitMath path, so the span in the paragraph stays ordinary inline math.
function InlineChemPopover({ initial, onCommit, onCancel, onValue }: {
  initial: string;
  onCommit: (latex: string) => void;
  onCancel: () => void;
  /** Report the live draft so the parent can commit it from outside. */
  onValue?: (v: string) => void;
}) {
  const latest = useRef(initial);
  useEffect(() => { onValue?.(initial); }, [initial, onValue]);
  const done = () => onCommit(wrapCe(latest.current));
  return (
    <div className="absolute left-2 right-2 top-full z-30 mt-1 rounded-md border border-accent bg-surface p-2 shadow-lg">
      <ChemField value={initial} autoFocus onChange={(s) => { latest.current = s; onValue?.(s); }} onExit={onCancel} onEnter={done} className="block" />
      <div className="mt-2 flex justify-end gap-2">
        <button onMouseDown={(e) => e.preventDefault()} onClick={onCancel} className="rounded border border-border px-2.5 py-1 text-xs text-muted hover:border-accent">Cancel</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={done} className="rounded bg-accent px-3 py-1 text-xs font-medium text-white">Done</button>
      </div>
    </div>
  );
}
