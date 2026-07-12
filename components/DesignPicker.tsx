"use client";

import { useMemo, useRef, useState } from "react";
import { BlockView } from "@/components/BlockView";
import { Icon } from "@/components/Icon";
import { ModuleEditorDialog } from "@/components/ModuleEditorDialog";
import { Dialog, DialogSection } from "@/components/ui/Dialog";
import { uiConfirm } from "@/components/ui/dialogs";
import type { Block, DocumentTree } from "@/lib/blocks/types";
import {
  builtinModules,
  builtinPresets,
  deleteSavedModule,
  listSavedModules,
  saveModule,
  stackTree,
  updateModule,
  MODULE_CATEGORY_NAMES,
  type Module,
  type Preset,
} from "@/lib/templates/modules";
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
  name,
  scenario,
  tree,
  onUse,
  onDelete,
}: {
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
          <p className="truncate font-medium">{name}</p>
          <p className="mt-0.5 text-xs text-muted">{scenario}</p>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete template"
            aria-label="Delete template"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-red-500/10 hover:text-red-500"
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
      <button onClick={onUse} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
        Use this template
      </button>
    </div>
  );
}

/** A note layout as its editable module stack: chips toggle modules in and out
 *  and drag to reorder; the preview tracks the current stack. "Use this
 *  template" inserts exactly what the preview shows. */
function PresetCard({ preset, onUse }: { preset: Preset; onUse: (tree: DocumentTree) => void }) {
  const [items, setItems] = useState(() => preset.stack.map((module) => ({ module, on: true })));
  const dragFrom = useRef<number | null>(null);
  const modified = items.some((it, i) => !it.on || it.module !== preset.stack[i]);
  const tree = useMemo(() => stackTree(items.filter((it) => it.on).map((it) => it.module)), [items]);

  const toggle = (i: number) => setItems((prev) => prev.map((it, j) => (j === i ? { ...it, on: !it.on } : it)));
  const move = (from: number, to: number) =>
    setItems((prev) => {
      if (from === to) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-3">
      {tree.blocks.length === 0 ? (
        <div className="grid h-36 place-items-center rounded-md border border-dashed border-border text-xs text-muted">
          Nothing to insert — tick a module below.
        </div>
      ) : (
        <Preview tree={tree} />
      )}
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{preset.name}</p>
          <p className="mt-0.5 text-xs text-muted">{preset.scenario}</p>
        </div>
        {modified && (
          <button
            onClick={() => setItems(preset.stack.map((module) => ({ module, on: true })))}
            className="shrink-0 text-xs text-muted underline decoration-dashed underline-offset-2 hover:text-accent"
          >
            Reset
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <button
            key={it.module.id}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("text/plain", ""); dragFrom.current = i; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom.current !== null) move(dragFrom.current, i);
              dragFrom.current = null;
            }}
            onDragEnd={() => { dragFrom.current = null; }}
            onClick={() => toggle(i)}
            aria-pressed={it.on}
            title={`${it.on ? "Click to leave out" : "Click to include"} · drag to reorder`}
            className={`flex cursor-grab items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition active:cursor-grabbing ${
              it.on ? "border-border bg-background" : "border-dashed border-border text-muted hover:text-foreground"
            }`}
          >
            <Icon name={it.on ? "check" : "plus"} size={11} className={it.on ? "text-accent" : undefined} />
            <span className="max-w-36 truncate">{it.module.name}</span>
          </button>
        ))}
      </div>
      <button
        onClick={() => onUse(stackTree(items.filter((it) => it.on).map((it) => it.module)))}
        disabled={tree.blocks.length === 0}
        className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
      >
        Use this template
      </button>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <DialogSection className={hint ? "mb-1" : "mb-2"}>{title}</DialogSection>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

