/**
 * Indentation analysis for code blocks — the "your indentation is wrong" pass.
 *
 * Pure text analysis (no CodeMirror, no DOM) so it is unit-testable and can
 * run anywhere; components/CodeBlockView surfaces the result through a
 * CodeMirror linter (see lib/editor/cm.ts).
 *
 * The rules are deliberately conservative — a warning the user disagrees with
 * is worse than a missing one:
 *  - Lines inside multi-line strings, block comments, bracket continuations
 *    and backslash continuations are skipped entirely (indentation there is
 *    free-form, or is part of the data).
 *  - Comment-only and blank lines are skipped: Python's own tokenizer ignores
 *    them when deciding INDENT/DEDENT.
 *  - The indent unit is INFERRED from the code (the most common indent step),
 *    so a 2-space file is not nagged for not being 4-space.
 *  - Structural rules (unexpected indent / bad dedent / missing block) apply
 *    only to Python, where indentation *is* the syntax. Brace languages get
 *    the whitespace-consistency rules only.
 */

export type IndentSeverity = "error" | "warning";

export interface IndentIssue {
  /** 1-based line number. */
  line: number;
  /** Document offsets covering the line's leading whitespace (or the whole
   *  line when it has none), for underlining. */
  from: number;
  to: number;
  severity: IndentSeverity;
  message: string;
}

interface LineInfo {
  num: number;
  start: number;
  end: number;
  text: string;
  /** Leading whitespace. */
  ws: string;
  /** Visual column after the leading whitespace (tabs expand to tab stops). */
  col: number;
  /** Code with any trailing comment removed, trimmed. */
  code: string;
  blank: boolean;
  commentOnly: boolean;
  /** Inside a multi-line string/comment at the START of this line. */
  inMultiline: boolean;
  /** Inside unclosed brackets (or after a `\` continuation) at line start. */
  continuation: boolean;
  /** Unclosed brackets remain at the END of this line. */
  openAtEnd: boolean;
  /** This line ends with a `\` continuation. */
  backslash: boolean;
}

const PY_BLOCK_KEYWORD =
  /^(if|elif|else|for|while|try|except|finally|with|def|class|match|case|async\s+def|async\s+for|async\s+with)\b/;

/** Languages whose indentation carries meaning (structural rules apply). */
const INDENT_SENSITIVE = new Set(["python"]);

/** Expand leading whitespace to a visual column using `unit`-wide tab stops. */
function columnOf(ws: string, unit: number): number {
  let col = 0;
  for (const ch of ws) {
    if (ch === "\t") col += unit - (col % unit) || unit;
    else col += 1;
  }
  return col;
}

/**
 * Scan the source once, classifying each line: what quoting/bracket state it
 * starts in, its indentation, and its code content minus comments.
 */
