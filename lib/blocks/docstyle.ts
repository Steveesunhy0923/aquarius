/**
 * Shared document-style constants (page geometry + font options) used by both
 * the editor and the library cover thumbnails so they render consistently.
 */

export const A4_W = 794; // A4 width  in px @ 96dpi (210mm)
export const A4_H = 1123; // A4 height in px @ 96dpi (297mm)

export const FONTS: Record<string, string> = {
  "Computer Modern":
    '"Computer Modern Serif", "Latin Modern Roman", "CMU Serif", Georgia, serif',
  Serif: 'Georgia, "Times New Roman", serif',
  "Sans-serif": 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  Monospace: 'ui-monospace, "SF Mono", Menlo, monospace',
};
export const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24];
export const LINE_SPACINGS = [1, 1.15, 1.5, 2];
export const INDENTS = [0, 1, 1.5, 2];

export function fontFamilyOf(key: string | undefined): string {
  return FONTS[key ?? "Computer Modern"] ?? FONTS["Computer Modern"];
}
