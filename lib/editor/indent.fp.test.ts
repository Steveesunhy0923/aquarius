/**
 * False-positive sweep. The indentation checker's whole value rests on staying
 * quiet about correct code, so this file feeds it a corpus of valid snippets —
 * plus real source files from node_modules — and asserts it says NOTHING.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { analyzeIndentation } from "./indent";

const py = (code: string) => analyzeIndentation(code, { langId: "python" });
const show = (code: string, langId = "python") =>
  analyzeIndentation(code, { langId, limit: 100 }).map((i) => `L${i.line}: ${i.message}`);

describe("correct python is never flagged", () => {
  const cases: Record<string, string> = {
    "multi-line def signature": "def f(\n    a,\n    b,\n):\n    return a\n",
    "multi-line class bases": "class A(\n    Base,\n):\n    pass\n",
    "decorated function": "@property\ndef f(self):\n    return 1\n",
    "multi-line if condition": "if (\n    a\n    and b\n):\n    pass\n",
    "dict literal then block": 'd = {\n    "a": 1,\n}\nif d:\n    pass\n',
    "nested dict in call": "f(\n    x={\n        1: 2,\n    },\n)\nprint(1)\n",
    "class with methods and blank lines": "class A:\n    def f(self):\n        return 1\n\n    def g(self):\n        return 2\n",
    "try/except/else/finally": "try:\n    f()\nexcept ValueError:\n    pass\nelse:\n    pass\nfinally:\n    pass\n",
    "match/case": "match x:\n    case 1:\n        pass\n    case _:\n        pass\n",
    "async def and with": "async def f():\n    async with g() as h:\n        await h\n",
    "type hints and walrus": "def f(x: int) -> int:\n    if (n := x) > 1:\n        return n\n    return 0\n",
    "lambda with colon": "f = lambda x: x + 1\nprint(f(1))\n",
    "slice with colon": "a = [1, 2, 3]\nb = a[1:]\nprint(b)\n",
    "comment between opener and body": "if x:\n    # explain\n    pass\n",
    "comment at column 0 inside a block": "def f():\n    a = 1\n# top-level note\n    return a\n",
    "f-string with format spec and braces": 'x = 5\nmsg = f"{x:>10} {{literal}}"\nprint(msg)\n',
    "triple-quoted docstring with code text": 'def f():\n    """\n    if x:\n  weird\n    """\n    return 1\n',
    "raw triple-quoted string": 'p = r"""\n  \\d+:\n"""\nprint(p)\n',
    "implicit string concat over lines": 'msg = (\n    "a"\n    "b"\n)\nprint(msg)\n',
    "semicolons": "a = 1; b = 2\nprint(a)\n",
    "one-line compound": "if x: pass\nelse: pass\n",
    "backslash continuation into a block": "if a and \\\n        b:\n    pass\n",
    "consistent tabs": "def f():\n\tif x:\n\t\treturn 1\n\treturn 0\n",
    "tab indent with space-aligned continuation": "def f():\n\treturn sum([1,\n\t           2,\n\t           3])\n",
    "CRLF endings": "def f():\r\n    return 1\r\n",
    "leading blank and comment lines": "\n# header\n\ndef f():\n    return 1\n",
    "no trailing newline": "def f():\n    return 1",
    "nested comprehension over lines": "xs = [\n    y\n    for y in range(3)\n    if y\n]\nprint(xs)\n",
    "with-statement multi-line": "with open('a') as f, \\\n     open('b') as g:\n    pass\n",
    "3-space consistent file": "def f():\n   if x:\n      return 1\n   return 0\n",
    "opener still being typed": "def f():\n",
    "opener with the caret on a fresh indent": "if x:\n    ",
    // A `\` in a comment is comment text, not a line join — treating it as one
    // hid the next opener and produced a phantom "expected an indented block".
    "comment ending in a backslash": "def f(items):\n    if items:\n        n = 1\n    # windows path: C:\\\n    if n:\n        return n\n    return 0\n",
    // The line closes a triple-quoted string AND carries a real continuation.
    "string close plus backslash continuation":
      'import textwrap\n\n\ndef f(e):\n    msg = textwrap.dedent("""\\\n        Something went wrong: %s\n        """) \\\n        % (e,)\n    return msg\n',
    "escaped quote inside a triple-quoted string": 'def f():\n    s = """a \\""" b"""\n    return s\n',
    "single-quoted string continued over lines": "def f():\n    s = 'abc\\\n def'\n    return s\n",
  };
  for (const [name, code] of Object.entries(cases)) {
    it(name, () => expect(show(code)).toEqual([]));
  }
});

describe("correct javascript is never flagged", () => {
  const cases: Record<string, string> = {
    "template literal with interpolation": "const a = 1\nconst s = `x ${a} 'q' \"d\"`\nconsole.log(s)\n",
    "regex with quotes": "const re = /['\"]/g\nconsole.log(re)\n",
    "comment containing quotes": "// it's a comment\nconst a = 1\n",
    "block comment with code": "/*\n   const x = 1\n*/\nconst a = 1\n",
    "string containing slashes": 'const u = "http://x/y"\nconsole.log(u)\n',
    "free-form indentation is legal in brace languages": "const a = 1\n        const b = 2\nconsole.log(a, b)\n",
    "tab indent with space-aligned arguments": "function f() {\n\treturn g(1,\n\t         2)\n}\n",
  };
  for (const [name, code] of Object.entries(cases)) {
    it(name, () => expect(show(code, "javascript")).toEqual([]));
  }
});

describe("real-world source files are never flagged", () => {
  // Shipped libraries, i.e. code that definitively compiles and runs.
  const files: [string, string][] = [
    ["enhanced-resolve (tabs)", "node_modules/enhanced-resolve/lib/CachedInputFileSystem.js"],
    ["idb (spaces)", "node_modules/idb/build/index.js"],
    ["pyodide loader", "node_modules/pyodide/pyodide.mjs"],
  ];
  for (const [name, path] of files) {
    it(name, () => {
      let src: string;
      try {
        src = readFileSync(path, "utf8");
      } catch {
        return; // dependency layout differs — nothing to assert
      }
      expect(show(src, "javascript")).toEqual([]);
    });
  }
});

describe("robustness", () => {
  it("never throws and always terminates on pathological input", () => {
    const nasty = [
      'x = "unterminated',
      "y = (1, 2",
      'z = """unterminated',
      "\t \t mixed",
      " ".repeat(500) + "deep = 1",
      "a = 1\n".repeat(5000),
      "   \n\t\n \n",
      "",
    ];
    for (const code of nasty) {
      expect(() => analyzeIndentation(code, { langId: "python" })).not.toThrow();
      expect(() => analyzeIndentation(code, { langId: "javascript" })).not.toThrow();
    }
  });
});
