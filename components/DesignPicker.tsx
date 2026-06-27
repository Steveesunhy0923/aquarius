"use client";

import { useMemo, useState } from "react";
import { BlockView } from "@/components/BlockView";
import type { DocumentTree } from "@/lib/blocks/types";
import {
  BUILTIN_BACKGROUNDS,
  BUILTIN_TEMPLATES,
  deleteTemplate,
  listSavedTemplates,
  type BuiltInBackground,
  type SavedTemplate,
} from "@/lib/templates/templates";

/** A clipped, scaled render of a template's first blocks — on its own background. */
function Preview({ tree }: { tree: DocumentTree }) {
  return (
    <div
      className="pointer-events-none h-36 overflow-hidden rounded-md border border-border"
      style={{ background: tree.style?.background || "var(--background)", color: tree.style?.foreground || undefined }}
    >
      <div className="origin-top-left scale-[0.7] space-y-1 p-3 [width:143%]">
        {tree.blocks.slice(0, 8).map((b) => (
          <div key={b.id}>
            <BlockView block={b} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplateCard({
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
      <button onClick={onUse} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
        Use this template
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function DesignPicker({
  currentBackground,
  onApplyBackground,
  onApply,
  onSaveCurrent,
  onClose,
}: {
  currentBackground?: string;
  /** Apply a page background (null = clear back to the default surface). */
  onApplyBackground: (bg: BuiltInBackground | null) => void;
  onApply: (tree: DocumentTree) => void;
  onSaveCurrent: (name: string) => SavedTemplate | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"template" | "background">("template");
  const builtins = useMemo(() => BUILTIN_TEMPLATES.map((t) => ({ ...t, tree: t.build() })), []);
  const [saved, setSaved] = useState<SavedTemplate[]>(() => listSavedTemplates());
  const [name, setName] = useState("");

  const saveCurrent = () => {
    const n = name.trim();
    if (!n) return;
    if (onSaveCurrent(n)) {
      setSaved(listSavedTemplates());
      setName("");
    }
  };
  const remove = (id: string) => {
    deleteTemplate(id);
    setSaved(listSavedTemplates());
  };

  const TabBtn = ({ id, label }: { id: "template" | "background"; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === id ? "bg-accent text-white" : "text-muted hover:bg-foreground/5"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Designs</h2>
            <div className="ml-2 flex items-center gap-1">
              <TabBtn id="template" label="Templates" />
              <TabBtn id="background" label="Backgrounds" />
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">✕</button>
        </div>

        <div className="overflow-auto px-5 py-4">
          {tab === "background" ? (
            <>
              <p className="mb-3 text-xs text-muted">Pick a page background — it shows on screen and in exported PDFs. Great for posters.</p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                <button
                  onClick={() => onApplyBackground(null)}
                  className={`overflow-hidden rounded-lg border-2 ${!currentBackground ? "border-accent" : "border-transparent hover:border-border"}`}
                >
                  <div className="grid h-20 place-items-center bg-surface text-muted">
                    <span className="text-xs">None</span>
                  </div>
                  <div className="bg-surface px-1 py-1 text-center text-xs">Default</div>
                </button>
                {BUILTIN_BACKGROUNDS.map((bg) => (
                  <button
                    key={bg.id}
                    onClick={() => onApplyBackground(bg)}
                    className={`overflow-hidden rounded-lg border-2 ${currentBackground === bg.css ? "border-accent" : "border-transparent hover:border-border"}`}
                  >
                    <div className="grid h-20 place-items-center" style={{ background: bg.css, color: bg.text || "#1a1a1a" }}>
                      <span className="text-lg font-semibold">Aa</span>
                    </div>
                    <div className="bg-surface px-1 py-1 text-center text-xs">{bg.name}</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-2.5">
                <span className="text-sm font-medium">Save this note as a template:</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); }}
                  placeholder="Template name…"
                  className="min-w-[10rem] flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                />
                <button onClick={saveCurrent} disabled={!name.trim()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-40">
                  Save
                </button>
              </div>

              <Section title="Note layouts">
                {builtins.filter((t) => t.category === "note").map((t) => (
                  <TemplateCard key={t.id} icon={t.icon} name={t.name} scenario={t.scenario} tree={t.tree} onUse={() => onApply(t.build())} />
                ))}
              </Section>

              <Section title="Posters">
                {builtins.filter((t) => t.category === "poster").map((t) => (
                  <TemplateCard key={t.id} icon={t.icon} name={t.name} scenario={t.scenario} tree={t.tree} onUse={() => onApply(t.build())} />
                ))}
              </Section>

              {saved.length > 0 && (
                <Section title="Your templates">
                  {saved.map((t) => (
                    <TemplateCard key={t.id} name={t.name} scenario={t.scenario} tree={t.tree} onUse={() => onApply(t.tree)} onDelete={() => remove(t.id)} />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
