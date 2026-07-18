"use client";

import { Icon } from "@/components/Icon";
import { TableView } from "@/components/TableView";
import { CLOSE_BTN } from "@/components/ui/primitives";
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
      className="print-hide fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 p-6"
      onClick={onClose}
    >
      <div
        className="mt-10 flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-modal border border-border bg-surface shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
          <h2 className="text-base font-semibold">Insert a table — pick a style</h2>
          <button onClick={onClose} className={CLOSE_BTN} title="Close (Esc)" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TABLE_STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => onPick(s.id)}
                className="flex flex-col items-start gap-2 rounded-card border border-border bg-surface p-3 text-left transition hover:border-accent hover:shadow-card"
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
    </div>
  );
}
