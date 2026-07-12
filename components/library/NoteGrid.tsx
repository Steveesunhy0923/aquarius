"use client";

import { Icon } from "@/components/Icon";
import type { NoteMeta } from "@/lib/storage/types";
import { type CardHandlers, NoteCard } from "./NoteCard";

/** Shared container class for every card grid in the library (notes, search, trash, shared). */
export const NOTE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] items-start gap-4";

export function NoteGrid({ notes, onNew, ...h }: { notes: NoteMeta[]; onNew?: () => void } & CardHandlers) {
  return (
    <div className={NOTE_GRID}>
      {onNew && <NewNoteTile onClick={onNew} />}
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} {...h} />
      ))}
    </div>
  );
}

export function ResultGroup({ label, notes, ...h }: { label: string; notes: NoteMeta[] } & CardHandlers) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {label} <span className="font-normal">· {notes.length}</span>
      </h3>
      <NoteGrid notes={notes} {...h} />
    </div>
  );
}

/** A big, card-sized tile that creates a new blank note — always the first cell. */
export function NewNoteTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-xl border-2 border-dashed border-border bg-surface/40 p-3 text-left transition hover:border-accent hover:bg-accent/[0.03]"
    >
      <div className="grid aspect-[3/4] place-items-center rounded-md border border-dashed border-border text-muted transition group-hover:border-accent group-hover:text-accent">
        <Icon name="plus" size={44} strokeWidth={1} />
      </div>
      <div className="mt-2 text-sm font-medium text-muted transition group-hover:text-accent">New note</div>
      <div className="text-xs text-muted">Blank document</div>
    </button>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-4 text-sm text-muted">{children}</p>;
}
