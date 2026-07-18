"use client";

import { downloadNote } from "@/components/ExportMenu";
import { Icon } from "@/components/Icon";
import { NoteCover } from "@/components/NoteCover";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { uiAlert } from "@/components/ui/dialogs";
import type { Role } from "@/lib/sharing/sharing";
import type { NoteMeta } from "@/lib/storage/types";
import Link from "next/link";

export type CardHandlers = {
  onDelete: (id: string) => void;
  onCopy: (n: NoteMeta) => void;
  onPdf: (n: NoteMeta) => void;
  onAddTag: (n: NoteMeta) => void;
  onRemoveTag: (n: NoteMeta, tag: string) => void;
};

function exportOrAlert(noteId: string, title: string, fmt: "tex" | "aqnote") {
  downloadNote(noteId, title, fmt).catch((e) => {
    console.error("export failed", e);
    void uiAlert({ title: "Export failed", message: "Couldn't export this note." });
  });
}

export function NoteCardMenu({
  note,
  onCopy,
  onDelete,
  onPdf,
}: {
  note: NoteMeta;
  onCopy: (n: NoteMeta) => void;
  onDelete: (id: string) => void;
  onPdf: (n: NoteMeta) => void;
}) {
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
          title="More"
          className="grid h-6 w-6 place-items-center rounded-full bg-surface text-muted shadow ring-1 ring-border hover:text-foreground hover:ring-accent"
        >
          <Icon name="more" size={16} />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem onClick={() => { close(); onCopy(note); }}>Make a copy</MenuItem>
          <MenuItem onClick={() => { close(); onPdf(note); }}>
            Download <span className="text-muted">(PDF)</span>
          </MenuItem>
          <MenuItem onClick={() => { close(); exportOrAlert(note.id, note.title, "tex"); }}>
            Download <span className="text-muted">(.tex)</span>
          </MenuItem>
          <MenuItem onClick={() => { close(); exportOrAlert(note.id, note.title, "aqnote"); }}>
            Download <span className="text-muted">(.aqnote)</span>
          </MenuItem>
          <div className="my-1 h-px bg-border" />
          <MenuItem danger onClick={() => { close(); onDelete(note.id); }}>Delete</MenuItem>
        </>
      )}
    </Menu>
  );
}

export function NoteCard({ note, onDelete, onCopy, onPdf, onAddTag, onRemoveTag }: { note: NoteMeta } & CardHandlers) {
  return (
    <div className="group relative flex flex-col rounded-card border border-border bg-surface p-3 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-card">
      <div className="absolute right-2 top-2 z-10 opacity-60 transition group-hover:opacity-100">
        <NoteCardMenu note={note} onCopy={onCopy} onDelete={onDelete} onPdf={onPdf} />
      </div>
      <Link href={`/editor/${note.id}`} className="flex flex-col">
        <div className="aspect-[3/4] overflow-hidden rounded-md border border-border">
          <NoteCover noteId={note.id} />
        </div>
        <div className="mt-2 truncate text-sm font-medium">{note.title}</div>
        <div className="text-xs text-muted">{new Date(note.updatedAt).toLocaleDateString()}</div>
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {note.tags.map((tag) => (
          <span key={tag} className="group/tag inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
            {tag}
            <button onClick={() => onRemoveTag(note, tag)} title="Remove tag" className="hidden leading-none hover:text-foreground group-hover/tag:inline-flex">
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
        <button onClick={() => onAddTag(note)} title="Add tag" className="rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted hover:border-accent hover:text-accent">
          + tag
        </button>
      </div>
    </div>
  );
}

/** Read-only card for a note someone shared with you, badged with your role. */
export function SharedNoteCard({ note, role, onOpen }: { note: NoteMeta; role: Role; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex flex-col items-stretch overflow-hidden rounded-lg border border-border bg-surface text-left hover:border-accent"
    >
      <NoteCover noteId={note.id} />
      <span className="line-clamp-2 px-3 pt-2 text-sm font-medium">{note.title}</span>
      <span className="px-3 pb-3 pt-1">
        <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{role}</span>
      </span>
    </button>
  );
}

export function DeletedCard({
  note,
  onRestore,
  onPurge,
}: {
  note: NoteMeta;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-3">
      <div className="aspect-[3/4] overflow-hidden rounded-md border border-border opacity-70">
        <NoteCover noteId={note.id} />
      </div>
      <div className="mt-2 truncate text-sm font-medium">{note.title}</div>
      <div className="text-xs text-muted">
        Deleted {note.deletedAt ? new Date(note.deletedAt).toLocaleDateString() : ""}
      </div>
      <div className="mt-2 flex gap-1.5">
        <button
          onClick={() => onRestore(note.id)}
          className="flex-1 rounded-md border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent"
        >
          Restore
        </button>
        <button
          onClick={() => onPurge(note.id)}
          title="Delete permanently"
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-danger hover:text-danger"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
