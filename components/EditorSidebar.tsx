"use client";

import { Icon } from "@/components/Icon";
import { uiPrompt } from "@/components/ui/dialogs";
import type { OutlineItem } from "@/lib/blocks/outline";
import { MAX_SHORTCUTS, type SectionShortcut } from "@/lib/blocks/shortcuts";
import type { DocHandle } from "@/lib/editor/types";
import { useAppSettings } from "@/lib/settings/useAppSettings";
import { getStore } from "@/lib/storage";
import type { NoteMeta } from "@/lib/storage/types";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

/** Left rail: a searchable recent-files list (top), backlinks into the active
 *  note (only when any exist), the design's section shortcuts, and the live
 *  section outline (bottom). */
export function EditorSidebar({
  currentId,
  secondId,
  activeId,
  onOpen,
  outline,
  shortcuts,
  handle,
  notesRev,
}: {
  currentId: string;
  secondId: string | null;
  /** The focused pane's note — the one the backlinks panel describes. */
  activeId: string;
  onOpen: (id: string) => void;
  outline: OutlineItem[];
  /** The active note's design shortcuts (lib/blocks/shortcuts.ts). */
  shortcuts: SectionShortcut[];
  handle: MutableRefObject<DocHandle | null>;
  notesRev: number;
}) {
  return (
    <aside className="print-hide flex w-60 shrink-0 flex-col border-r border-border">
      <RecentFilesPanel currentId={currentId} secondId={secondId} onOpen={onOpen} notesRev={notesRev} />
      <BacklinksPanel currentId={currentId} secondId={secondId} activeId={activeId} onOpen={onOpen} notesRev={notesRev} />
      <ShortcutsPanel shortcuts={shortcuts} outline={outline} handle={handle} />
      <SectionOutline outline={outline} handle={handle} />
    </aside>
  );
}

/**
 * The design's jump list.
 *
 * The outline below shows what the note HAS; this shows what its design says it
 * should have — so on a half-written note the section you are heading for is in
 * the list before you have written it, and one click puts it there. A shortcut
 * whose section doesn't exist yet is drawn dimmed with a `+`.
 *
 * The list is the note's own (stamped when a design is applied) and every part
 * of it is editable here: add, rename, remove, drag to reorder.
 */
function ShortcutsPanel({ shortcuts, outline, handle }: {
  shortcuts: SectionShortcut[];
  outline: OutlineItem[];
  handle: MutableRefObject<DocHandle | null>;
}) {
  const dragId = useRef<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Which shortcuts the note actually has a section for — the outline is
  // already the list of headings, so no second pass over the document.
  const present = new Set(outline.map((o) => o.text.trim().toLowerCase()));
  const has = (s: SectionShortcut) => present.has(s.label.trim().toLowerCase());
  const full = shortcuts.length >= MAX_SHORTCUTS;

  async function addOne() {
    const name = await uiPrompt({ title: "Add a shortcut", message: "Name the section this jumps to. If the note doesn\u2019t have it yet, following the shortcut adds it.", placeholder: "Worked example", confirmLabel: "Add" });
    if (name?.trim()) handle.current?.addShortcut(name.trim());
  }
  async function rename(s: SectionShortcut) {
    const name = await uiPrompt({ title: "Rename shortcut", message: "The name is how a shortcut finds its section.", initial: s.label, confirmLabel: "Rename" });
    if (name?.trim()) handle.current?.renameShortcut(s.id, name.trim());
  }

  return (
    <div className="max-h-52 shrink-0 overflow-y-auto border-b border-border px-2 pb-2">
      <div className="flex items-center gap-1 px-1 pb-1 pt-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Shortcuts</h2>
        <button
          onClick={() => setEditing((e) => !e)}
          title={editing ? "Done editing shortcuts" : "Edit shortcuts"}
          aria-label={editing ? "Done editing shortcuts" : "Edit shortcuts"}
          aria-pressed={editing}
          className={`ml-auto shrink-0 rounded px-1 ${editing ? "text-accent" : "text-muted hover:text-foreground"}`}
        >
          <Icon name={editing ? "check" : "editformula"} size={13} />
        </button>
        <button onClick={addOne} disabled={full} title={full ? "That's as many shortcuts as a note can have" : "Add a shortcut"} aria-label="Add a shortcut" className="shrink-0 rounded px-1 text-muted hover:text-accent disabled:opacity-30">
          <Icon name="plus" size={13} />
        </button>
      </div>
      {shortcuts.length === 0 ? null : (
        shortcuts.map((s) => {
          const here = has(s);
          return (
            <div
              key={s.id}
              draggable
              onDragStart={() => { dragId.current = s.id; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId.current && dragId.current !== s.id) handle.current?.moveShortcut(dragId.current, s.id);
                dragId.current = null;
              }}
              className="group flex items-center gap-1 rounded-md hover:bg-foreground/5"
            >
              <button
                onClick={() => handle.current?.jumpToShortcut(s.id)}
                title={here ? `Go to “${s.label}”` : `Add the “${s.label}” section`}
                className={`flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-sm ${here ? "" : "text-muted"}`}
              >
                <Icon name={here ? "moveright" : "plus"} size={12} className="shrink-0 opacity-60" />
                <span className="truncate">{s.label}</span>
              </button>
              {editing && (
                <>
                  <button onClick={() => rename(s)} title="Rename" aria-label={`Rename ${s.label}`} className="shrink-0 px-1 text-muted hover:text-accent">
                    <Icon name="editformula" size={12} />
                  </button>
                  <button onClick={() => handle.current?.removeShortcut(s.id)} title="Remove" aria-label={`Remove ${s.label}`} className="shrink-0 px-1 text-muted hover:text-danger">
                    <Icon name="close" size={12} />
                  </button>
                </>
              )}
            </div>
          );
        })
      )}
      {editing && shortcuts.length > 1 && (
        <p className="px-1 pt-1 text-[10px] text-faint">Drag a shortcut to reorder it.</p>
      )}
    </div>
  );
}

