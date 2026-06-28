import { describe, expect, it } from "vitest";

import { inlineMathSpans, replaceInlineMathSpan, runsFromSource } from "./source";

const SRC = "before \\(a+b\\) middle \\(\\frac{1}{2}\\) after";

describe("inline-math span helpers", () => {
  it("enumerates spans 1:1 with runsFromSource math runs", () => {
    const spans = inlineMathSpans(SRC);
    const mathRuns = runsFromSource(SRC).filter((r) => r.kind === "math");
    expect(spans.map((s) => s.latex)).toEqual(["a+b", "\\frac{1}{2}"]);
    expect(spans.length).toBe(mathRuns.length);
  });

  it("replaces the nth span and keeps the source re-parseable", () => {
    const next = replaceInlineMathSpan(SRC, 1, "\\sqrt{2}");
    expect(next).toBe("before \\(a+b\\) middle \\(\\sqrt{2}\\) after");
    // The edit survives the round-trip the editor uses on every keystroke.
    const spans = inlineMathSpans(next);
    expect(spans.map((s) => s.latex)).toEqual(["a+b", "\\sqrt{2}"]);
  });

  it("removes a span entirely when the new latex is empty", () => {
    const next = replaceInlineMathSpan(SRC, 0, "   ");
    expect(next).toBe("before  middle \\(\\frac{1}{2}\\) after");
    expect(inlineMathSpans(next).map((s) => s.latex)).toEqual(["\\frac{1}{2}"]);
  });

  it("is a no-op for an out-of-range index", () => {
    expect(replaceInlineMathSpan(SRC, 5, "x")).toBe(SRC);
  });
});
