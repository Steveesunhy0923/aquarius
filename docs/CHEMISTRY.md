# Chemistry Input

Chemistry is a **parallel input system** to math: its own symbol catalog, its own
toolbar strip, its own picker, and its own editors — deliberately mirroring the
math system's architecture without mixing content. Storage is unchanged: a
chemistry formula is an ordinary `math` block (or inline `\(...\)` run) whose raw
LaTeX is a single mhchem `\ce{...}`, so serialization, collab, export and search
all work with zero schema changes.

## How users write chemistry

Chemistry is typed as **plain mhchem source** — the notation mhchem designed to
be natural for chemists — with a live rendered preview:

```
2H2 + O2 ->[\Delta] 2H2O      reaction with heat over the arrow
SO4^2-                        charges
NaCl(aq), AgCl v, CO2 ^       states, precipitate, gas evolved
^{235}_{92}U                  isotopes
CuSO4 * 5H2O                  hydrates
```

No LaTeX knowledge needed; no MathLive box-editing (linear text is a better fit
for reaction equations than structural navigation).

## The pieces (all mirroring a math twin)

| Chemistry                                   | Math twin                        |
| ------------------------------------------- | -------------------------------- |
| `lib/chemsymbols.ts` catalog (~125 entries) | `lib/symbols.ts`                 |
| `components/ChemToolbar.tsx` strip          | `components/SymbolToolbar.tsx`   |
| Chemistry library picker (`SymbolPicker` with `symbols={CHEM_SYMBOLS}`) | the same `SymbolPicker` |
| `components/ChemField.tsx` (source input + live KaTeX preview, active-field registry) | `components/MathField.tsx` |
| `ChemFormulaBox` (in `FormulaEditBox.tsx`)  | `FormulaEditBox`                 |
| `InlineChemPopover` + "Insert chemistry" (in `EditBox.tsx`) | `InlineMathPopover` + "Insert math" |
| `onInsertChem` routing (editor page)        | `onInsert`                       |

The **Σ / ⚗ switch** at the left of the symbol strip swaps the whole bar between
the math set and the chemistry set (persisted in `localStorage` under
`aquarius.symbolbar`, like the editable slot keys `aquarius.symbols` /
`aquarius.chemsymbols`). This is how "chemistry replaces the default symbol bar"
works — one click, and the strip is arrows/states/species instead of ∑/∫/π.

## Key mechanics

- **Rendering**: `components/Katex.tsx` side-effect-imports `katex/contrib/mhchem`,
  which registers `\ce`/`\pu` on the katex singleton — every render surface
  (blocks, inline chips, tables, pickers, print, /ink) gets chemistry for free.
- **Detection, not tagging**: `lib/blocks/chem.ts` `ceInner()` decides whether a
  formula is "pure chemistry" (exactly one balanced `\ce{...}`). Such blocks and
  inline chips reopen in the chemistry editor with their inner source as the
  draft; mixed math (e.g. `K = \frac{[\ce{H+}]}{c}`) keeps MathLive. `wrapCe()`
  re-wraps on commit and returns `""` for empty source, so an abandoned block
  auto-removes like an empty math block.
- **Insert routing** (`onInsertChem`): focused ChemField → splice bare source at
  the caret ($-escaping non-`\ce` entries like `\Delta H` / `\pu{...}`); focused
  MathLive/structural editor → insert the full LaTeX (MathLive parses `\ce`
  natively); editing prose → inline chemistry popover; otherwise → new chemical
  equation block. It deliberately **skips** `onInsert`'s `{}`→placeholder
  rewriting — mhchem braces are literal content.
- **Export**: body-only `.tex` gains a document-level
  `% requires \usepackage[version=4]{mhchem}` comment when `\ce`/`\pu` appear
  (the per-fragment "% requires" convention, hoisted because chemistry can occur
  in any math fragment).
- **Catalog contract**: every `lib/chemsymbols.ts` entry must render in
  KaTeX+mhchem; `lib/chemsymbols.test.ts` enforces it (previews AND the exact
  forms the routing inserts). Keep entries narrow — wide reaction previews clip
  in the picker grid.

## Known limitations / later

- **Table cells**: chemistry renders in cells (they're MathLive-backed), but cell
  `.tex` export escapes backslashes (`lib/blocks/tables.ts` `escapeCell`) — a
  pre-existing limitation for ALL cell math, inherited by `\ce`.
- **Lists/headings** can't carry math at all (pre-existing), so no inline
  chemistry there either.
- **Structural beta editor** stores an inserted `\ce{...}` as one opaque atom —
  renders/serializes fine, no in-place chem editing.
- **Chemistry handwriting** (planned): the /ink pipeline is already
  LaTeX-string-based end to end (`components/ink/InkInsertPanel.tsx` →
  `onInsert`), so a chemistry-capable recognition model only needs to emit
  `\ce{...}` strings — route its output through `onInsertChem` for the chem-aware
  landing. Training data: mhchem sources are linear text, so a synthetic
  renderer→strokes pipeline like `ml/`'s MathWriting setup should transfer.
