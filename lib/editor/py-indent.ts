/**
 * Python's missing dedent rule, as a CodeMirror indent service.
 *
 * CodeMirror's Python grammar indents after a `:` but never steps back out
 * after a statement that ends its block, so pressing Enter under `return x`
 * leaves the caret inside the block it just left.
 *
 * Kept out of lib/editor/cm.ts (which pulls in @codemirror/view and therefore
 * needs a DOM) so the behaviour can be unit-tested headlessly — this rule is
 * consulted by "Fix indentation" as well as by Enter, and getting that wrong
 * silently rewrites the user's code.
 */

import { indentService, syntaxTree } from "@codemirror/language";
import { countColumn, type Extension } from "@codemirror/state";

import { endsBlockStatement, inferIndentUnit } from "./indent";

export function pythonDedentService(): Extension {
  return indentService.of((cx, pos) => {
    // ONLY while a line break is being simulated, i.e. the Enter key. An
    // indent service is also consulted by `indentRange` ("Fix indentation"),
    // where there is no break and `cx.lineAt(pos, -1)` is the line being
    // indented rather than the one above it — acting there would dedent every
    // `return` in the block and turn correct Python into a SyntaxError.
    if (cx.simulatedBreak == null) return undefined;
    // Inside a docstring or comment, "return x" is prose, not a statement.
    const node = syntaxTree(cx.state).resolveInner(pos, -1).name;
    if (/String|Comment/.test(node)) return undefined;
    const line = cx.lineAt(pos, -1); // what will remain above the break
    if (!endsBlockStatement(line.text)) return undefined; // defer to the grammar
    const ws = /^[ \t]*/.exec(line.text)?.[0] ?? "";
    // Step out by the block's OWN indent step, not the editor default, so a
    // 2-space cell dedents by 2 instead of overshooting to column 0.
    const step = inferIndentUnit(cx.state.doc.toString(), cx.unit);
    return Math.max(0, countColumn(ws, cx.state.tabSize) - step);
  });
}