const TABS = [
  { id: "template", label: "Templates" },
  { id: "module", label: "Modules" },
  { id: "background", label: "Backgrounds" },
] as const;

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
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("template");
  const posters = useMemo(() => BUILTIN_TEMPLATES.filter((t) => t.category === "poster").map((t) => ({ ...t, tree: t.build() })), []);
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

  return (
    <Dialog title="Designs" onClose={onClose} maxWidth="max-w-3xl">
      <div className="px-5 pt-4">
        <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 transition ${tab === t.id ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[65vh] overflow-auto px-5 py-4">
        {tab === "module" ? (
          <ModulesTab />
        ) : tab === "background" ? (
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
            <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg bg-background px-3 py-2.5">
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

            <Section title="Note layouts" hint="Each layout is a stack of modules — tick chips off or drag them into a new order before using it.">
              {builtinPresets().map((p) => (
                <PresetCard key={p.id} preset={p} onUse={onApply} />
              ))}
            </Section>

            <Section title="Posters">
              {posters.map((t) => (
                <TemplateCard key={t.id} name={t.name} scenario={t.scenario} tree={t.tree} onUse={() => onApply(t.build())} />
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
    </Dialog>
  );
}

// ─── Modules tab: build, edit, and manage the `/` menu's modules ──────────────

/** A module's blocks rendered as a small clipped preview. */
function ModulePreview({ blocks }: { blocks: Block[] }) {
  return (
    <div className="pointer-events-none h-28 overflow-hidden rounded-md border border-border bg-background">
      <div className="origin-top-left scale-[0.7] space-y-1 p-3 [width:143%]">
        {blocks.slice(0, 6).map((b) => (
          <div key={b.id}><BlockView block={b} /></div>
        ))}
      </div>
    </div>
  );
}

function ModulesTab() {
  const [saved, setSaved] = useState<Module[]>(() => listSavedModules());
  // null = closed; {module:null} = new from scratch; {module, asCopy} = edit / customize a copy.
  const [editor, setEditor] = useState<{ module: Module | null; asCopy?: boolean } | null>(null);
  const refresh = () => setSaved(listSavedModules());

  const onSave = (name: string, blocks: Block[]) => {
    if (editor?.module && !editor.asCopy) updateModule(editor.module.id, name, blocks);
    else saveModule(name, blocks, new Date().toISOString());
    setEditor(null);
    refresh();
  };
  const remove = async (m: Module) => {
    if (!(await uiConfirm({ title: "Delete module", message: `Delete “${m.name}”? Notes that already used it keep their content.`, confirmLabel: "Delete", danger: true }))) return;
    deleteSavedModule(m.id);
    refresh();
  };

  return (
    <>
      <p className="mb-4 text-xs text-muted">
        Modules are reusable sections — insert one anywhere by typing <span className="font-mono">/</span> in a paragraph.
        Build your own here, or save any section from the sidebar outline.
      </p>

      <DialogSection className="mb-2">Your modules</DialogSection>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => setEditor({ module: null })}
          className="grid min-h-40 place-items-center rounded-lg border border-dashed border-border text-muted hover:border-accent hover:text-accent"
        >
          <span className="flex flex-col items-center gap-1.5 text-sm"><Icon name="plus" size={20} /> New module</span>
        </button>
        {saved.map((m) => (
          <div key={m.id} className="flex flex-col rounded-lg border border-border bg-surface p-3">
            <ModulePreview blocks={m.blocks} />
            <div className="mt-2 flex items-center gap-1.5">
              <Icon name={m.icon} size={15} className="shrink-0 text-muted" />
              <p className="min-w-0 flex-1 truncate font-medium">{m.name}</p>
              <button onClick={() => setEditor({ module: listSavedModules().find((x) => x.id === m.id) ?? m })} title="Edit module" aria-label="Edit module" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-foreground/[0.05] hover:text-foreground"><Icon name="editformula" size={15} /></button>
              <button onClick={() => void remove(m)} title="Delete module" aria-label="Delete module" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-red-500/10 hover:text-red-500"><Icon name="trash" size={15} /></button>
            </div>
          </div>
        ))}
      </div>
      {saved.length === 0 && (
        <p className="mt-2 text-xs text-muted">Nothing yet — build one, or hover a section in the editor sidebar and hit the module icon.</p>
      )}

      <DialogSection className="mb-2 mt-6">Built-in modules</DialogSection>
      <p className="mb-2 text-xs text-muted">Built-ins can’t be changed directly — “Customize” starts your own copy.</p>
      <div className="overflow-hidden rounded-lg border border-border">
        {builtinModules().map((m) => (
          <div key={m.id} className="flex items-center gap-2.5 border-t border-border-soft px-3 py-2 first:border-t-0">
            <Icon name={m.icon} size={16} className="shrink-0 text-muted" />
            <span className="shrink-0 text-sm font-medium">{m.name}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{m.description}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">{MODULE_CATEGORY_NAMES[m.category]}</span>
            <button
              onClick={() => setEditor({ module: m, asCopy: true })}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:border-accent"
            >
              Customize
            </button>
          </div>
        ))}
      </div>

      {editor && (
        <ModuleEditorDialog
          initial={editor.module ? { name: editor.asCopy ? `${editor.module.name} (mine)` : editor.module.name, blocks: editor.module.blocks } : null}
          create={!editor.module || editor.asCopy}
          onSave={onSave}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
