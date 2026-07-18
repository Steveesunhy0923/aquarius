"use client";

import { AccountMenu } from "@/components/auth/AccountMenu";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Icon } from "@/components/Icon";
import { ImportMenu } from "@/components/library/ImportMenu";
import { DeletedCard, SharedNoteCard } from "@/components/library/NoteCard";
import { Empty, NOTE_GRID, NoteGrid, ResultGroup } from "@/components/library/NoteGrid";
import { SideHead, SideItem, TagChip } from "@/components/library/Sidebar";
import { uiAlert, uiConfirm, uiPrompt } from "@/components/ui/dialogs";
import { useAuth } from "@/lib/auth/AuthProvider";
import { errorMessage } from "@/lib/errors";
import { listSharedWithMe, type SharedNote } from "@/lib/sharing/sharing";
import { getStore, migrateLocalToCloud, seedDemoLibrary } from "@/lib/storage";
import type { LibraryStore, NoteBundleFile, NoteMeta, Notebook, Subject } from "@/lib/storage/types";
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
  const [uploading, setUploading] = useState(false);
  const [shared, setShared] = useState(false);
  const [uncat, setUncat] = useState(false);
  const [sharedNotes, setSharedNotes] = useState<SharedNote[]>([]);

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
      // Leave any account-scoped view (shared/uncat) when the account changes.
      setShared(false);
      setUncat(false);
      setTrash(false);
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

  // Shares split by whether they've been opened: unopened ones are the
  // "Shared with me" inbox; opened ones live in the Uncategorized section.
  // Keyed to userId so sign-out clears the list and account switches refetch.
  useEffect(() => {
    if (!userId || (!shared && !uncat)) { setSharedNotes([]); return; }
    listSharedWithMe().then(setSharedNotes).catch(() => setSharedNotes([]));
  }, [shared, uncat, userId]);
  const sharedInbox = useMemo(() => sharedNotes.filter((s) => !s.openedAt), [sharedNotes]);
  const uncatNotes = useMemo(() => sharedNotes.filter((s) => s.openedAt), [sharedNotes]);

  const refresh = useCallback(async () => {
    const store = getStore();
    if (notebookId) setNotes(await store.listNotes(notebookId));
    if (query.trim()) setResults(await store.searchNotes(query.trim()));
    if (trash) setDeleted(await store.listDeletedNotes());
  }, [notebookId, query, trash]);

  const addSubject = useCallback(async () => {
    const name = (await uiPrompt({ title: "New subject", placeholder: "Subject name", confirmLabel: "Create" }))?.trim();
    if (!name) return;
    const store = getStore();
    const s = await store.createSubject({ name });
    setSubjects(await store.listSubjects());
    setSubjectId(s.id);
  }, []);

  const addNotebook = useCallback(async () => {
    if (!subjectId) return;
    const name = (await uiPrompt({ title: "New notebook", placeholder: "Notebook name", confirmLabel: "Create" }))?.trim();
    if (!name) return;
    const store = getStore();
    const nb = await store.createNotebook({ subjectId, name });
    setNotebooks(await store.listNotebooks(subjectId));
    setNotebookId(nb.id);
  }, [subjectId]);

  const removeSubject = useCallback(async (sid: string) => {
    const s = subjects.find((x) => x.id === sid);
    const ok = await uiConfirm({
      title: "Delete subject",
      message: `Delete “${s?.name ?? ""}” and all its notebooks and notes? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const store = getStore();
    await store.deleteSubject(sid);
    const subs = await store.listSubjects();
    setSubjects(subs);
    if (subjectId === sid) setSubjectId(subs[0]?.id ?? null);
  }, [subjects, subjectId]);

  const uploadToCloud = useCallback(async () => {
    if (uploading) return;
    if (!(await uiConfirm({ title: "Upload to cloud", message: "Copy your local notes into your cloud library?", confirmLabel: "Upload" }))) return;
    setUploading(true);
    try {
      const { notes } = await migrateLocalToCloud();
      setSubjects(await getStore().listSubjects());
      await refresh();
      await uiAlert({
        title: "Upload to cloud",
        message: notes > 0 ? `Uploaded ${notes} note${notes === 1 ? "" : "s"} to the cloud.` : "No local notes to upload.",
      });
    } catch (e) {
      await uiAlert({ title: "Upload failed", message: errorMessage(e) });
    } finally {
      setUploading(false);
    }
  }, [uploading, refresh]);

  const removeNotebook = useCallback(async (nbId: string) => {
    const nb = notebooks.find((x) => x.id === nbId);
    const ok = await uiConfirm({
      title: "Delete notebook",
      message: `Delete “${nb?.name ?? ""}” and all its notes? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
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
      const ok = await uiConfirm({
        title: "Delete note",
        message: "Delete permanently? This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await getStore().deleteNote(id);
      await refresh();
    },
    [refresh],
  );
  const emptyTrash = useCallback(async () => {
    if (deleted.length === 0) return;
    const ok = await uiConfirm({
      title: "Empty Recently Deleted",
      message: `Permanently delete all ${deleted.length} note${deleted.length === 1 ? "" : "s"}? This cannot be undone.`,
      confirmLabel: "Delete all",
      danger: true,
    });
    if (!ok) return;
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
        await uiAlert({ title: "Copy failed", message: "Couldn't copy this note." });
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
        await uiAlert({ title: "Import failed", message: "Couldn't import that file. It must be a valid .aqnote bundle." });
      }
    },
    [importBundle],
  );

  const importFromLink = useCallback(async () => {
    const url = (await uiPrompt({
      title: "Import from link",
      message: "Paste a link to a public .aqnote file.",
      placeholder: "https://…",
      confirmLabel: "Import",
    }))?.trim();
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bundle: unknown = await res.json();
      if (!isAqnoteBundle(bundle)) throw new Error("not an .aqnote bundle");
      await importBundle(bundle);
    } catch (e) {
      console.error("import from link failed", e);
      await uiAlert({ title: "Import failed", message: "Couldn't import from that link. It must point to a public .aqnote file." });
    }
  }, [importBundle]);

  const addTag = useCallback(
    async (note: NoteMeta) => {
      const raw = (await uiPrompt({ title: "Add tag", placeholder: "Tag name", confirmLabel: "Add" }))?.trim();
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
      <header className="flex items-center gap-3 border-b border-border bg-surface px-5 py-3">
        <div className="mr-1 shrink-0">
          <h1 className="text-[17px] font-bold leading-none tracking-tight">Aquarius</h1>
          <p className="mt-1 text-[11px] text-muted">WYSIWYG math notes</p>
        </div>
        <div className="relative ml-2 w-full max-w-[420px]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon name="search" size={16} />
          </span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim()) { setTrash(false); setShared(false); setUncat(false); } }}
            placeholder="Search title, tag, or content…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-8 text-sm outline-none focus:border-accent"
          />
          {searching && (
            <button
              onClick={() => setQuery("")}
              title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              <Icon name="clearsearch" size={16} />
            </button>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-border text-muted hover:border-accent"
          >
            <Icon name="settings" size={18} />
          </button>
          <AccountMenu />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[248px_1fr]">
        <aside className="overflow-auto border-r border-border bg-surface px-3 py-4">
          <SideHead onAdd={addSubject} addLabel="Add subject">Subjects</SideHead>
          {subjects.map((s) => (
            <SideItem key={s.id} active={!trash && !shared && !uncat && s.id === subjectId} onClick={() => { setTrash(false); setShared(false); setUncat(false); setSubjectId(s.id); }} onDelete={() => removeSubject(s.id)}>
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color || "var(--accent)" }} />
              <span className="truncate">{s.name}</span>
            </SideItem>
          ))}

          <SideHead onAdd={subjectId ? addNotebook : undefined} addLabel="Add notebook">Notebooks</SideHead>
          {subjectId && notebooks.length === 0 && <p className="px-2.5 py-1.5 text-[13px] text-muted">No notebooks yet</p>}
          {notebooks.map((nb) => {
            const on = !trash && !shared && !uncat && nb.id === notebookId;
            return (
              <SideItem key={nb.id} active={on} onClick={() => { setTrash(false); setShared(false); setUncat(false); setNotebookId(nb.id); }} onDelete={() => removeNotebook(nb.id)}>
                <Icon name="notebooks" size={16} className={`shrink-0 ${on ? "text-accent" : "text-muted"}`} />
                <span className="truncate">{nb.name}</span>
              </SideItem>
            );
          })}

          <SideHead>Library</SideHead>
          {user && (
            <SideItem active={shared} onClick={() => { setShared(true); setUncat(false); setTrash(false); setQuery(""); }}>
              <Icon name="share" size={16} className={`shrink-0 ${shared ? "text-accent" : "text-muted"}`} />
              <span className="truncate">Shared with me</span>
            </SideItem>
          )}
          {user && (
            <SideItem active={uncat} onClick={() => { setUncat(true); setShared(false); setTrash(false); setQuery(""); }}>
              <Icon name="inbox" size={16} className={`shrink-0 ${uncat ? "text-accent" : "text-muted"}`} />
              <span className="truncate">Uncategorized</span>
            </SideItem>
          )}
          <SideItem active={trash} onClick={() => { setTrash(true); setShared(false); setUncat(false); setQuery(""); }}>
            <Icon name="trash" size={16} className={`shrink-0 ${trash ? "text-accent" : "text-muted"}`} />
            <span className="truncate">Recently Deleted</span>
          </SideItem>
          {user && (
            <SideItem onClick={() => { if (!uploading) uploadToCloud(); }}>
              <Icon name="uploadcloud" size={16} className="shrink-0 text-muted" />
              <span className="truncate">{uploading ? "Uploading…" : "Upload to cloud"}</span>
            </SideItem>
          )}
        </aside>

        {/* Notes / Search / Trash */}
        <section className="p-6">
          {trash ? (
            <>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
                  Recently Deleted
                </h2>
                {deleted.length > 0 && (
                  <button onClick={emptyTrash} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:border-danger hover:text-danger">
                    Empty
                  </button>
                )}
              </div>
              <p className="mb-4 text-xs text-muted">Notes are removed permanently after {TRASH_DAYS} days.</p>
              {deleted.length === 0 ? (
                <Empty>Nothing here. Deleted notes will appear for {TRASH_DAYS} days.</Empty>
              ) : (
                <div className={NOTE_GRID}>
                  {deleted.map((n) => (
                    <DeletedCard key={n.id} note={n} onRestore={restore} onPurge={purge} />
                  ))}
                </div>
              )}
            </>
          ) : shared ? (
            <>
              <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-muted">Shared with me</h2>
              <p className="mb-4 text-xs text-muted">New shares appear here; once you open one it moves to Uncategorized.</p>
              {sharedInbox.length === 0 ? (
                <Empty>Nothing new.</Empty>
              ) : (
                <div className={NOTE_GRID}>
                  {sharedInbox.map(({ note, role }) => (
                    <SharedNoteCard key={note.id} note={note} role={role} onOpen={() => router.push(`/editor/${note.id}`)} />
                  ))}
                </div>
              )}
            </>
          ) : uncat ? (
            <>
              <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-muted">Uncategorized</h2>
              <p className="mb-4 text-xs text-muted">Shared notes you&rsquo;ve opened. To file one under a subject, make a copy.</p>
              {uncatNotes.length === 0 ? (
                <Empty>Nothing here yet.</Empty>
              ) : (
                <div className={NOTE_GRID}>
                  {uncatNotes.map(({ note, role }) => (
                    <SharedNoteCard key={note.id} note={note} role={role} onOpen={() => router.push(`/editor/${note.id}`)} />
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
