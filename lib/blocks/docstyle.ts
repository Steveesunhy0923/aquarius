/**
 * Shared document-style constants (page geometry, fonts, LaTeX metrics) used by
 * the editor, the library cover thumbnails and the PDF export, so a note looks
 * the same in all three.
 *
 * The default is the LaTeX look: `article` at 11pt in Computer Modern, on
 * LaTeX's own baseline. Every number below is taken from `size11.clo` and the
 * export preamble (lib/export/pdf.ts) rather than eyeballed, which is what
 * makes the on-screen page and the typeset PDF agree — with ONE deliberate
 * departure, the paragraph shape: see LATEX_STYLE.indent.
 *
 * Notes created before 0.8.1 have no `style.preset` and keep the looser,
 * web-ish look they were written in — see PLAIN below.
 */

import { INDENT_STEP_PX } from "./indent";
import type { DocPreset, DocumentStyle } from "./types";

export const A4_W = 794; // A4 width  in px @ 96dpi (210mm)
export const A4_H = 1123; // A4 height in px @ 96dpi (297mm)

/** CSS's own conversion factors at 96dpi. `pt` here is the TeX point CSS uses. */
export const PX_PER_PT = 96 / 72;
export const PX_PER_MM = 96 / 25.4;

export const ptToPx = (pt: number): number => pt * PX_PER_PT;
export const pxToPt = (px: number): number => px / PX_PER_PT;
export const pxToMm = (px: number): number => px / PX_PER_MM;

/**
 * LaTeX `article` metrics, 11pt class option.
 *
 *   \normalsize   10.95pt on a 13.6pt baseline   (size11.clo)
 *   \parindent    17pt
 *   \parskip      0pt plus 1pt                   → 0 for our purposes
 *   margins       2.2cm, from \usepackage[a4paper,margin=2.2cm]{geometry}
 */
export const TEX = {
  /** The `\documentclass[Npt]` option. Its \normalsize is NOT N pt — see below. */
  classPt: 11,
  normalPt: 10.95,
  baselinePt: 13.6,
  parindentPt: 17,
  marginMm: 22,
} as const;

/** LaTeX's own `\parindent` in em. Still offered in the inspector (INDENTS),
 *  but no longer the default — see LATEX_STYLE.indent. */
export const TEX_INDENT = round(TEX.parindentPt / TEX.normalPt, 4); // 1.5525em

/** The default document style: what LaTeX would give you, except that nothing
 *  indents itself. A first line the writer did not ask for is text they have to
 *  notice and undo; indentation here is something you TYPE (Tab in a
 *  paragraph), never something the document does on their behalf. Paragraphs
 *  are then separated by a skip instead — the `parskip` treatment, which is the
 *  standard pairing for zero indent and the only thing that keeps justified
 *  paragraphs from running into one wall of text. */
export const LATEX_STYLE: Required<
  Pick<DocumentStyle, "preset" | "fontFamily" | "fontSize" | "lineSpacing" | "indent">
> = {
  preset: "latex",
  fontFamily: "Computer Modern",
  fontSize: round(ptToPx(TEX.normalPt), 2), // 14.6px
  lineSpacing: round(TEX.baselinePt / TEX.normalPt, 4), // 1.242
  indent: 0,
};

/** The pre-0.8.1 look, kept so existing notes are not restyled under the user. */
const PLAIN = {
  fontSize: 14,
  lineSpacing: 1.5,
  indent: 0,
} as const;

/** Rules that follow from the preset rather than from a user-set field. */
const PRESET_RULES: Record<DocPreset, { align: "left" | "justify"; paraSkip: number; marginRatio: number }> = {
  // A paragraph skip is what separates paragraphs, since nothing indents (see
  // LATEX_STYLE.indent). 9px at the 14.6px body is half a baseline — what
  // `\usepackage{parskip}` gives you — and pdf.ts re-derives \parskip from it,
  // so the page and the typeset PDF still agree. The margin is a fraction of
  // the page WIDTH so page zoom scales it.
  latex: { align: "justify", paraSkip: 9, marginRatio: (TEX.marginMm * PX_PER_MM) / A4_W },
  plain: { align: "left", paraSkip: 4, marginRatio: 0.09 },
};

export const FONTS: Record<string, string> = {
  // "CMU Serif" is the vendored Computer Modern (scripts/prepare-fonts.mjs);
  // the rest are fallbacks for a TeX install's own names.
  "Computer Modern":
    '"CMU Serif", "Latin Modern Roman", "Computer Modern Serif", Georgia, serif',
  Serif: 'Georgia, "Times New Roman", serif',
  "Sans-serif": "ui-sans-serif, system-ui, -apple-system, sans-serif",
  Monospace: 'ui-monospace, "SF Mono", Menlo, monospace',
};

/**
 * Offered body sizes: stored in px, chosen as LaTeX point sizes. The label is
 * the `\documentclass` option, not the resulting body size — those differ for
 * exactly one entry, since `[11pt]` sets \normalsize to 10.95pt, and a menu
 * reading "10.95pt" would look like a bug rather than like fidelity.
 */
export interface FontSizeOption {
  px: number;
  label: string;
}
export const FONT_SIZES: FontSizeOption[] = [8, 9, 10, TEX.classPt, 12, 14, 17, 20].map(
  (pt) => ({
    px: round(ptToPx(pt === TEX.classPt ? TEX.normalPt : pt), 2),
    label: `${pt}pt`,
  }),
);

/** The size list, with a document's own size added if it isn't on it (see
 *  `optionsWith` — same reasoning, different element shape). */
