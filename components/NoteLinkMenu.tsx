"use client";

import { Icon } from "@/components/Icon";
import type { NoteMeta } from "@/lib/storage/types";
import { useEffect, useRef } from "react";

/**
 * The inline `[[query` note-link menu: search-as-you-type note results shown
 * below the edit box. Purely presentational — the EditBox owns the open state,
 * query, results, and key handling (mirrors ModuleSlashMenu). The final row
 * opens the full two-step picker (NoteLinkPicker) for section links; `active`
 * ranges over notes.length + 1 to include it. Every mousedown inside is
 * preventDefault'ed so a click never blurs the textarea.
 */
export function NoteLinkMenu({ query, notes, active, onHover, onPick, onBrowse }: {
  query: string;
  notes: NoteMeta[];
  active: number;
  onHover: (i: number) => void;
  onPick: (n: NoteMeta) => void;
  /** Open the full picker (browse everything, or link a specific section). */
  onBrowse: () => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, notes]);
  const row = (i: number) =>
    `flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${i === active ? "bg-accent-soft text-accent" : "hover:bg-foreground/[0.06]"}`;
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="print-hide absolute left-2 right-2 top-full z-30 mt-1 rounded-md border border-accent bg-surface shadow-lg"
    >
      <div className="border-b border-border-soft px-3 py-1.5 text-xs text-muted">
        Link a note — ↑↓ choose · Enter link · Esc dismiss
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {notes.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted">
            {query.trim() ? `No notes match “${query}”.` : "No notes yet."}
          </p>
        )}
        {notes.map((n, i) => (
          <div
            key={n.id}
            ref={i === active ? activeRef : undefined}
            role="button"
            tabIndex={-1}
            onClick={() => onPick(n)}
            onMouseEnter={() => onHover(i)}
            className={row(i)}
          >
            <Icon name="pagesize" size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{n.title || "Untitled"}</span>
          </div>
        ))}
        <div
          ref={active === notes.length ? activeRef : undefined}
          role="button"
          tabIndex={-1}
          onClick={onBrowse}
          onMouseEnter={() => onHover(notes.length)}
          className={row(notes.length)}
        >
          <Icon name="search" size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-xs">Browse all notes / link a section…</span>
        </div>
      </div>
    </div>
  );
}