function scanLines(code: string, langId: string, unit: number): LineInfo[] {
  const py = langId === "python";
  const groupOpen = py ? "([{" : "([";
  const groupClose = py ? ")]}" : ")]";
  const lines: LineInfo[] = [];
  let i = 0;
  let lineNum = 0;
  let depth = 0; // bracket nesting
  let multi: string | null = null; // open ''' / """ / ` / block comment
  let contByBackslash = false;

  while (i <= code.length) {
    const nl = code.indexOf("\n", i);
    const end = nl === -1 ? code.length : nl;
    const text = code.slice(i, end);
    lineNum++;

    const startedInMultiline = multi !== null;
    const startedContinuation = depth > 0 || contByBackslash;

    // ── walk the line, tracking quotes/brackets/comments ──────────────────
    let codeEnd = text.length; // where a trailing line comment starts
    let j = 0;
    let sawCode = false;
    while (j < text.length) {
      const ch = text[j];
      if (multi) {
        if (multi === "*/") {
          if (ch === "*" && text[j + 1] === "/") { multi = null; j += 2; continue; }
        } else if (ch === "\\") {
          // Escapes bind before the closing delimiter: `\"""` does NOT end a
          // Python triple-quoted string (nor does \` end a template literal).
          j += 2;
          continue;
        } else if (text.startsWith(multi, j)) {
          j += multi.length;
          multi = null;
          continue;
        }
        j++;
        continue;
      }
      // comments
      if (py && ch === "#") { codeEnd = j; break; }
      if (!py && ch === "/" && text[j + 1] === "/") { codeEnd = j; break; }
      if (!py && ch === "/" && text[j + 1] === "*") { multi = "*/"; j += 2; sawCode = true; continue; }
      // strings
      if (py && (text.startsWith('"""', j) || text.startsWith("'''", j))) {
        multi = text.slice(j, j + 3);
        j += 3;
        sawCode = true;
        continue;
      }
      if (!py && ch === "`") { multi = "`"; j++; sawCode = true; continue; }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        j++;
        let closed = false;
        while (j < text.length) {
          if (text[j] === "\\") { j += 2; continue; }
          if (text[j] === quote) { j++; closed = true; break; }
          j++;
        }
        // A single-quoted string may span lines via a trailing backslash; keep
        // reading it as a string, or the rest of the block desyncs.
        if (!closed && /\\$/.test(text)) multi = quote;
        sawCode = true;
        continue;
      }
      // Only GROUPING brackets make the next line a free-form continuation.
      // In Python `{}` is a dict/set literal, so it groups; in brace languages
      // it opens a block whose lines are ordinary, indentation-carrying code.
      if (groupOpen.includes(ch)) depth++;
      else if (groupClose.includes(ch)) depth = Math.max(0, depth - 1);
      if (!/\s/.test(ch)) sawCode = true;
      j++;
    }

    const ws = /^[ \t]*/.exec(text)?.[0] ?? "";
    const body = text.slice(0, codeEnd);
    const trimmed = body.trim();
    // A `\` inside a comment is comment text, never a line join — test the
    // comment-stripped body. `multi === null` already excludes a backslash
    // that sits inside a string, so a line that CLOSES a string and then
    // continues with `\` is still recognised as a continuation.
    const backslash = /\\$/.test(body.trimEnd()) && multi === null;
    contByBackslash = backslash;

    lines.push({
      num: lineNum,
      start: i,
      end,
      text,
      ws,
      col: columnOf(ws, unit),
      code: trimmed,
      blank: text.trim() === "",
      commentOnly: !sawCode && text.trim() !== "" && trimmed === "",
      inMultiline: startedInMultiline,
      continuation: startedContinuation,
      openAtEnd: depth > 0 || multi !== null,
      backslash,
    });

    if (nl === -1) break;
    i = nl + 1;
  }
  return lines;
}

/**
 * True when a Python line is a COMPLETE statement that ends its block, so the
 * next line should be typed one level out. CodeMirror's Python grammar has no
 * rule for this (it only dedents when you type `else:`/`except:`…), which is
 * why lib/editor/cm.ts registers an indentService using this predicate.
 *
 * Guarded against continuations: `return (` opens a bracket, and the lines
 * that follow it must keep their own indentation.
 */
export function endsBlockStatement(lineText: string): boolean {
  const code = lineText.replace(/#.*$/, "").trimEnd();
  if (!/^\s*(return|pass|break|continue|raise)\b/.test(code)) return false;
  if (/[\\,:]$/.test(code)) return false;
  let depth = 0;
  for (const ch of code) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
  }
  return depth <= 0;
}

/** The most common positive indent increase among real statement lines. */
function inferUnitFromLines(lines: LineInfo[], fallback: number): number {
  const steps = new Map<number, number>();
  let prev = 0;
  for (const l of lines) {
    if (l.blank || l.inMultiline || l.continuation || l.commentOnly) continue;
    if (l.ws.includes("\t")) return fallback; // tab-indented: nothing to infer
    const col = l.ws.length;
    if (col > prev) steps.set(col - prev, (steps.get(col - prev) ?? 0) + 1);
    prev = col;
  }
  let best = fallback;
  let bestCount = 0;
  for (const [step, count] of steps) {
    if (step > 0 && step <= 8 && count > bestCount) {
      best = step;
      bestCount = count;
    }
  }
  return best;
}

/** The file's own indent step: the most common positive indent increase. */
export function inferIndentUnit(code: string, fallback = 4): number {
  return inferUnitFromLines(scanLines(code, "python", fallback), fallback);
}

/**
 * Find indentation problems. `langId` is a CODE_LANGS id (lib/blocks/codeblock).
 * Returns at most `limit` issues, in document order.
 */
