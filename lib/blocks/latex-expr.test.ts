import { describe, expect, it } from "vitest";
import { latexToExpr } from "./latex-expr";
import { compileExpr } from "./expr";

/** Sample both the expected infix and the produced expr; assert they agree over a range. */
function agrees(expr: string, ref: (x: number) => number) {
  const { fn, error } = compileExpr(expr, ["x"]);
  expect(error).toBeNull();
  for (const x of [-2, -0.5, 0.25, 1, 2.5, 3]) {
    const got = fn!({ x });
    const want = ref(x);
    if (Number.isFinite(want)) expect(got).toBeCloseTo(want, 6);
  }
}

describe("latexToExpr", () => {
  it("plots a bare polynomial", () => {
    const r = latexToExpr("x^2");
    expect(r?.variable).toBe("x");
    agrees(r!.expr, (x) => x * x);
  });

  it("strips a y = … left-hand side", () => {
    const r = latexToExpr("y = x^2 - 1");
    expect(r).not.toBeNull();
    agrees(r!.expr, (x) => x * x - 1);
  });

  it("strips an f(x) = … left-hand side", () => {
    const r = latexToExpr("f(x) = 2x + 3");
    agrees(r!.expr, (x) => 2 * x + 3);
  });

  it("handles the expression on the left of =", () => {
    const r = latexToExpr("x^3 = y");
    agrees(r!.expr, (x) => x ** 3);
  });

  it("converts \\frac to division", () => {
    const r = latexToExpr("\\frac{1}{x}");
    agrees(r!.expr, (x) => 1 / x);
  });

  it("converts nested fractions", () => {
    const r = latexToExpr("\\frac{x^2 - 1}{x + 1}");
    agrees(r!.expr, (x) => (x * x - 1) / (x + 1));
  });

  it("converts \\sqrt", () => {
    const r = latexToExpr("\\sqrt{x}");
    agrees(r!.expr, (x) => Math.sqrt(x));
  });

  it("converts an nth root", () => {
    const r = latexToExpr("\\sqrt[3]{x}");
    agrees(r!.expr, (x) => Math.cbrt(x));
  });

  it("converts trig with \\left \\right delimiters", () => {
    const r = latexToExpr("\\sin\\left(2x\\right)");
    agrees(r!.expr, (x) => Math.sin(2 * x));
  });

  it("converts braced exponents", () => {
    const r = latexToExpr("e^{x}");
    agrees(r!.expr, (x) => Math.E ** x);
  });

  it("converts \\cdot and \\pi", () => {
    const r = latexToExpr("2 \\cdot \\pi \\cdot x");
    agrees(r!.expr, (x) => 2 * Math.PI * x);
  });

  it("converts absolute value bars", () => {
    const r = latexToExpr("|x|");
    agrees(r!.expr, (x) => Math.abs(x));
  });

  it("renames a t variable to x", () => {
    const r = latexToExpr("f(t) = 2t + t^2");
    expect(r?.variable).toBe("t");
    agrees(r!.expr, (x) => 2 * x + x * x);
  });

  it("rejects implicit relations in x and y", () => {
    expect(latexToExpr("x^2 + y^2 = 1")).toBeNull();
  });

  it("rejects chained equations", () => {
    expect(latexToExpr("a = b = c")).toBeNull();
  });

  it("rejects a non-mathematical formula", () => {
    expect(latexToExpr("E = mc^2")).toBeNull(); // two free vars m, c
  });

  it("strips $$ delimiters", () => {
    const r = latexToExpr("$$ x^2 + 1 $$");
    agrees(r!.expr, (x) => x * x + 1);
  });

  it("handles \\ln", () => {
    const r = latexToExpr("\\ln(x)");
    agrees(r!.expr, (x) => Math.log(x));
  });
});
