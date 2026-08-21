"use client";

import { BlockView } from "@/components/BlockView";
import { ChemField } from "@/components/ChemField";
import { Icon } from "@/components/Icon";
import { Katex } from "@/components/Katex";
import { MathField } from "@/components/MathField";
import { ModuleSlashMenu } from "@/components/ModuleSlashMenu";
import { NoteLinkMenu } from "@/components/NoteLinkMenu";
import { CALLOUT_COLORS, isHexColor } from "@/lib/blocks/callouts";
import { ceInner, wrapCe } from "@/lib/blocks/chem";
import { makeNoteHref } from "@/lib/blocks/notelink";
import { inlineMathSpans, replaceInlineMathSpan } from "@/lib/blocks/source";
import { deleteSavedModule, searchModules, type Module } from "@/lib/templates/modules";
import { getStore } from "@/lib/storage";
import type { NoteMeta } from "@/lib/storage/types";
import type { Block } from "@/lib/blocks/types";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
} from "react";

// ─── Edit box (paragraph/formula) ────────────────────────────────────────────
export interface EditBoxHandle {
  /** Open the inline-math box editor, optionally seeded with a structure. */
  openMath: (seed: string) => void;
  /** Open the inline-chemistry editor, optionally seeded with mhchem source. */
  openChem: (seed: string) => void;
  /** Commit an open inline formula popover, as if Done were pressed. Returns
   *  true if one was open. Lets a click on blank document space close the
   *  formula layer WITHOUT discarding what was typed into it. */
  commitInline: () => boolean;
}
export const EditBox = forwardRef<EditBoxHandle, {
  taRef: RefObject<HTMLTextAreaElement | null>;
  para: boolean;
  draft: string;
  color: string | null;
  previewBlock: Block;
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
  sticky: MutableRefObject<boolean>;
}>(function EditBox(
  { taRef, para, draft, color, previewBlock, onChange, onColor, onExit, onInsertModule, onEditModule, onNoteLink, onInlineEditor, sticky },
  ref,
) {
  const boxRef = useRef<HTMLDivElement>(null);
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
  const spans = para ? inlineMathSpans(draft) : [];

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
  function trackSlashSelect(ta: HTMLTextAreaElement) {
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
  function trackLinkSelect(ta: HTMLTextAreaElement) {
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

  // Open the box editor. `seed` (empty for a blank formula, or a structure like
  // \frac{\placeholder{}}{\placeholder{}} from a toolbar button) pre-fills it.
  const openMath = useCallback((seed: string) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? ta?.value.length ?? 0;
    setSlash(null); // the popover owns the keyboard now
    setLink(null);
    setMathPopover({ mode: "insert", caret, initial: seed });
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
    if (!mathPopover) return false;
    commitMath(mathPopover.chem ? wrapCe(inlineValue.current) : inlineValue.current);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mathPopover]);
  useImperativeHandle(ref, () => ({ openMath, openChem, commitInline }), [openMath, openChem, commitInline]);

  // Mirror the popover's open state to the parent, and report "closed" on
  // unmount so ending the edit can never leave the strip stranded open.
  const inlineKind = mathPopover ? (mathPopover.chem ? "chem" : "math") : null;
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
        const ins = `\\(${latex}\\)`;
        onChange(cur.slice(0, c) + ins + cur.slice(c), c + ins.length);
      }
    } else {
      onChange(replaceInlineMathSpan(cur, pop.index, latex), cur.length);
    }
  }

  function onFocusOut(e: FocusEvent<HTMLDivElement>) {
    if (mathPopover) return; // editing an inline formula in the popover — never exit
    if (boxRef.current && e.relatedTarget && boxRef.current.contains(e.relatedTarget as Node)) return;
    if (sticky.current) { sticky.current = false; return; }
    onExit();
  }

  // Keep Tab inside the box (its default focus-move would blur → exit). Escape
  // commits/leaves. Tab/Shift+Tab indent/outdent prose; in formula mode it only
  // holds focus (a literal tab is meaningless whitespace in LaTeX). Reads the
  // live textarea value, mirroring spliceAtCaret.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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
    if (e.key !== "Tab") return;
    e.preventDefault();
    if (!para) return; // formula: keep focus, don't inject whitespace into LaTeX
    const ta = e.currentTarget;
    const value = ta.value;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
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
    <div ref={boxRef} onBlur={onFocusOut} className="relative rounded-md border border-accent/40 bg-surface p-2">
      {para && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">Box:</span>
          <button onClick={() => onColor(null)} className={`rounded border px-2 py-0.5 text-xs ${color ? "border-border text-muted" : "border-accent text-accent"}`}>None</button>
          {CALLOUT_COLORS.map((c) => (
            <button key={c} onClick={() => onColor(c)} title={c} className="h-6 w-6 rounded" style={{ background: c, outline: color === c ? "2px solid var(--foreground)" : "1px solid rgba(0,0,0,.12)", outlineOffset: "1px" }} />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <input type="color" value={color ?? "#fef3c7"} onChange={(e) => onColor(e.target.value)} title="Custom color (wheel)" className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5" />
          <input type="text" value={hexDraft} onChange={(e) => { const v = e.target.value; setHexDraft(v); if (isHexColor(v)) onColor(v); }} placeholder="#RRGGBB" spellCheck={false} className="w-24 rounded border border-border bg-background px-2 py-0.5 font-mono text-xs outline-none focus:border-accent" />
        </div>
      )}
      {para && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <button onClick={() => openMath("")} title="Insert an inline formula (fill in the boxes)" className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:border-accent"><Icon name="inlineformula" size={14} /> Insert math</button>
          <button onClick={() => openChem("")} title="Insert inline chemistry (type it naturally, e.g. 2H2 + O2 -> 2H2O)" className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:border-accent"><Icon name="flask" size={14} /> Insert chemistry</button>
          {spans.length > 0 && <span className="ml-1 text-xs text-muted">Formulas (click to edit):</span>}
          {spans.map((s, i) => {
            // A pure-\ce span reopens in the chemistry editor (as its source);
            // anything else reopens in the MathLive box. Same stored form either way.
            const chemSrc = ceInner(s.latex);
            return (
              <button key={i} onClick={() => { setSlash(null); setMathPopover(chemSrc != null ? { mode: "edit", index: i, initial: chemSrc, chem: true } : { mode: "edit", index: i, initial: s.latex }); }} title={chemSrc != null ? "Edit this chemistry formula" : "Edit this formula"} className="rounded border border-border px-1.5 py-0.5 hover:border-accent">
                <Katex latex={s.latex.trim() || "\\square"} />
              </button>
            );
          })}
        </div>
      )}
      <textarea
        ref={taRef}
        value={draft}
        spellCheck={para}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const text = e.target.value;
          const caret = e.target.selectionStart ?? 0;
          if (para && onInsertModule) trackSlash(text, caret);
          if (para && onNoteLink) {
            trackLink(text, caret);
            // "[[" completed by a SINGLE typed "[" (never deletions/cuts/pastes
            // that happen to end at "[[", never mid-IME) → inline note menu.
            if (
              !link &&
              text.length === draft.length + 1 &&
              !(e.nativeEvent as InputEvent).isComposing &&
              caret >= 2 && text[caret - 1] === "[" && text[caret - 2] === "[" &&
              (caret < 3 || text[caret - 3] !== "[")
            ) {
              setSlash(null); // "[[" typed into a /query hands the keyboard over
              setLink({ start: caret - 2, query: "" });
              setLinkActive(0);
            }
          }
          onChange(text, caret);
        }}
        onSelect={(e) => { trackSlashSelect(e.currentTarget); trackLinkSelect(e.currentTarget); }}
        rows={para ? Math.max(2, draft.split("\n").length) : 2}
        placeholder={para ? "Type text… **bold**, *italic*, ƒ for a formula, / for a module, [[ to link a note" : "LaTeX, e.g. \\frac{a}{b}"}
        className="w-full resize-none bg-transparent font-mono text-sm outline-none"
      />
      {/* pointer-events-none: like every other preview surface — a note link
          here must not pop hover cards or navigate away mid-edit. */}
      <div className="pointer-events-none mt-2 border-t border-border pt-2">
        {draft.trim() ? <BlockView block={previewBlock} /> : <span className="text-xs text-muted">preview</span>}
      </div>
      {mathPopover && (() => {
        // Key by target: retargeting the popover (clicking another chip while
        // it is open) must REMOUNT it, or the editor's `latest` ref would keep
        // the previous target's content and Done would write it into the newly
        // selected span.
        const key = `${mathPopover.chem ? "c" : "m"}:${mathPopover.mode === "edit" ? `e${mathPopover.index}` : `i${mathPopover.caret}`}`;
        return mathPopover.chem ? (
          <InlineChemPopover
            key={key}
            initial={mathPopover.initial}
            onCommit={commitMath}
            onCancel={() => setMathPopover(null)}
            onValue={(v) => { inlineValue.current = v; }}
          />
        ) : (
          <InlineMathPopover
            key={key}
            initial={mathPopover.initial}
            onCommit={commitMath}
            onCancel={() => setMathPopover(null)}
            onValue={(v) => { inlineValue.current = v; }}
          />
        );
      })()}
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

