/**
 * Preset entries obey the same contract as the symbol catalog: every one has to
 * render in KaTeX, because the strip draws each slot as a live preview — a bad
 * entry shows up as red error text sitting in the toolbar. The insert forms are
 * exercised too, since that is what the entry actually becomes when clicked.
 */

import katex from "katex";
import { describe, expect, it } from "vitest";

import { fillEnvCells } from "./blocks/mathenv";
import { previewLatex } from "./blocks/source";
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID, MAX_PRESET_SYMBOLS, builtinPreset, matchPresetId, type SymbolPreset } from "./symbolpresets";

const render = (latex: string) => katex.renderToString(latex, { throwOnError: true });
const entries = BUILTIN_PRESETS.flatMap((p) => p.symbols.map((latex) => ({ preset: p.name, latex })));

describe("built-in symbol presets", () => {
  it("every entry renders as the strip previews it", () => {
    for (const e of entries) {
      expect(() => render(previewLatex(e.latex)), `${e.preset}: preview of ${e.latex}`).not.toThrow();
    }
  });

  it("every entry renders in the form a new equation block stores", () => {
    // The no-focus insert path writes KaTeX-safe LaTeX straight into a block
    // (EditorClient.onInsert), with environment cells left empty.
    for (const e of entries) {
      const stored = fillEnvCells(e.latex, () => "");
      expect(() => render(stored), `${e.preset}: stored form of ${e.latex}`).not.toThrow();
    }
  });

  it("marks its holes with empty braces so inserts are tabbable", () => {
    // `\det({})` becomes `\det(#?)` in a math field; an entry written `\det(x)`
    // would insert a stray x instead of a box to type in.
    const templates = entries.filter((e) => /\{\}|\\begin\{/.test(e.latex));
    expect(templates.length).toBeGreaterThan(5);
    for (const e of templates) {
      const inserted = fillEnvCells(e.latex.replace(/\{\}/g, "{#?}"), () => "#?");
      expect(inserted, `${e.preset}: ${e.latex}`).toContain("#?");
    }
  });

  it("keeps preset names and ids unique", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    const names = BUILTIN_PRESETS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("fits every preset in the strip", () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.symbols.length, p.name).toBeGreaterThan(0);
      expect(p.symbols.length, p.name).toBeLessThanOrEqual(MAX_PRESET_SYMBOLS);
      expect(new Set(p.symbols).size, `${p.name} repeats a symbol`).toBe(p.symbols.length);
    }
  });

  it("ships the default the strip falls back to", () => {
    expect(builtinPreset(DEFAULT_PRESET_ID)).toBeDefined();
    expect(builtinPreset("no-such-preset")).toBeUndefined();
  });

  it("covers the scenarios the strip is meant to switch between", () => {
    for (const id of ["linear-algebra", "calculus", "statistics", "sets-logic", "physics"]) {
      expect(builtinPreset(id), id).toBeDefined();
    }
    // The two the request named specifically.
    expect(builtinPreset("linear-algebra")!.symbols).toContain("\\det({})");
    expect(builtinPreset("linear-algebra")!.symbols).toContain("\\begin{bmatrix}\\end{bmatrix}");
    // Calculus carries what the fixed structures DON'T: ∫ and ∑ are always on
    // the strip already, so the row spends its slots on derivatives and limits.
    const calculus = builtinPreset("calculus")!.symbols;
    expect(calculus).toContain("\\partial");
    expect(calculus.some((s) => s.startsWith("\\lim"))).toBe(true);
    expect(calculus).not.toContain("\\int_{}^{}");
  });
});

describe("matchPresetId", () => {
  const custom: SymbolPreset = { id: "u1", name: "Mine", symbols: ["\\alpha", "\\beta"] };

  it("names a row that matches a built-in", () => {
    expect(matchPresetId(builtinPreset("calculus")!.symbols)).toBe("calculus");
  });

  it("returns null for a row that matches nothing (shown as Custom)", () => {
    const edited = [...builtinPreset("calculus")!.symbols];
    edited[0] = "\\heartsuit";
    expect(matchPresetId(edited)).toBeNull();
    expect(matchPresetId([])).toBeNull();
  });

  it("is order- and length-sensitive", () => {
    const p = builtinPreset("greek")!.symbols;
    expect(matchPresetId([...p].reverse())).toBeNull();
    expect(matchPresetId(p.slice(0, -1))).toBeNull();
  });

  it("prefers the user's own name for a row they saved", () => {
    expect(matchPresetId(custom.symbols, [custom])).toBe("u1");
    const generalRow = builtinPreset("general")!.symbols;
    const shadow: SymbolPreset = { id: "u2", name: "My general", symbols: [...generalRow] };
    expect(matchPresetId(generalRow, [shadow])).toBe("u2");
  });
});
