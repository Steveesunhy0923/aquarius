"use client";

import { Icon } from "@/components/Icon";
import { Dialog, DialogSection } from "@/components/ui/Dialog";
import { computeOutline, type OutlineItem } from "@/lib/blocks/outline";
import { getStore } from "@/lib/storage";
import type { NoteMeta } from "@/lib/storage/types";
import { useEffect, useState } from "react";

export interface NoteLinkPick {
  noteId: string;
  /** Heading block id when a section is chosen; absent = the whole note. */
  blockId?: string;
  title: string;
  section?: string;
}

/**
 * Two-step picker for inserting a note link: search/choose a note, then link
 * to the whole note or to one of its sections (its headings). Opened from the
 * toolbar's link-note button or by typing `[[` in a paragraph.
 */
export function NoteLinkPicker({ currentId, onPick, onClose }: {
  /** The note being edited — kept in the list, labeled "this note". */
  currentId?: string;
  onPick: (pick: NoteLinkPick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<NoteMeta[]>([]);
  const [results, setResults] = useState<NoteMeta[] | null>(null);
  const [chosen, setChosen] = useState<NoteMeta | null>(null);
  const [outline, setOutline] = useState<OutlineItem[] | null>(null); // null = loading

  useEffect(() => {
    getStore().listRecentNotes(40).then(setRecent).catch(() => {});
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      getStore().searchNotes(q).then((r) => {
        if (!alive) return;
        const seen = new Set<string>();
        setResults([...r.title, ...r.content].filter((n) => !seen.has(n.id) && seen.add(n.id)));
      }).catch(() => {});
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  useEffect(() => {
    if (!chosen) return;
    setOutline(null);
    let alive = true;
    getStore().openNote(chosen.id)
      .then((p) => { if (alive) setOutline(computeOutline(p.tree.blocks)); })
      .catch(() => { if (alive) setOutline([]); });
    return () => { alive = false; };
  }, [chosen]);

  const list = results ?? recent;
  const pickWhole = () => chosen && onPick({ noteId: chosen.id, title: chosen.title || "Untitled" });
  const pickSection = (item: OutlineItem) =>
    chosen && onPick({ noteId: chosen.id, blockId: item.id, title: chosen.title || "Untitled", section: item.text });

  return (
    <Dialog title="Link to a note" onClose={onClose} maxWidth="max-w-lg">
      {chosen ? (
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <button onClick={() => setChosen(null)} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">
              <Icon name="back" size={13} /> Notes
            </button>
            <span className="min-w-0 truncate text-sm font-semibold">{chosen.title || "Untitled"}</span>
          </div>
          <DialogSection className="mb-2">Link to</DialogSection>
          <div className="max-h-80 overflow-y-auto">
            <button onClick={pickWhole} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-foreground/[0.05]">
              <Icon name="pagesize" size={16} className="shrink-0 text-muted" />
              <span className="font-medium">The whole note</span>
              <span className="text-xs text-muted">— opens at the top</span>
            </button>
            {outline === null ? (
              <p className="px-2 py-3 text-xs text-muted">Reading sections…</p>
            ) : outline.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted">No sections — this note has no headings yet.</p>
            ) : (
              outline.map((item) => (
                <button
                  key={item.id}
                  onClick={() => pickSection(item)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/[0.05]"
                  style={{ paddingLeft: `${8 + (item.level - 1) * 16}px` }}
                >
                  <Icon name="heading" size={14} className="shrink-0 text-muted" />
                  <span className="min-w-0 truncate">{item.text}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="px-5 py-4">
          <div className="relative mb-3">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"><Icon name="search" size={16} /></span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              autoFocus
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted">{query.trim() ? "No matches." : "No notes yet."}</p>
            ) : (
              list.map((n) => (
                <button key={n.id} onClick={() => setChosen(n)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/[0.05]">
                  <Icon name="pagesize" size={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{n.title || "Untitled"}</span>
                  {n.id === currentId && <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">this note</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
