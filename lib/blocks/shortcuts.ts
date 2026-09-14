/**
 * Section shortcuts — the jump list a note's DESIGN comes with.
 *
 * A note built from a design (Notes, Lab Report, Problem Set…) has a shape its
 * author already knows: key concepts, then a worked example, then open
 * questions. The outline in the sidebar can only show what has been WRITTEN, so
 * on a half-finished note the very sections you are working towards are the
 * ones missing from it. Shortcuts are the design's own list, stamped onto the
 * note when the design is applied: each one jumps to its section, and offers to
 * put the section back when it isn't there.
 *
 * They are stored on the tree (`DocumentTree.shortcuts`) rather than in
 * localStorage, so they travel with the note through sync, sharing and export,
 * and two notes from the same design can drift apart as the user edits them —
 * which is the point of being able to customize the list.
 *
 * Resolution is deliberately loose: a shortcut remembers the heading it was
 * made from, but falls back to matching by NAME, so it keeps working after a
 * section is deleted and rewritten, or when the design is applied a second time
 * with fresh block ids.
 */

import { headingLevel } from "./headings";
import type { Block, DocumentTree } from "./types";

const uid = (): string => crypto.randomUUID();

export interface SectionShortcut {
  /** Stable id for keys and reordering (not a block id). */
  id: string;
  /** What the shortcut is called — also how it finds its section. */
  label: string;
  /** The heading it was created from, when it came from a design. */
  blockId?: string;
}

/** Beyond this the sidebar list stops being a shortcut list. */
export const MAX_SHORTCUTS = 16;

const normalize = (s: string): string => s.trim().toLowerCase();

/** A note's shortcuts, validated — a hand-edited or older tree may have none. */
export function documentShortcuts(tree: DocumentTree | null | undefined): SectionShortcut[] {
  const raw = tree?.shortcuts;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is SectionShortcut => !!s && typeof s.id === "string" && typeof s.label === "string")
    .slice(0, MAX_SHORTCUTS);
}

/**
 * The shortcut list a design implies: its sections, in document order.
 *
 * Level-1 headings are the document's own title, not a section to jump to, so
 * they are skipped. Repeated names (four "Solution" headings in a problem set)
 * collapse to the first — a jump list wants one entry per destination.
 */
export function shortcutsFromBlocks(blocks: Block[]): SectionShortcut[] {
  const out: SectionShortcut[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (b.type !== "heading" || headingLevel(b) < 2) continue;
    const label = b.value?.trim();
    if (!label || seen.has(normalize(label))) continue;
    seen.add(normalize(label));
    out.push({ id: uid(), label, blockId: b.id });
    if (out.length >= MAX_SHORTCUTS) break;
  }
  return out;
}

/** Merge new shortcuts into an existing list, keeping order and dropping names
 *  it already has (a design applied on top of a note that has some). */
export function mergeShortcuts(current: SectionShortcut[], incoming: SectionShortcut[]): SectionShortcut[] {
  const have = new Set(current.map((s) => normalize(s.label)));
  const added = incoming.filter((s) => !have.has(normalize(s.label)));
  return [...current, ...added].slice(0, MAX_SHORTCUTS);
}

/**
 * The heading block a shortcut points at, or null when the note doesn't (yet)
 * have that section. The remembered block wins; the name is the fallback.
 */
export function resolveShortcut(blocks: Block[], shortcut: SectionShortcut): Block | null {
  if (shortcut.blockId) {
    const exact = blocks.find((b) => b.id === shortcut.blockId && b.type === "heading");
    if (exact) return exact;
  }
  const want = normalize(shortcut.label);
  return blocks.find((b) => b.type === "heading" && normalize(b.value ?? "") === want) ?? null;
}

// ─── List edits (pure) ────────────────────────────────────────────────────────

export function addShortcut(list: SectionShortcut[], label: string, blockId?: string): SectionShortcut[] {
  const name = label.trim();
  if (!name || list.length >= MAX_SHORTCUTS) return list;
  if (list.some((s) => normalize(s.label) === normalize(name))) return list; // already there
  return [...list, { id: uid(), label: name, blockId }];
}

export function removeShortcut(list: SectionShortcut[], id: string): SectionShortcut[] {
  return list.filter((s) => s.id !== id);
}

/** Rename a shortcut. The remembered block is dropped: the new name is now what
 *  it means, and keeping the old link would jump to a section it no longer
 *  names. Blank names are rejected (the list would show an unclickable gap). */
export function renameShortcut(list: SectionShortcut[], id: string, label: string): SectionShortcut[] {
  const name = label.trim();
  if (!name) return list;
  return list.map((s) => (s.id === id ? { id: s.id, label: name } : s));
}

/** Move `fromId` before `toId` (or to the end when `toId` is null). */
export function moveShortcut(list: SectionShortcut[], fromId: string, toId: string | null): SectionShortcut[] {
  const from = list.findIndex((s) => s.id === fromId);
  if (from < 0 || fromId === toId) return list;
  const rest = [...list.slice(0, from), ...list.slice(from + 1)];
  if (toId === null) return [...rest, list[from]];
  const to = rest.findIndex((s) => s.id === toId);
  if (to < 0) return list;
  return [...rest.slice(0, to), list[from], ...rest.slice(to)];
}
