import { describe, expect, it } from "vitest";

import { ceInner, isChemBlock, tagChem, wrapCe } from "./chem";
import { documentToLatex } from "./serialize";
import { displayFromSource, paragraphFromSource } from "./source";
import { emptyDocument } from "./types";

describe("wrapCe", () => {
  it("wraps mhchem source in \\ce{...}", () => {
    expect(wrapCe("2H2 + O2 -> 2H2O")).toBe("\\ce{2H2 + O2 -> 2H2O}");
  });
  it("trims the source", () => {
    expect(wrapCe("  H2O ")).toBe("\\ce{H2O}");
  });
  it("returns empty for empty source (so abandoned blocks count as empty)", () => {
    expect(wrapCe("")).toBe("");
    expect(wrapCe("   ")).toBe("");
  });
});

describe("ceInner", () => {
  it("unwraps a pure \\ce{...} formula", () => {
    expect(ceInner("\\ce{2H2 + O2 -> 2H2O}")).toBe("2H2 + O2 -> 2H2O");
    expect(ceInner("  \\ce{H2O}  ")).toBe("H2O");
  });
  it("handles nested braces", () => {
    expect(ceInner("\\ce{Fe^{3+} + ^{235}_{92}U}")).toBe("Fe^{3+} + ^{235}_{92}U");
  });
  it("handles escaped braces", () => {
    expect(ceInner("\\ce{A\\}B}")).toBe("A\\}B");
  });
  it("unwraps the empty formula", () => {
    expect(ceInner("\\ce{}")).toBe("");
  });
  it("rejects anything that is not exactly one \\ce group", () => {
    expect(ceInner("x + \\ce{H2O}")).toBeNull();
    expect(ceInner("\\ce{H2O} = 1")).toBeNull();
    expect(ceInner("\\ce{A}\\ce{B}")).toBeNull();
    expect(ceInner("\\frac{a}{b}")).toBeNull();
    expect(ceInner("\\ce{unbalanced")).toBeNull();
    expect(ceInner("")).toBeNull();
  });
  it("stays lenient on a typo'd inner brace (never strands the user in the math editor)", () => {
    // "Fe^{3+" commits as \ce{Fe^{3+} — the sup group swallowed the wrapper's
    // closing brace. Reopening must land back in the chemistry editor, and the
    // next commit re-closes the group.
    expect(ceInner("\\ce{Fe^{3+}")).toBe("Fe^{3+}");
    expect(ceInner(wrapCe("Fe^{3+"))).toBe("Fe^{3+}");
  });
  it("round-trips with wrapCe", () => {
    for (const src of ["H2O", "SO4^2-", "CaCO3 ->[\\Delta] CaO + CO2 ^", "Fe^{3+}"]) {
      expect(ceInner(wrapCe(src))).toBe(src);
    }
  });
});

describe("chem block identity (attrs.kind)", () => {
  it("tagChem stamps attrs.kind = 'chem' and preserves other attrs", () => {
    expect(tagChem(displayFromSource("\\ce{H2O}")).attrs?.kind).toBe("chem");
    expect(tagChem({ id: "x", type: "math", attrs: { assetId: "a" } }).attrs).toEqual({
      assetId: "a",
      kind: "chem",
    });
  });
  it("isChemBlock reads the stored tag, not the LaTeX string", () => {
    // Tagged chem block → chem (identity is stored, can't be mis-sniffed).
    expect(isChemBlock(tagChem(displayFromSource("\\ce{H2O}")))).toBe(true);
    // Untagged pure-\ce block is NOT chem by tag — the editor's legacy path uses
    // ceInner for old notes, but the tag itself must stay string-independent.
    expect(isChemBlock(displayFromSource("\\ce{H2O}"))).toBe(false);
    // Only math blocks can be chemistry, tag or not.
    expect(isChemBlock({ id: "p", type: "text", value: "hi", attrs: { kind: "chem" } })).toBe(false);
  });
});

describe("documentToLatex mhchem requirement", () => {
  it("flags mhchem once when the document uses \\ce", () => {
    const tree = { ...emptyDocument(), blocks: [displayFromSource("\\ce{2H2 + O2 -> 2H2O}")] };
    const out = documentToLatex(tree);
    expect(out.startsWith("% requires \\usepackage[version=4]{mhchem}\n\n")).toBe(true);
    expect(out).toContain("\\ce{2H2 + O2 -> 2H2O}");
  });
  it("flags mhchem for inline chemistry in prose", () => {
    const tree = { ...emptyDocument(), blocks: [paragraphFromSource("Water is \\(\\ce{H2O}\\) at home.")] };
    expect(documentToLatex(tree)).toContain("% requires \\usepackage[version=4]{mhchem}");
  });
  it("stays silent for chemistry-free documents", () => {
    const tree = { ...emptyDocument(), blocks: [displayFromSource("\\frac{a}{b}"), paragraphFromSource("hello")] };
    expect(documentToLatex(tree)).not.toContain("mhchem");
  });
  it("ignores literal \\ce in verbatim surfaces (code listings)", () => {
    const code = { id: "c1", type: "code" as const, value: "\\ce{H2O} in a listing" };
    const tree = { ...emptyDocument(), blocks: [code] };
    expect(documentToLatex(tree)).not.toContain("mhchem");
  });
});
