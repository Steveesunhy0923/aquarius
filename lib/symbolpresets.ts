/**
 * Symbol-strip presets — the toolbar's symbol slots, saved as named sets.
 *
 * The strip only has room for a handful of symbols, and which handful is right
 * depends entirely on what you are writing: a linear-algebra sheet wants `det`
 * and bracket matrices, a calculus one wants ∂ and lim, and neither wants the
 * other's. Rather than one compromise row that everybody re-edits, the strip
 * carries a *preset* — a named list of entries — that switches in one click.
 *
 * Built-ins cover the common courses; users save their own from whatever the
 * strip currently holds (see `saveUserPreset`), so a personal row survives
 * beyond the session that built it. Both kinds are just `{ name, symbols }`.
 *
 * CONTRACT (inherited from lib/symbols.ts): every entry must render in KaTeX,
 * because the strip and the picker show a live preview of each one. Entries use
 * the same empty-brace convention as the catalog — `\vec{}` — so insertion
 * turns them into tabbable placeholder boxes and previews fill them with sample
 * letters. Enforced by lib/symbolpresets.test.ts.
 */

const uid = (): string => crypto.randomUUID();

export interface SymbolPreset {
  id: string;
  name: string;
  /** What the strip's symbol slots hold, left to right. */
  symbols: string[];
  /** One line naming the scenario, shown in the preset menu. */
  scenario?: string;
}

/** The strip's stock row — what a fresh install shows. */
export const DEFAULT_PRESET_ID = "general";

export const BUILTIN_PRESETS: SymbolPreset[] = [
  {
    id: DEFAULT_PRESET_ID,
    name: "General",
    scenario: "Everyday relations and operators.",
    symbols: ["\\infty", "\\rightarrow", "\\in", "\\leq", "\\geq", "\\neq", "\\pm", "\\times"],
  },
  {
    id: "linear-algebra",
    name: "Linear algebra",
    scenario: "Determinants, matrices, transposes, products.",
    symbols: [
      "\\det({})",
      "\\begin{bmatrix}\\end{bmatrix}",
      "\\begin{vmatrix}\\end{vmatrix}",
      "^{T}",
      "\\vec{}",
      "\\langle {},{} \\rangle",
      "\\cdot",
      "\\times",
    ],
  },
  {
    id: "calculus",
    name: "Calculus",
    scenario: "Integrals, derivatives, limits.",
    // No plain ∫ or ∑ here: both sit in the fixed structures to the left, and a
    // slot spent repeating them is a slot not spent on ∂ or lim.
    symbols: ["\\iint", "\\oint", "\\frac{d}{d{}}", "\\partial", "\\nabla", "\\lim_{{} \\to {}}", "\\infty", "\\to"],
  },
  {
    id: "statistics",
    name: "Statistics",
    scenario: "Means, spreads, distributions, probability.",
    symbols: ["\\bar{}", "\\hat{}", "\\mu", "\\sigma", "\\sigma^{2}", "P({})", "\\binom{}{}", "\\sim"],
  },
  {
    id: "sets-logic",
    name: "Sets & logic",
    scenario: "Membership, set algebra, quantifiers.",
    symbols: ["\\in", "\\notin", "\\subseteq", "\\cup", "\\cap", "\\emptyset", "\\forall", "\\implies"],
  },
  {
    id: "physics",
    name: "Physics",
    scenario: "Vectors, fields, constants, proportionality.",
    symbols: ["\\vec{}", "\\hbar", "\\nabla", "\\partial", "\\Delta", "\\omega", "\\propto", "\\approx"],
  },
  {
    id: "greek",
    name: "Greek",
    scenario: "The letters that come up most.",
    // α and π are always present in the fixed structures, so the row spends its
    // slots on the ones that aren't.
    symbols: ["\\beta", "\\gamma", "\\delta", "\\theta", "\\lambda", "\\mu", "\\sigma", "\\omega"],
  },
];

/** Longest row a preset may define. The strip wraps to a second line past
 *  roughly this many, at which point scanning it is slower than the picker. */
export const MAX_PRESET_SYMBOLS = 8;

export const builtinPreset = (id: string): SymbolPreset | undefined =>
  BUILTIN_PRESETS.find((p) => p.id === id);

// ─── User presets (localStorage, like saved modules/templates) ────────────────

const LS_PRESETS = "aquarius.symbolpresets.v1";

function read(): SymbolPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_PRESETS);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (p): p is SymbolPreset =>
        !!p &&
        typeof (p as SymbolPreset).id === "string" &&
        typeof (p as SymbolPreset).name === "string" &&
        Array.isArray((p as SymbolPreset).symbols),
    );
  } catch {
    return [];
  }
}

function write(list: SymbolPreset[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_PRESETS, JSON.stringify(list)); } catch { /* quota — nothing to do */ }
}

export function listUserPresets(): SymbolPreset[] {
  return read();
}

/** Save the strip as a named preset; newest first, so it heads the menu. */
export function saveUserPreset(name: string, symbols: string[]): SymbolPreset {
  const preset: SymbolPreset = { id: uid(), name: name.trim(), symbols: symbols.slice(0, MAX_PRESET_SYMBOLS) };
  write([preset, ...read()]);
  return preset;
}

export function renameUserPreset(id: string, name: string): void {
  write(read().map((p) => (p.id === id ? { ...p, name: name.trim() } : p)));
}

export function deleteUserPreset(id: string): void {
  write(read().filter((p) => p.id !== id));
}

// ─── Which preset the strip is currently showing ──────────────────────────────

const sameRow = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);

/**
 * The preset the strip is showing, or null for a row that matches none of them
 * ("Custom"). DERIVED from the symbols rather than stored alongside them: a
 * remembered id drifts the moment a slot is edited, and would have to be kept
 * in step with every edit, apply, save and delete. Reading it back off the row
 * cannot disagree with the row.
 *
 * User presets are checked first, so someone who saves their own copy of a
 * built-in row sees the name they chose for it.
 */
export function matchPresetId(symbols: string[], userPresets: SymbolPreset[] = []): string | null {
  return [...userPresets, ...BUILTIN_PRESETS].find((p) => sameRow(p.symbols, symbols))?.id ?? null;
}
