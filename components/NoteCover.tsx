"use client";

import { BlockView } from "@/components/BlockView";
import { A4_W, fontFamilyOf } from "@/lib/blocks/docstyle";
import type { DocumentTree } from "@/lib/blocks/types";
import { getStore } from "@/lib/storage";
import { useEffect, useRef, useState, type CSSProperties } from "react";

/** Only the first page is visible, so rendering a handful of blocks is enough. */
const COVER_BLOCKS = 12;

/**
 * A live thumbnail of a note's first page: loads the note package and renders
 * its leading blocks into a scaled-down A4 sheet, clipped to the card.
 */
export function NoteCover({ noteId }: { noteId: string }) {
  const [tree, setTree] = useState<DocumentTree | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let alive = true;
    getStore()
      .openNote(noteId)
      .then((p) => { if (alive) setTree(p.tree); })
      .catch(() => { if (alive) setTree(null); }); // missing/unreadable package → blank cover
    return () => { alive = false; };
  }, [noteId]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const blocks = tree?.blocks ?? [];
  const scale = width ? width / A4_W : 0;
  const style = tree?.style;
  const pad = Math.round(A4_W * 0.09);
  const contentStyle: CSSProperties = {
    width: A4_W,
    padding: pad,
    fontSize: `${style?.fontSize ?? 14}px`,
    fontFamily: fontFamilyOf(style?.fontFamily),
    lineHeight: style?.lineSpacing ?? 1.5,
    ["--indent" as string]: `${style?.indent ?? 0}em`,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  };

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden rounded-md bg-surface text-foreground">
      {blocks.length > 0 && scale > 0 && (
        <div className="pointer-events-none absolute left-0 top-0" style={contentStyle}>
          <div className="space-y-1">
            {blocks.slice(0, COVER_BLOCKS).map((b) => (
              <BlockView key={b.id} block={b} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
