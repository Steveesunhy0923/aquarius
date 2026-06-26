"use client";

import { Katex } from "@/components/Katex";
import { previewLatex } from "@/lib/blocks/source";
import { SYMBOLS } from "@/lib/symbols";
import { useEffect, useMemo, useState } from "react";

/**
 * Modal that searches the symbol library and calls `onPick` with the chosen
 * LaTeX. Defaults to an alphabetical (by name) listing; typing filters by name,
 * latex, category, or alias.
 */
export function SymbolPicker({
  onPick,
  onClose,
  title = "Symbol library",
}: {
  onPick: (latex: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const results = useMemo(() => {
    const sorted = [...SYMBOLS].sort((a, b) => a.name.localeCompare(b.name));
    const term = q.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.latex.toLowerCase().includes(term) ||
        s.category.toLowerCase().includes(term) ||
        s.aliases?.some((a) => a.toLowerCase().includes(term)),
    );
  }, [q]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="mt-12 flex max-h-[75vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border p-3">
          <span className="text-sm font-medium">{title}</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search… (e.g. alpha, leq, arrow, integral)"
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <span className="text-xs text-muted">{results.length}</span>
          <button
            onClick={onClose}
            className="px-1 text-muted hover:text-foreground"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-1 overflow-y-auto p-3">
          {results.map((s) => (
            <button
              key={`${s.category}:${s.latex}:${s.name}`}
              onClick={() => onPick(s.latex)}
              title={`${s.name}  ·  ${s.latex}`}
              className="flex flex-col items-center gap-1 rounded-md border border-transparent p-2 hover:border-accent hover:bg-foreground/5"
            >
              <span className="text-lg">
                <Katex latex={previewLatex(s.latex)} />
              </span>
              <span className="w-full truncate text-center text-[11px] text-muted">
                {s.name}
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="col-span-full p-6 text-center text-sm text-muted">
              No symbols match “{q}”.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
