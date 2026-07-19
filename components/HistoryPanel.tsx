"use client";

import { BlockView } from "@/components/BlockView";
import { Icon } from "@/components/Icon";
import { Dialog } from "@/components/ui/Dialog";
import { BTN, BTN_PRIMARY } from "@/components/ui/primitives";
import { uiConfirm, uiPrompt } from "@/components/ui/dialogs";
import { getStore } from "@/lib/storage";
import type { NoteSnapshot, SnapshotMeta } from "@/lib/storage/types";
import { useCallback, useEffect, useState } from "react";

/** "just now" / "5 minutes ago" / "3 days ago" from an ISO timestamp. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Version history / timeline — a two-pane dialog: the left rail lists every
 * captured version of the note (newest first), the right pane previews the
 * selected one read-only and offers Restore / Delete. Versions are snapshots of
 * the document tree (auto-captured on edit + on demand), so this works for
 * private notes too, not just co-edited ones.
 */
export function HistoryPanel({
  noteId,
  canWrite,
  onClose,
  onRestore,
  onSaveVersion,
}: {
  noteId: string;
  canWrite: boolean;
  onClose: () => void;
  onRestore: (snap: NoteSnapshot) => void;
  onSaveVersion: (label: string) => Promise<void>;
}) {
  const [snaps, setSnaps] = useState<SnapshotMeta[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<NoteSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await getStore().listSnapshots(noteId);
      setSnaps(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    } catch {
      setSnaps([]);
    }
  }, [noteId]);

  useEffect(() => { void reload(); }, [reload]);

  // Load the selected version's tree for the preview pane.
  useEffect(() => {
    if (!selectedId) { setPreview(null); return; }
    let cancelled = false;
    setPreview(null);
    getStore().getSnapshot(selectedId).then((s) => { if (!cancelled) setPreview(s ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedId]);

  const saveVersion = async () => {
    const label = await uiPrompt({ title: "Name this version", placeholder: "e.g. Before rewrite", confirmLabel: "Save version" });
    if (label == null) return;
    setBusy(true);
    try { await onSaveVersion(label.trim() || "Manual save"); await reload(); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    if (!selectedId) return;
    const snap = await getStore().getSnapshot(selectedId);
    if (!snap) return;
    const ok = await uiConfirm({
      title: "Restore this version?",
      message: "The note will be replaced with this version. Your current text is saved as a version first, and you can undo the restore.",
      confirmLabel: "Restore",
    });
    if (ok) onRestore(snap);
  };

  const remove = async (id: string) => {
    const ok = await uiConfirm({ title: "Delete this version?", message: "This version will be permanently removed.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await getStore().deleteSnapshot(id).catch(() => {});
    if (selectedId === id) setSelectedId(null);
    await reload();
  };

  return (
    <Dialog title="Version history" onClose={onClose} maxWidth="max-w-4xl">
      <div className="flex h-[62vh] min-h-0">
        {/* Timeline rail */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border">
          {canWrite && (
            <button onClick={saveVersion} disabled={busy} className={`${BTN} m-3 justify-center gap-1.5 disabled:opacity-50`}>
              <Icon name="save" size={14} /> Save current version
            </button>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {snaps === null ? (
              <p className="px-2 py-6 text-center text-sm text-muted">Loading…</p>
            ) : snaps.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted">No versions yet. They&rsquo;re captured automatically as you edit{canWrite ? ", or save one now" : ""}.</p>
            ) : (
              snaps.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`group mb-0.5 flex w-full items-center gap-2 rounded-control px-2 py-2 text-left ${s.id === selectedId ? "bg-accent-soft text-accent" : "hover:bg-foreground/5"}`}
                >
                  <span className={s.id === selectedId ? "text-accent" : "text-muted"}><Icon name={s.kind === "manual" ? "save" : "history"} size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{s.label || (s.kind === "manual" ? "Manual save" : "Autosave")}</span>
                    <span className="block text-xs text-muted">{timeAgo(s.createdAt)}{s.kind === "manual" ? " · saved" : ""}</span>
                  </span>
                  {canWrite && (
                    <span onClick={(e) => { e.stopPropagation(); void remove(s.id); }} title="Delete version" className="shrink-0 text-faint opacity-0 transition hover:text-danger group-hover:opacity-100"><Icon name="trash" size={14} /></span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Preview + actions */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto bg-background p-6">
            {preview ? (
              <div className="mx-auto max-w-2xl space-y-2">
                {preview.tree.blocks.map((b) => <BlockView key={b.id} block={b} />)}
                {preview.tree.blocks.length === 0 && <p className="text-center text-sm text-muted">This version is empty.</p>}
              </div>
            ) : (
              <p className="grid h-full place-items-center text-sm text-muted">{selectedId ? "Loading preview…" : "Select a version to preview it."}</p>
            )}
          </div>
          {canWrite && preview && (
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <span className="mr-auto text-xs text-muted">{timeAgo(preview.createdAt)}</span>
              <button onClick={restore} className={`${BTN_PRIMARY} gap-1.5`}><Icon name="history" size={14} /> Restore this version</button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