export function analyzeIndentation(
  code: string,
  opts: { langId: string; unit?: number; limit?: number } ,
): IndentIssue[] {
  const langId = opts.langId;
  if (langId === "text" || !code.trim()) return [];
  const limit = opts.limit ?? 20;
  // Scan once to classify lines, then infer the block's indent step from the
  // lines that actually carry indentation meaning — a continuation line inside
  // brackets is aligned to taste and would poison the inference.
  const firstPass = scanLines(code, langId, opts.unit ?? 4);
  const unit = opts.unit ?? inferUnitFromLines(firstPass, 4);
  const lines =
    unit === (opts.unit ?? 4) ? firstPass : scanLines(code, langId, unit); // tab stops depend on the unit
  const issues: IndentIssue[] = [];
  const add = (l: LineInfo, severity: IndentSeverity, message: string) => {
    if (issues.length >= limit) return;
    issues.push({
      line: l.num,
      from: l.start,
      to: l.start + (l.ws.length || Math.max(1, l.text.length)),
      severity,
      message,
    });
  };

  // Which whitespace character does this block INDENT with? Only statement
  // lines vote: continuation lines are commonly space-aligned under an opening
  // bracket even in tab-indented code, and would otherwise outvote the real
  // indentation and get every genuine line flagged.
  const indentative = (l: LineInfo) =>
    !l.blank && !l.inMultiline && !l.continuation && !l.commentOnly && !!l.ws;
  let tabLines = 0;
  let spaceLines = 0;
  for (const l of lines) {
    if (!indentative(l)) continue;
    if (l.ws.includes("\t")) tabLines++;
    if (l.ws.includes(" ")) spaceLines++;
  }
  const dominant: "tab" | "space" | null =
    tabLines && spaceLines ? (tabLines >= spaceLines ? "tab" : "space") : null;

  const structural = INDENT_SENSITIVE.has(langId);
  const stack = [0];
  /** The statement whose `:` opened a block that still needs a body. */
  let expectIndentAfter: LineInfo | null = null;
  /** First physical line of the statement being read (it may span lines). */
  let stmtStart: LineInfo | null = null;

  for (const l of lines) {
    if (l.blank || l.inMultiline) continue;
    if (l.commentOnly) continue; // ignored by Python's tokenizer too

    // Only the FIRST physical line of a statement carries indentation meaning:
    // the rest sit inside brackets or after a `\` and are aligned to taste.
    if (!l.continuation) {
      stmtStart = l;

      // ── whitespace consistency (all languages) ────────────────────────
      if (l.ws.includes("\t") && l.ws.includes(" ")) {
        add(l, "warning", "This line's indentation mixes tabs and spaces — it will not line up everywhere.");
      } else if (dominant && l.ws) {
        const isTab = l.ws.includes("\t");
        if (isTab && dominant === "space") {
          add(l, "warning", "This line is indented with tabs, but the rest of this block uses spaces.");
        } else if (!isTab && dominant === "tab") {
          add(l, "warning", "This line is indented with spaces, but the rest of this block uses tabs.");
        }
      }

      // ── indent step size (all languages) ──────────────────────────────
      if (!l.ws.includes("\t") && l.col % unit !== 0) {
        add(
          l,
          "warning",
          `Indented by ${l.col} space${l.col === 1 ? "" : "s"} — this block indents in steps of ${unit}.`,
        );
      }

      // ── structural rules (indentation-sensitive languages only) ───────
      if (structural) {
        const top = stack[stack.length - 1];
        if (expectIndentAfter) {
          if (l.col > top) {
            stack.push(l.col);
          } else {
            const opener = PY_BLOCK_KEYWORD.exec(expectIndentAfter.code)?.[1] ?? "the previous line";
            add(
              l,
              "error",
              `Expected an indented block after '${opener}' on line ${expectIndentAfter.num}.`,
            );
          }
          expectIndentAfter = null;
        } else if (l.col > top) {
          add(l, "error", "Unexpected indent — nothing on the previous line opens a block.");
          stack.push(l.col); // resync so the rest of the block isn't all flagged
        } else if (l.col < top) {
          while (stack.length > 1 && l.col < stack[stack.length - 1]) stack.pop();
          if (l.col !== stack[stack.length - 1]) {
            add(l, "error", "Unindent does not match any outer indentation level.");
            // Resync WITHOUT destroying the base level: overwriting stack[0]
            // would make a later, perfectly good column-0 line look wrong.
            if (stack.length > 1) stack[stack.length - 1] = l.col;
            else stack.push(l.col);
          }
        }
      }
    }

    // A statement ends where its brackets close and no `\` continues it — that
    // last line is the one whose trailing `:` opens a block, e.g.
    //   def f(\n    a,\n):  ← the colon lives on the closing line
    if (structural && !l.openAtEnd && !l.backslash) {
      expectIndentAfter = /:$/.test(l.code) ? (stmtStart ?? l) : null;
    }
  }

  // NOTE: a block that ENDS on an opener (`if x:` with nothing after it yet) is
  // deliberately not reported. It is incomplete rather than wrong, and it is
  // the state the editor is in every time someone presses Enter after a colon —
  // warning there would fire mid-typing on perfectly good code. A body at the
  // wrong indentation is still caught by the in-loop check above.

  return issues;
}
