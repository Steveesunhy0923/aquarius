import { describe, expect, it } from "vitest";
import { LATEX_STYLE } from "@/lib/blocks/docstyle";
import { fullLatexDocument } from "./pdf";

const doc = (style?: Parameters<typeof fullLatexDocument>[1]): string =>
  fullLatexDocument("Hello.", style);

describe("fullLatexDocument", () => {
  it("exports a LaTeX-preset note as a plain 11pt article", () => {
    const tex = doc(LATEX_STYLE);
    expect(tex).toContain("\\documentclass[11pt]{article}");
    expect(tex).toContain("margin=22mm");
    expect(tex).toContain("\\setlength{\\parskip}{0pt}");
    expect(tex).toMatch(/\\setlength\{\\parindent\}\{1[67](\.\d+)?pt\}/); // article's 17pt
    expect(tex).not.toContain("\\linespread"); // 1.242 IS LaTeX's own leading
    expect(tex).not.toContain("\\raggedright");
  });

  it("carries a plain note's ragged, gapped look into the PDF", () => {
    const tex = doc(undefined);
    // 14px is 10.5pt: nearer [11pt]'s 10.95 body than [10pt]'s 10, and the
    // class these notes have always been exported with.
    expect(tex).toContain("\\documentclass[11pt]{article}");
    expect(tex).toContain("\\raggedright");
    expect(tex).toContain("\\setlength{\\parindent}{0pt}");
    expect(tex).toMatch(/\\setlength\{\\parskip\}\{[1-9]/);
    expect(tex).toContain("\\linespread{1.208}"); // 1.5 spacing over [11pt]'s 1.242
  });

  it("puts \\raggedright before \\parindent, which it would otherwise zero", () => {
    const tex = doc({ indent: 1, fontSize: 14 });
    expect(tex.indexOf("\\raggedright")).toBeLessThan(tex.indexOf("\\parindent"));
  });

  it("picks the nearest available class size for an unusual body size", () => {
    expect(doc({ preset: "latex", fontSize: 26 })).toContain("\\documentclass[12pt]");
    expect(doc({ preset: "latex", fontSize: 11 })).toContain("\\documentclass[10pt]");
  });

  it("still emits the packages the serializer's output needs", () => {
    const tex = doc(LATEX_STYLE);
    for (const pkg of ["amsmath", "graphicx", "enumitem", "subcaption", "tikz", "mhchem", "listings"]) {
      expect(tex).toContain(pkg);
    }
    expect(tex).toContain("Hello.");
  });
});
