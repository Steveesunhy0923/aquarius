import { describe, expect, it } from "vitest";
import { A4_W, pageContentStyle, resolveStyle, TEX_INDENT } from "./docstyle";
import { MAX_INDENT, paraIndent, withParaIndent } from "./indent";
import { blockToLatex } from "./serialize";
import { paragraphFromSource } from "./source";

describe("paragraph indent (Google Docs model)", () => {
  it("is a whole-paragraph attribute counted in steps", () => {
    const p = paragraphFromSource("text");
    expect(paraIndent(p)).toBe(0);
    expect(paraIndent(withParaIndent(p, 2))).toBe(2);
    expect(paraIndent(withParaIndent(p, 99))).toBe(MAX_INDENT);
    expect(withParaIndent(withParaIndent(p, 1), 0).attrs?.indent).toBeUndefined();
    expect(withParaIndent(p, 0)).toBe(p); // nothing to change → same block
    expect(withParaIndent(p, -1)).toBe(p);
  });

  it("exports as a \\leftskip, so every line of the paragraph moves", () => {
    const tex = blockToLatex(withParaIndent(paragraphFromSource("hello $x$"), 2));
    expect(tex).toBe("{\\leftskip=72pt\\relax\nhello \\(x\\)\\par}");
    expect(blockToLatex(paragraphFromSource("plain"))).toBe("plain");
  });

  it("sets the step as half an inch of the sheet, scaled with the page", () => {
    const r = resolveStyle({ preset: "latex" });
    expect(pageContentStyle(r, A4_W)["--indent-step"]).toBe("48px");
    expect(pageContentStyle(r, A4_W * 1.5)["--indent-step"]).toBe("72px");
  });
});

describe("the old stored first-line indent", () => {
  it("reads LaTeX's 17pt, stored as an old note's default, as no indent", () => {
    expect(resolveStyle({ preset: "latex", indent: TEX_INDENT }).indent).toBe(0);
  });

  it("keeps it when the writer chose it, and keeps any other value", () => {
    expect(resolveStyle({ preset: "latex", indent: TEX_INDENT, indentChosen: true }).indent).toBe(TEX_INDENT);
    expect(resolveStyle({ preset: "latex", indent: 2 }).indent).toBe(2);
  });
});
