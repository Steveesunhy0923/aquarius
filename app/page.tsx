"use client";

import { AccountMenu } from "@/components/auth/AccountMenu";
import { SettingsDialog } from "@/components/SettingsDialog";
import { downloadNote } from "@/components/ExportMenu";
import { NoteCover } from "@/components/NoteCover";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getStore, migrateLocalToCloud, seedDemoLibrary } from "@/lib/storage";
import type { LibraryStore, NoteBundleFile, NoteMeta, Notebook, Subject } from "@/lib/storage/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TRASH_DAYS = 30;

/** Structural check that a parsed JSON value is an Aquarius bundle file. */
function isAqnoteBundle(x: unknown): x is NoteBundleFile {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  return b.format === "aqnote" && typeof b.meta === "object" && typeof b.pkg === "object";
}

/** A title not already in `existing`, appending " (2)", " (3)", … if needed. */
function uniqueTitle(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

/** Hard-delete soft-deleted notes whose retention window has elapsed. */
async function purgeExpired(store: LibraryStore): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  const deleted = await store.listDeletedNotes();
  await Promise.all(
    deleted.filter((n) => (n.deletedAt ?? "") < cutoff).map((n) => store.deleteNote(n.id)),
  );
}

/**
 * Notability-style library: Subject ▸ Notebook ▸ Note, plus global search,
 * per-note tags/export, and a Recently Deleted (soft-delete) bin.
 */
