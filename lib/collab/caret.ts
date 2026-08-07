/**
 * Caret bookkeeping for live co-editing.
 *
 * When a peer's keystroke lands in the paragraph you have open, the editor
 * replaces the draft string under your cursor. Without adjustment the caret
 * would jump (a controlled <textarea> re-render puts it at the end), which is
 * exactly the jitter that makes co-editing feel broken. `shiftCaret` maps the
 * old caret onto the new string: an edit *before* you slides you by its length
 * delta, an edit *after* you leaves you alone.
 *
 * PURE — no React, no DOM, so it's unit-testable on its own.
 */

/** Where `caret` in `prev` ends up in `next` after someone else's edit. */
export function shiftCaret(prev: string, next: string, caret: number): number {
  if (prev === next) return caret;
  const max = Math.min(prev.length, next.length);
  let p = 0;
  while (p < max && prev[p] === next[p]) p++;
  // The change starts at `p`. Anything at or before that is unaffected.
  if (caret <= p) return caret;
  const delta = next.length - prev.length;
  return Math.max(p, Math.min(next.length, caret + delta));
}
