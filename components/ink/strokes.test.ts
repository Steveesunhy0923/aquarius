import { describe, expect, it } from "vitest";

import {
  buildAcceptedRequest,
  buildCollectRequest,
  sampleMode,
  unwrapInlineMath,
  type Segment,
  type Stroke,
} from "./strokes";

const stroke = (x0: number): Stroke => ({ x: [x0, x0 + 1], y: [0, 1], t: [0, 10], p: [0.5, 0.5] });
const ink = [stroke(0), stroke(10), stroke(20)];

const seg = (over: Partial<Segment>): Segment => ({
  id: "s1",
  line: 0,
  page: 0,
  kind: "math",
  confidence: 0.9,
  box: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  strokes: [0],
  sourceStart: 0,
  sourceEnd: 5,
  ...over,
});

describe("sampleMode", () => {
  it("passes through the single-interpretation modes untouched", () => {
    expect(sampleMode("math", undefined, false)).toBe("math");
    expect(sampleMode("chem", undefined, true)).toBe("chem");
    expect(sampleMode("text", undefined, false)).toBe("text");
  });

  it("resolves an unsegmented auto result by the chem switch", () => {
    expect(sampleMode("auto", undefined, false)).toBe("math");
    expect(sampleMode("auto", [], true)).toBe("chem");
  });

  it("takes a lone run's own kind", () => {
    expect(sampleMode("auto", [seg({ kind: "chem" })], false)).toBe("chem");
    expect(sampleMode("auto", [seg({ kind: "text" })], false)).toBe("text");
  });

  it("calls several runs a mixed page", () => {
    expect(sampleMode("auto", [seg({ kind: "text" }), seg({ id: "s2", kind: "math" })], false)).toBe("mixed");
    // …even when every run is math: the assembled label is still a page.
    expect(sampleMode("auto", [seg({}), seg({ id: "s2" })], false)).toBe("mixed");
  });

  it("never returns the request-only value auto", () => {
    for (const segs of [undefined, [], [seg({})], [seg({}), seg({ id: "s2" })]]) {
      expect(sampleMode("auto", segs, false)).not.toBe("auto");
    }
  });
});

describe("unwrapInlineMath", () => {
  it("strips delimiters that enclose the whole label", () => {
    expect(unwrapInlineMath("\\(x^{2}\\)")).toBe("x^{2}");
    expect(unwrapInlineMath("  \\(\\frac{a}{b}\\)  ")).toBe("\\frac{a}{b}");
  });

  it("leaves an already-bare label alone", () => {
    expect(unwrapInlineMath("x^{2}")).toBe("x^{2}");
    expect(unwrapInlineMath("\\int")).toBe("\\int");
  });

  it("refuses to unwrap two runs into one bogus formula", () => {
    expect(unwrapInlineMath("\\(a\\)+\\(b\\)")).toBe("\\(a\\)+\\(b\\)");
  });

  it("leaves prose containing math untouched", () => {
    expect(unwrapInlineMath("let \\(x\\) be")).toBe("let \\(x\\) be");
  });
});

describe("buildCollectRequest", () => {
  it("stores a math label bare — the decoder never emits delimiters", () => {
    const req = buildCollectRequest(ink, "\\(x^{2}\\)", "\\(x^{3}\\)", "math");
    expect(req.label).toBe("x^{2}");
    expect(req.predicted).toBe("x^{3}");
  });

  it("keeps a mixed page whole, delimiters and all", () => {
    const req = buildCollectRequest(ink, "let \\(x\\) be", undefined, "mixed");
    expect(req.label).toBe("let \\(x\\) be");
  });

  it("demotes a math sample the user edited into two runs, rather than teaching the decoder delimiters", () => {
    const req = buildCollectRequest(ink, "\\(a\\)+\\(b\\)", "\\(a\\)", "math");
    expect(req.mode).toBe("mixed"); // saved, but out of the math corpus
    expect(req.label).toBe("\\(a\\)+\\(b\\)"); // and kept verbatim for later triage
  });

  it("demotes a correction turned into prose", () => {
    expect(buildCollectRequest(ink, "let \\(x\\) be", undefined, "math").mode).toBe("mixed");
  });
});

describe("buildAcceptedRequest", () => {
  it("carries the confidence and files a lone formula bare", () => {
    const req = buildAcceptedRequest(ink, "\\(x^{2}\\)", "math", { confidence: 0.912345 });
    expect(req.label).toBe("x^{2}");
    expect(req.mode).toBe("math");
    expect(req.confidence).toBe(0.912);
    expect(req.segments).toBeUndefined();
  });

  it("omits segments for a single-run reading, so the ink is never stored twice", () => {
    const req = buildAcceptedRequest(ink, "x^{2}", "math", { segments: [seg({ strokes: [0, 1, 2] })] });
    expect(req.segments).toBeUndefined();
  });

  it("sends one child per run for a mixed page, keeping stroke indices", () => {
    const req = buildAcceptedRequest(ink, "let \\(x\\) be", "mixed", {
      segments: [
        seg({ kind: "text", text: "let", strokes: [0, 1] }),
        seg({ id: "s2", kind: "math", latex: "x", strokes: [2] }),
      ],
    });
    expect(req.label).toBe("let \\(x\\) be"); // page label stays whole
    expect(req.segments).toEqual([
      { strokes: [0, 1], label: "let", kind: "text" },
      { strokes: [2], label: "x", kind: "math" },
    ]);
  });

  it("drops a run with no reading rather than saving an empty label", () => {
    const req = buildAcceptedRequest(ink, "page", "mixed", {
      segments: [seg({ kind: "math", latex: "", strokes: [0] }), seg({ id: "s2", kind: "math", latex: "x", strokes: [1] })],
    });
    expect(req.segments).toEqual([{ strokes: [1], label: "x", kind: "math" }]);
  });

  it("rebases timestamps so a saved sample matches what was recognized", () => {
    const late: Stroke[] = [{ x: [5], y: [5], t: [1000], p: [1] }, { x: [6], y: [6], t: [1200], p: [1] }];
    const req = buildAcceptedRequest(late, "x", "math");
    expect(req.strokes[0].t).toEqual([0]);
    expect(req.strokes[1].t).toEqual([200]);
  });
});