export default function LibraryPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ title: NoteMeta[]; content: NoteMeta[] } | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [trash, setTrash] = useState(false);
  const [deleted, setDeleted] = useState<NoteMeta[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Initial load: seed on first run, purge expired trash, then list subjects.
  // Re-runs when the signed-in user changes (sign in/out swaps cloud ↔ local
  // store); waits for the auth session to resolve so we load the right library
  // once rather than flashing the local one first.
  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    (async () => {
      const store = getStore();
      await seedDemoLibrary(store);
      await purgeExpired(store).catch(() => {});
      const subs = await store.listSubjects();
      if (!alive) return;
      setSubjects(subs);
      setSubjectId(subs[0]?.id ?? null);
      setReady(true);
    })().catch(console.error);
    return () => { alive = false; };
  }, [authLoading, userId]);

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

  useEffect(() => {
    if (!notebookId) {
      setNotes([]);
      return;
    }
    setTagFilter(null);
    getStore().listNotes(notebookId).then(setNotes).catch(console.error);
  }, [notebookId]);

  // Debounced library-wide search (title/tags first, then note contents).
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      getStore().searchNotes(q).then((r) => { if (alive) setResults(r); }).catch(console.error);
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  useEffect(() => {
    if (!trash) return;
    getStore().listDeletedNotes().then(setDeleted).catch(console.error);
  }, [trash]);

  const refresh = useCallback(async () => {
    const store = getStore();
    if (notebookId) setNotes(await store.listNotes(notebookId));
    if (query.trim()) setResults(await store.searchNotes(query.trim()));
    if (trash) setDeleted(await store.listDeletedNotes());
  }, [notebookId, query, trash]);

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

  const removeSubject = useCallback(async (sid: string) => {
    const s = subjects.find((x) => x.id === sid);
    if (!confirm(`Delete subject “${s?.name ?? ""}” and all its notebooks and notes? This cannot be undone.`)) return;
    const store = getStore();
    await store.deleteSubject(sid);
    const subs = await store.listSubjects();
    setSubjects(subs);
    if (subjectId === sid) setSubjectId(subs[0]?.id ?? null);
  }, [subjects, subjectId]);

  const removeNotebook = useCallback(async (nbId: string) => {
    const nb = notebooks.find((x) => x.id === nbId);
    if (!confirm(`Delete notebook “${nb?.name ?? ""}” and all its notes? This cannot be undone.`)) return;
    const store = getStore();
    await store.deleteNotebook(nbId);
    if (!subjectId) return;
    const nbs = await store.listNotebooks(subjectId);
    setNotebooks(nbs);
    if (notebookId === nbId) setNotebookId(nbs[0]?.id ?? null);
  }, [notebooks, subjectId, notebookId]);

  const addNote = useCallback(async () => {
    if (!notebookId) return;
    const meta = await getStore().createNote({ notebookId, title: "Untitled note" });
    router.push(`/editor/${meta.id}?new=1`);
  }, [notebookId, router]);

  // User delete = soft delete (recoverable from Recently Deleted).
  const softDelete = useCallback(
    async (id: string) => {
      await getStore().updateNoteMeta(id, { deletedAt: new Date().toISOString() });
      await refresh();
    },
    [refresh],
  );
  const restore = useCallback(
    async (id: string) => {
      await getStore().updateNoteMeta(id, { deletedAt: null });
      await refresh();
    },
    [refresh],
  );
  const purge = useCallback(
    async (id: string) => {
      if (!confirm("Delete permanently? This cannot be undone.")) return;
      await getStore().deleteNote(id);
      await refresh();
    },
    [refresh],
  );
  const emptyTrash = useCallback(async () => {
    if (deleted.length === 0) return;
    if (!confirm(`Permanently delete all ${deleted.length} note(s)? This cannot be undone.`)) return;
    const store = getStore();
    await Promise.all(deleted.map((n) => store.deleteNote(n.id)));
    await refresh();
  }, [deleted, refresh]);

  const pdfNote = useCallback(
    (note: NoteMeta) => router.push(`/editor/${note.id}?print=1`),
    [router],
  );

  const copyNote = useCallback(
    async (note: NoteMeta) => {
      try {
        const store = getStore();
        const siblings = await store.listNotes(note.notebookId);
        const existing = new Set(siblings.map((n) => n.title));
        const bundle = await store.exportNote(note.id);
        bundle.meta.title = uniqueTitle(`Copy of ${note.title}`, existing);
        await store.importNote(bundle, note.notebookId);
        await refresh();
      } catch (e) {
        console.error("copy failed", e);
        alert("Couldn't copy this note.");
      }
    },
    [refresh],
  );

  // ── Import an .aqnote bundle (from a picked file or a link) into this notebook.
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importBundle = useCallback(
    async (bundle: NoteBundleFile) => {
      if (!notebookId) return;
      const store = getStore();
      const siblings = await store.listNotes(notebookId);
      const existing = new Set(siblings.map((n) => n.title));
      // Keep the source title, disambiguating only if it already exists here.
      bundle.meta.title = uniqueTitle(bundle.meta.title, existing);
      await store.importNote(bundle, notebookId);
      await refresh();
    },
    [notebookId, refresh],
  );

  const importFromFile = useCallback(
    async (file: File) => {
      try {
        const bundle: unknown = JSON.parse(await file.text());
        if (!isAqnoteBundle(bundle)) throw new Error("not an .aqnote bundle");
        await importBundle(bundle);
      } catch (e) {
        console.error("import failed", e);
        alert("Couldn't import that file. It must be a valid .aqnote bundle.");
      }
    },
    [importBundle],
  );

  const importFromLink = useCallback(async () => {
    const url = prompt("Paste a link to an .aqnote file")?.trim();
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bundle: unknown = await res.json();
      if (!isAqnoteBundle(bundle)) throw new Error("not an .aqnote bundle");
      await importBundle(bundle);
    } catch (e) {
      console.error("import from link failed", e);
      alert("Couldn't import from that link. It must point to a public .aqnote file.");
    }
  }, [importBundle]);

  const addTag = useCallback(
    async (note: NoteMeta) => {
      const raw = prompt("Add a tag")?.trim();
      if (!raw) return;
      const tag = raw.replace(/,/g, " ").trim();
      if (!tag || note.tags.includes(tag)) return;
      await getStore().updateNoteMeta(note.id, { tags: [...note.tags, tag] });
      await refresh();
    },
    [refresh],
  );
  const removeTag = useCallback(
    async (note: NoteMeta, tag: string) => {
      await getStore().updateNoteMeta(note.id, { tags: note.tags.filter((t) => t !== tag) });
      await refresh();
    },
    [refresh],
  );

  const tagsInNotebook = useMemo(
    () => Array.from(new Set(notes.flatMap((n) => n.tags))).sort(),
    [notes],
  );
  const visibleNotes = useMemo(
    () => (tagFilter ? notes.filter((n) => n.tags.includes(tagFilter)) : notes),
    [notes, tagFilter],
  );

  const cardProps = { onDelete: softDelete, onCopy: copyNote, onPdf: pdfNote, onAddTag: addTag, onRemoveTag: removeTag };

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center text-muted">
        Loading your library…
      </main>
    );
  }

  const searching = query.trim().length > 0;

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-6 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Aquarius</h1>
          <p className="text-sm text-muted">
            WYSIWYG math notes · LaTeX is the output, not the input
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-72">
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim()) setTrash(false); }}
              placeholder="Search title, tag, or content…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 pr-8 text-sm outline-none focus:border-accent"
            />
            {searching && (
              <button
                onClick={() => setQuery("")}
                title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>
          <button
            onClick={() => setTrash((t) => !t)}
            className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm ${
              trash ? "border-accent text-accent" : "border-border text-muted hover:border-accent"
            }`}
          >
            🗑 Recently Deleted
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:border-accent"
          >
            ⚙
          </button>
          <AccountMenu
            onUploadLocal={async () => {
              await migrateLocalToCloud();
              await refresh();
              setSubjects(await getStore().listSubjects());
            }}
          />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[220px_240px_1fr]">
        {/* Subjects */}
        <Pane title="Subjects" onAdd={addSubject} addLabel="Add subject">
          {subjects.map((s) => (
            <Row key={s.id} active={!trash && s.id === subjectId} onClick={() => { setTrash(false); setSubjectId(s.id); }} onDelete={() => removeSubject(s.id)}>
              <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: s.color || "var(--accent)" }} />
              <span className="truncate">{s.name}</span>
            </Row>
          ))}
        </Pane>

        {/* Notebooks */}
        <Pane title="Notebooks" onAdd={subjectId ? addNotebook : undefined} addLabel="Add notebook">
          {notebooks.map((nb) => (
            <Row key={nb.id} active={!trash && nb.id === notebookId} onClick={() => { setTrash(false); setNotebookId(nb.id); }} onDelete={() => removeNotebook(nb.id)}>
              <span className="shrink-0">📓</span>
              <span className="truncate">{nb.name}</span>
            </Row>
          ))}
          {subjectId && notebooks.length === 0 && <Empty>No notebooks yet</Empty>}
        </Pane>

        {/* Notes / Search / Trash */}
        <section className="p-6">
          {trash ? (
            <>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
                  Recently Deleted
                </h2>
                {deleted.length > 0 && (
                  <button onClick={emptyTrash} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:border-red-500 hover:text-red-500">
                    Empty
                  </button>
                )}
              </div>
              <p className="mb-4 text-xs text-muted">Notes are removed permanently after {TRASH_DAYS} days.</p>
              {deleted.length === 0 ? (
                <Empty>Nothing here. Deleted notes will appear for {TRASH_DAYS} days.</Empty>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] items-start gap-4">
                  {deleted.map((n) => (
                    <DeletedCard key={n.id} note={n} onRestore={restore} onPurge={purge} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
                  {searching ? "Search results" : "Notes"}
                </h2>
                {!searching && (
                  <ImportMenu
                    disabled={!notebookId}
                    onFile={() => fileInputRef.current?.click()}
                    onLink={importFromLink}
                  />
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".aqnote,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ""; // allow re-picking the same file
                  if (f) importFromFile(f);
                }}
              />

              {searching ? (
                !results ? (
                  <Empty>Searching…</Empty>
                ) : results.title.length + results.content.length === 0 ? (
                  <Empty>No notes match “{query.trim()}”.</Empty>
                ) : (
                  <div className="space-y-8">
                    {results.title.length > 0 && (
                      <ResultGroup label="Title &amp; tags" notes={results.title} {...cardProps} />
                    )}
                    {results.content.length > 0 && (
                      <ResultGroup label="In contents" notes={results.content} {...cardProps} />
                    )}
                  </div>
                )
              ) : !notebookId ? (
                <Empty>Select or create a notebook to see its notes.</Empty>
              ) : (
                <>
                  {tagsInNotebook.length > 0 && (
                    <div className="mb-4 flex flex-wrap items-center gap-1.5">
                      <TagChip active={tagFilter === null} onClick={() => setTagFilter(null)}>
                        All
                      </TagChip>
                      {tagsInNotebook.map((tag) => (
                        <TagChip
                          key={tag}
                          active={tagFilter === tag}
                          onClick={() => setTagFilter((t) => (t === tag ? null : tag))}
                        >
                          {tag}
                        </TagChip>
                      ))}
                    </div>
                  )}
                  {tagFilter && visibleNotes.length === 0 ? (
                    <Empty>No notes tagged “{tagFilter}”.</Empty>
                  ) : (
                    <NoteGrid notes={visibleNotes} onNew={addNote} {...cardProps} />
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}

type CardHandlers = {
  onDelete: (id: string) => void;
  onCopy: (n: NoteMeta) => void;
  onPdf: (n: NoteMeta) => void;
  onAddTag: (n: NoteMeta) => void;
  onRemoveTag: (n: NoteMeta, tag: string) => void;
};

function ResultGroup({ label, notes, ...h }: { label: string; notes: NoteMeta[] } & CardHandlers) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {label} <span className="font-normal">· {notes.length}</span>
      </h3>
      <NoteGrid notes={notes} {...h} />
    </div>
  );
}

function NoteGrid({ notes, onNew, ...h }: { notes: NoteMeta[]; onNew?: () => void } & CardHandlers) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] items-start gap-4">
      {onNew && <NewNoteTile onClick={onNew} />}
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} {...h} />
      ))}
    </div>
  );
}

/** A big, card-sized tile that creates a new blank note — always the first cell. */
function NewNoteTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-xl border-2 border-dashed border-border bg-surface/40 p-3 text-left transition hover:border-accent hover:bg-accent/[0.03]"
    >
      <div className="grid aspect-[3/4] place-items-center rounded-md border border-dashed border-border text-muted transition group-hover:border-accent group-hover:text-accent">
        <span className="text-5xl font-light leading-none">+</span>
      </div>
      <div className="mt-2 text-sm font-medium text-muted transition group-hover:text-accent">New note</div>
      <div className="text-xs text-muted">Blank document</div>
    </button>
  );
}

/** Dropdown to import a note from an .aqnote file or a link to one. */
function ImportMenu({
  disabled,
  onFile,
  onLink,
}: {
  disabled: boolean;
  onFile: () => void;
  onLink: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        disabled={disabled}
        title="Import a note"
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted"
      >
        ↧ Import
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={(e) => { e.preventDefault(); setOpen(false); }}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-border bg-surface p-1 text-sm shadow-lg">
            <MenuItem onClick={() => { setOpen(false); onFile(); }}>
              From file <span className="text-muted">(.aqnote)</span>
            </MenuItem>
            <MenuItem onClick={() => { setOpen(false); onLink(); }}>From link…</MenuItem>
          </div>
        </>
      )}
    </span>
  );
}

function exportOrAlert(noteId: string, title: string, fmt: "tex" | "aqnote") {
  downloadNote(noteId, title, fmt).catch((e) => {
    console.error("export failed", e);
    alert("Couldn't export this note.");
  });
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className={`block w-full rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06] ${danger ? "text-red-500" : ""}`}
    >
      {children}
    </button>
  );
}

function NoteCardMenu({
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
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        title="More"
        className="grid h-6 w-6 place-items-center rounded-full bg-surface text-base leading-none shadow ring-1 ring-border hover:ring-accent"
      >
        ⋯
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={(e) => { e.preventDefault(); setOpen(false); }}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-border bg-surface p-1 text-sm shadow-lg">
            <MenuItem onClick={() => { setOpen(false); onCopy(note); }}>Make a copy</MenuItem>
            <MenuItem onClick={() => { setOpen(false); onPdf(note); }}>
              Download <span className="text-muted">(PDF)</span>
            </MenuItem>
            <MenuItem onClick={() => { setOpen(false); exportOrAlert(note.id, note.title, "tex"); }}>
              Download <span className="text-muted">(.tex)</span>
            </MenuItem>
            <MenuItem onClick={() => { setOpen(false); exportOrAlert(note.id, note.title, "aqnote"); }}>
              Download <span className="text-muted">(.aqnote)</span>
            </MenuItem>
            <div className="my-1 h-px bg-border" />
            <MenuItem danger onClick={() => { setOpen(false); onDelete(note.id); }}>Delete</MenuItem>
          </div>
        </>
      )}
    </span>
  );
}

function NoteCard({ note, onDelete, onCopy, onPdf, onAddTag, onRemoveTag }: { note: NoteMeta } & CardHandlers) {
  return (
    <div className="group relative flex flex-col rounded-xl border border-border bg-surface p-3 transition hover:border-accent">
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
            <button onClick={() => onRemoveTag(note, tag)} title="Remove tag" className="hidden leading-none hover:text-foreground group-hover/tag:inline">
              ✕
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

function DeletedCard({
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
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-red-500 hover:text-red-500"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-xs transition ${
        active ? "bg-accent text-white" : "border border-border text-muted hover:border-accent"
      }`}
    >
      {children}
    </button>
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
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{title}</h2>
        {onAdd && (
          <button onClick={onAdd} title={addLabel} className="rounded px-1.5 text-lg leading-none text-muted hover:text-accent">
            +
          </button>
        )}
      </div>
      <div className="flex-1 space-y-0.5 px-2">{children}</div>
    </aside>
  );
}

function Row({ active, onClick, onDelete, children }: { active: boolean; onClick: () => void; onDelete?: () => void; children: React.ReactNode }) {
  return (
    <div className={`group flex items-center rounded-md ${active ? "bg-accent/10" : "hover:bg-foreground/5"}`}>
      <button
        onClick={onClick}
        className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm ${active ? "text-accent" : ""}`}
      >
        {children}
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          title="Delete"
          className="mr-1 shrink-0 px-1 text-muted opacity-0 transition hover:text-red-500 group-hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-4 text-sm text-muted">{children}</p>;
}
