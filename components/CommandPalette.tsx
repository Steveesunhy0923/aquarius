"use client";

import { Icon, type IconName } from "@/components/Icon";
import { getStore } from "@/lib/storage";
import type { NoteMeta } from "@/lib/storage/types";
import type { DocHandle, EditorCommand } from "@/lib/editor/types";
import { builtinPresets, searchModules, stackTree, type Module, type Preset } from "@/lib/templates/modules";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * ⌘K command palette — one surface unifying the three things that were three
 * separate menus: jump to a note (the `[[` link search), insert a module/preset
 * (the `/` slash menu), and run an editor action (previously scattered toolbar
 * buttons). A single query fuzzy-filters across all three; ↑/↓ walk a flat list
 * of the visible rows and Enter runs the highlighted one.
 *
 * Mounted once in the editor route and wired to the ACTIVE pane's `DocHandle`,
 * so inserts and actions land in whichever split the user last focused.
 */

interface Row {
  key: string;
  section: string;
  icon: IconName;
  label: string;
  sub?: string;
  run: () => void;
}

/** Static action/insert catalog. `write` rows are hidden on read-only notes. */
const COMMANDS: { id: EditorCommand; label: string; icon: IconName; group: "Insert" | "Actions"; write: boolean; keywords?: string[] }[] = [
  { id: "insertParagraph", label: "Paragraph", icon: "paragraph", group: "Insert", write: true, keywords: ["text", "body"] },
  { id: "insertHeading", label: "Heading", icon: "heading", group: "Insert", write: true, keywords: ["title", "section"] },
  { id: "insertList", label: "List", icon: "list", group: "Insert", write: true, keywords: ["bullet", "bulleted", "item"] },
  { id: "insertEquation", label: "Equation", icon: "displayeq", group: "Insert", write: true, keywords: ["formula", "math", "latex"] },
  { id: "insertTable", label: "Table", icon: "table", group: "Insert", write: true, keywords: ["grid", "rows", "columns"] },
  { id: "insertGraph", label: "Graph", icon: "graph", group: "Insert", write: true, keywords: ["plot", "chart", "figure", "curve"] },
  { id: "insertImage", label: "Image", icon: "image", group: "Insert", write: true, keywords: ["picture", "photo", "figure"] },
  { id: "openSymbols", label: "Symbol library…", icon: "choosesymbol", group: "Insert", write: true, keywords: ["math", "greek", "operator"] },
  { id: "openInk", label: "Handwriting input…", icon: "ink", group: "Insert", write: true, keywords: ["draw", "pencil", "ipad"] },
  { id: "openTemplates", label: "Templates & designs…", icon: "templates", group: "Insert", write: true, keywords: ["preset", "design", "layout"] },
  { id: "undo", label: "Undo", icon: "undo", group: "Actions", write: true },
  { id: "redo", label: "Redo", icon: "redo", group: "Actions", write: true },
  { id: "save", label: "Save now", icon: "save", group: "Actions", write: true, keywords: ["store"] },
  { id: "openHistory", label: "Version history…", icon: "history", group: "Actions", write: false, keywords: ["timeline", "snapshot", "revision", "restore"] },
  { id: "toggleSource", label: "Toggle LaTeX source", icon: "code", group: "Actions", write: false, keywords: ["latex", "source", "raw"] },
  { id: "openShare", label: "Share…", icon: "share", group: "Actions", write: true, keywords: ["collaborate", "invite", "publish"] },
  { id: "print", label: "Export / print PDF", icon: "export", group: "Actions", write: false, keywords: ["pdf", "download", "print"] },
];

/** A preset behaves like a big multi-section module when inserted from the palette. */
function presetModule(p: Preset): Module {
  return { id: `preset:${p.id}`, name: `${p.name} layout`, icon: "templates", category: "structural", description: `Preset · ${p.stack.length} sections`, blocks: stackTree(p.stack).blocks };
}

