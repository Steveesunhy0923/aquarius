"use client";

import { getStore, seedDemoLibrary } from "@/lib/storage";
import type { NoteMeta, Notebook, Subject } from "@/lib/storage/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/**
 * Notability-style library: Subject ▸ Notebook ▸ Note.
 * Browses the LIGHT index only (no note packages loaded) so it stays instant.
 */
export default function LibraryPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Initial load: seed a demo library on first run, then list subjects.
  useEffect(() => {
    (async () => {
      const store = getStore();
      await seedDemoLibrary(store);
      const subs = await store.listSubjects();
      setSubjects(subs);
      setSubjectId(subs[0]?.id ?? null);
      setReady(true);
    })().catch(console.error);
  }, []);

  // Load notebooks when the active subject changes.
  useEffect(() => {
    if (!subjectId) {
      setNotebooks([]);
      setNotebookId(null);
      return;
    }
    getStore()
      .listNotebooks(subjectId)
      .then((nbs) => {
        setNotebooks(nbs);
        setNotebookId(nbs[0]?.id ?? null);
      })
      .catch(console.error);
  }, [subjectId]);

  // Load notes when the active notebook changes.
  useEffect(() => {
    if (!notebookId) {
      setNotes([]);
      return;
    }
    getStore().listNotes(notebookId).then(setNotes).catch(console.error);
  }, [notebookId]);

  const addSubject = useCallback(async () => {
    const name = prompt("New subject name?")?.trim();
    if (!name) return;
    const store = getStore();
    const s = await store.createSubject({ name });
    setSubjects(await store.listSubjects());
    setSubjectId(s.id);
  }, []);

  const addNotebook = useCallback(async () => {
    if (!subjectId) return;
    const name = prompt("New notebook name?")?.trim();
    if (!name) return;
    const store = getStore();
    const nb = await store.createNotebook({ subjectId, name });
    setNotebooks(await store.listNotebooks(subjectId));
    setNotebookId(nb.id);
  }, [subjectId]);

  const addNote = useCallback(async () => {
    if (!notebookId) return;
    const store = getStore();
    const meta = await store.createNote({ notebookId, title: "Untitled note" });
    router.push(`/editor/${meta.id}`);
  }, [notebookId, router]);

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center text-muted">
        Loading your library…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Aquarius</h1>
          <p className="text-sm text-muted">
            WYSIWYG math notes · LaTeX is the output, not the input
          </p>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[220px_240px_1fr]">
        {/* Subjects */}
        <Pane
          title="Subjects"
          onAdd={addSubject}
          addLabel="Add subject"
        >
          {subjects.map((s) => (
            <Row
              key={s.id}
              active={s.id === subjectId}
              onClick={() => setSubjectId(s.id)}
            >
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: s.color || "var(--accent)" }}
              />
              {s.name}
            </Row>
          ))}
        </Pane>

        {/* Notebooks */}
        <Pane
          title="Notebooks"
          onAdd={subjectId ? addNotebook : undefined}
          addLabel="Add notebook"
        >
          {notebooks.map((nb) => (
            <Row
              key={nb.id}
              active={nb.id === notebookId}
              onClick={() => setNotebookId(nb.id)}
            >
              📓 {nb.name}
            </Row>
          ))}
          {subjectId && notebooks.length === 0 && (
            <Empty>No notebooks yet</Empty>
          )}
        </Pane>

        {/* Notes */}
        <section className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Notes
            </h2>
            <button
              onClick={addNote}
              disabled={!notebookId}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              + New note
            </button>
          </div>

          {notes.length === 0 ? (
            <Empty>No notes in this notebook yet — create one.</Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
              {notes.map((n) => (
                <Link
                  key={n.id}
                  href={`/editor/${n.id}`}
                  className="flex aspect-[3/4] flex-col rounded-xl border border-border bg-surface p-3 transition hover:border-accent"
                >
                  <div className="flex-1 overflow-hidden rounded-md bg-background" />
                  <div className="mt-2 truncate text-sm font-medium">
                    {n.title}
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(n.updatedAt).toLocaleDateString()}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Pane({
  title,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  onAdd?: () => void;
  addLabel: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="flex flex-col border-r border-border">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          {title}
        </h2>
        {onAdd && (
          <button
            onClick={onAdd}
            title={addLabel}
            className="rounded px-1.5 text-lg leading-none text-muted hover:text-accent"
          >
            +
          </button>
        )}
      </div>
      <div className="flex-1 space-y-0.5 px-2">{children}</div>
    </aside>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
        active ? "bg-accent/10 text-accent" : "hover:bg-foreground/5"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-4 text-sm text-muted">{children}</p>;
}
