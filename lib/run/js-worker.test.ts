/**
 * The JS kernel is a source STRING evaluated inside a Blob worker, so it can't
 * be imported directly. These tests pull the two source-rewriting helpers out
 * of that string and exercise them in isolation — they are the parts that can
 * silently corrupt a user's code, and a regression there is invisible at
 * runtime (the cell just prints something subtly wrong).
 */

import { describe, expect, it } from "vitest";

import { JS_WORKER_SOURCE } from "./js-worker";

/** Evaluate the worker source in a bare scope and hand back a helper. */
function helper<T>(name: string): T {
  const factory = new Function(`
    var self = { postMessage: function () {}, setTimeout: function () {}, setInterval: function () {} };
    var console = { log() {}, info() {}, debug() {}, trace() {}, warn() {}, error() {} };
    ${JS_WORKER_SOURCE}
    return ${name};
  `);
  return factory() as T;
}

const persistDecls = helper<(code: string) => string>("persistDecls");
const asyncWrap = helper<(code: string) => string>("asyncWrap");

describe("worker source", () => {
  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(JS_WORKER_SOURCE)).not.toThrow();
  });
});

describe("persistDecls", () => {
  it("rewrites top-level const/let so variables survive into the next cell", () => {
    expect(persistDecls("const a = 1\nlet b = 2")).toBe("var a = 1\nvar b = 2");
  });
  it("leaves indented (block-scoped) declarations alone", () => {
    const src = "function f() {\n  const inner = 1\n  return inner\n}";
    expect(persistDecls(src)).toBe(src);
  });
  it("never rewrites inside a template literal (it would corrupt the string)", () => {
    const src = "const demo = `\nconst a = 1;\nlet b = 2;\n`\nconsole.log(demo)";
    const out = persistDecls(src);
    expect(out).toBe("var demo = `\nconst a = 1;\nlet b = 2;\n`\nconsole.log(demo)");
    // The string's VALUE is what the user typed.
    expect(eval(out.replace("console.log(demo)", "demo"))).toContain("const a = 1;");
  });
  it("never rewrites inside comments or quoted strings", () => {
    const src = '// const a = 1\nconst real = "\\nlet quoted = 2"';
    expect(persistDecls(src)).toBe('// const a = 1\nvar real = "\\nlet quoted = 2"');
  });
  it("handles an unterminated string without hanging or dropping text", () => {
    expect(persistDecls('const a = "oops')).toBe('var a = "oops');
  });
});

describe("asyncWrap (top-level await fallback)", () => {
  it("returns the trailing expression so the cell still reports a value", async () => {
    const wrapped = asyncWrap("const v = await Promise.resolve(41)\nv + 1");
    expect(await eval(wrapped)).toBe(42);
  });
  it("does not fabricate a value when the cell ends in a statement", async () => {
    const wrapped = asyncWrap("await Promise.resolve(1)\nconst x = 5");
    expect(await eval(wrapped)).toBeUndefined();
  });
});
