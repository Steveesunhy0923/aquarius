/**
 * Inline text formatting markers inside a paragraph's prose:
 *   **bold**   *italic*   __underline__   ~~strike~~   ==highlight==   [text](url)
 * Highlight may carry a color: ==#RRGGBB:text== (default yellow).
 * Parsed for both on-screen rendering and LaTeX export.
 */

import { escapeLatex } from "./captions";

export const DEFAULT_HIGHLIGHT = "#fde047"; // yellow

export interface FormatSeg {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: string; // hex color when highlighted
  href?: string;
}

const RE =
  /\*\*([^*]+)\*\*|__([^_]+)__|==(?:#([0-9a-fA-F]{6}):)?((?:[^=]|=(?!=))+?)==|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|~~([^~]+)~~/g;

/** Split prose into formatted segments (bold/italic/underline/highlight/link). */
export function parseFormat(text: string): FormatSeg[] {
  const segs: FormatSeg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(text))) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index) });
    if (m[1] != null) segs.push({ text: m[1], bold: true });
    else if (m[2] != null) segs.push({ text: m[2], underline: true });
    else if (m[4] != null)
      segs.push({ text: m[4], highlight: m[3] ? `#${m[3]}` : DEFAULT_HIGHLIGHT });
    else if (m[5] != null) segs.push({ text: m[5], italic: true });
    else if (m[6] != null) segs.push({ text: m[6], href: m[7] });
    else if (m[8] != null) segs.push({ text: m[8], strike: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  if (segs.length === 0) segs.push({ text });
  return segs;
}

/** Serialize formatted prose to LaTeX (special chars escaped). */
export function formatToLatex(text: string): string {
  return parseFormat(text)
    .map((s) => {
      let t = escapeLatex(s.text);
      if (s.bold) t = `\\textbf{${t}}`;
      if (s.italic) t = `\\textit{${t}}`;
      if (s.underline) t = `\\underline{${t}}`;
      if (s.strike) t = `\\sout{${t}}`; // requires \usepackage[normalem]{ulem}
      if (s.highlight) {
        const hex = s.highlight.replace("#", "").toUpperCase();
        t = `\\colorbox[HTML]{${hex}}{${t}}`; // requires \usepackage{xcolor}
      }
      if (s.href) t = `\\href{${s.href}}{${t}}`; // requires \usepackage{hyperref}
      return t;
    })
    .join("");
}