export function CommandPalette({
  open,
  onClose,
  handle,
  currentNoteId,
  onOpenNote,
}: {
  open: boolean;
  onClose: () => void;
  handle: DocHandle | null;
  currentNoteId: string;
  onOpenNote: (noteId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset query each time the palette opens.
  useEffect(() => { if (open) { setQ(""); setActive(0); } }, [open]);

  // Escape closes only this modal (capture phase, like SymbolPicker/Dialog) so
  // it never also exits the block being edited underneath.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // Note search: recent when empty, debounced searchNotes otherwise (title + body, deduped).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const query = q.trim();
    const load = async () => {
      try {
        if (!query) {
          const recent = await getStore().listRecentNotes(6);
          if (!cancelled) setNotes(recent);
          return;
        }
        const r = await getStore().searchNotes(query);
        if (cancelled) return;
        const seen = new Set<string>();
        const merged: NoteMeta[] = [];
        for (const n of [...r.title, ...r.content]) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          merged.push(n);
          if (merged.length >= 6) break;
        }
        setNotes(merged);
      } catch {
        if (!cancelled) setNotes([]);
      }
    };
    if (query) {
      const t = setTimeout(load, 150);
      return () => { cancelled = true; clearTimeout(t); };
    }
    void load();
    return () => { cancelled = true; };
  }, [q, open]);

  const canWrite = handle?.canWrite() ?? false;

  const rows = useMemo<Row[]>(() => {
    const query = q.trim().toLowerCase();
    const out: Row[] = [];

    // 1) Jump to note
    for (const n of notes) {
      out.push({
        key: `note:${n.id}`,
        section: "Jump to note",
        icon: n.id === currentNoteId ? "notebooks" : "notelink",
        label: n.title || "Untitled note",
        sub: n.id === currentNoteId ? "Current note" : undefined,
        run: () => { onOpenNote(n.id); onClose(); },
      });
    }

    if (handle) {
      // 2) Insert — block commands, then modules, then presets
      for (const c of COMMANDS.filter((c) => c.group === "Insert")) {
        if (c.write && !canWrite) continue;
        if (query && !(c.label.toLowerCase().includes(query) || c.keywords?.some((k) => k.includes(query)))) continue;
        out.push({ key: `cmd:${c.id}`, section: "Insert", icon: c.icon, label: c.label, run: () => { handle.runCommand(c.id); onClose(); } });
      }
      if (canWrite) {
        const modules = searchModules(query).slice(0, query ? 8 : 4);
        for (const m of modules) {
          out.push({ key: `mod:${m.id}`, section: "Insert", icon: m.icon, label: m.name, sub: m.description, run: () => { handle.insertModule(m); onClose(); } });
        }
        const presets = builtinPresets().filter((p) => !query || p.name.toLowerCase().includes(query)).slice(0, query ? 4 : 3);
        for (const p of presets) {
          const pm = presetModule(p);
          out.push({ key: `preset:${p.id}`, section: "Insert", icon: "templates", label: pm.name, sub: pm.description, run: () => { handle.insertModule(pm); onClose(); } });
        }
      }

      // 3) Actions
      for (const c of COMMANDS.filter((c) => c.group === "Actions")) {
        if (c.write && !canWrite) continue;
        if (query && !(c.label.toLowerCase().includes(query) || c.keywords?.some((k) => k.includes(query)))) continue;
        out.push({ key: `cmd:${c.id}`, section: "Actions", icon: c.icon, label: c.label, run: () => { handle.runCommand(c.id); onClose(); } });
      }
    }

    return out;
  }, [q, notes, handle, canWrite, currentNoteId, onOpenNote, onClose]);

  // Keep the active index in range as results change.
  useEffect(() => { setActive((a) => (rows.length === 0 ? 0 : Math.min(a, rows.length - 1))); }, [rows.length]);

  // Scroll the active row into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (rows.length ? (a + 1) % rows.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0)); }
    else if (e.key === "Enter") { e.preventDefault(); rows[active]?.run(); }
  };

  // Section boundaries for rendering headers (rows are already grouped in order).
  let lastSection = "";

  return (
    <div className="print-hide fixed inset-0 z-60 flex items-start justify-center bg-foreground/25 p-6" onClick={onClose}>
      <div className="mt-[12vh] flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-modal border border-border bg-surface shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3">
          <span className="text-muted"><Icon name="search" size={16} /></span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search notes, insert, actions…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>

        <div ref={listRef} className="overflow-y-auto py-1">
          {rows.map((r, i) => {
            const header = r.section !== lastSection ? r.section : null;
            lastSection = r.section;
            return (
              <div key={r.key}>
                {header && <div className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{header}</div>}
                <button
                  data-idx={i}
                  onMouseMove={() => setActive(i)}
                  onClick={r.run}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${i === active ? "bg-accent-soft text-accent" : "text-foreground"}`}
                >
                  <span className={i === active ? "text-accent" : "text-muted"}><Icon name={r.icon} size={16} /></span>
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {r.sub && <span className="shrink-0 truncate text-xs text-muted">{r.sub}</span>}
                </button>
              </div>
            );
          })}
          {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No matches{q ? ` for “${q}”` : ""}.</p>}
        </div>
      </div>
    </div>
  );
}
