"use client";

import { useMemo, useState } from "react";
import { BlockView } from "@/components/BlockView";
import type { DocumentTree } from "@/lib/blocks/types";
import {
  BUILTIN_TEMPLATES,
  deleteTemplate,
  listSavedTemplates,
  type SavedTemplate,
} from "@/lib/templates/templates";

/** A clipped, scaled-down render of a template's first blocks (a thumbnail). */
function Preview({ tree }: { tree: DocumentTree }) {
  return (
    <div className="pointer-events-none h-36 overflow-hidden rounded-md border border-border bg-background p-3">
      <div className="origin-top-left scale-[0.7] space-y-1 [width:143%]">
        {tree.blocks.slice(0, 8).map((b) => (
          <div key={b.id}>
            <BlockView block={b} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({
  icon,
  name,
  scenario,
  tree,
  onUse,
  onDelete,
}: {
  icon?: string;
  name: string;
  scenario: string;
  tree: DocumentTree;
  onUse: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-3">
      <Preview tree={tree} />
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{icon ? `${icon} ` : ""}{name}</p>
          <p className="mt-0.5 text-xs text-muted">{scenario}</p>
        </div>
        {onDelete && (
          <button onClick={onDelete} title="Delete template" className="shrink-0 text-muted hover:text-red-500">✕</button>
        )}
      </div>
      <button
        onClick={onUse}
        className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
      >
        Use this template
      </button>
    </div>
  );
}

export function TemplatePicker({
  onApply,
  onSaveCurrent,
  onClose,
}: {
  onApply: (tree: DocumentTree) => void;
  /** Persist the current note as a template; returns the saved record (or null). */
  onSaveCurrent: (name: string) => SavedTemplate | null;
  onClose: () => void;
}) {
  // Build each built-in once (fresh ids happen again on apply).
  const builtins = useMemo(() => BUILTIN_TEMPLATES.map((t) => ({ ...t, tree: t.build() })), []);
  const [saved, setSaved] = useState<SavedTemplate[]>(() => listSavedTemplates());
  const [name, setName] = useState("");

  const saveCurrent = () => {
    const n = name.trim();
    if (!n) return;
    const rec = onSaveCurrent(n);
    if (rec) {
      setSaved(listSavedTemplates());
      setName("");
    }
  };
  const remove = (id: string) => {
    deleteTemplate(id);
    setSaved(listSavedTemplates());
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">Templates</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">✕</button>
        </div>

        <div className="overflow-auto px-5 py-4">
          {/* Save the current note as a template */}
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-2.5">
            <span className="text-sm font-medium">Save this note as a template:</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); }}
              placeholder="Template name…"
              className="min-w-[10rem] flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={saveCurrent}
              disabled={!name.trim()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-40"
            >
              Save
            </button>
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Starter templates</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {builtins.map((t) => (
              <Card
                key={t.id}
                icon={t.icon}
                name={t.name}
                scenario={t.scenario}
                tree={t.tree}
                onUse={() => onApply(t.build())}
              />
            ))}
          </div>

          {saved.length > 0 && (
            <>
              <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Your templates</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {saved.map((t) => (
                  <Card
                    key={t.id}
                    name={t.name}
                    scenario={t.scenario}
                    tree={t.tree}
                    onUse={() => onApply(t.tree)}
                    onDelete={() => remove(t.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
