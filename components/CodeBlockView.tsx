"use client";

/**
 * CodeBlockView — a runnable code LISTING inside the document.
 *
 *                                              ▶  ⋯   ← controls, never printed
 *   │ for i in range(3):                             CodeMirror (lazy import)
 *   │     print(i)
 *   → 0 1 2                                          outputs (print with note)
 *   PYTHON · RUN 2                                   caption
 *
 * The page is a typeset A4 document in Computer Modern where nothing else is
 * boxed, so this block is deliberately NOT a card: one hairline rule marks the
 * code the way a blockquote marks a quote (it takes the accent while the caret
 * is inside), the result hangs off a `→`, and the language/run counter live in
 * a caption like a figure's. No header bar, no line-number gutter — which also
 * makes the on-screen form match what the LaTeX export prints.
 *
 * Jupyter semantics: Shift/⌘-Enter runs on the note's per-language kernel
 * (variables persist across this note's blocks — lib/run/manager.ts). While a
 * run streams, output lives in transient kernel state; the bounded final
 * outputs are committed to attrs once, and the transient state is then dropped
 * so the document is the single source of truth (that is what makes "Clear
 * output", undo and collab visible). Read-only viewers may run code locally —
 * their commit is a no-op, so their transient state is kept instead.
 *
 * Document-level focus interplay comes for free: CodeMirror's contentEditable
 * root keeps native ⌘Z routing (EditorClient's undo handler exempts editable
 * elements), and the block row has no competing selection handlers.
 */

import { Icon } from "@/components/Icon";
import { CodeOutputs } from "@/components/CodeOutputs";
import {
  CODE_LANGS,
  codeExecCount,
  codeLangInfo,
  codeOutputs,
  codeSource,
  withCodeLang,
  withCodeOutputsCleared,
  withCodeRun,
  withCodeSource,
  type CodeLangInfo,
} from "@/lib/blocks/codeblock";
import type { Block } from "@/lib/blocks/types";
import {
  cancelPending,
  clearRunState,
  getKernelStatus,
  getRunState,
  restartKernel,
  runCode,
  subscribeKernel,
  subscribeRunState,
} from "@/lib/run/manager";
import type { CodeEditor } from "@/lib/editor/cm";
import type { IndentIssue } from "@/lib/editor/indent";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Caret/focus carried across a remount — repagination moves a block to
 *  another page element, which React can only do by unmounting it. */
const carryOver = new Map<string, { anchor: number; head: number; focused: boolean }>();

