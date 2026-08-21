"use client";

/**
 * FormatPopover — inline text formatting, raised by a selection instead of
 * parked in a permanent toolbar row.
 *
 * Bold/italic/underline/strike/highlight only do anything when text is
 * selected, so a row that shows them unconditionally spends permanent space
 * advertising controls that are inert most of the time. Here they appear when
 * they can act, next to the thing they will act on.
 *
 * Positioning note: prose is edited in a <textarea>, which has no client rect
 * for its selection — the browser exposes character offsets only. Rather than
 * mirror the textarea into a hidden div to chase the exact selection rectangle
 * (fragile under wrapping, fonts and scroll), the popover anchors to the whole
 * edit box and flips below when there isn't room above. It anchors to the BOX
 * rather than the textarea because EditBox carries its own controls above the
 * text — anchoring to the textarea drops the popover straight onto them.
 *
 * It deliberately does NOT repeat what EditBox already offers inline (insert
 * math, insert chemistry, edit an existing formula). What lives here is the
 * selection-only set that used to occupy a permanent toolbar row.
 */

import { Icon } from "@/components/Icon";
import { HighlightButton } from "@/components/ToolbarControls";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";

/** Gap between the edit box and the popover. */
const OFFSET = 8;

export function FormatPopover({
  getAnchor,
  visible,
  hlColor,
  hlOpen,
  onHlToggle,
  onHlApply,
  onHlColor,
  onWrap,
  onLink,
  onNoteLink,
  keepFocus,
  markSticky,
}: {
  /** The element the popover floats above — the whole edit box, resolved on
   *  each measure because the block being edited changes between renders. */
  getAnchor: () => HTMLElement | null;
  visible: boolean;
  hlColor: string;
  hlOpen: boolean;
  onHlToggle: () => void;
  onHlApply: () => void;
  onHlColor: (c: string) => void;
  onWrap: (marker: string) => void;
  onLink: () => void;
  onNoteLink: () => void;
  keepFocus: (e: MouseEvent) => void;
  markSticky: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure after paint (the popover's own size decides whether it fits above),
  // and keep following the anchor while the page scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!visible) { setPos(null); return; }
    function place() {
      const a = getAnchor();
      const p = popRef.current;
      if (!a || !p) return;
      const r = a.getBoundingClientRect();
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      const above = r.top - OFFSET - h;
      const top = above >= 4 ? above : Math.min(r.bottom + OFFSET, window.innerHeight - h - 4);
      // Clamp horizontally so a block near either edge still shows the whole bar.
      const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 8), window.innerWidth - w - 8);
      setPos({ top, left });
    }
    place();
    window.addEventListener("scroll", place, true); // capture: any scrolling ancestor
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [visible, getAnchor]);

  // The highlight palette is a child popover; close it when this one goes away
  // so it can't outlive its parent and hang over the document.
  useEffect(() => { if (!visible && hlOpen) onHlToggle(); }, [visible, hlOpen, onHlToggle]);

  if (!visible) return null;

  const btn = "grid h-8 w-8 place-items-center rounded transition hover:bg-foreground/[0.06]";
  return (
    <div
      ref={popRef}
      role="toolbar"
      aria-label="Format selection"
      className="print-hide fixed z-40 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg"
      // Rendered off-screen for the first paint so measuring it doesn't flash it
      // in the wrong place.
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      <button onMouseDown={keepFocus} onClick={() => onWrap("**")} title="Bold (**…**)" aria-label="Bold" className={btn}><Icon name="bold" size={15} /></button>
      <button onMouseDown={keepFocus} onClick={() => onWrap("*")} title="Italic (*…*)" aria-label="Italic" className={btn}><Icon name="italic" size={15} /></button>
      <button onMouseDown={keepFocus} onClick={() => onWrap("__")} title="Underline (__…__)" aria-label="Underline" className={btn}><Icon name="underline" size={15} /></button>
      <button onMouseDown={keepFocus} onClick={() => onWrap("~~")} title="Strikethrough (~~…~~)" aria-label="Strikethrough" className={btn}><Icon name="strike" size={15} /></button>
      <HighlightButton
        color={hlColor}
        open={hlOpen}
        onToggle={onHlToggle}
        onApply={onHlApply}
        onColor={onHlColor}
        keepFocus={keepFocus}
        onColorMouseDown={markSticky}
      />
      <span className="mx-1 h-5 w-px bg-border" />
      <button onMouseDown={keepFocus} onClick={onLink} title="Insert link" aria-label="Insert link" className={btn}><Icon name="link" size={15} /></button>
      <button onMouseDown={keepFocus} onClick={onNoteLink} title="Link to another note" aria-label="Link to another note" className={btn}><Icon name="notebrackets" size={15} /></button>
    </div>
  );
}
