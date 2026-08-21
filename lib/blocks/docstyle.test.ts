import { describe, expect, it } from "vitest";
import {
  A4_W,
  FONT_SIZES,
  LATEX_STYLE,
  TEX,
  fontSizeOptions,
  optionsWith,
  pageContentStyle,
  presetClass,
  presetPatch,
  ptLabel,
  pxToMm,
  pxToPt,
  resolveStyle,
  unindentedParagraphs,
} from "./docstyle";
import { emptyDocument } from "./types";

describe("the LaTeX default style", () => {
  it("carries article's 11pt metrics", () => {
    // \normalsize 10.95pt on a 13.6pt baseline, \parindent 17pt (size11.clo).
    expect(pxToPt(LATEX_STYLE.fontSize)).toBeCloseTo(TEX.normalPt, 2);
    expect(LATEX_STYLE.lineSpacing).toBeCloseTo(13.6 / 10.95, 3);
    expect(LATEX_STYLE.indent * pxToPt(LATEX_STYLE.fontSize)).toBeCloseTo(17, 1);
  });

  it("is stamped on every new document, not left to a fallback", () => {
    expect(emptyDocument().style).toEqual(LATEX_STYLE);
  });

  it("justifies, drops the paragraph gap, and uses the export's 2.2cm margin", () => {
    const r = resolveStyle(LATEX_STYLE);
    expect(r.align).toBe("justify");
    expect(r.paraSkip).toBe(0);
    expect(pxToMm(A4_W * r.marginRatio)).toBeCloseTo(TEX.marginMm, 2);
    expect(presetClass(r.preset)).toBe("aq-tex");
  });
});

describe("resolveStyle", () => {
  it("treats a style-less document as the pre-0.8.1 plain look", () => {
    const r = resolveStyle(undefined);
    expect(r.preset).toBe("plain");
    expect(r.fontSize).toBe(14);
    expect(r.lineSpacing).toBe(1.5);
    expect(r.indent).toBe(0);
    expect(r.align).toBe("left");
    expect(presetClass(r.preset)).toBe("");
  });

  it("lets an explicit field beat the preset's default", () => {
    const r = resolveStyle({ preset: "latex", fontSize: 20, indent: 0 });
    expect(r.fontSize).toBe(20);
    expect(r.indent).toBe(0);
    expect(r.lineSpacing).toBe(LATEX_STYLE.lineSpacing); // untouched fields still preset
  });

  it("keeps a plain document's own font choice", () => {
    expect(resolveStyle({ fontFamily: "Monospace" }).fontKey).toBe("Monospace");
  });
});

describe("presetPatch", () => {
  it("rewrites the fields the preset owns, so the page matches its label", () => {
    const patch = presetPatch("latex");
    expect(patch).toEqual(LATEX_STYLE);
    const plain = presetPatch("plain");
    expect(plain.preset).toBe("plain");
    expect(plain.fontSize).toBe(14);
    expect(plain.indent).toBe(0);
  });
});

describe("pageContentStyle", () => {
  it("scales the margin with the page, so zoom does not change the layout", () => {
    const r = resolveStyle(LATEX_STYLE);
    const full = pageContentStyle(r, A4_W);
    const half = pageContentStyle(r, A4_W / 2);
    expect(Number(half.padding)).toBe(Math.round(Number(full.padding) / 2));
    expect(full.textAlign).toBe("justify");
    expect(full["--indent"]).toBe(`${LATEX_STYLE.indent}em`);
    expect(full["--para-skip"]).toBe("0px");
  });
});

describe("unindentedParagraphs", () => {
  const doc = [
    { id: "p1", type: "text" },
    { id: "p2", type: "text" },
    { id: "h", type: "heading" },
    { id: "p3", type: "text" },
    { id: "p4", type: "text" },
    { id: "eq", type: "math" },
    { id: "p5", type: "text" },
  ];

  it("skips the indent on the opening paragraph of the document and of a section", () => {
    expect([...unindentedParagraphs(doc)]).toEqual(["p1", "p3"]);
  });

  it("still indents a paragraph that merely follows display math", () => {
    expect(unindentedParagraphs(doc).has("p5")).toBe(false);
  });

  it("is empty for a document that does not open with prose", () => {
    expect(unindentedParagraphs([{ id: "img", type: "image" }]).size).toBe(0);
  });
});

describe("select options", () => {
  it("labels sizes by class option, so 10.95pt reads as the 11pt it was asked for", () => {
    const eleven = FONT_SIZES.find((o) => o.label === "11pt");
    expect(eleven?.px).toBe(LATEX_STYLE.fontSize);
    expect(pxToPt(eleven!.px)).toBeCloseTo(TEX.normalPt, 2);
  });

  it("keeps a size the list does not offer", () => {
    expect(fontSizeOptions(14).map((o) => o.label)).toContain(ptLabel(14));
    expect(fontSizeOptions(LATEX_STYLE.fontSize)).toEqual(FONT_SIZES);
  });

  it("keeps a value the list does not offer, so the select never renders blank", () => {
    expect(optionsWith([10, 12], 11)).toEqual([10, 11, 12]);
    expect(optionsWith([10, 12], 12)).toEqual([10, 12]);
  });
});