export function fontSizeOptions(current: number): FontSizeOption[] {
  const has = FONT_SIZES.some((o) => Math.abs(o.px - current) < 1e-6);
  return has
    ? FONT_SIZES
    : [...FONT_SIZES, { px: current, label: ptLabel(current) }].sort((a, b) => a.px - b.px);
}
export const LINE_SPACINGS = [1, 1.15, LATEX_STYLE.lineSpacing, 1.5, 2];
export const INDENTS = [0, 1, TEX_INDENT, 2];

export function fontFamilyOf(key: string | undefined): string {
  return FONTS[key ?? LATEX_STYLE.fontFamily] ?? FONTS[LATEX_STYLE.fontFamily];
}

/** Every value the renderers need, with preset-aware defaults filled in. */
export interface ResolvedStyle {
  preset: DocPreset;
  fontKey: string;
  fontFamily: string;
  fontSize: number; // px
  lineSpacing: number; // multiplier
  indent: number; // first-line indent, em
  paraSkip: number; // gap between sibling blocks, px
  align: "left" | "justify";
  /** Page margin as a fraction of page width, so it scales with zoom. */
  marginRatio: number;
  pageLayout: "vertical" | "horizontal";
}

/**
 * Fill in a document's style. A note with no style at all is a pre-0.8.1 note,
 * so it resolves to "plain"; anything created since carries `preset: "latex"`
 * (see `emptyDocument`). Individual fields always win over the preset, so the
 * DocumentInspector's font/size/spacing/indent controls keep working either way.
 */
export function resolveStyle(style: DocumentStyle | undefined): ResolvedStyle {
  const preset: DocPreset = style?.preset ?? "plain";
  const base = preset === "latex" ? LATEX_STYLE : PLAIN;
  const rules = PRESET_RULES[preset];
  const fontKey = style?.fontFamily ?? LATEX_STYLE.fontFamily;
  return {
    preset,
    fontKey,
    fontFamily: fontFamilyOf(fontKey),
    fontSize: style?.fontSize ?? base.fontSize,
    lineSpacing: style?.lineSpacing ?? base.lineSpacing,
    indent: storedIndent(style, base.indent),
    paraSkip: rules.paraSkip,
    align: rules.align,
    marginRatio: rules.marginRatio,
    pageLayout: style?.pageLayout ?? "vertical",
  };
}

/**
 * The first-line indent a note asked for.
 *
 * Notes created before the LaTeX preset stopped indenting (2026-09-09) stored
 * its 17pt `\parindent` in their style the moment they were made, so the value
 * alone cannot say whether anyone chose it. The inspector marks a real choice
 * with `indentChosen`; without that mark the old default reads as the new one,
 * the Google Docs rule that a paragraph indents only when you indent it.
 */
function storedIndent(style: DocumentStyle | undefined, fallback: number): number {
  const v = style?.indent;
  if (v == null) return fallback;
  if (!style?.indentChosen && Math.abs(v - TEX_INDENT) < 1e-6) return fallback;
  return v;
}

/**
 * The paragraphs that take NO first-line indent: the document's first one, and
 * the one that opens a section (`\@afterindentfalse` — LaTeX indents every
 * paragraph of a section except the one right under its heading).
 *
 * Computed here from the whole block list rather than in CSS, because the
 * editor paginates: `:first-child` would match the first block of every *page*,
 * and an adjacent-sibling rule would break wherever a heading and its opening
 * paragraph land on different pages.
 */
export function unindentedParagraphs(blocks: { id: string; type: string }[]): Set<string> {
  const out = new Set<string>();
  blocks.forEach((b, i) => {
    if (b.type !== "text") return;
    if (i === 0 || blocks[i - 1]?.type === "heading") out.add(b.id);
  });
  return out;
}

/**
 * The typographic class on the page-content element. Block-level spacing
 * (section skips, \abovedisplayskip, list skips) lives in app/globals.css under
 * `.aq-tex`, because it is a *relationship* between blocks — expressing it in
 * per-block inline styles would mean every renderer re-deriving the same rules.
 */
export const presetClass = (preset: DocPreset): string =>
  preset === "latex" ? "aq-tex" : "";

/** Inline style for the padded content box of a page (or a cover thumbnail). */
export function pageContentStyle(r: ResolvedStyle, pageW: number): Record<string, string | number> {
  return {
    padding: Math.round(pageW * r.marginRatio),
    fontSize: `${r.fontSize}px`,
    fontFamily: r.fontFamily,
    lineHeight: r.lineSpacing,
    textAlign: r.align,
    "--indent": `${r.indent}em`,
    "--para-skip": `${r.paraSkip}px`,
    // Half an inch of THIS sheet: paragraph indents and list levels are
    // measured in it (lib/blocks/indent.ts), so they scale with the page zoom.
    "--indent-step": `${round((INDENT_STEP_PX * pageW) / A4_W, 2)}px`,
  };
}

/** The style patch that applies a preset, clearing the fields it owns. */
export function presetPatch(preset: DocPreset): Partial<DocumentStyle> {
  return preset === "latex"
    ? { ...LATEX_STYLE }
    : { preset: "plain", ...PLAIN, fontFamily: LATEX_STYLE.fontFamily };
}

/**
 * Select options for a numeric style field. A note may hold a value the list
 * does not offer (an older default, or a preset the user has since left); it is
 * appended rather than dropped, or the `<select>` would render blank and the
 * first edit would silently restyle the document.
 */
export function optionsWith(values: number[], current: number): number[] {
  const has = values.some((v) => Math.abs(v - current) < 1e-6);
  return has ? values : [...values, current].sort((a, b) => a - b);
}

/** 14.6 → "11pt". Sizes are stored in px but chosen in points. */
export const ptLabel = (px: number): string => `${round(pxToPt(px), 2)}pt`;

/** 1.242 → "1.24" — display precision only; the stored value stays exact. */
export const numLabel = (n: number, dp = 2): string => String(round(n, dp));

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
