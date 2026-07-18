"use client";

import { Icon } from "@/components/Icon";
import { Katex } from "@/components/Katex";
import { previewLatex } from "@/lib/blocks/source";
import { SYMBOLS, type SymbolEntry } from "@/lib/symbols";
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

const CLOSE_BTN = "grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-foreground/[0.05] hover:text-foreground";

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
  symbols = SYMBOLS,
  searchPlaceholder = "Search… (e.g. alpha, leq, arrow, integral)",
  closeOnPick = true,
  keepFocus,
  onNavMouseDown,
  autoFocusSearch = true,
}: {
  onPick: (latex: string) => void;
  onClose: () => void;
  title?: string;
  /** The catalog to browse — defaults to the math library; the chemistry
   *  palette passes CHEM_SYMBOLS (parallel system, identical picker). */
  symbols?: SymbolEntry[];
  searchPlaceholder?: string;
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
    for (const s of symbols) if (!seen.includes(s.category)) seen.push(s.category);
    return seen;
  }, [symbols]);

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
    for (const s of symbols) {
      if (cat !== "All" && s.category !== cat) continue;
      if (!match(s)) continue;
      const list = byCat.get(s.category) ?? [];
      list.push(s);
      byCat.set(s.category, list);
    }
    for (const list of byCat.values())
      list.sort((a, b) => a.name.localeCompare(b.name));
    return [...byCat.entries()].map(([category, items]) => ({ category, items }));
  }, [q, cat, symbols]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div
      className="print-hide fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 p-6"
      onClick={onClose}
    >
      <div
        className="mt-12 flex max-h-[78vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border-soft px-5 py-4">
          <h2 className="shrink-0 text-base font-semibold">{title}</h2>
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <Icon name="search" size={16} />
            </span>
            <input
              autoFocus={autoFocusSearch}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onMouseDown={onNavMouseDown}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-sm outline-none focus:border-accent"
            />
            {q && (
              <button
                onMouseDown={keepFocus}
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              >
                <Icon name="clearsearch" size={16} />
              </button>
            )}
          </div>
          <span className="text-xs text-muted">{total}</span>
          <button onClick={onClose} className={CLOSE_BTN} title="Close (Esc)" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1 border-b border-border-soft px-3 py-2">
          {["All", ...categories].map((c) => (
            <button
              key={c}
              onMouseDown={keepFocus}
              onClick={() => setCat(c)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                cat === c
                  ? "border-transparent bg-accent-soft text-accent"
                  : "border-border text-muted hover:border-accent"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-3">
          {groups.map((g) => (
            <section key={g.category} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">
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
                    {/* overflow-hidden: a wide preview (a long \ce reaction, a
                        structural fragment) clips inside its cell instead of
                        overlapping its neighbors. */}
                    <span className="max-w-full overflow-hidden text-lg">
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
