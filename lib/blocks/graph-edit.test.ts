import { describe, expect, it } from "vitest";
import { isValidLineEquation, lineAnchors, lineEquationText, parseLineEquation } from "./graph-edit";
import { niceStep, panView, zoomView, type GraphView } from "./graph";

const VIEW: GraphView = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };

/** Is (x, y) on the line a·x + b·y = c? */
const on = (k: { a: number; b: number; c: number }, [x, y]: [number, number], tol = 1e-9): boolean =>
  Math.abs(k.a * x + k.b * y - k.c) < tol;

const inView = ([x, y]: [number, number]): boolean =>
  x >= VIEW.xmin - 1e-9 && x <= VIEW.xmax + 1e-9 && y >= VIEW.ymin - 1e-9 && y <= VIEW.ymax + 1e-9;

describe("parseLineEquation", () => {
  it("reads slope-intercept form", () => {
    const k = parseLineEquation("y = 2x + 1")!;
    expect(k).not.toBeNull();
    for (const x of [-3, 0, 4.5]) expect(on(k, [x, 2 * x + 1])).toBe(true);
  });

  it("reads a vertical line, which no function shape could draw", () => {
    const k = parseLineEquation("x = 3")!;
    expect(k.b).toBe(0);
    for (const y of [-2, 0, 7]) expect(on(k, [3, y])).toBe(true);
  });

  it("reads general form with terms on both sides", () => {
    const k = parseLineEquation("2x + 3y = 6")!;
    expect(on(k, [3, 0])).toBe(true);
    expect(on(k, [0, 2])).toBe(true);
    const pointSlope = parseLineEquation("y - 3 = 2(x - 1)")!;
    expect(on(pointSlope, [1, 3])).toBe(true);
    expect(on(pointSlope, [2, 5])).toBe(true);
  });

  it("reads a bare expression as y = …, the way a graphing calculator does", () => {
    const k = parseLineEquation("2x + 1")!;
    expect(on(k, [0, 1])).toBe(true);
    expect(on(k, [1, 3])).toBe(true);
  });

  it("accepts a horizontal line and an equation with no constant", () => {
    expect(on(parseLineEquation("y = -4")!, [9, -4])).toBe(true);
    expect(on(parseLineEquation("y = -x")!, [2, -2])).toBe(true);
  });

  it("rejects anything that is not a line", () => {
    for (const src of ["y = x^2", "y = sin(x)", "y = 1/x", "y = x*y"]) {
      expect(parseLineEquation(src), src).toBeNull();
    }
  });

  it("rejects equations that describe no line at all", () => {
    for (const src of ["", "   ", "y = y", "3 = 3", "y == 2", "hello", "y = 2x +"]) {
      expect(parseLineEquation(src), src).toBeNull();
    }
  });

  it("isValidLineEquation mirrors the parse", () => {
    expect(isValidLineEquation("y = 2x + 1")).toBe(true);
    expect(isValidLineEquation("y = x^2")).toBe(false);
  });
});

describe("lineAnchors", () => {
  it("puts both anchors on the line and inside the view", () => {
    for (const src of ["y = 2x + 1", "x = 3", "y = -4", "2x + 3y = 6", "y = 0.05x"]) {
      const k = parseLineEquation(src)!;
      const [p, q] = lineAnchors(VIEW, k);
      expect(on(k, p), src).toBe(true);
      expect(on(k, q), src).toBe(true);
      expect(inView(p), src).toBe(true);
      expect(inView(q), src).toBe(true);
      expect(Math.hypot(q[0] - p[0], q[1] - p[1]), src).toBeGreaterThan(0.5);
    }
  });

  it("still gives two usable anchors for a line that misses the view", () => {
    const k = parseLineEquation("x = 900")!;
    const [p, q] = lineAnchors(VIEW, k);
    expect(on(k, p)).toBe(true);
    expect(on(k, q)).toBe(true);
    expect(p).not.toEqual(q);
  });

  it("handles a steep line without running out of the view vertically", () => {
    const k = parseLineEquation("y = 40x")!;
    const [p, q] = lineAnchors(VIEW, k);
    expect(inView(p)).toBe(true);
    expect(inView(q)).toBe(true);
  });
});

