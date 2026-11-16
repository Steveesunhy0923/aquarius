"use client";

/**
 * The editor PAGE: the top bar, the files/outline sidebar, and one or two
 * document panes side by side. Everything about a single document — its tree,
 * its tools, saving, collaboration — lives in DocumentEditor; this component
 * only decides which notes are open, which pane has focus, and routes
 * note-link clicks and the command palette to the right one.
 */

import { EditorSidebar } from "@/components/EditorSidebar";
import { Icon } from "@/components/Icon";
import { SyncStatus } from "@/components/SyncStatus";
import { NOTE_LINK_EVENT, type NoteLinkTarget } from "@/lib/blocks/notelink";
import type { OutlineItem } from "@/lib/blocks/outline";
import type { SectionShortcut } from "@/lib/blocks/shortcuts";
import type { DocHandle } from "@/lib/editor/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { DocumentEditor } from "./DocumentEditor";
import { CommandPalette } from "./lazy";

// ─── The editor route: shared strip + left sidebar + up to two split panes ────
// The note id lives in the query string (`/editor?id=…`), not a path segment,
// so the route is a single static page under `output: "export"` — local-first
// note ids cannot be enumerated at build time. Rendered inside the Suspense
// boundary in page.tsx, which useSearchParams requires for static prerender.
export default function EditorClient() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const [secondId, setSecondId] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Below `lg` the files/outline column is a drawer (see EditorSidebar).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [outlineA, setOutlineA] = useState<OutlineItem[]>([]);
  const [outlineB, setOutlineB] = useState<OutlineItem[]>([]);
  const [shortcutsA, setShortcutsA] = useState<SectionShortcut[]>([]);
  const [shortcutsB, setShortcutsB] = useState<SectionShortcut[]>([]);
  const [notesRev, setNotesRev] = useState(0); // bumped on save → refresh recent files
  const handleA = useRef<DocHandle | null>(null);
  const handleB = useRef<DocHandle | null>(null);
  const paneBRef = useRef<HTMLDivElement | null>(null); // which pane a note-link click came from
  const bumpNotes = useCallback(() => setNotesRev((v) => v + 1), []);

  // Opening the primary doc resets the split; opening a file puts it in pane B.
  useEffect(() => { setSecondId(null); setActiveSlot("a"); setSidebarOpen(false); }, [id]);

  const openSecond = useCallback((noteId: string) => {
    setSidebarOpen(false);
    if (noteId === id) { setActiveSlot("a"); return; }
    // Two panes need two panes' worth of screen. Below `lg` a second note
    // replaces the first rather than halving a width that is already tight.
    if (window.innerWidth < 1024) { router.push(`/editor?id=${noteId}`); return; }
    setSecondId(noteId); // limit of 2: a new pick replaces the existing pane B
    setActiveSlot("b");
  }, [id, router]);
  const closeSecond = useCallback(() => { setSecondId(null); setActiveSlot("a"); }, []);

  const onHeadingsA = useCallback((o: OutlineItem[]) => setOutlineA(o), []);
  const onHeadingsB = useCallback((o: OutlineItem[]) => setOutlineB(o), []);
  const onShortcutsA = useCallback((s: SectionShortcut[]) => setShortcutsA(s), []);
  const onShortcutsB = useCallback((s: SectionShortcut[]) => setShortcutsB(s), []);

  // ⌘K / Ctrl-K toggles the command palette from anywhere in the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Palette note-jump: focus the pane if the note is already open, else navigate.
  const openNoteFromPalette = useCallback((noteId: string) => {
    if (noteId === id) { setActiveSlot("a"); handleA.current?.scrollToTop(); }
    else if (noteId === secondId) { setActiveSlot("b"); handleB.current?.scrollToTop(); }
    else router.push(`/editor?id=${noteId}`);
  }, [id, secondId, router]);

  // Note-link clicks: when the target note is already open in a pane, jump to
  // it in place (scroll to the linked section — or the top — and focus the
  // pane) instead of navigating. A link clicked INSIDE pane B to a third note
  // replaces pane B (keeping the split) rather than navigating pane A away.
  // Anything else falls through to NoteLink's router.push.
  useEffect(() => {
    const onLink = (e: Event) => {
      const { noteId, blockId, source } =
        (e as CustomEvent<NoteLinkTarget & { source?: HTMLElement | null }>).detail;
      const pane = noteId === id ? "a" : noteId === secondId ? "b" : null;
      if (pane) {
        e.preventDefault();
        const handle = pane === "a" ? handleA : handleB;
        if (blockId) handle.current?.scrollToBlock(blockId);
        else handle.current?.scrollToTop();
        setActiveSlot(pane);
        return;
      }
      if (source && paneBRef.current?.contains(source)) {
        e.preventDefault();
        openSecond(noteId);
        if (blockId) setTimeout(() => handleB.current?.scrollToBlock(blockId), 900);
      }
    };
    window.addEventListener(NOTE_LINK_EVENT, onLink);
    return () => window.removeEventListener(NOTE_LINK_EVENT, onLink);
  }, [id, secondId, openSecond]);

  // No id in the URL (direct visit to /editor) → back to the library.
  useEffect(() => {
    if (!id) router.replace("/");
  }, [id, router]);

  const split = secondId !== null;
  const active: "a" | "b" = split ? activeSlot : "a";
  const activeHandle = active === "a" ? handleA : handleB;
  const activeOutline = active === "a" ? outlineA : outlineB;
  const activeShortcuts = active === "a" ? shortcutsA : shortcutsB;

  if (!id) return null;

  return (
    <div className="print-flow flex h-screen flex-col">
      <div className="print-hide flex items-center gap-2 border-b border-border px-3 py-2 sm:gap-3 sm:px-4">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Files and outline"
          aria-expanded={sidebarOpen}
          aria-controls="editor-sidebar"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-control border border-border text-muted hover:border-accent hover:text-accent lg:hidden"
        >
          <Icon name="menu" size={16} />
        </button>
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted hover:text-accent"><Icon name="back" size={14} />Library</Link>
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">Aquarius</span>
        {split && <span className="hidden text-xs text-muted md:inline">Split view — click a pane to focus its tools &amp; outline</span>}
        <SyncStatus className="ml-auto" />
        <button onClick={() => setPaletteOpen(true)} title="Command palette (⌘K)" className="flex items-center gap-1.5 rounded-control border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">
          <Icon name="search" size={13} />
          <span className="hidden sm:inline">Search</span>
          <kbd className="rounded border border-border px-1 text-[10px]">⌘K</kbd>
        </button>
        <span className="hidden text-xs text-muted sm:inline">{split ? "2 / 2 open" : "1 open"}</span>
      </div>

      <div className="print-flow flex min-h-0 flex-1">
        {sidebarOpen && <div aria-hidden className="print-hide fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />}
        <EditorSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} currentId={id} secondId={secondId} activeId={active === "b" && secondId ? secondId : id} onOpen={openSecond} outline={activeOutline} shortcuts={activeShortcuts} handle={activeHandle} notesRev={notesRev} />
        <div className="print-flow flex min-w-0 flex-1">
          {/* Exactly one of print-flow / print-hide per wrapper, so only the active pane prints. */}
          <div className={`min-w-0 flex-1 overflow-hidden ${!split || active === "a" ? "print-flow" : "print-hide"} ${split ? "border-r border-border" : ""} ${split && active === "a" ? "ring-1 ring-inset ring-accent/50" : ""}`}>
            <DocumentEditor key={id} id={id} primary split={split} onActivate={() => setActiveSlot("a")} onHeadings={onHeadingsA} onShortcuts={onShortcutsA} onSaved={bumpNotes} handleRef={handleA} />
          </div>
          {split && secondId && (
            <div ref={paneBRef} className={`min-w-0 flex-1 overflow-hidden ${active === "b" ? "print-flow" : "print-hide"} ${active === "b" ? "ring-1 ring-inset ring-accent/50" : ""}`}>
              <DocumentEditor key={secondId} id={secondId} primary={false} split onActivate={() => setActiveSlot("b")} onClose={closeSecond} onHeadings={onHeadingsB} onShortcuts={onShortcutsB} onSaved={bumpNotes} handleRef={handleB} />
            </div>
          )}
        </div>
      </div>
      {/* Mounted only while open, so its chunk loads on first use (./lazy). */}
      {paletteOpen && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          handle={activeHandle.current}
          currentNoteId={active === "b" && secondId ? secondId : id}
          onOpenNote={openNoteFromPalette}
        />
      )}
    </div>
  );
}
