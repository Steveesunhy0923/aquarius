/**
 * The chemistry catalog's contract (mirroring lib/symbols.ts's rule): every
 * entry MUST render in KaTeX with mhchem loaded — the picker/toolbar show live
 * previews, and a broken entry would surface as red error text in the UI.
 * Also exercises the two insertion forms the routing produces (see
 * app/editor/[id]/page.tsx onInsertChem).
 */

import katex from "katex";
import "katex/contrib/mhchem";
import { describe, expect, it } from "vitest";

import { ceInner } from "./blocks/chem";
import { previewLatex } from "./blocks/source";
import { CHEM_SYMBOLS } from "./chemsymbols";

const render = (latex: string) => katex.renderToString(latex, { throwOnError: true });

describe("chemistry catalog", () => {
  it("every entry renders in KaTeX+mhchem (picker preview contract)", () => {
    for (const s of CHEM_SYMBOLS) {
      expect(() => render(previewLatex(s.latex)), `preview of ${s.latex}`).not.toThrow();
    }
  });

  it("every entry renders in the form the chemistry field receives", () => {
    for (const s of CHEM_SYMBOLS) {
      const src = ceInner(s.latex);
      // \ce entries splice their bare source into the field (rendered back
      // inside \ce{...}); non-\ce entries embed as mhchem's $math$ escape.
      const inField = src != null ? `\\ce{${src}}` : `\\ce{H2O $${s.latex}$}`;
      expect(() => render(inField), `chem-field form of ${s.latex}`).not.toThrow();
    }
  });

  it("keeps names unique so search/labels stay unambiguous", () => {
    const names = CHEM_SYMBOLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("stays a chemistry-only catalog (\\ce, \\pu, or Quantities math)", () => {
    for (const s of CHEM_SYMBOLS) {
      const chemish = /\\(?:ce|pu)\{/.test(s.latex) || s.category === "Quantities" || s.category === "Isotopes & nuclear";
      expect(chemish, `${s.name} (${s.latex}) looks out of place`).toBe(true);
    }
  });
});
