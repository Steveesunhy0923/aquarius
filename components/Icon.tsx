/**
 * Icon — one source of truth for every action's glyph, so buttons reference a
 * NAME, not ad-hoc markup. Glyphs are Lucide (lucide.dev) inlined as raw SVG on a
 * 24×24 canvas; a handful of math/graph primitives with no Lucide equal are kept
 * as bespoke strokes in the same visual language (tagged `bespoke` below).
 *
 * Every icon renders as a 24×24 stroke SVG in `currentColor`. `size` is in px;
 * `strokeWidth` overrides the default. Recognizable by shape alone.
 */

import type { CSSProperties } from "react";

// Inner SVG markup on a 0 0 24 24 canvas. Nodes with their own fill/stroke carry
// an inline `style` so they stay legible under the wrapper's fill:none / stroke.
const PATHS = {
  search: '<path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" />', // lucide/search
  clearsearch: '<circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />', // lucide/circle-x
  settings: '<path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" />', // lucide/sliders-horizontal
  more: '<circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />', // lucide/ellipsis
  newnote: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M9 15h6" /><path d="M12 18v-6" />', // lucide/file-plus
  import: '<path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" />', // lucide/download
  uploadcloud: '<path d="M12 13v8" /><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="m8 17 4-4 4 4" />', // lucide/cloud-upload
  subjects: '<rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />', // lucide/layout-grid
  notebooks: '<path d="M2 6h4" /><path d="M2 10h4" /><path d="M2 14h4" /><path d="M2 18h4" /><rect width="16" height="20" x="4" y="2" rx="2" /><path d="M9.5 8h5" /><path d="M9.5 12H16" /><path d="M9.5 16H14" />', // lucide/notebook-text
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />', // lucide/tag
  trash: '<path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />', // lucide/trash-2
  highlight: '<path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />', // lucide/highlighter
  textcolor: '<path d="M4 20h16" /><path d="m6 16 6-12 6 12" /><path d="M8 12h8" />', // lucide/baseline
  colorwheel: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />', // lucide/palette
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />', // lucide/bold
  italic: '<line x1="19" x2="10" y1="4" y2="4" /><line x1="14" x2="5" y1="20" y2="20" /><line x1="15" x2="9" y1="4" y2="20" />', // lucide/italic
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4" /><line x1="4" x2="20" y1="20" y2="20" />', // lucide/underline
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" x2="20" y1="12" y2="12" />', // lucide/strikethrough
  paragraph: '<path d="M13 4v16" /><path d="M17 4v16" /><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />', // lucide/pilcrow
  heading: '<path d="M6 12h12" /><path d="M6 20V4" /><path d="M18 20V4" />', // lucide/heading
  list: '<path d="M3 5h.01" /><path d="M3 12h.01" /><path d="M3 19h.01" /><path d="M8 5h13" /><path d="M8 12h13" /><path d="M8 19h13" />', // lucide/list
  listnumber: '<path d="M11 5h10" /><path d="M11 12h10" /><path d="M11 19h10" /><path d="M4 4h1v5" /><path d="M4 9h2" /><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" />', // lucide/list-ordered
  inlineformula: '<path d="M8 21s-4-3-4-9 4-9 4-9" /><path d="M16 3s4 3 4 9-4 9-4 9" /><line x1="15" x2="9" y1="9" y2="15" /><line x1="9" x2="15" y1="9" y2="15" />', // lucide/variable
  displayeq: '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M16 8.9V7H8l4 5-4 5h8v-1.9" />', // lucide/square-sigma
  functions: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3" /><path d="M9 11.2h5.7" />', // lucide/square-function
  choosesymbol: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /><path d="M20 2v4" /><path d="M22 4h-4" /><circle cx="4" cy="20" r="2" />', // lucide/sparkles
  editformula: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />', // lucide/square-pen
  ink: '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" /><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" /><path d="m2.3 2.3 7.286 7.286" /><circle cx="11" cy="11" r="2" />', // lucide/pen-tool
  flask: '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" /><path d="M6.453 15h11.094" /><path d="M8.5 2h7" />', // lucide/flask-conical
  atom: '<circle cx="12" cy="12" r="1" /><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" /><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z" />', // lucide/atom
  fraction: '<line x1="5" y1="12" x2="19" y2="12"/><rect x="7.5" y="4.8" width="9" height="4.6" rx="1.1"/><rect x="7.5" y="14.6" width="9" height="4.6" rx="1.1"/>', // bespoke
  sqrt: '<polyline points="3,13 5.6,18 9,5.5 21,5.5"/><rect x="11" y="8.5" width="7" height="7" rx="1.2"/>', // bespoke
  power: '<rect x="4.5" y="9.5" width="8.5" height="8.5" rx="1.4"/><rect x="14.5" y="4.5" width="5" height="5" rx="1.1"/>', // bespoke
  integral: '<path d="M7 18.2c0 1.2.9 2 1.8 2 1.1 0 1.7-.9 1.7-2.2V6.2C10.5 4.9 11.1 4 12.2 4c.9 0 1.8.8 1.8 2"/>', // bespoke
  sum: '<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2" />', // lucide/sigma
  matrix: '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" />', // lucide/grid-3x3
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />', // lucide/image
  graph: '<path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M7 16c.5-2 1.5-7 4-7 2 0 2 3 4 3 2.5 0 4.5-5 5-7" />', // lucide/chart-spline
  link: '<path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><line x1="8" x2="16" y1="12" y2="12" />', // lucide/link-2
  table: '<path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" />', // lucide/table
  moveup: '<path d="m5 12 7-7 7 7" /><path d="M12 19V5" />', // lucide/arrow-up
  movedown: '<path d="M12 5v14" /><path d="m19 12-7 7-7-7" />', // lucide/arrow-down
  moveleft: '<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />', // lucide/arrow-left
  moveright: '<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />', // lucide/arrow-right
  drag: '<circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" />', // lucide/grip-vertical
  undo: '<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />', // lucide/undo-2
  redo: '<path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />', // lucide/redo-2
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" />', // lucide/save
  share: '<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />', // lucide/share-2
  templates: '<rect width="18" height="7" x="3" y="3" rx="1" /><rect width="9" height="7" x="3" y="14" rx="1" /><rect width="5" height="7" x="16" y="14" rx="1" />', // lucide/layout-template
  module: '<path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" /><rect x="14" y="2" width="8" height="8" rx="1" />', // lucide/blocks
  notelink: '<path d="M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="m10 18 3-3-3-3" />', // lucide/file-symlink
  pagesize: '<rect width="20" height="16" x="2" y="4" rx="2" /><path d="M12 9v11" /><path d="M2 9h13a2 2 0 0 1 2 2v9" />', // lucide/proportions
  close: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />', // lucide/x
  chevron: '<path d="m6 9 6 6 6-6" />', // lucide/chevron-down
  back: '<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />', // lucide/arrow-left
  code: '<path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" />', // lucide/code
  export: '<path d="M4.226 20.925A2 2 0 0 0 6 22h12a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.127" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="m5 11-3 3" /><path d="m5 17-3-3h10" />', // lucide/file-output
  plus: '<path d="M5 12h14" /><path d="M12 5v14" />', // lucide/plus
  check: '<path d="M20 6 9 17l-5-5" />', // lucide/check
  minus: '<path d="M5 12h14" />', // lucide/minus
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />', // lucide/lock
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />', // lucide/inbox
  cursor: '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />', // lucide/mouse-pointer-2
  point: '<circle cx="12" cy="12" r="10" /><line x1="22" x2="18" y1="12" y2="12" /><line x1="6" x2="2" y1="12" y2="12" /><line x1="12" x2="12" y1="6" y2="2" /><line x1="12" x2="12" y1="22" y2="18" />', // lucide/crosshair
  segment: '<line x1="6.8" y1="17.2" x2="17.2" y2="6.8"/><circle cx="6.2" cy="17.8" r="1.5" style="fill:currentColor;stroke:none"/><circle cx="17.8" cy="6.2" r="1.5" style="fill:currentColor;stroke:none"/>', // bespoke
  line: '<line x1="3.5" y1="20.5" x2="20.5" y2="3.5"/><circle cx="9.2" cy="14.8" r="1.4" style="fill:currentColor;stroke:none"/><circle cx="14.8" cy="9.2" r="1.4" style="fill:currentColor;stroke:none"/>', // bespoke
  triangle: '<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />', // lucide/triangle
  rectangle: '<rect width="20" height="12" x="2" y="6" rx="2" />', // lucide/rectangle-horizontal
  circle: '<circle cx="12" cy="12" r="10" />', // lucide/circle
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="5.5"/>', // bespoke
  parabola: '<path d="M5 5c1.6 8.4 4 12.6 7 12.6S17.4 13.4 19 5"/>', // bespoke
  plot: '<circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><path d="M5 17A12 12 0 0 1 17 5" />', // lucide/spline
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" />', // lucide/eye
  eyeoff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" />', // lucide/eye-off
  markerdisc: '<circle cx="12" cy="12" r="3.4" style="fill:currentColor;stroke:none"/>', // bespoke
  markercircle: '<circle cx="12" cy="12" r="3.2"/>', // bespoke
  markersquare: '<rect x="8.8" y="8.8" width="6.4" height="6.4" rx="0.8" style="fill:currentColor;stroke:none"/>', // bespoke
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" />', // lucide/history
} as const;

export type IconName = keyof typeof PATHS;

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
      strokeWidth={strokeWidth ?? 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
