/**
 * CodeMirror 6 setup for the code block's mini IDE (components/CodeBlockView).
 *
 * This module is loaded via dynamic import() from CodeBlockView so CodeMirror
 * stays out of the editor's main bundle until a note actually shows a code
 * block. It exports one factory that wires the pieces the mini IDE needs:
 * highlighting themed by the app's --code-* tokens (light/dark for free),
 * per-language support lazy-loaded through @codemirror/language-data, and
 * Run-on-Shift/Mod-Enter.
 *
 * Everything visual is expressed in design tokens, including the popup
 * surfaces (autocomplete/tooltips) — CodeMirror's built-in light/dark base
 * themes are class-switched at construction time and would not follow the
 * app's runtime theme toggle.
 */

import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  LanguageDescription,
  bracketMatching,
  indentOnInput,
  indentRange,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { linter, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, countColumn } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  placeholder as cmPlaceholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { analyzeIndentation, type IndentIssue } from "./indent";
import { pythonDedentService } from "./py-indent";

/** Syntax colors come from the design tokens so dark mode & print just work. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: "var(--code-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--code-string)" },
  { tag: [t.number, t.bool, t.atom, t.null], color: "var(--code-number)" },
  { tag: [t.comment, t.meta], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: "var(--code-func)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--code-func)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--foreground)" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--muted)" },
]);

/**
 * The editor is a LISTING inside a document, not an IDE pane: no gutters, no
 * background, no chrome of its own. The block (components/CodeBlockView) draws
 * the single hairline rule that marks it, and the code starts at the document's
 * own text column so it lines up with the prose around it.
 */
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "12.5px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.62",
    maxHeight: "480px",
  },
  ".cm-content": { padding: "0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-gutters": { display: "none" },
  // Popups: token-driven so they stay legible under the app's theme toggle
  // (CM's own cm-light/cm-dark base styling is fixed at construction).
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-control, 8px)",
    boxShadow: "var(--shadow-popover, 0 8px 24px -6px rgba(20,20,45,.16))",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "12px",
    maxHeight: "12em",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { color: "var(--foreground)", padding: "2px 6px" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--accent)",
  },
  ".cm-completionMatchedText": { color: "var(--accent)", textDecoration: "none", fontWeight: "600" },
  ".cm-completionIcon": { color: "var(--muted)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--foreground)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--accent-soft)",
    color: "inherit",
  },
  // Lint (indentation warnings): the built-in styles are hard-coded colors.
  // With no gutter, the underline plus the block's caption carry the signal.
  ".cm-lintRange-error": { backgroundImage: "none", borderBottom: "2px dotted var(--danger)" },
  ".cm-lintRange-warning": { backgroundImage: "none", borderBottom: "2px dotted var(--warning)" },
  ".cm-tooltip-lint .cm-diagnostic": {
    fontFamily: "inherit",
    fontSize: "12px",
    padding: "6px 8px",
    borderLeft: "3px solid var(--warning)",
  },
  ".cm-tooltip-lint .cm-diagnostic-error": { borderLeftColor: "var(--danger)" },
  ".cm-diagnosticAction": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--accent)",
    borderRadius: "4px",
    marginLeft: "6px",
    padding: "1px 5px",
  },
});

/**
 * Indentation-aware line wrapping: a wrapped line's continuation is padded to
 * its own indentation, so nested code stays visually aligned instead of
 * snapping back to column 0. `padding-left` shifts the whole line right and a
 * matching negative `text-indent` pulls only the first row back, which is the
 * standard CM6 recipe (`ch` units are exact because the editor is monospace).
 */
const alignWrappedLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildIndentDecos(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.geometryChanged) {
        this.decorations = buildIndentDecos(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** One shared Decoration per indent column — a fresh object per line would
 *  defeat the view's decoration diffing and redraw every line on each edit. */
const indentDecoCache = new Map<number, Decoration>();
const MAX_HANG = 24; // don't push wrapped text off a narrow editor

function indentDeco(cols: number): Decoration {
  let deco = indentDecoCache.get(cols);
  if (!deco) {
    deco = Decoration.line({
      attributes: { style: `padding-left:${cols}ch; text-indent:-${cols}ch` },
    });
    indentDecoCache.set(cols, deco);
  }
  return deco;
}

function buildIndentDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tabSize = view.state.tabSize;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const ws = /^[ \t]*/.exec(line.text)?.[0] ?? "";
      if (ws.length && ws.length < line.text.length) {
        const cols = Math.min(countColumn(ws, tabSize), MAX_HANG);
        if (cols > 0) builder.add(line.from, line.from, indentDeco(cols));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** Python's missing dedent-after-`return` rule (lib/editor/py-indent.ts). */
const pythonDedent = pythonDedentService();

export interface CodeEditor {
  view: EditorView;
  /** Swap the language (async — grammars lazy-load per language). */
  setLanguage(cmName: string | null, langId?: string): void;
  setReadOnly(readOnly: boolean): void;
  setPlaceholder(text: string): void;
  /** Re-indent the whole block with the language's indentation rules. */
  reindent(): void;
  destroy(): void;
}

export interface CodeEditorOptions {
  parent: HTMLElement;
  doc: string;
  /** @codemirror/language-data name (CodeLangInfo.cm), null = plain text. */
  language: string | null;
  /** CODE_LANGS id — drives the indentation checker (lib/editor/indent.ts). */
  langId: string;
  placeholder?: string;
  /** Called after each indentation check with the current issues. */
  onIssues?: (issues: IndentIssue[]) => void;
  readOnly?: boolean;
  /** Restored across a remount (repagination moves the block between pages). */
  selection?: { anchor: number; head: number };
  autofocus?: boolean;
  onChange: (doc: string) => void;
  /** Shift+Enter / Mod+Enter. Return false when the block can't run, so the
   *  key falls through to inserting a newline instead of dying silently. */
  onRun: () => boolean;
}

export function createCodeEditor(opts: CodeEditorOptions): CodeEditor {
  const langCompartment = new Compartment();
  const roCompartment = new Compartment();
  const phCompartment = new Compartment();

  const run = () => opts.onRun();

  const docLen = opts.doc.length;
  const clamp = (n: number) => Math.max(0, Math.min(docLen, n));

  // Indentation check → lint diagnostics (squiggle + gutter dot + hover fix).
  let langId = opts.langId;
  const indentLinter = linter(
    (v) => {
      // The unit is inferred from the block's own code, so a 2-space cell is
      // not measured against the editor's 4-space default.
      const issues = analyzeIndentation(v.state.doc.toString(), { langId });
      opts.onIssues?.(issues);
      // Viewers of a shared note can't persist an edit, so don't offer a fix
      // that would silently desync their editor from the saved document.
      const fixable = !v.state.readOnly;
      return issues.map(
        (issue): Diagnostic => ({
          from: issue.from,
          to: Math.max(issue.to, issue.from + 1),
          severity: issue.severity,
          message: issue.message,
          source: "indentation",
          actions: fixable
            ? [
                {
                  name: "Fix",
                  apply(view, from) {
                    const line = view.state.doc.lineAt(from);
                    view.dispatch({
                      changes: indentRange(view.state, line.from, line.to),
                      userEvent: "format",
                    });
                  },
                },
              ]
            : undefined,
        }),
      );
    },
    { delay: 400 },
  );

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.doc,
      selection: opts.selection
        ? EditorSelection.single(clamp(opts.selection.anchor), clamp(opts.selection.head))
        : undefined,
      extensions: [
        // Run bindings first so they beat insertNewline in defaultKeymap.
        keymap.of([
          { key: "Shift-Enter", run },
          { key: "Mod-Enter", run },
          { key: "Escape", run: (v) => (v.contentDOM.blur(), true) },
        ]),
        history(),
        indentUnit.of("    "),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
        phCompartment.of(cmPlaceholder(opts.placeholder ?? "Write code…")),
        theme,
        syntaxHighlighting(highlight, { fallback: true }),
        langCompartment.of([]),
        roCompartment.of(readOnlyExt(opts.readOnly ?? false)),
        indentLinter,
        EditorView.lineWrapping,
        alignWrappedLines,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
  if (opts.autofocus) view.focus();

  let langToken = 0;
  const setLanguage = (cmName: string | null, nextLangId?: string) => {
    if (nextLangId) langId = nextLangId;
    const token = ++langToken;
    // Python's own indentation rules never dedent after `return`; ours do.
    const extras = langId === "python" ? [pythonDedent] : [];
    const desc = cmName ? LanguageDescription.matchLanguageName(languages, cmName, true) : null;
    if (!desc) {
      view.dispatch({ effects: langCompartment.reconfigure(extras) });
      return;
    }
    void desc.load().then((support) => {
      if (token !== langToken) return; // language changed again meanwhile
      view.dispatch({ effects: langCompartment.reconfigure([extras, support]) });
    });
  };
  setLanguage(opts.language);

  return {
    view,
    setLanguage,
    setReadOnly(readOnly: boolean) {
      view.dispatch({ effects: roCompartment.reconfigure(readOnlyExt(readOnly)) });
    },
    setPlaceholder(text: string) {
      view.dispatch({ effects: phCompartment.reconfigure(cmPlaceholder(text)) });
    },
    reindent() {
      if (view.state.readOnly) return;
      const changes = indentRange(view.state, 0, view.state.doc.length);
      if (changes.empty) return;
      view.dispatch({ changes, userEvent: "format" });
    },
    destroy() {
      langToken++;
      view.destroy();
    },
  };
}

function readOnlyExt(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}
