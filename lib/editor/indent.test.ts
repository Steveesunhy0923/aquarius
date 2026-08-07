import { describe, expect, it } from "vitest";

import { analyzeIndentation, endsBlockStatement, inferIndentUnit } from "./indent";

const py = (code: string) => analyzeIndentation(code, { langId: "python" });
const js = (code: string) => analyzeIndentation(code, { langId: "javascript" });
const messages = (code: string, lang = "python") =>
  analyzeIndentation(code, { langId: lang }).map((i) => `${i.line}: ${i.message}`);

describe("inferIndentUnit", () => {
  it("reads the file's own step rather than assuming 4", () => {
    expect(inferIndentUnit("def f():\n  return 1\n")).toBe(2);
    expect(inferIndentUnit("def f():\n    return 1\n")).toBe(4);
    expect(inferIndentUnit("x = 1\n")).toBe(4); // nothing to infer
  });
});

describe("endsBlockStatement (drives the Python dedent-on-Enter rule)", () => {
  it("recognises statements that close a block", () => {
    expect(endsBlockStatement("    return 1")).toBe(true);
    expect(endsBlockStatement("        pass")).toBe(true);
    expect(endsBlockStatement("    break  # done")).toBe(true);
    expect(endsBlockStatement("    raise ValueError('x')")).toBe(true);
    expect(endsBlockStatement("    continue")).toBe(true);
  });
  it("leaves ordinary statements alone", () => {
    expect(endsBlockStatement("    x = returns_value()")).toBe(false);
    expect(endsBlockStatement("    if x:")).toBe(false);
    expect(endsBlockStatement("")).toBe(false);
  });
  it("does not dedent a multi-line return (its continuation owns the indent)", () => {
    expect(endsBlockStatement("    return (")).toBe(false);
    expect(endsBlockStatement("    return [")).toBe(false);
    expect(endsBlockStatement("    return 1 + \\")).toBe(false);
    expect(endsBlockStatement("    return (1 + 2)")).toBe(true); // balanced again
  });
});

describe("clean code produces no complaints", () => {
  it("well-formed python", () => {
    expect(py("def f(x):\n    if x:\n        return 1\n    return 0\n")).toEqual([]);
  });
  it("2-space python is not nagged for not being 4-space", () => {
    expect(py("def f(x):\n  if x:\n    return 1\n  return 0\n")).toEqual([]);
  });
  it("else/elif/except dedents back to an open level", () => {
    expect(py("if a:\n    x = 1\nelif b:\n    x = 2\nelse:\n    x = 3\n")).toEqual([]);
    expect(py("try:\n    f()\nexcept ValueError:\n    pass\nfinally:\n    done()\n")).toEqual([]);
  });
  it("tab-indented python is fine when consistent", () => {
    expect(py("def f():\n\tif x:\n\t\treturn 1\n")).toEqual([]);
  });
  it("javascript braces are not structurally policed", () => {
    expect(js("function f() {\n    if (x) {\n        return 1\n    }\n}\n")).toEqual([]);
    // free-form indentation inside a brace language is legal, if ugly
    expect(js("const a = 1\n        const b = 2\n")).toEqual([]);
  });
});

describe("python structural errors", () => {
  it("flags a missing indented block after a colon", () => {
    expect(messages("if x:\nprint(1)\n")[0]).toMatch(/Expected an indented block after 'if' on line 1/);
  });
  it("does NOT nag an opener that is still being typed (nothing after it yet)", () => {
    expect(py("for i in range(3):\n")).toEqual([]);
    expect(py("if x:\n    ")).toEqual([]); // caret sitting on the fresh indent
    expect(py("def f():\n\n")).toEqual([]);
  });
  it("still flags a body written at the wrong level after the opener", () => {
    expect(messages("if x:\n\nprint(1)\n")[0]).toMatch(/Expected an indented block after 'if' on line 1/);
  });
  it("flags an indent that opens nothing", () => {
    expect(messages("x = 1\n    y = 2\n")[0]).toMatch(/Unexpected indent/);
  });
  it("flags a dedent to a level that was never open", () => {
    const msgs = messages("if a:\n        x = 1\n    y = 2\n");
    expect(msgs.some((m) => /Unindent does not match/.test(m))).toBe(true);
  });
  it("reports the first bad line only once, then resyncs", () => {
    const issues = py("x = 1\n    y = 2\n    z = 3\n");
    expect(issues).toHaveLength(1);
  });
  it("resyncing after a bad dedent keeps column 0 valid for later lines", () => {
    // Only line 3 is wrong; lines 4-5 return cleanly to the top level.
    const issues = py("if a:\n        x = 1\n    y = 2\nz = 3\nprint(z)\n");
    expect(issues.filter((i) => i.line > 3)).toEqual([]);
  });
});

describe("whitespace consistency", () => {
  it("flags tabs and spaces mixed in one line", () => {
    const msgs = messages("def f():\n \treturn 1\n");
    expect(msgs.some((m) => /mixes tabs and spaces/.test(m))).toBe(true);
  });
  it("flags a tab-indented line inside a space-indented block", () => {
    const msgs = messages("def f():\n    a = 1\n    b = 2\n\tc = 3\n");
    expect(msgs.some((m) => /indented with tabs, but the rest of this block uses spaces/.test(m))).toBe(true);
  });
  it("flags an off-step indent", () => {
    const msgs = messages("def f():\n    a = 1\n    if a:\n       b = 2\n");
    expect(msgs.some((m) => /steps of 4/.test(m))).toBe(true);
  });
  it("applies the whitespace rules to brace languages too", () => {
    const msgs = messages("function f() {\n \tconst a = 1\n}\n", "javascript");
    expect(msgs.some((m) => /mixes tabs and spaces/.test(m))).toBe(true);
  });
});

describe("false-positive guards", () => {
  it("ignores everything inside a triple-quoted string", () => {
    expect(py('def f():\n    """\nnot code\n        weird indent\n"""\n    return 1\n')).toEqual([]);
  });
  it("ignores continuation lines inside brackets", () => {
    expect(py("values = [\n    1,\n        2,\n  3,\n]\nprint(values)\n")).toEqual([]);
  });
  it("ignores backslash continuations", () => {
    expect(py("total = 1 + \\\n        2\nprint(total)\n")).toEqual([]);
  });
  it("ignores comment-only lines at any indentation", () => {
    expect(py("def f():\n    a = 1\n        # a deeply indented note\n    return a\n")).toEqual([]);
  });
  it("does not treat a colon inside a string or dict as a block opener", () => {
    expect(py('d = {"a": 1}\nprint(d)\n')).toEqual([]);
    expect(py('s = "if x:"\nprint(s)\n')).toEqual([]);
  });
  it("allows one-line compound statements", () => {
    expect(py("if x: y = 1\nz = 2\n")).toEqual([]);
  });
  it("ignores JS template literals and block comments", () => {
    expect(js("const t = `\n   ragged\n      lines\n`\n/*\n   block\n*/\nconst a = 1\n")).toEqual([]);
  });
  it("returns nothing for plain text or an empty block", () => {
    expect(analyzeIndentation("   whatever\n  it is\n", { langId: "text" })).toEqual([]);
    expect(py("   \n")).toEqual([]);
  });
});

describe("issue ranges", () => {
  it("underlines the leading whitespace of the offending line", () => {
    const [issue] = py("x = 1\n    y = 2\n");
    expect(issue.from).toBe(6); // start of line 2
    expect(issue.to).toBe(10); // end of its 4-space indent
    expect(issue.severity).toBe("error");
  });
});
