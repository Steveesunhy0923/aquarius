"use client";

import { useMemo, useRef, useState } from "react";
import { BlockView } from "@/components/BlockView";
import { Icon } from "@/components/Icon";
import { ModuleFileEditor } from "@/components/ModuleFileEditor";
import { Dialog, DialogSection } from "@/components/ui/Dialog";
import { uiConfirm } from "@/components/ui/dialogs";
import type { Block, DocumentTree } from "@/lib/blocks/types";
import {
  builtinPresets,
  deleteSavedModule,
  listSavedModules,
  saveModule,
  stackTree,
  updateModule,
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
  tree,
  onUse,
  onDelete,
}: {
  name: string;
  tree: DocumentTree;
  onUse: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-3">
      <Preview tree={tree} />
      <div className="mt-2 flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium">{name}</p>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete template"
            aria-label="Delete template"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
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
        <div className="h-36 rounded-md border border-dashed border-border" />
      ) : (
        <Preview tree={tree} />
      )}
      <div className="mt-2 flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium">{preset.name}</p>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <DialogSection className="mb-2">{title}</DialogSection>
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
  onInsertModule,
  onSaveCurrent,
  onClose,
}: {
  currentBackground?: string;
  /** Apply a page background (null = clear back to the default surface). */
  onApplyBackground: (bg: BuiltInBackground | null) => void;
  onApply: (tree: DocumentTree) => void;
  /** Add one of the user's modules to the note. */
  onInsertModule: (m: Module) => void;
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
          <ModulesTab onInsert={onInsertModule} />
        ) : tab === "background" ? (
          <>
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

            <Section title="Note layouts">
              {builtinPresets().map((p) => (
                <PresetCard key={p.id} preset={p} onUse={onApply} />
              ))}
            </Section>

            <Section title="Posters">
              {posters.map((t) => (
                <TemplateCard key={t.id} name={t.name} tree={t.tree} onUse={() => onApply(t.build())} />
              ))}
            </Section>

            {saved.length > 0 && (
              <Section title="Your templates">
                {saved.map((t) => (
                  <TemplateCard key={t.id} name={t.name} tree={t.tree} onUse={() => onApply(t.tree)} onDelete={() => remove(t.id)} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

// ─── Modules tab: the user's own library of quick sections ────────────────────
//
// Everything here belongs to the user — modules they built, sections they saved
// from a note, and the starter set seeded into their library on first run — so
// nothing is read-only: every card edits, deletes, and adds itself to the note.
// The built-in catalog still exists, but only as the parts templates are made
// of; it is not a shelf of modules someone else wrote.

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

function ModulesTab({ onInsert }: { onInsert: (m: Module) => void }) {
  const [saved, setSaved] = useState<Module[]>(() => listSavedModules());
  // null = closed; {module:null} = build a new one; {module} = edit that one.
  const [editor, setEditor] = useState<{ module: Module | null } | null>(null);
  const refresh = () => setSaved(listSavedModules());

  const onSave = (name: string, blocks: Block[]) => {
    if (editor?.module) updateModule(editor.module.id, name, blocks);
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
              {/* Re-read from storage: the card's copy may predate an edit made from the `/` menu. */}
              <button onClick={() => setEditor({ module: listSavedModules().find((x) => x.id === m.id) ?? m })} title="Edit module" aria-label={`Edit ${m.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-foreground/[0.05] hover:text-foreground"><Icon name="editformula" size={15} /></button>
              <button onClick={() => void remove(m)} title="Delete module" aria-label={`Delete ${m.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"><Icon name="trash" size={15} /></button>
            </div>
            <button onClick={() => onInsert(m)} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
              Add to note
            </button>
          </div>
        ))}
      </div>

      {editor && (
        <ModuleFileEditor
          initial={editor.module ? { name: editor.module.name, blocks: editor.module.blocks } : null}
          onSave={onSave}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
