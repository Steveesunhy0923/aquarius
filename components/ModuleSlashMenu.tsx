"use client";

import { Icon } from "@/components/Icon";
import { MODULE_CATEGORY_NAMES, type Module } from "@/lib/templates/modules";
import { useEffect, useRef } from "react";

/**
 * The slash-insert menu: a fuzzy-filtered, keyboard-navigable module list shown
 * below the edit box while the user types `/query` in a paragraph. Purely
 * presentational — the EditBox owns the open state, query, and key handling.
 * Every mousedown inside is preventDefault'ed so a click never blurs the
 * textarea (which would exit the block editor).
 */
export function ModuleSlashMenu({ query, modules, active, onHover, onPick, onEdit, onDelete }: {
  query: string;
  modules: Module[];
  active: number;
  onHover: (i: number) => void;
  onPick: (m: Module) => void;
  /** Open the module builder on a saved (category "custom") module. */
  onEdit?: (m: Module) => void;
  /** Remove a saved (category "custom") module. */
  onDelete?: (m: Module) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, modules]);
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="print-hide absolute left-2 right-2 top-full z-30 mt-1 rounded-md border border-accent bg-surface shadow-lg"
    >
      <div className="border-b border-border-soft px-3 py-1.5 text-xs text-muted">
        Insert a module — ↑↓ choose · Enter insert · Esc dismiss
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {modules.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted">No modules match “{query}”.</p>
        ) : (
          modules.map((m, i) => (
            <div
              key={m.id}
              ref={i === active ? activeRef : undefined}
              role="button"
              tabIndex={-1}
              onClick={() => onPick(m)}
              onMouseEnter={() => onHover(i)}
              className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${i === active ? "bg-accent-soft text-accent" : "hover:bg-foreground/[0.06]"}`}
            >
              <Icon name={m.icon} size={16} className="shrink-0" />
              <span className="shrink-0 font-medium">{m.name}</span>
              <span className={`min-w-0 flex-1 truncate text-xs ${i === active ? "text-accent/80" : "text-muted"}`}>{m.description}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">{MODULE_CATEGORY_NAMES[m.category]}</span>
              {m.category === "custom" && onEdit && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(m); }}
                  title="Edit this module"
                  aria-label="Edit this module"
                  className="grid shrink-0 place-items-center rounded px-0.5 text-muted hover:text-accent"
                >
                  <Icon name="editformula" size={13} />
                </button>
              )}
              {m.category === "custom" && onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(m); }}
                  title="Delete this saved module"
                  aria-label="Delete this saved module"
                  className="grid shrink-0 place-items-center rounded px-0.5 text-muted hover:text-red-500"
                >
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
