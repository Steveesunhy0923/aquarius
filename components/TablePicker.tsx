"use client";

import { TableView } from "@/components/TableView";
import { TABLE_STYLES, demoRows, type TableStyle } from "@/lib/blocks/tables";
import { useEffect } from "react";

/**
 * Modal gallery of common LaTeX table styles, each shown as a small live demo.
 * Clicking a style calls `onPick`.
 */
export function TablePicker({
  onPick,
  onClose,
}: {
  onPick: (style: TableStyle) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const demo = demoRows();

  return (
    <div
      className="print-hide fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="mt-10 max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Insert a table — pick a style</h2>
          <button
            onClick={onClose}
            className="px-1 text-muted hover:text-foreground"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TABLE_STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              className="flex flex-col items-start gap-2 rounded-lg border border-border bg-background p-3 text-left transition hover:border-accent hover:shadow"
            >
              <div className="text-sm font-medium">{s.name}</div>
              <div className="text-xs text-muted">{s.description}</div>
              <div className="mt-1 self-center overflow-x-auto">
                <TableView data={{ style: s.id, rows: demo }} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
