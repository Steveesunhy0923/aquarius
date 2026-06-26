"use client";

import type { ImageAlign } from "@/lib/blocks/images";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

/**
 * A row of selectable, draggable items. Click to select; press and drag an item
 * — it floats with the pointer (via pointer capture, so events fire reliably)
 * and on release lands wherever you dropped it: reordered within this row, or
 * moved into ANOTHER row of the same `group` (cross-box move). The drop target
 * is found by hit-testing every `[data-sgroup]` row, so this works across boxes.
 */
export function SortableRow({
  count,
  align,
  selectedIndex,
  group,
  rowId,
  onSelect,
  onMove,
  renderItem,
  itemWidth,
}: {
  count: number;
  align: ImageAlign;
  selectedIndex: number | null;
  group: string; // "image" | "table" — items only move within the same group
  rowId: string; // the owning block's id
  onSelect: (index: number) => void;
  onMove: (
    fromRowId: string,
    fromIndex: number,
    toRowId: string,
    toIndex: number,
  ) => void;
  renderItem: (index: number) => ReactNode;
  itemWidth?: (index: number) => string | undefined;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; startX: number; startY: number } | null>(null);
  const [pos, setPos] = useState<{ index: number; dx: number; dy: number } | null>(null);
  const justify =
    align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

  function onPointerDown(e: ReactPointerEvent, i: number) {
    onSelect(i);
    const t = e.target as HTMLElement;
    if (t.closest("input,textarea,select,button,a,[contenteditable=true]")) return;
    e.preventDefault();
    drag.current = { index: i, startX: e.clientX, startY: e.clientY };
    setPos({ index: i, dx: 0, dy: 0 });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    setPos({ index: d.index, dx: e.clientX - d.startX, dy: e.clientY - d.startY });
  }

  function onPointerUp(e: ReactPointerEvent) {
    const d = drag.current;
    drag.current = null;
    setPos(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (!d) return;

    // Find the target row of the same group: the one whose box contains the
    // pointer, else the vertically-nearest (so dropping in a gap still lands).
    const rows = Array.from(
      document.querySelectorAll(`[data-sgroup="${group}"]`),
    ) as HTMLElement[];
    let target: HTMLElement | null = null;
    let best = Infinity;
    for (const r of rows) {
      const rect = r.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (inside) {
        target = r;
        break;
      }
      const cy = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(e.clientY - cy);
      if (dist < best) {
        best = dist;
        target = r;
      }
    }
    if (!target) return;

    const toRowId = target.getAttribute("data-srow") || rowId;
    const kids = Array.from(
      target.querySelectorAll(":scope > [data-sidx]"),
    ) as HTMLElement[];
    let toIndex = 0;
    for (const k of kids) {
      const idx = Number(k.getAttribute("data-sidx"));
      if (toRowId === rowId && idx === d.index) continue; // skip dragged in same row
      const rect = k.getBoundingClientRect();
      if (e.clientX > rect.left + rect.width / 2) toIndex += 1;
    }
    onMove(rowId, d.index, toRowId, toIndex);
  }

  return (
    <div
      ref={rowRef}
      data-sgroup={group}
      data-srow={rowId}
      className="flex flex-wrap items-start gap-3"
      style={{ justifyContent: justify }}
    >
      {Array.from({ length: count }, (_, i) => {
        const dragging = pos?.index === i;
        return (
          <div
            key={i}
            data-sidx={i}
            onPointerDown={(e) => onPointerDown(e, i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={`touch-none select-none rounded-md ${pos ? "cursor-grabbing" : "cursor-grab"}`}
            style={{
              width: itemWidth?.(i),
              outline:
                selectedIndex === i ? "2px solid var(--accent)" : undefined,
              outlineOffset: "3px",
              transform: dragging
                ? `translate(${pos?.dx ?? 0}px, ${pos?.dy ?? 0}px)`
                : undefined,
              position: dragging ? "relative" : undefined,
              zIndex: dragging ? 50 : undefined,
              opacity: dragging ? 0.85 : 1,
              transition: dragging ? "none" : "transform 120ms ease",
            }}
          >
            {renderItem(i)}
          </div>
        );
      })}
    </div>
  );
}
