/**
 * Putting the caret where the user clicked.
 *
 * A paragraph is RENDERED (bold text, no markers, formulas as maths) but EDITED
 * as source (`**bold**`, `$x^2$`). Clicking the rendered text gives an offset
 * into what is on screen; the textarea that opens needs the matching offset into
 * the source. Landing at the end of the block instead — which is what happens
 * without this — is the difference between "I clicked into my sentence" and "I
 * have to arrow back to where I was pointing".
 */

/**
 * Map an offset in the RENDERED text to the matching offset in the SOURCE.
 *
 * Greedy alignment: walk the source, consuming a rendered character whenever it
 * matches, and skipping source-only characters (`*`, `$`, a formula's LaTeX)
 * otherwise. For prose with no markup the two strings are identical and this is
 * exact; inside a formula, where the source and its rendering share only some
 * characters, the caret lands within that formula's source, which is where a
 * click on it means anyway.
 */
export function sourceOffsetFor(src: string, rendered: string, offset: number): number {
  const want = Math.max(0, Math.min(offset, rendered.length));
  if (want === 0) return 0;
  let seen = 0; // rendered characters consumed so far
  for (let i = 0; i < src.length; i++) {
    if (seen === want) return i;
    if (src[i] === rendered[seen]) seen++;
  }
  return src.length;
}

/**
 * The offset into `el`'s text that the point (x, y) falls on, or null when the
 * browser can't say. Text nodes are walked in document order, so the offset is
 * into `el.textContent` — the same string `sourceOffsetFor` aligns against.
 *
 * Two APIs because no single one is universal: `caretPositionFromPoint` is the
 * standard (Firefox, newer Chrome), `caretRangeFromPoint` the WebKit/Blink one.
 */
export function renderedOffsetAt(el: HTMLElement, x: number, y: number): number | null {
  const doc = el.ownerDocument;
  // Neither API is universal, and `caretRangeFromPoint` is not in lib.dom at
  // all, so both are read off a hand-written shape rather than the DOM types.
  const d = doc as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const range = d.caretRangeFromPoint?.(x, y);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  }
  if (!node || !el.contains(node)) return null;
  // A click on an element (rather than inside a text node) reports a CHILD
  // index, not a character offset — count the text of the children before it.
  if (node.nodeType !== Node.TEXT_NODE) {
    const kids = Array.from(node.childNodes).slice(0, offset);
    offset = kids.reduce((n, k) => n + (k.textContent?.length ?? 0), 0);
  }
  let total = 0;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === node || (node.nodeType !== Node.TEXT_NODE && node.contains(t))) {
      return total + Math.min(offset, t.textContent?.length ?? 0);
    }
    total += t.textContent?.length ?? 0;
  }
  return total;
}

/** Where a press landed on a formula, as fractions of the formula's own box. */
export interface FormulaPoint {
  relX: number;
  relY: number;
}

/**
 * Where a press landed on a RENDERED formula (KaTeX, under `el`), as fractions
 * of the formula's own box, clamped to 0..1 — a press on the blank line either
 * side counts as its nearest end. The editor that replaces the rendering draws
 * the formula at another size, so an absolute point would miss; a fraction of
 * the box lands the caret on the same part of the formula. Null when there is
 * no rendered formula under `el` (an empty equation slot).
 */
export function formulaPointAt(el: HTMLElement, x: number, y: number): FormulaPoint | null {
  const parts = el.querySelectorAll<HTMLElement>(".katex-html .base");
  if (!parts.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  parts.forEach((part) => {
    const r = part.getBoundingClientRect();
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  });
  const w = right - left;
  const h = bottom - top;
  if (!(w > 0) || !(h > 0)) return null;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { relX: clamp((x - left) / w), relY: clamp((y - top) / h) };
}

/** The same fractions for a press relative to an open editor's box. */
export function pointInBox(box: DOMRect, x: number, y: number): FormulaPoint {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    relX: box.width > 0 ? clamp((x - box.left) / box.width) : 1,
    relY: box.height > 0 ? clamp((y - box.top) / box.height) : 0.5,
  };
}
