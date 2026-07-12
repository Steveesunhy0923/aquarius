"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Hover-preview plumbing shared by the link components (NoteLink,
 * ExternalLink): hovering the anchor ~a third of a second opens the card,
 * leaving gives a short grace period (moving onto the card keeps it open),
 * and any scroll dismisses it (the card is anchored to a point-in-time rect).
 *
 * The hook hands back the anchor's rect; the component computes the card's
 * position per render with `placeCard`, so a card may change size (e.g. once
 * the fetched preview decides its orientation) and stay clamped on screen.
 * All returned callbacks are referentially stable.
 */

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 200;

export function useHoverCard(onOpen?: () => void) {
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rect, setRectState] = useState<DOMRect | null>(null);
  const rectRef = useRef<DOMRect | null>(null); // mirror so the stable callbacks can read it
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const setRect = useCallback((r: DOMRect | null) => {
    rectRef.current = r;
    setRectState(r);
  }, []);

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!rect) return;
    const close = () => setRect(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [rect, setRect]);

  const armOpen = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (rectRef.current || openTimer.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      setRect(r);
      onOpenRef.current?.();
    }, HOVER_OPEN_MS);
  }, [setRect]);

  const armClose = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (!rectRef.current || closeTimer.current) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setRect(null);
    }, HOVER_CLOSE_MS);
  }, [setRect]);

  /** Cancel both hover timers and close (click/navigation must not pop a late card). */
  const cancel = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setRect(null);
  }, [setRect]);

  return { anchorRef, rect, armOpen, armClose, cancel };
}

/**
 * Fixed-position style for a card near the anchor, clamped into the viewport on
 * both axes. `h` should be the card's MAXIMUM height (not its current height):
 * a card that grows after its content loads must not re-flip to the other side
 * and yank itself out from under the pointer, so the side is chosen once from a
 * stable height. `maxWidth`/`maxHeight` keep the card on screen when a viewport
 * is smaller than the card (the card is `overflow-hidden`, so it clips rather
 * than spilling past an edge the scroll-to-dismiss listener won't let you reach).
 */
export function placeCard(rect: DOMRect, w: number, h: number): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.min(Math.max(8, rect.left), Math.max(8, vw - w - 8));
  const below = vh - rect.bottom;
  const above = rect.top;
  const placeAbove = below < h + 16 && above > below;
  const room = (placeAbove ? above : below) - 16;
  return {
    left: x,
    maxWidth: vw - 16,
    maxHeight: Math.max(160, room),
    ...(placeAbove ? { bottom: vh - rect.top + 8 } : { top: rect.bottom + 8 }),
  };
}