function RecentFilesPanel({ currentId, secondId, onOpen, notesRev }: { currentId: string; secondId: string | null; onOpen: (id: string) => void; notesRev: number }) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<NoteMeta[]>([]);
  const [results, setResults] = useState<NoteMeta[] | null>(null);

  // Refresh when the open documents change or any pane saves (titles/recency shift).
  useEffect(() => {
    getStore().listRecentNotes(60).then(setRecent).catch(() => {});
  }, [currentId, secondId, notesRev]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      getStore().searchNotes(q).then((r) => { if (alive) setResults([...r.title, ...r.content]); }).catch(() => {});
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  const list = results ?? recent;
  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-border">
      <div className="px-3 pb-2 pt-3">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Files</h2>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files…" className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted">{query.trim() ? "No matches." : "No files yet."}</p>
        ) : (
          list.map((n) => {
            const open = n.id === currentId || n.id === secondId;
            return (
              <button
                key={n.id}
                onClick={() => onOpen(n.id)}
                disabled={open}
                title={open ? "Already open" : "Open on the right (split view)"}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${open ? "bg-accent/10 text-accent" : "hover:bg-foreground/5"}`}
              >
                <span className="truncate">{n.title || "Untitled"}</span>
                {open && <span className="ml-auto shrink-0 text-[10px] uppercase">{n.id === currentId ? "A" : "B"}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Notes that link to the active note (`note://` in their tree). Hidden when
 *  there are none; a row opens the referrer on the right, like the Files list. */
function BacklinksPanel({ currentId, secondId, activeId, onOpen, notesRev }: {
  currentId: string;
  secondId: string | null;
  activeId: string;
  onOpen: (id: string) => void;
  notesRev: number;
}) {
  const [links, setLinks] = useState<NoteMeta[]>([]);
  // notesRev: a save in either pane may add/remove links pointing here.
  useEffect(() => {
    let alive = true;
    getStore().listBacklinks(activeId)
      .then((l) => { if (alive) setLinks(l); })
      .catch(() => { if (alive) setLinks([]); });
    return () => { alive = false; };
  }, [activeId, notesRev]);

  if (links.length === 0) return null;
  return (
    <div className="max-h-44 shrink-0 overflow-y-auto border-b border-border px-2 pb-2">
      <h2 className="px-1 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted">Linked from</h2>
      {links.map((n) => {
        const open = n.id === currentId || n.id === secondId;
        return (
          <button
            key={n.id}
            onClick={() => onOpen(n.id)}
            disabled={open}
            title={open ? "Already open" : "Open on the right (split view)"}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${open ? "bg-accent/10 text-accent" : "hover:bg-foreground/5"}`}
          >
            <Icon name="module" size={13} className="shrink-0 text-muted" />
            <span className="truncate">{n.title || "Untitled"}</span>
            {open && <span className="ml-auto shrink-0 text-[10px] uppercase">{n.id === currentId ? "A" : "B"}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Overleaf-style outline: click to jump, drag to reorder, eye to hide a section. */
function SectionOutline({ outline, handle }: { outline: OutlineItem[]; handle: MutableRefObject<DocHandle | null> }) {
  // Folding is opt-in (Settings → Fold sections); off, every section shows and
  // the outline has no hide button to offer.
  const { sectionFolding } = useAppSettings();
  const dragId = useRef<string | null>(null);
  return (
    <div className="flex min-h-0 flex-[1.3] flex-col">
      <h2 className="px-3 pb-2 pt-3 text-xs font-medium uppercase tracking-wide text-muted">Sections</h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {outline.length === 0 ? null : (
          <>
            {outline.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => { dragId.current = item.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId.current && dragId.current !== item.id) handle.current?.reorderSections(dragId.current, item.id);
                  dragId.current = null;
                }}
                className="group flex items-center gap-1 rounded-md hover:bg-foreground/5"
                style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
              >
                <span className="cursor-grab select-none px-0.5 text-muted opacity-0 group-hover:opacity-100" title="Drag to reorder" aria-label="Drag to reorder"><Icon name="drag" size={13} /></span>
                <button onClick={() => handle.current?.scrollToBlock(item.id)} className={`min-w-0 flex-1 truncate py-1 text-left text-sm ${sectionFolding && item.collapsed ? "text-muted line-through" : ""}`} title={item.text}>
                  {item.text}
                </button>
                <button onClick={() => handle.current?.saveSectionAsModule(item.id)} title="Save section as module (insert it anywhere with /)" aria-label="Save section as module" className="shrink-0 px-1 text-xs text-muted opacity-0 hover:text-accent group-hover:opacity-100">
                  <Icon name="module" size={14} />
                </button>
                {sectionFolding && (
                  <button onClick={() => handle.current?.toggleSection(item.id)} title={item.collapsed ? "Show section" : "Hide section"} aria-label={item.collapsed ? "Show section" : "Hide section"} className="shrink-0 px-1 text-xs text-muted opacity-0 hover:text-accent group-hover:opacity-100">
                    <Icon name={item.collapsed ? "eyeoff" : "eye"} size={14} />
                  </button>
                )}
              </div>
            ))}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragId.current) handle.current?.reorderSections(dragId.current, null); dragId.current = null; }}
              aria-label="Move section to the end"
              className="mt-1 rounded border border-dashed border-transparent py-2 hover:border-border"
            />
          </>
        )}
      </div>
    </div>
  );
}
