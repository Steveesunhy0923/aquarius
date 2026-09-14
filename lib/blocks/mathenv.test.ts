import { describe, expect, it } from "vitest";
import { ENV_COLS, ENV_ROWS, fillEnvCells, isCasesEnv, isGridEnv, showBlankCells, zeroFillCells } from "./mathenv";
import { previewLatex } from "./source";
import { SYMBOLS } from "@/lib/symbols";

describe("fillEnvCells", () => {
  it("expands a bare environment into a grid of the caller's cell", () => {
    expect(fillEnvCells("\\begin{bmatrix}\\end{bmatrix}", () => "#?")).toBe(
      "\\begin{bmatrix}#? & #?\\\\#? & #?\\end{bmatrix}",
    );
  });

  it("keeps the environment name, including starred and cased ones", () => {
    for (const env of ["pmatrix", "Vmatrix", "cases", "aligned", "smallmatrix", "align*"]) {
      const out = fillEnvCells(`\\begin{${env}}\\end{${env}}`, () => "");
      expect(out.startsWith(`\\begin{${env}}`), env).toBe(true);
      expect(out.endsWith(`\\end{${env}}`), env).toBe(true);
    }
  });

  it("calls cell() once per cell, so callers can hand out distinct values", () => {
    const letters = ["a", "b", "c", "d"];
    let i = 0;
    expect(fillEnvCells("\\begin{matrix}\\end{matrix}", () => letters[i++])).toBe(
      "\\begin{matrix}a & b\\\\c & d\\end{matrix}",
    );
    expect(i).toBe(ENV_ROWS * ENV_COLS);
  });

  it("leaves snippets without an environment untouched", () => {
    for (const s of ["\\frac{}{}", "\\alpha", "x^{}", ""]) expect(fillEnvCells(s, () => "#?")).toBe(s);
  });

  it("does not touch an environment that already has cells", () => {
    const filled = "\\begin{bmatrix}1 & 2\\\\3 & 4\\end{bmatrix}";
    expect(fillEnvCells(filled, () => "#?")).toBe(filled);
  });

  it("expands every environment in a compound snippet", () => {
    const out = fillEnvCells("\\begin{bmatrix}\\end{bmatrix}+\\begin{pmatrix}\\end{pmatrix}", () => "");
    expect(out).toBe("\\begin{bmatrix} & \\\\ & \\end{bmatrix}+\\begin{pmatrix} & \\\\ & \\end{pmatrix}");
  });

  it("does not pair up mismatched begin/end", () => {
    const mismatched = "\\begin{bmatrix}\\end{pmatrix}";
    expect(fillEnvCells(mismatched, () => "#?")).toBe(mismatched);
  });
});

describe("zeroFillCells", () => {
  it("defaults blank cells to 0", () => {
    expect(zeroFillCells("\\begin{bmatrix}1 & \\\\ & 4\\end{bmatrix}")).toBe(
      "\\begin{bmatrix}1 & 0\\\\0 & 4\\end{bmatrix}",
    );
  });

  it("treats MathLive's unfilled placeholder box as blank", () => {
    expect(zeroFillCells("\\begin{bmatrix}1 & \\placeholder{}\\\\\\placeholder{} & 4\\end{bmatrix}")).toBe(
      "\\begin{bmatrix}1 & 0\\\\0 & 4\\end{bmatrix}",
    );
  });

  it("fills a matrix the user never typed into", () => {
    expect(zeroFillCells("\\begin{bmatrix} & \\\\ & \\end{bmatrix}")).toBe(
      "\\begin{bmatrix}0 & 0\\\\0 & 0\\end{bmatrix}",
    );
  });

  it("keeps filled cells exactly as they are", () => {
    const full = "\\begin{pmatrix}a & b\\\\c & d\\end{pmatrix}";
    expect(zeroFillCells(full)).toBe(full);
  });

  it("handles rows of unequal length (a fresh column on one row only)", () => {
    expect(zeroFillCells("\\begin{bmatrix}1 & 2 & \\\\3 & 4\\end{bmatrix}")).toBe(
      "\\begin{bmatrix}1 & 2 & 0\\\\3 & 4\\end{bmatrix}",
    );
  });

  it("does not split on the & or \\\\ of a nested matrix", () => {
    expect(zeroFillCells("\\begin{bmatrix}\\begin{pmatrix}1 & \\end{pmatrix} & \\end{bmatrix}")).toBe(
      "\\begin{bmatrix}\\begin{pmatrix}1 & 0\\end{pmatrix} & 0\\end{bmatrix}",
    );
  });

  it("ignores cells inside braced groups", () => {
    const frac = "\\begin{bmatrix}\\frac{1}{2} & \\\\ & \\end{bmatrix}";
    expect(zeroFillCells(frac)).toBe("\\begin{bmatrix}\\frac{1}{2} & 0\\\\0 & 0\\end{bmatrix}");
  });

  it("leaves non-grid environments alone — a blank line there is meaningful", () => {
    const aligned = "\\begin{aligned}x & = 1\\\\ & \\end{aligned}";
    expect(zeroFillCells(aligned)).toBe(aligned);
    expect(isGridEnv("aligned")).toBe(false);
    expect(isGridEnv("displaylines")).toBe(false);
  });

  it("grows `cases` with the grid keys but never writes 0 into a condition", () => {
    // The second column of `cases` holds conditions, not numbers — a blank one
    // is something the author still owes, and `0` would state it falsely.
    expect(isGridEnv("cases")).toBe(true);
    const cases = "\\begin{cases}x & \\\\ & \\end{cases}";
    expect(zeroFillCells(cases)).toBe(cases);
  });

  it("leaves maths with no environment untouched", () => {
    for (const s of ["x+1", "\\frac{a}{b}", ""]) expect(zeroFillCells(s)).toBe(s);
  });

  it("passes an unterminated environment through rather than mangling it", () => {
    const broken = "\\begin{bmatrix}1 & 2";
    expect(zeroFillCells(broken)).toBe(broken);
  });

  it("takes a custom filler", () => {
    expect(zeroFillCells("\\begin{bmatrix}1 & \\\\ & \\end{bmatrix}", "\\cdot")).toBe(
      "\\begin{bmatrix}1 & \\cdot\\\\\\cdot & \\cdot\\end{bmatrix}",
    );
  });
});

