/**
 * Icon — the Graphite icon set (see design/system.png). One source of truth for
 * every action's glyph, so buttons reference a NAME, not ad-hoc markup.
 *
 * Every icon renders as a 24×24 stroke SVG in `currentColor` — text-format
 * letterforms included (drawn strokes, not typed characters). `size` is in px.
 * Designed to be recognizable by shape alone.
 */

import type { CSSProperties } from "react";

// Line icons — inner SVG markup on a 0 0 24 24 canvas. `text` nodes carry their
// own fill/stroke so they stay legible under the svg's fill:none / stroke set.
const PATHS = {
  search: '<circle cx="11" cy="11" r="6"/><line x1="20" y1="20" x2="15.6" y2="15.6"/>',
  clearsearch: '<circle cx="12" cy="12" r="8"/><line x1="9.5" y1="9.5" x2="14.5" y2="14.5"/><line x1="14.5" y1="9.5" x2="9.5" y2="14.5"/>',
  settings: '<line x1="4" y1="8.5" x2="20" y2="8.5"/><line x1="4" y1="15.5" x2="20" y2="15.5"/><circle cx="9" cy="8.5" r="2.3"/><circle cx="15" cy="15.5" r="2.3"/>',
  more: '<circle cx="5.5" cy="12" r="1.25" style="fill:currentColor"/><circle cx="12" cy="12" r="1.25" style="fill:currentColor"/><circle cx="18.5" cy="12" r="1.25" style="fill:currentColor"/>',
  newnote: '<path d="M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13A2 2 0 0 0 7.5 20.5h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><line x1="12" y1="11.5" x2="12" y2="16.5"/><line x1="9.5" y1="14" x2="14.5" y2="14"/>',
  import: '<line x1="12" y1="4" x2="12" y2="14.5"/><polyline points="8,11 12,15 16,11"/><line x1="5" y1="19" x2="19" y2="19"/>',
  uploadcloud: '<path d="M7 17.5a3.6 3.6 0 0 1-.3-7.2 5 5 0 0 1 9.7-1.3A3.7 3.7 0 0 1 17 17.5"/><polyline points="9.6,12 12,9.5 14.4,12"/><line x1="12" y1="9.6" x2="12" y2="16"/>',
  subjects: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  notebooks: '<rect x="6" y="4" width="13" height="16" rx="1.6"/><line x1="9.3" y1="4" x2="9.3" y2="20"/><line x1="11.6" y1="8.2" x2="16" y2="8.2"/><line x1="11.6" y1="11.6" x2="16" y2="11.6"/>',
  tag: '<path d="M4.5 12.4l7.4-7.4h4.6a2 2 0 0 1 2 2v4.6l-7.4 7.4z"/><circle cx="15" cy="9" r="1.15" style="fill:currentColor"/>',
  trash: '<line x1="5" y1="7" x2="19" y2="7"/><path d="M9 7V5.4a1.2 1.2 0 0 1 1.2-1.2h3.6A1.2 1.2 0 0 1 15 5.4V7"/><path d="M7.3 7l.9 11.4a1.4 1.4 0 0 0 1.4 1.3h4.8a1.4 1.4 0 0 0 1.4-1.3L16.7 7"/><line x1="10.6" y1="10.5" x2="10.7" y2="16.5"/><line x1="13.4" y1="10.5" x2="13.3" y2="16.5"/>',
  highlight: '<path d="M5 19.5h5"/><path d="M13.6 4.9l4.6 4.6-7 7-4.6.7.7-4.6z"/><line x1="12.1" y1="6.4" x2="16.7" y2="11"/>',
  textcolor: '<path d="M7.5 14l4-9 4 9"/><line x1="8.7" y1="11" x2="14.3" y2="11"/><rect x="6" y="17.5" width="12" height="2.6" rx="1.2" style="fill:currentColor;stroke:none"/>',
  colorwheel: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="4.5" x2="12" y2="9.5"/><line x1="19.5" y1="12" x2="14.5" y2="12"/><line x1="12" y1="19.5" x2="12" y2="14.5"/><line x1="4.5" y1="12" x2="9.5" y2="12"/>',
  // Text formatting — drawn letterforms (see design/format-icons.html); bold gets a heavier stroke via THICK.
  bold: '<path d="M8 4.5v15"/><path d="M8 4.5h4.6a3.4 3.4 0 0 1 0 6.8H8"/><path d="M8 11.3h5.4a4.1 4.1 0 0 1 0 8.2H8"/>',
  italic: '<line x1="10.5" y1="5" x2="18" y2="5"/><line x1="6" y1="19" x2="13.5" y2="19"/><line x1="14.5" y1="5" x2="9.5" y2="19"/>',
  underline: '<path d="M7.5 4v6.5a4.5 4.5 0 0 0 9 0V4"/><line x1="6" y1="20" x2="18" y2="20"/>',
  strike: '<path d="M16.4 6.6a4.5 4.5 0 0 0-4.2-2.2c-2.3 0-4 1.3-4 3.1 0 1.5 1.1 2.4 3 3"/><path d="M12.9 13.5c1.9.6 3 1.5 3 3 0 1.8-1.7 3.1-4 3.1a4.7 4.7 0 0 1-4.4-2.2"/><line x1="5" y1="12" x2="19" y2="12"/>',
  paragraph: '<line x1="5.5" y1="5.5" x2="18.5" y2="5.5"/><line x1="5.5" y1="5.5" x2="5.5" y2="8"/><line x1="18.5" y1="5.5" x2="18.5" y2="8"/><line x1="12" y1="5.5" x2="12" y2="19.5"/><line x1="9.5" y1="19.5" x2="14.5" y2="19.5"/>',
  heading: '<line x1="6.5" y1="4.5" x2="6.5" y2="19.5"/><line x1="17.5" y1="4.5" x2="17.5" y2="19.5"/><line x1="6.5" y1="12" x2="17.5" y2="12"/>',
  list: '<line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="20" y2="17"/><circle cx="5" cy="7" r="1.1" style="fill:currentColor"/><circle cx="5" cy="12" r="1.1" style="fill:currentColor"/><circle cx="5" cy="17" r="1.1" style="fill:currentColor"/>',
  listnumber: '<line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="20" y2="17"/><text x="3" y="9.4" font-size="7" style="fill:currentColor;stroke:none">1</text><text x="3" y="14.4" font-size="7" style="fill:currentColor;stroke:none">2</text><text x="3" y="19.4" font-size="7" style="fill:currentColor;stroke:none">3</text>',
  inlineformula: '<path d="M8.6 5.6c-1.9 1.9-1.9 11 0 12.8"/><path d="M15.4 5.6c1.9 1.9 1.9 11 0 12.8"/><line x1="10.4" y1="12" x2="13.6" y2="12"/><circle cx="12" cy="9.4" r="1" style="fill:currentColor"/><circle cx="12" cy="14.6" r="1" style="fill:currentColor"/>',
  displayeq: '<polyline points="17,5.5 7,5.5 12,12 7,18.5 17,18.5"/><line x1="17" y1="5.5" x2="17" y2="8.2"/><line x1="17" y1="18.5" x2="17" y2="15.8"/>',
  functions: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.4" cy="8.4" r="1.15" style="fill:currentColor"/><path d="M13.2 7.2l2.7 2.7M15.9 7.2l-2.7 2.7"/><path d="M6.8 15.4c1.1-1.9 2.2 1.9 3.3 0"/><path d="M13.5 15.3h3.2M15.1 13.7v3.2"/>',
  choosesymbol: '<rect x="4.5" y="4.5" width="15" height="15" rx="4"/><path d="M12 7.8l1.1 3.1 3.1 1.1-3.1 1.1L12 16.2l-1.1-3.1L7.8 12l3.1-1.1z" style="fill:currentColor;stroke:none"/>',
  editformula: '<path d="M5 19l.6-3.3 8.8-8.8 2.7 2.7-8.8 8.8z"/><line x1="13.6" y1="7.4" x2="16.3" y2="10.1"/>',
  // Pencil over a flowing ink wave — the handwriting (ink → LaTeX) input panel.
  ink: '<path d="M5 15l.6-3.3 8.8-8.8 2.7 2.7-8.8 8.8z"/><line x1="13.6" y1="3.4" x2="16.3" y2="6.1"/><path d="M5.3 19.5c1.5-1.6 3-1.6 4.5 0s3 1.6 4.5 0 3-1.6 4.5 0"/>',
  fraction: '<line x1="5" y1="12" x2="19" y2="12"/><rect x="7.5" y="4.8" width="9" height="4.6" rx="1.1"/><rect x="7.5" y="14.6" width="9" height="4.6" rx="1.1"/>',
  sqrt: '<polyline points="3,13 5.6,18 9,5.5 21,5.5"/><rect x="11" y="8.5" width="7" height="7" rx="1.2"/>',
  power: '<rect x="4.5" y="9.5" width="8.5" height="8.5" rx="1.4"/><rect x="14.5" y="4.5" width="5" height="5" rx="1.1"/>',
  integral: '<path d="M7 18.2c0 1.2.9 2 1.8 2 1.1 0 1.7-.9 1.7-2.2V6.2C10.5 4.9 11.1 4 12.2 4c.9 0 1.8.8 1.8 2"/>',
  sum: '<polyline points="16.5,5.5 7.5,5.5 12,12 7.5,18.5 16.5,18.5"/>',
  matrix: '<path d="M8 4.5H5.5v15H8"/><path d="M16 4.5h2.5v15H16"/><circle cx="10" cy="9.2" r="1" style="fill:currentColor"/><circle cx="14" cy="9.2" r="1" style="fill:currentColor"/><circle cx="10" cy="14.8" r="1" style="fill:currentColor"/><circle cx="14" cy="14.8" r="1" style="fill:currentColor"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="1.8"/><circle cx="9" cy="10" r="1.7"/><path d="M5 17.6l4-3.8 3 2.9 3-2.9 4 3.8"/>',
  graph: '<polyline points="5,4 5,19 20,19"/><path d="M6.2 16c3.4 0 3.9-9 7.8-9 2.6 0 3 6 5.5 6"/>',
  link: '<path d="M10 14l4-4"/><path d="M11.5 7.4l1.4-1.4a3.6 3.6 0 0 1 5.1 5.1l-1.9 1.9"/><path d="M12.5 16.6l-1.4 1.4a3.6 3.6 0 0 1-5.1-5.1l1.9-1.9"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="1.6"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="12" y1="5" x2="12" y2="19"/>',
  moveup: '<line x1="12" y1="19" x2="12" y2="6.5"/><polyline points="7,11 12,6 17,11"/>',
  movedown: '<line x1="12" y1="5" x2="12" y2="17.5"/><polyline points="7,13 12,18 17,13"/>',
  moveleft: '<line x1="19" y1="12" x2="6.5" y2="12"/><polyline points="11,7 6,12 11,17"/>',
  moveright: '<line x1="5" y1="12" x2="17.5" y2="12"/><polyline points="13,7 18,12 13,17"/>',
  drag: '<circle cx="9.5" cy="6" r="1.2" style="fill:currentColor"/><circle cx="14.5" cy="6" r="1.2" style="fill:currentColor"/><circle cx="9.5" cy="12" r="1.2" style="fill:currentColor"/><circle cx="14.5" cy="12" r="1.2" style="fill:currentColor"/><circle cx="9.5" cy="18" r="1.2" style="fill:currentColor"/><circle cx="14.5" cy="18" r="1.2" style="fill:currentColor"/>',
  undo: '<polyline points="9,7 5,11 9,15"/><path d="M5 11h8.5a5 5 0 0 1 0 10H10"/>',
  redo: '<polyline points="15,7 19,11 15,15"/><path d="M19 11h-8.5a5 5 0 0 0 0 10H14"/>',
  save: '<path d="M7.4 17.5a3.5 3.5 0 0 1-.5-7 5 5 0 0 1 9.5-1.4 3.6 3.6 0 0 1 1.1 7"/><polyline points="9.5,13.3 11.2,15.1 14.7,11.1"/>',
  share: '<circle cx="6" cy="12" r="2.4"/><circle cx="17.5" cy="6" r="2.4"/><circle cx="17.5" cy="18" r="2.4"/><line x1="8.1" y1="11" x2="15.4" y2="7"/><line x1="8.1" y1="13" x2="15.4" y2="17"/>',
  templates: '<path d="M12 4l7.5 3.6-7.5 3.6-7.5-3.6z"/><polyline points="4.5,12 12,15.6 19.5,12"/><polyline points="4.5,15.8 12,19.4 19.5,15.8"/>',
  // Stacked section bricks with a small plus — a reusable module being slotted in.
  module: '<rect x="4.5" y="4" width="15" height="5" rx="1.4"/><rect x="4.5" y="11" width="15" height="5" rx="1.4"/><line x1="4.5" y1="19.6" x2="11.5" y2="19.6"/><line x1="16.8" y1="17.4" x2="16.8" y2="21.8"/><line x1="14.6" y1="19.6" x2="19" y2="19.6"/>',
  // A note with an outgoing arrow — link to another note.
  notelink: '<path d="M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13A2 2 0 0 0 7.5 20.5h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><line x1="9.5" y1="16.2" x2="14.3" y2="11.4"/><polyline points="11.2,11.2 14.5,11.2 14.5,14.5"/>',
  pagesize: '<rect x="6" y="3.5" width="12" height="17" rx="1.6"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="14" x2="13" y2="14"/>',
  close: '<line x1="7" y1="7" x2="17" y2="17"/><line x1="17" y1="7" x2="7" y2="17"/>',
  chevron: '<polyline points="6.5,10 12,15 17.5,10"/>',
  back: '<polyline points="13,6 7,12 13,18"/><line x1="7" y1="12" x2="20" y2="12"/>',
  // `</>` — toggles the raw LaTeX source view.
  code: '<polyline points="8.5,8 4.5,12 8.5,16"/><polyline points="15.5,8 19.5,12 15.5,16"/><line x1="13.6" y1="6" x2="10.4" y2="18"/>',
  // Tray with an outgoing arrow — export/download (.tex / .aqnote / PDF).
  export: '<path d="M5 13.5v3.5A1.5 1.5 0 0 0 6.5 18.5h11a1.5 1.5 0 0 0 1.5-1.5v-3.5"/><line x1="12" y1="4" x2="12" y2="14"/><polyline points="8.2,7.4 12,3.7 15.8,7.4"/>',
  plus: '<line x1="12" y1="6.5" x2="12" y2="17.5"/><line x1="6.5" y1="12" x2="17.5" y2="12"/>',
  minus: '<line x1="6.5" y1="12" x2="17.5" y2="12"/>',
  // Padlock — read-only / restricted access badge.
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/><circle cx="12" cy="14.3" r="1.05" style="fill:currentColor"/><line x1="12" y1="15.1" x2="12" y2="16.7"/>',
  // Open tray — the library's Uncategorized section (opened shared notes).
  inbox: '<path d="M6.1 5.6L3.5 12v4.7a1.8 1.8 0 0 0 1.8 1.8h13.4a1.8 1.8 0 0 0 1.8-1.8V12l-2.6-6.4a1.6 1.6 0 0 0-1.5-1H7.6a1.6 1.6 0 0 0-1.5 1z"/><polyline points="3.5,12 8.5,12 10.2,14.5 13.8,14.5 15.5,12 20.5,12"/>',
  // Graph editor tools, visibility toggles & list markers (see design/graph-tool-icons.html).
  cursor: '<path d="M6.5 4.5l12 9.7-5.4.9 3 5.6-2.6 1.3-3-5.6-4 3.6z"/>',
  point: '<circle cx="12" cy="12" r="1.7" style="fill:currentColor;stroke:none"/><line x1="12" y1="4.5" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="19.5"/><line x1="4.5" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="19.5" y2="12"/>',
  segment: '<line x1="6.8" y1="17.2" x2="17.2" y2="6.8"/><circle cx="6.2" cy="17.8" r="1.5" style="fill:currentColor;stroke:none"/><circle cx="17.8" cy="6.2" r="1.5" style="fill:currentColor;stroke:none"/>',
  line: '<line x1="3.5" y1="20.5" x2="20.5" y2="3.5"/><circle cx="9.2" cy="14.8" r="1.4" style="fill:currentColor;stroke:none"/><circle cx="14.8" cy="9.2" r="1.4" style="fill:currentColor;stroke:none"/>',
  triangle: '<path d="M12 5.2L20 18.8H4z"/>',
  rectangle: '<rect x="4" y="6.5" width="16" height="11" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1.3" style="fill:currentColor;stroke:none"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="5.5"/>',
  parabola: '<path d="M5 5c1.6 8.4 4 12.6 7 12.6S17.4 13.4 19 5"/>',
  plot: '<path d="M3.5 16.5C6 16.5 6.5 7 9.5 7s3.5 8 6 8 3-4.5 5-6"/><circle cx="9.5" cy="7" r="1.2" style="fill:currentColor;stroke:none"/><circle cx="15.5" cy="15" r="1.2" style="fill:currentColor;stroke:none"/>',
  eye: '<path d="M3.5 12C6 7.7 8.9 5.7 12 5.7S18 7.7 20.5 12C18 16.3 15.1 18.3 12 18.3S6 16.3 3.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeoff: '<path d="M5.2 8.4A14.5 14.5 0 0 0 3.5 12c2.5 4.3 5.4 6.3 8.5 6.3 1.3 0 2.6-.4 3.8-1.1M9.9 6.1A7.6 7.6 0 0 1 12 5.7c3.1 0 6 2 8.5 6.3a15.5 15.5 0 0 1-2.6 3.3"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4"/><line x1="4.5" y1="19.5" x2="19.5" y2="4.5"/>',
  markerdisc: '<circle cx="12" cy="12" r="3.4" style="fill:currentColor;stroke:none"/>',
  markercircle: '<circle cx="12" cy="12" r="3.2"/>',
  markersquare: '<rect x="8.8" y="8.8" width="6.4" height="6.4" rx="0.8" style="fill:currentColor;stroke:none"/>',
} as const;

export type IconName = keyof typeof PATHS;

// Per-name default stroke weight — bold's heavier stroke IS the glyph's meaning.
const THICK: Partial<Record<IconName, number>> = { bold: 2.3 };

export function Icon({
  name,
  size = 18,
  className,
  style,
  strokeWidth,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? THICK[name] ?? 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
