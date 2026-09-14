import { describe, expect, it } from "vitest";
import { inlineSource, inlineSpanAt } from "./source";

describe("the formula under the caret", () => {
  const src = "if $x^2$ then \\(y\\)";

  it("finds the span the caret is inside", () => {
    expect(inlineSpanAt(src, 4)).toMatchObject({ index: 0, start: 3, end: 8, latex: "x^2" });
    expect(inlineSpanAt(src, 7)).toMatchObject({ index: 0 });
    expect(inlineSpanAt(src, 16)).toMatchObject({ index: 1, start: 14, end: 19, latex: "y" });
  });

  it("treats the outer edges of a formula, and money, as outside", () => {
    expect(inlineSpanAt(src, 3)).toBeNull();
    expect(inlineSpanAt(src, 8)).toBeNull();
    expect(inlineSpanAt("costs $5, not $10", 8)).toBeNull();
  });
});

describe("inlineSource", () => {
  it("wraps a formula in dollars, trimmed so it still reads as maths", () => {
    expect(inlineSource("x^2")).toBe("$x^2$");
    expect(inlineSource(" a+b ")).toBe("$a+b$");
    expect(inlineSource("   ")).toBe("");
    expect(inlineSpanAt(`so ${inlineSource(" z ")} ok`, 5)).toMatchObject({ latex: "z" });
  });
});