describe("showBlankCells", () => {
  it("gives an empty matrix a box in every cell", () => {
    expect(showBlankCells("\\begin{bmatrix} & \\\\ & \\end{bmatrix}")).toBe(
      "\\begin{bmatrix}\\placeholder{} & \\placeholder{}\\\\\\placeholder{} & \\placeholder{}\\end{bmatrix}",
    );
  });

  it("covers `cases` too — the empty brace zeroFillCells deliberately leaves", () => {
    // The bug this exists for: a stored `cases` has no cells at all, so MathLive
    // showed one big brace with nothing to click into.
    const stored = "\\begin{cases} & \\\\ & \\end{cases}";
    expect(zeroFillCells(stored)).toBe(stored);
    expect(showBlankCells(stored)).toBe(
      "\\begin{cases}\\placeholder{} & \\placeholder{}\\\\\\placeholder{} & \\placeholder{}\\end{cases}",
    );
  });

  it("keeps every cell that has content", () => {
    expect(showBlankCells("\\begin{cases}x & x>0\\\\ & \\end{cases}")).toBe(
      "\\begin{cases}x & x>0\\\\\\placeholder{} & \\placeholder{}\\end{cases}",
    );
  });

  it("is idempotent — a box stays one box", () => {
    const once = showBlankCells("\\begin{bmatrix}1 & \\end{bmatrix}");
    expect(showBlankCells(once)).toBe(once);
  });

  it("leaves non-grid environments and plain maths alone", () => {
    for (const s of ["\\begin{aligned}x & = 1\\\\ & \\end{aligned}", "x+1", ""]) {
      expect(showBlankCells(s)).toBe(s);
    }
  });

  it("reaches a matrix nested inside an environment it does not fill", () => {
    expect(showBlankCells("\\begin{aligned}A & = \\begin{bmatrix}1 & \\end{bmatrix}\\end{aligned}")).toBe(
      "\\begin{aligned}A & = \\begin{bmatrix}1 & \\placeholder{}\\end{bmatrix}\\end{aligned}",
    );
  });
});

describe("isCasesEnv", () => {
  it("singles `cases` out of the grids — it has fixed columns and no zeros", () => {
    expect(isCasesEnv("cases")).toBe(true);
    for (const env of ["matrix", "bmatrix", "pmatrix", "smallmatrix", "aligned"]) {
      expect(isCasesEnv(env), env).toBe(false);
    }
  });
});

describe("previewLatex on catalog templates", () => {
  // The picker renders every entry through previewLatex; an entry that previews
  // empty is one the user cannot tell apart from its neighbours.
  const envEntries = SYMBOLS.filter((s) => /\\begin\{[A-Za-z]+\*?\}\s*\\end\{/.test(s.latex));

  it("covers the catalog's environment entries", () => {
    expect(envEntries.length).toBeGreaterThanOrEqual(9);
  });

  it("previews a delimited environment as its delimiters around one empty cell", () => {
    // One cell, so the icon is the height of a single glyph like `\alpha`. A
    // row break here would double it and tower over every neighbouring entry.
    for (const name of ["parenthesized matrix", "bracket matrix", "determinant matrix", "cases"]) {
      const entry = SYMBOLS.find((s) => s.name.startsWith(name))!;
      const preview = previewLatex(entry.latex);
      expect(preview, name).toMatch(/^\\begin\{([A-Za-z]+)\} \\end\{\1\}$/);
      expect(preview, name).not.toContain("\\\\");
    }
  });

  it("still gives sample cells to environments that draw nothing", () => {
    // `matrix` / `smallmatrix` / `aligned` have no delimiters, so delimiters
    // alone would be a blank row in the picker.
    for (const name of ["matrix (template)", "smallmatrix", "aligned"]) {
      const entry = SYMBOLS.find((s) => s.name.startsWith(name))!;
      expect(previewLatex(entry.latex), name).toMatch(/[a-z] & [a-z]\\\\[a-z] & [a-z]/);
    }
  });

  it("previews every environment entry as a balanced environment", () => {
    for (const s of envEntries) {
      expect(previewLatex(s.latex), s.name).toMatch(/^\\begin\{([A-Za-z]+\*?)\}.*\\end\{\1\}$/);
    }
  });
});