describe("lineEquationText", () => {
  it("writes the equation the way it would be typed", () => {
    expect(lineEquationText([0, 1], [1, 3])).toBe("y = 2x + 1");
    expect(lineEquationText([0, 0], [1, -1])).toBe("y = -x");
    expect(lineEquationText([0, 2], [5, 2])).toBe("y = 2");
    expect(lineEquationText([3, -1], [3, 8])).toBe("x = 3");
    expect(lineEquationText([0, -1.5], [2, 0.5])).toBe("y = x - 1.5");
  });

  it("round-trips: text → anchors → text", () => {
    for (const src of ["y = 2x + 1", "x = 3", "y = -4", "y = -x", "2x + 3y = 6"]) {
      const k = parseLineEquation(src)!;
      const [p, q] = lineAnchors(VIEW, k);
      const back = parseLineEquation(lineEquationText(p, q))!;
      expect(back, src).not.toBeNull();
      // Same line: both anchors satisfy the re-parsed equation. The text rounds
      // to 6 decimals (2x + 3y = 6 becomes y = -0.666667x + 2), so this is
      // equality to display precision, not to the bit.
      expect(on(back, p, 1e-5), src).toBe(true);
      expect(on(back, q, 1e-5), src).toBe(true);
    }
  });
});

// ─── Moving the window (pan / zoom / grid step) ───────────────────────────────

describe("panView", () => {
  it("slides the window without resizing it", () => {
    const v = panView(VIEW, 2, -3);
    expect(v).toEqual({ xmin: -3, xmax: 7, ymin: -8, ymax: 2 });
    expect(v.xmax - v.xmin).toBe(VIEW.xmax - VIEW.xmin);
    expect(v.ymax - v.ymin).toBe(VIEW.ymax - VIEW.ymin);
  });
});

describe("zoomView", () => {
  it("keeps the anchor point exactly where it was on screen", () => {
    // The anchor's position within the window (0…1) must not move — that is
    // what makes wheel-zoom feel anchored to the cursor.
    const anchor: [number, number] = [3, -1];
    const before = (anchor[0] - VIEW.xmin) / (VIEW.xmax - VIEW.xmin);
    for (const k of [0.5, 0.8, 1.25, 2]) {
      const v = zoomView(VIEW, k, ...anchor);
      const after = (anchor[0] - v.xmin) / (v.xmax - v.xmin);
      expect(after, `k=${k}`).toBeCloseTo(before, 12);
    }
  });

  it("scales the span by k — in below 1, out above", () => {
    expect(zoomView(VIEW, 0.5, 0, 0).xmax - zoomView(VIEW, 0.5, 0, 0).xmin).toBeCloseTo(5);
    expect(zoomView(VIEW, 2, 0, 0).ymax - zoomView(VIEW, 2, 0, 0).ymin).toBeCloseTo(20);
  });

  it("stops at the ends instead of collapsing or exploding the window", () => {
    const tiny = { xmin: -1e-3, xmax: 1e-3, ymin: -1e-3, ymax: 1e-3 };
    expect(zoomView(tiny, 0.1, 0, 0)).toBe(tiny); // already as far in as it goes
    const huge = { xmin: -1e6, xmax: 1e6, ymin: -1e6, ymax: 1e6 };
    expect(zoomView(huge, 10, 0, 0)).toBe(huge);
  });

  it("survives a degenerate factor rather than producing NaN bounds", () => {
    expect(zoomView(VIEW, 0, 0, 0)).toBe(VIEW);
    expect(zoomView(VIEW, -1, 0, 0)).toBe(VIEW);
  });
});

describe("niceStep", () => {
  it("picks 1/2/5 × a power of ten, about ten divisions across", () => {
    expect(niceStep(10)).toBe(1);
    expect(niceStep(20)).toBe(2);
    expect(niceStep(50)).toBe(5);
    expect(niceStep(100)).toBe(10);
    expect(niceStep(1)).toBe(0.1);
    expect(niceStep(0.05)).toBeCloseTo(0.005, 12);
  });

  it("keeps the grid between roughly 4 and 25 lines at any zoom", () => {
    for (let span = 0.01; span < 1e5; span *= 1.7) {
      const lines = span / niceStep(span);
      expect(lines, `span=${span}`).toBeGreaterThanOrEqual(4);
      expect(lines, `span=${span}`).toBeLessThanOrEqual(25);
    }
  });

  it("never returns zero for a degenerate span", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
  });
});
