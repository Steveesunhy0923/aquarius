/**
 * Callout ("colored box") styling.
 *
 * A callout is a paragraph (`text` block) carrying `attrs.calloutColor = <hex>`.
 * It reuses all paragraph editing and just renders inside a colored box. The
 * user picks from 7 default colors or any custom hex (#000000–#FFFFFF).
 */

import type { Block } from "@/lib/blocks/types";

/** Seven default callout background colors (no black, no white). */
export const CALLOUT_COLORS = [
  "#fef3c7", // amber
  "#d1fae5", // green
  "#dbeafe", // blue
  "#fee2e2", // red
  "#ede9fe", // purple
  "#ffedd5", // orange
  "#cffafe", // cyan
];

/** Legacy named variants → color (back-compat with earlier callout blocks). */
const LEGACY_COLOR: Record<string, string> = {
  note: "#fef3c7",
  tip: "#d1fae5",
  info: "#dbeafe",
  warning: "#fee2e2",
};

/** Valid `#RRGGBB` hex color string? */
export function isHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

/** The callout background color of a block, or null if it isn't a callout. */
export function calloutColorOf(block: Block): string | null {
  const c = block.attrs?.calloutColor;
  if (typeof c === "string" && isHexColor(c)) return c;
  const legacy = block.attrs?.callout; // migrate older variant blocks
  if (typeof legacy === "string" && legacy in LEGACY_COLOR)
    return LEGACY_COLOR[legacy];
  return null;
}

/** Return a copy of `block` with the given callout color set (or cleared). */
export function withCalloutColor(block: Block, color: string | null): Block {
  const attrs = { ...block.attrs };
  delete attrs.callout; // drop any legacy variant marker
  if (color) attrs.calloutColor = color;
  else delete attrs.calloutColor;
  return { ...block, attrs };
}

/** Derive box styling (a darker border + readable text) from a background. */
export function boxStyle(bg: string): {
  background: string;
  borderColor: string;
  color: string;
} {
  const [r, g, b] = hexToRgb(bg);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return {
    background: bg,
    borderColor: rgbToHex([r * 0.72, g * 0.72, b * 0.72]), // ~28% darker
    color: luminance > 0.55 ? "#1f2937" : "#ffffff", // contrast
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: number[]): string {
  return (
    "#" +
    rgb
      .map((x) =>
        Math.max(0, Math.min(255, Math.round(x)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