export function CodeBlockView({
  block,
  noteId,
  readOnly,
  onChange,
}: {
  block: Block;
  noteId: string;
  readOnly: boolean;
  /** Commit a block transform through the editor's mutation funnel
   *  (undo/autosave/collab). `coalesce` merges keystroke bursts. */
  onChange: (fn: (b: Block) => Block, coalesce?: boolean) => void;
}) {
  const lang = codeLangInfo(block);
  const source = codeSource(block);

  // ── live kernel/run state (transient, outside the tree) ──────────────────
  const runState = useSyncExternalStore(
    (fn) => subscribeRunState(noteId, block.id, fn),
    () => getRunState(noteId, block.id),
    () => null,
  );
  const family = lang.kernel;
  const kernelStatus = useSyncExternalStore(
    (fn) => (family ? subscribeKernel(noteId, family, fn) : () => {}),
    () => (family ? getKernelStatus(noteId, family) : "off"),
    () => "off" as const,
  );
  const running = runState?.phase === "running";
  const queued = runState?.phase === "queued";

  // ── CodeMirror mount (lazy) ───────────────────────────────────────────────
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditor | null>(null);
  const lastDocRef = useRef(source);
  /** True while a programmatic dispatch is applying an external change, so the
   *  resulting update is not echoed back into the document as a fresh edit. */
  const applyingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [issues, setIssues] = useState<IndentIssue[]>([]);

  // Refs so the editor's stable callbacks always see the current props.
  const blockRef = useRef(block);
  blockRef.current = block;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const runRef = useRef<() => boolean>(() => false);

  useEffect(() => {
    let disposed = false;
    const blockId = blockRef.current.id;
    const carried = carryOver.get(blockId);
    carryOver.delete(blockId);
    void import("@/lib/editor/cm").then(({ createCodeEditor }) => {
      if (disposed || !hostRef.current) return;
      const editor = createCodeEditor({
        parent: hostRef.current,
        doc: lastDocRef.current,
        language: codeLangInfo(blockRef.current).cm,
        langId: codeLangInfo(blockRef.current).id,
        placeholder: placeholderFor(codeLangInfo(blockRef.current)),
        readOnly,
        onIssues: setIssues,
        selection: carried ? { anchor: carried.anchor, head: carried.head } : undefined,
        autofocus: carried?.focused,
        onChange: (doc) => {
          if (applyingRef.current) return; // external change, already in the tree
          lastDocRef.current = doc;
          onChangeRef.current((b) => withCodeSource(b, doc), true);
        },
        onRun: () => runRef.current(),
      });
      editorRef.current = editor;
      setReady(true);
    });
    return () => {
      disposed = true;
      const editor = editorRef.current;
      if (editor) {
        const sel = editor.view.state.selection.main;
        carryOver.set(blockId, {
          anchor: sel.anchor,
          head: sel.head,
          focused: editor.view.hasFocus,
        });
        editor.destroy();
      }
      editorRef.current = null;
    };
    // Mount once per block; language/readOnly changes reconfigure below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  // External source changes (undo, collab, restore) → replace the CM doc.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || source === lastDocRef.current) return;
    lastDocRef.current = source;
    applyingRef.current = true;
    try {
      editor.view.dispatch({
        changes: { from: 0, to: editor.view.state.doc.length, insert: source },
      });
    } finally {
      applyingRef.current = false;
    }
  }, [source, ready]);

  useEffect(() => {
    editorRef.current?.setLanguage(lang.cm, lang.id);
    editorRef.current?.setPlaceholder(placeholderFor(lang));
  }, [lang, ready]);
  useEffect(() => {
    editorRef.current?.setReadOnly(readOnly);
  }, [readOnly, ready]);

  // ── actions ───────────────────────────────────────────────────────────────
  const run = (): boolean => {
    const b = blockRef.current;
    const info = codeLangInfo(b);
    if (!info.kernel) return false; // let the key insert a newline instead
    const code = editorRef.current?.view.state.doc.toString() ?? codeSource(b);
    if (!code.trim()) return true;
    const startedLang = info.id;
    runCode(noteId, info.kernel, b.id, code, (outputs, execCount) => {
      // The language may have changed while the run was in flight; its outputs
      // belong to the old language, so drop them rather than mis-tagging them.
      if (codeLangInfo(blockRef.current).id !== startedLang) {
        clearRunState(noteId, b.id, execCount);
        return;
      }
      onChangeRef.current((blk) => withCodeRun(blk, outputs, execCount));
      // Editable notes: the commit landed, so let attrs drive the UI again.
      // Viewers can't persist, so their transient outputs must stay.
      if (!readOnly) clearRunState(noteId, b.id, execCount);
    });
    return true;
  };
  runRef.current = run;

  const stop = () => {
    if (family) restartKernel(noteId, family);
  };

  const [menu, setMenu] = useState<null | "lang" | "more">(null);
  const pickLang = (l: CodeLangInfo) => {
    setMenu(null);
    if (l.id === lang.id) return;
    if (family) cancelPending(noteId, family, block.id);
    clearRunState(noteId, block.id);
    onChange((b) => withCodeLang(b, l.id));
    editorRef.current?.setLanguage(l.cm);
  };
  const clearOutput = () => {
    setMenu(null);
    clearRunState(noteId, block.id);
    onChange((b) => withCodeOutputsCleared(b));
  };
  const reindent = () => {
    setMenu(null);
    editorRef.current?.reindent();
  };
  /** Jump the caret to the first badly-indented line (clicking the chip). */
  const goToFirstIssue = () => {
    const editor = editorRef.current;
    const first = issues[0];
    if (!editor || !first) return;
    const pos = Math.min(first.from, editor.view.state.doc.length);
    editor.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    editor.view.focus();
  };

  // ── header widgets ────────────────────────────────────────────────────────
  const persisted = codeOutputs(block);
  const execCount = runState && runState.phase !== "queued" ? runState.execCount : codeExecCount(block);
  const outputs = runState ? runState.outputs : persisted;
  const booting = running && kernelStatus === "starting";

  const status = !family ? null : queued ? (
    <span className="text-[11px] text-muted">Queued…</span>
  ) : booting ? (
    <span className="flex items-center gap-1.5 text-[11px] text-warning">
      <span className="h-3 w-3 animate-spin rounded-full border border-warning border-t-transparent" />
      Loading {lang.label}…
    </span>
  ) : running ? (
    <span className="flex items-center gap-1.5 text-[11px] text-accent">
      <span className="h-3 w-3 animate-spin rounded-full border border-accent border-t-transparent" />
      Running
    </span>
  ) : null;

  const menuPanel = "absolute top-full z-40 mt-1 rounded-md border border-border bg-surface p-1 text-sm shadow-lg";
  const quietIcon = "grid h-6 w-6 place-items-center rounded text-muted hover:bg-foreground/[0.05] hover:text-foreground";

  return (
    // A listing, not a pane: one hairline rule marks the code the way a
    // blockquote marks a quote, and it picks up the accent while you edit.
    <div className="relative my-1">
      {/* Controls — small, borderless, out of the text column. Never printed. */}
      <div className="print-hide absolute -top-0.5 right-0 z-10 flex items-center gap-0.5">
        {status}
        {family &&
          (running || queued ? (
            <button onClick={stop} title="Stop — terminates the kernel (variables are discarded)" aria-label="Stop run" className="grid h-6 w-6 place-items-center rounded text-danger hover:bg-danger-soft">
              <Icon name="stop" size={13} />
            </button>
          ) : (
            <button onClick={run} title="Run (Shift+⏎ or ⌘+⏎)" aria-label="Run code" className="grid h-6 w-6 place-items-center rounded text-accent hover:bg-accent-soft">
              <Icon name="play" size={14} />
            </button>
          ))}
        <div className="relative">
          <button
            onClick={() => setMenu(menu === "more" ? null : "more")}
            title="Code block options"
            aria-label="Code block options"
            aria-expanded={menu === "more"}
            className={quietIcon}
          >
            <Icon name="more" size={14} />
          </button>
          {menu === "more" && (
            <>
              <button className="fixed inset-0 z-30 cursor-default" aria-hidden tabIndex={-1} onClick={() => setMenu(null)} />
              <div className={`${menuPanel} right-0 w-52`}>
                <button
                  onClick={() => { setMenu(null); void navigator.clipboard?.writeText(editorRef.current?.view.state.doc.toString() ?? source); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
                >
                  <Icon name="copy" size={14} />Copy code
                </button>
                {!readOnly && (
                  <button onClick={reindent} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06]" title="Re-indent every line using this language's rules">
                    <Icon name="indent" size={14} />Fix indentation
                  </button>
                )}
                {!readOnly && (
                  <button onClick={clearOutput} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06]">
                    <Icon name="trash" size={14} />Clear output
                  </button>
                )}
                {family && (
                  <button
                    onClick={() => { setMenu(null); stop(); }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
                    title="Discard this note's kernel session — variables reset, the next run starts fresh"
                  >
                    <Icon name="restart" size={14} />Restart kernel
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* The listing itself. */}
      <div className="border-l-2 border-border pl-4 transition-colors has-[.cm-focused]:border-accent/60">
        <div ref={hostRef} className="min-h-[20px]">
          {!ready && (
            <pre className="overflow-x-auto font-mono text-[12.5px] leading-[1.62]">{source || " "}</pre>
          )}
        </div>
      </div>

      <CodeOutputs outputs={outputs} />

      {/* Caption — language, run counter, warnings. Reads like a figure's. */}
      <div className="mt-1.5 flex items-center gap-2 pl-4 text-[10.5px] uppercase tracking-[0.07em] text-muted">
        <div className="relative">
          {readOnly ? (
            <span>{lang.label}</span>
          ) : (
            <button
              onClick={() => setMenu(menu === "lang" ? null : "lang")}
              title="Code language"
              aria-label="Code language"
              aria-expanded={menu === "lang"}
              className="rounded hover:text-foreground"
            >
              {lang.label}
            </button>
          )}
          {menu === "lang" && (
            <>
              <button className="fixed inset-0 z-30 cursor-default" aria-hidden tabIndex={-1} onClick={() => setMenu(null)} />
              <div className={`${menuPanel} left-0 max-h-72 w-44 overflow-y-auto normal-case tracking-normal`}>
                {CODE_LANGS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => pickLang(l)}
                    className={`flex w-full items-center rounded px-2 py-1 text-left hover:bg-foreground/[0.06] ${l.id === lang.id ? "text-accent" : ""}`}
                  >
                    <span className="flex-1">{l.label}</span>
                    {l.kernel && <span className="text-[10px] uppercase tracking-wide text-muted">runs</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {execCount > 0 && !running && !queued && <span title="Run counter (this kernel session)">· Run {execCount}</span>}
        {issues.length > 0 && !running && !queued && (
          <button
            onClick={goToFirstIssue}
            title={`${issues[0].message}${issues.length > 1 ? `\n(+${issues.length - 1} more — hover the marked lines for details)` : ""}`}
            className={`print-hide flex items-center gap-1 ${issues.some((i) => i.severity === "error") ? "text-danger" : "text-warning"}`}
          >
            <Icon name="warning" size={11} />
            {issues.length === 1 ? "Check indentation" : `${issues.length} indentation issues`}
          </button>
        )}
      </div>
    </div>
  );
}


function placeholderFor(lang: CodeLangInfo): string {
  return lang.kernel ? "Write code — Shift⏎ runs" : "Write code…";
}
