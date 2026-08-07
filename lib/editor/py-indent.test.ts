/**
 * The Python dedent rule is consulted by BOTH the Enter key and the whole-block
 * "Fix indentation" command. An indent service that answers in the second case
 * silently rewrites correct code, so these tests drive the real CodeMirror
 * indentation machinery (EditorState only — no DOM needed).
 */

import { IndentContext, getIndentation, indentRange, indentUnit } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { pythonDedentService } from "./py-indent";

const stateOf = (doc: string) =>
  EditorState.create({ doc, extensions: [indentUnit.of("    "), pythonDedentService(), python()] });

/** What "Fix indentation" (⋯ menu) would produce. */
const reindent = (doc: string) => {
  const state = stateOf(doc);
  return indentRange(state, 0, state.doc.length).apply(state.doc).toString();
};

describe("Fix indentation never breaks correct Python", () => {
  const untouched: Record<string, string> = {
    "return inside a nested block": "def f(x):\n    if x:\n        return 1\n    return 0\n",
    "continue inside a loop": "for i in r:\n    if i:\n        continue\n    print(i)\n",
    "pass in a class body": "class A:\n    def f(self):\n        pass\n\n    def g(self):\n        return 1\n",
    "raise then more code": "def f():\n    if bad:\n        raise ValueError('x')\n    return 1\n",
    "break in a while": "while True:\n    if done:\n        break\n    step()\n",
    "docstring containing statements": 'def f():\n    """\n    return 1\n    """\n    return 2\n',
    "try/except with returns": "def f():\n    try:\n        return g()\n    except ValueError:\n        return None\n",
  };
  for (const [name, doc] of Object.entries(untouched)) {
    it(name, () => expect(reindent(doc)).toBe(doc));
  }

  it("still repairs genuinely broken indentation", () => {
    expect(reindent("def f():\n            return 1\n")).toBe("def f():\n    return 1\n");
  });
});

describe("the dedent rule applies when a new line is opened", () => {
  /** The indentation Enter would give a fresh line after `at` — exactly what
   *  insertNewlineAndIndent computes (a simulated break, no document edit). */
  const indentAfter = (doc: string, at = doc.length) => {
    const state = stateOf(doc);
    return getIndentation(new IndentContext(state, { simulateBreak: at }), at);
  };

  it("steps out after return", () => {
    expect(indentAfter("def f(x):\n    if x:\n        return 1")).toBe(4);
  });
  it("steps out after pass, break, continue and raise", () => {
    expect(indentAfter("for i in r:\n    if i:\n        continue")).toBe(4);
    expect(indentAfter("while 1:\n    if x:\n        break")).toBe(4);
    expect(indentAfter("class A:\n    def f(self):\n        pass")).toBe(4);
    expect(indentAfter("def f():\n    if x:\n        raise ValueError('x')")).toBe(4);
  });
  it("keeps the level after an ordinary statement", () => {
    expect(indentAfter("def f(x):\n    y = 1")).toBe(4);
  });
  it("indents after a block opener", () => {
    expect(indentAfter("def f(x):")).toBe(4);
    expect(indentAfter("def f(x):\n    if x:")).toBe(8);
  });
  it("does not dedent below the top level", () => {
    expect(indentAfter("return 1")).toBe(0);
  });
  it("dedents by the block's own step in a 2-space cell", () => {
    expect(indentAfter("def f(x):\n  if x:\n    return 1")).toBe(2);
  });
  it("leaves prose inside a docstring alone", () => {
    // The caret sits inside the string, where "return 1" is text, not code.
    const doc = 'def f():\n    """\n    return 1';
    expect(indentAfter(doc)).not.toBe(0);
  });
});
