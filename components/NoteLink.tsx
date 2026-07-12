"use client";

import { BlockView } from "@/components/BlockView";
import { Icon } from "@/components/Icon";
import { NOTE_LINK_EVENT, noteLinkUrl, parseNoteHref } from "@/lib/blocks/notelink";
import { sectionRange } from "@/lib/blocks/outline";
import type { Block } from "@/lib/blocks/types";
import { getStore } from "@/lib/storage";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * NoteLink — an in-prose link to another note (`note://id`, optionally
 * `#headingBlockId` for one section). Click opens the note (the editor route
 * intercepts same-note/section jumps via NOTE_LINK_EVENT; otherwise we
 * navigate); hovering ~a third of a second shows a live preview card of the
 * note — or just the linked section.
 */

// ── tiny preview cache (per session, short TTL so edits show up) ──────────────
type Fetched = { title: string; blocks: Block[] } | { missing: true };
const cache = new Map<string, { at: number; data: Fetched }>();
const TTL = 8_000;
const MISS_TTL = 2_000; // failures/deletions retry quickly (could be transient)

async function fetchNote(noteId: string): Promise<Fetched> {
  const hit = cache.get(noteId);
  if (hit && Date.now() - hit.at < ("missing" in hit.data ? MISS_TTL : TTL)) return hit.data;
  let data: Fetched;
  try {
    const store = getStore();
    const [pkg, meta] = await Promise.all([store.openNote(noteId), store.getNoteMeta(noteId)]);
    // The cloud store answers a deleted/inaccessible note with an empty
    // package and no meta (it never throws) — treat metaless as missing.
    data = meta ? { title: meta.title || "Untitled", blocks: pkg.tree.blocks } : { missing: true };
  } catch {
    data = { missing: true };
  }
  cache.set(noteId, { at: Date.now(), data });
  return data;
}

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 200;

export function NoteLink({ href, text }: { href: string; text: string }) {
  const router = useRouter();
  const target = parseNoteHref(href);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const [note, setNote] = useState<Fetched | null>(null);
  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  // React reuses this instance when only the href segment changes (index keys)
  // — never show the previous target's fetched content.
  useEffect(() => {
    setNote(null);
    setPreview(null);
  }, [href]);
  // The card is anchored to a point-in-time rect; any scroll drifts it, so dismiss.
  useEffect(() => {
    if (!preview) return;
    const close = () => setPreview(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [preview]);
  if (!target) return <span>{text}</span>;

  /** Cancel both hover timers (click/navigation must not pop a late preview). */
  function clearTimers() {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }

  function navigate() {
    if (!target) return;
    // Give the editor route first refusal (same-note section jump, split
    // panes). `source` lets it tell which pane the click came from.
    const ev = new CustomEvent(NOTE_LINK_EVENT, {
      cancelable: true,
      detail: { ...target, source: anchorRef.current },
    });
    if (window.dispatchEvent(ev)) router.push(noteLinkUrl(target));
  }

  function openPreview() {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const W = 340;
    const H = 300;
    const x = Math.max(8, Math.min(rect.left, window.innerWidth - W - 8));
    const above = window.innerHeight - rect.bottom < H + 16 && rect.top > H + 16;
    const y = above ? rect.top - 8 : rect.bottom + 8;
    setPreview({ x, y, above });
    if (target) void fetchNote(target.noteId).then(setNote);
  }

  const armOpen = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (!preview && !openTimer.current) openTimer.current = setTimeout(() => { openTimer.current = null; openPreview(); }, HOVER_OPEN_MS);
  };
  const armClose = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (preview && !closeTimer.current) closeTimer.current = setTimeout(() => { closeTimer.current = null; setPreview(null); }, HOVER_CLOSE_MS);
  };

  return (
    <>
      <a
        ref={anchorRef}
        href={noteLinkUrl(target)}
        onClick={(e) => {
          e.stopPropagation(); // never trigger the paragraph's click-to-edit
          // Modified clicks keep the browser default (new tab/window) — the
          // href is a real app route.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          clearTimers();
          setPreview(null);
          navigate();
        }}
        onMouseEnter={armOpen}
        onMouseLeave={armClose}
        className="mx-0.5 inline-flex items-baseline gap-1 rounded-sm px-0.5 font-medium text-accent underline decoration-accent/40 decoration-dashed underline-offset-2 hover:bg-accent-soft hover:decoration-solid print:bg-transparent print:text-inherit print:no-underline"
      >
        <Icon name="pagesize" size={13} className="print-hide relative top-0.5 shrink-0 self-center opacity-70" />
        {text}
      </a>
      {/* Portal: links live inside <p>/<button> where a <div> card would be
          invalid DOM (hydration warnings); the card is fixed-positioned anyway. */}
      {preview && createPortal(
        <PreviewCard
          target={target}
          note={note}
          pos={preview}
          onEnter={armOpen}
          onLeave={armClose}
          onOpen={() => { setPreview(null); navigate(); }}
        />,
        document.body,
      )}
    </>
  );
}

function PreviewCard({ target, note, pos, onEnter, onLeave, onOpen }: {
  target: { noteId: string; blockId?: string };
  note: Fetched | null;
  pos: { x: number; y: number; above: boolean };
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  let title = "";
  let sectionName: string | null = null;
  let blocks: Block[] = [];
  let missing = false;
  let sectionGone = false;
  if (note) {
    if ("missing" in note) missing = true;
    else {
      title = note.title;
      blocks = note.blocks;
      if (target.blockId) {
        const range = sectionRange(blocks, target.blockId);
        if (range) {
          sectionName = blocks[range[0]].value?.trim() || "Untitled heading";
          blocks = blocks.slice(range[0], range[1]);
        } else {
          sectionGone = true; // deleted/demoted heading — fall back to the note
        }
      }
      blocks = blocks.slice(0, 10);
    }
  }
  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className="print-hide fixed z-[80] w-[340px] cursor-pointer overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
      style={{ left: pos.x, top: pos.above ? undefined : pos.y, bottom: pos.above ? window.innerHeight - pos.y : undefined }}
    >
      <div className="flex items-center gap-1.5 border-b border-border-soft px-3 py-2 text-sm">
        <Icon name="pagesize" size={14} className="shrink-0 text-muted" />
        <span className="min-w-0 truncate font-semibold">{missing ? "Note not found" : title || "…"}</span>
        {sectionName && (
          <span className="min-w-0 truncate text-xs text-muted">› {sectionName}</span>
        )}
      </div>
      <div className="max-h-56 overflow-hidden bg-background px-3 py-2">
        {sectionGone && (
          <p className="mb-1 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
            The linked section no longer exists — showing the note instead.
          </p>
        )}
        {missing ? (
          <p className="py-4 text-center text-xs text-muted">This note may have been deleted, or it lives in another account.</p>
        ) : !note ? (
          <p className="py-4 text-center text-xs text-muted">Loading preview…</p>
        ) : blocks.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">{sectionName ? "This section is empty." : "This note is empty."}</p>
        ) : (
          <div className="pointer-events-none origin-top-left scale-[0.8] space-y-1 [width:125%]">
            {blocks.map((b) => (
              <div key={b.id}><BlockView block={b} /></div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-border-soft px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-faint">Click to open</div>
    </div>
  );
}
