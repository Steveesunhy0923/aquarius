"use client";

import { Katex } from "@/components/Katex";
import { previewLatex } from "@/lib/blocks/source";
import { SYMBOLS, type SymbolEntry } from "@/lib/symbols";
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

/**
 * Modal that browses the symbol/function library, grouped by category, and
 * calls `onPick` with the chosen LaTeX. A search box filters across all
 * categories (by name / latex / category / alias); the category chips jump to
 * one group.
 *
 * - `closeOnPick` (default true): close after a pick. Set false for a "browse &
 *   insert several" flow.
 * - `keepFocus`: mousedown handler that preserves the editor's focus so picks
 *   can be inserted inline while a paragraph is being edited.
 * - `autoFocusSearch` (default true): focus the search box on open. Pass false
 *   while editing so opening the modal doesn't steal focus from the textarea.
 */
export function SymbolPicker({
  onPick,
  onClose,
  title = "Symbol library",
  closeOnPick = true,
  keepFocus,
  onNavMouseDown,
  autoFocusSearch = true,
}: {
  onPick: (latex: string) => void;
  onClose: () => void;
  title?: string;
  closeOnPick?: boolean;
  keepFocus?: (e: ReactMouseEvent) => void;
  onNavMouseDown?: () => void;
  autoFocusSearch?: boolean;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");

  useEffect(() => {
    // Capture phase + stopImmediatePropagation so Escape dismisses only this
    // modal — it must not also reach the editor textarea's onKeyDown (which
    // would exit the block being edited).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const s of SYMBOLS) if (!seen.includes(s.category)) seen.push(s.category);
    return seen;
  }, []);

  // Group the (filtered) library by category, preserving the catalog's order.
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (s: SymbolEntry) =>
      !term ||
      s.name.toLowerCase().includes(term) ||
      s.latex.toLowerCase().includes(term) ||
      s.category.toLowerCase().includes(term) ||
      s.aliases?.some((a) => a.toLowerCase().includes(term));

    const byCat = new Map<string, SymbolEntry[]>();
    for (const s of SYMBOLS) {
      if (cat !== "All" && s.category !== cat) continue;
      if (!match(s)) continue;
      const list = byCat.get(s.category) ?? [];
      list.push(s);
      byCat.set(s.category, list);
    }
    for (const list of byCat.values())
      list.sort((a, b) => a.name.localeCompare(b.name));
    return [...byCat.entries()].map(([category, items]) => ({ category, items }));
  }, [q, cat]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="mt-12 flex max-h-[78vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border p-3">
          <span className="text-sm font-medium">{title}</span>
          <input
            autoFocus={autoFocusSearch}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onMouseDown={onNavMouseDown}
            placeholder="Search… (e.g. alpha, leq, arrow, integral)"
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <span className="text-xs text-muted">{total}</span>
          <button
            onClick={onClose}
            className="px-1 text-muted hover:text-foreground"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {["All", ...categories].map((c) => (
            <button
              key={c}
              onMouseDown={keepFocus}
              onClick={() => setCat(c)}
              className={`rounded-full px-2.5 py-0.5 text-xs transition ${
                cat === c
                  ? "bg-accent text-white"
                  : "border border-border text-muted hover:border-accent"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-3">
          {groups.map((g) => (
            <section key={g.category} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {g.category}
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-1">
                {g.items.map((s) => (
                  <button
                    key={`${s.category}:${s.latex}:${s.name}`}
                    onMouseDown={keepFocus}
                    onClick={() => {
                      onPick(s.latex);
                      if (closeOnPick) onClose();
                    }}
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
              </div>
            </section>
          ))}
          {total === 0 && (
            <p className="p-6 text-center text-sm text-muted">
              No symbols match “{q}”.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