// ─── Inline-chemistry popover — the chemistry twin of InlineMathPopover. ──────
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

// ─── Inline-math popover (Desmos-style editor for a formula inside prose) ─────
function InlineMathPopover({ initial, onCommit, onCancel, onValue }: {
  initial: string;
  onCommit: (latex: string) => void;
  onCancel: () => void;
  /** Report the live draft so the parent can commit it from outside. */
  onValue?: (v: string) => void;
}) {
  const latest = useRef(initial);
  useEffect(() => { onValue?.(initial); }, [initial, onValue]);
  return (
    <div className="absolute left-2 right-2 top-full z-30 mt-1 rounded-md border border-accent bg-surface p-2 shadow-lg">
      <MathField value={initial} inline autoFocus onChange={(l) => { latest.current = l; onValue?.(l); }} onExit={onCancel} className="block min-h-[2.25rem] rounded border border-border bg-background px-2 py-1 text-base" />
      <div className="mt-2 flex justify-end gap-2">
        <button onMouseDown={(e) => e.preventDefault()} onClick={onCancel} className="rounded border border-border px-2.5 py-1 text-xs text-muted hover:border-accent">Cancel</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => onCommit(latest.current)} className="rounded bg-accent px-3 py-1 text-xs font-medium text-white">Done</button>
      </div>
    </div>
  );
}
