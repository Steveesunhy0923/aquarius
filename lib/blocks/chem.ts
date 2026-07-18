/**
 * Chemistry (mhchem) helpers.
 *
 * A chemistry formula is stored exactly like any other formula — a `math`
 * block (or inline run) whose raw LaTeX is a single `\ce{...}` — so storage,
 * serialization, collab and export all work unchanged. What differs is the
 * EDITOR: chemistry is edited as plain mhchem source ("2H2 + O2 -> 2H2O",
 * "SO4^2-", "(aq)") in a text field with a live preview, not in MathLive.
 * These helpers convert between the stored LaTeX and that editable source.
 *
 * Chemistry identity is also STORED on the block (`attrs.kind = "chem"`) so the
 * chem and math editors never mis-claim each other's blocks — `ceInner` is only
 * the legacy/inline detector for untagged content.
 */

import type { Block } from "@/lib/blocks/types";

/** Wrap mhchem source for storage; empty source stays empty so an abandoned
 *  chemistry block counts as empty and gets auto-removed on exit. */
export function wrapCe(src: string): string {
  const s = src.trim();
  return s ? `\\ce{${s}}` : "";
}

/**
 * If `latex` is exactly ONE `\ce{...}` (nothing but whitespace around it,
 * braces balanced), return the inner mhchem source; otherwise null.
 *
 * This is the chemistry detector: pure-\ce formulas open in the chemistry
 * editor, anything else (mixed math like `K = \frac{[\ce{H+}]}{c}`) keeps the
 * regular math editor.
 */
export function ceInner(latex: string): string | null {
  const s = latex.trim();
  if (!s.startsWith("\\ce{") || !s.endsWith("}")) return null;
  let depth = 0;
  const open = "\\ce{".length - 1; // index of the opening brace
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; } // skip escaped char (incl. \{ \})
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        // The wrapping \ce must close at the very end of the string.
        return i === s.length - 1 ? s.slice(open + 1, i) : null;
      }
    }
  }
  // Unbalanced but still nothing-but-\ce (a typo like "Fe^{3+" swallowed the
  // wrapper's closing brace on commit): treat it as chemistry anyway and hand
  // back everything after the opening brace, so the block reopens in the
  // chemistry editor (the next commit's wrapCe re-closes it) instead of
  // stranding the user in the math editor with a broken machine-added \ce{.
  return s.slice(open + 1);
}

/** True when a block is an explicit chemistry formula — identity is STORED
 *  (attrs.kind = "chem"), not sniffed from the LaTeX. New \ce blocks are tagged
 *  at authoring time (see the editor's addBlock/commit). */
export function isChemBlock(block: Block): boolean {
  return block.type === "math" && block.attrs?.kind === "chem";
}

/** Tag a math block as a chemistry formula so it always reopens in the chem
 *  editor (and a math formula is never sniffed into it). Mirrors the
 *  structural-editor tag in lib/matheditor/structural.ts. */
export function tagChem(block: Block): Block {
  return { ...block, attrs: { ...(block.attrs ?? {}), kind: "chem" } };
}
