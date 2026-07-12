"use client";

import { BlockView } from "@/components/BlockView";
import { Icon } from "@/components/Icon";
import { placeCard, useHoverCard } from "@/components/ui/hovercard";
import { NOTE_LINK_EVENT, noteLinkUrl, parseNoteHref } from "@/lib/blocks/notelink";
import { sectionRange } from "@/lib/blocks/outline";
import type { Block } from "@/lib/blocks/types";
import { getStore } from "@/lib/storage";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * NoteLink — an in-prose link to another note (`note://id`, optionally
 * `#headingBlockId` for one section). Click opens the note (the editor route
 * intercepts same-note/section jumps via NOTE_LINK_EVENT; otherwise we
 * navigate); hovering ~a third of a second shows a Google-Docs-style preview
 * card: the note rendered on a miniature page, portrait or landscape to match
 * the note's own page layout — or just the linked section.
 */

// ── tiny preview cache (per session, short TTL so edits show up) ──────────────
type Fetched =
  | {
      title: string;
      blocks: Block[];
      /** The note's own page layout — decides the card's orientation. */
      layout: "vertical" | "horizontal";
      background?: string;
      foreground?: string;
    }
  | { missing: true };
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
    data = meta
      ? {
          title: meta.title || "Untitled",
          blocks: pkg.tree.blocks,
          layout: pkg.tree.style?.pageLayout === "horizontal" ? "horizontal" : "vertical",
          background: pkg.tree.style?.background,
          foreground: pkg.tree.style?.foreground,
        }
      : { missing: true };
  } catch {
    data = { missing: true };
  }
  cache.set(noteId, { at: Date.now(), data });
  return data;
}

export function NoteLink({ href, text }: { href: string; text: string }) {
  const router = useRouter();
  const target = parseNoteHref(href);
  const [note, setNote] = useState<Fetched | null>(null);
  const { anchorRef, rect, armOpen, armClose, cancel } = useHoverCard(() => {
    if (target) void fetchNote(target.noteId).then(setNote);
  });
  // React reuses this instance when only the href segment changes (index keys)
  // — never show the previous target's fetched content.
  useEffect(() => {
    setNote(null);
    cancel();
  }, [href, cancel]);
  if (!target) return <span>{text}</span>;

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
          cancel();
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
      {rect && createPortal(
        <PreviewCard
          target={target}
          note={note}
          rect={rect}
          onEnter={armOpen}
          onLeave={armClose}
          onOpen={() => { cancel(); navigate(); }}
        />,
        document.body,
      )}
    </>
  );
}

function PreviewCard({ target, note, rect, onEnter, onLeave, onOpen }: {
  target: { noteId: string; blockId?: string };
  note: Fetched | null;
  rect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  let title = "";
  let sectionName: string | null = null;
  let blocks: Block[] = [];
  let missing = false;
  let sectionGone = false;
  let layout: "vertical" | "horizontal" = "vertical";
  let pageStyle: { background?: string; foreground?: string } = {};
  if (note) {
    if ("missing" in note) missing = true;
    else {
      title = note.title;
      blocks = note.blocks;
      layout = note.layout;
      pageStyle = { background: note.background, foreground: note.foreground };
      if (target.blockId) {
        const range = sectionRange(blocks, target.blockId);
        if (range) {
          sectionName = blocks[range[0]].value?.trim() || "Untitled heading";
          blocks = blocks.slice(range[0], range[1]);
        } else {
          sectionGone = true; // deleted/demoted heading — fall back to the note
        }
      }
      blocks = blocks.slice(0, 12);
    }
  }
  // The card follows the note's page layout: vertical notes preview as a
  // portrait mini-page, horizontal ones as a wide landscape card.
  const wide = layout === "horizontal" && !missing;
  const width = wide ? 480 : 300;
  const empty = blocks.length === 0;

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className="print-hide fixed z-80 cursor-pointer overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
      // Placement uses the max card footprint (480×430) so the side/position is
      // stable whether the fetch resolves to a portrait or landscape card.
      style={{ width, ...placeCard(rect, 480, 430) }}
    >
      <div className="flex items-center gap-1.5 border-b border-border-soft px-3 py-2 text-sm">
        <Icon name="pagesize" size={14} className="shrink-0 text-muted" />
        <span className="min-w-0 truncate font-semibold">{missing ? "Note not found" : title || "…"}</span>
        {sectionName && (
          <span className="min-w-0 truncate text-xs text-muted">› {sectionName}</span>
        )}
      </div>
      <div className="bg-background p-3">
        {sectionGone && (
          <p className="mb-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
            The linked section no longer exists — showing the note instead.
          </p>
        )}
        {missing || !note || empty ? (
          <p className="py-6 text-center text-xs text-muted">
            {missing
              ? "This note may have been deleted, or it lives in another account."
              : !note
                ? "Loading preview…"
                : sectionName
                  ? "This section is empty."
                  : "This note is empty."}
          </p>
        ) : (
          // The miniature page: the note's own surface (poster backgrounds and
          // all), clipped to the layout's aspect.
          <div
            className={`overflow-hidden rounded-md border border-border-soft shadow-sm ${wide ? "h-44" : "h-80"}`}
            style={{ background: pageStyle.background || "var(--surface)", color: pageStyle.foreground || undefined }}
          >
            <div className={`pointer-events-none origin-top-left space-y-1 p-3 ${wide ? "scale-[0.75] w-[133%]" : "scale-[0.7] w-[143%]"}`}>
              {blocks.map((b) => (
                <div key={b.id}><BlockView block={b} /></div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-border-soft px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-faint">Click to open</div>
    </div>
  );
}
