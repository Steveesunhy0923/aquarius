"use client";

import { BlockView } from "@/components/BlockView";
import { ExportMenu } from "@/components/ExportMenu";
import { FigureBox } from "@/components/FigureBox";
import { GraphEditor } from "@/components/GraphEditor";
import { ImageRowEditor } from "@/components/ImageRowEditor";
import { Katex } from "@/components/Katex";
import { SymbolPicker } from "@/components/SymbolPicker";
import { TablePicker } from "@/components/TablePicker";
import { TableRowEditor } from "@/components/TableRowEditor";
import { DesignPicker } from "@/components/DesignPicker";
import { TemplateApplyDialog } from "@/components/TemplateApplyDialog";
import { getSettings, setSettings } from "@/lib/settings/settings";
import { freshTree, saveTemplate, type BuiltInBackground, type SavedTemplate } from "@/lib/templates/templates";
import { useAuth } from "@/lib/auth/AuthProvider";
import { documentToLatex } from "@/lib/blocks";
import { emptyDocument } from "@/lib/blocks/types";
import {
  CALLOUT_COLORS,
  calloutColorOf,
  isHexColor,
  withCalloutColor,
} from "@/lib/blocks/callouts";
import {
  HEADING_NAMES,
  computeHeadingNumbers,
  headingAlign,
  headingLevel,
  headingNumbered,
  makeHeading,
  withHeading,
  type HeadingLevel,
} from "@/lib/blocks/headings";
import {
  imageAlign,
  imageItems,
  makeImageBlock,
  withImages,
  type ImageAlign,
  type ImageItem,
} from "@/lib/blocks/images";
import {
  blockEditSource,
  displayFromSource,
  hasContent,
  isParagraph,
  paragraphFromSource,
  previewLatex,
} from "@/lib/blocks/source";
import { graphModel, makeGraphBlock, withGraph, type GraphData } from "@/lib/blocks/graph";
import { DEFAULT_HIGHLIGHT } from "@/lib/blocks/format";
import { A4_W, A4_H, FONTS, FONT_SIZES, LINE_SPACINGS, INDENTS, fontFamilyOf } from "@/lib/blocks/docstyle";
import {
  BULLET_MARKERS,
  NUMBER_MARKERS,
  listItems,
  listOrdered,
  makeList,
  withList,
  type ListMarker,
} from "@/lib/blocks/lists";
import {
  TABLE_STYLES,
  demoRows,
  tableAlign,
  tableItems,
  withTables,
  type TableData,
  type TableStyle,
} from "@/lib/blocks/tables";
import type { Block, DocumentStyle, DocumentTree, Placement } from "@/lib/blocks/types";
import { getStore } from "@/lib/storage";
import type { NotePackage, NoteMeta } from "@/lib/storage/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";

/** Imperative API a DocumentEditor exposes to the page (for the section outline). */
export interface DocHandle {
  scrollToBlock: (id: string) => void;
  toggleSection: (id: string) => void;
  reorderSections: (fromHeadingId: string, toHeadingId: string | null) => void;
}

/** One entry in the section outline (a heading). */
export interface OutlineItem {
  id: string;
  text: string;
  level: number;
  collapsed: boolean;
}

interface DocProps {
  id: string;
  /** The route's document; only the primary participates in ?new/?print behavior. */
  primary: boolean;
  split: boolean;
  onActivate: () => void;
  onClose?: () => void;
  onHeadings: (items: OutlineItem[]) => void;
  /** Fired after a successful save so the page can refresh the recent-files list. */
  onSaved?: () => void;
  handleRef: MutableRefObject<DocHandle | null>;
}

const SYM_KEY = "aquarius.symbols";
const DEFAULT_TB1 = ["\\frac{}{}", "\\sqrt{}", "^{}", "\\sum_{}^{}", "\\int_{}^{}", "\\sin", "\\cos", "\\neq", "\\pi", "\\alpha"];
// Eight editable symbol slots; the "Edit" button lets users change any of them.
const DEFAULT_SYMBOLS = ["\\infty", "\\rightarrow", "\\in", "\\leq", "\\geq", "\\neq", "\\pm", "\\times"];
const SYMBOL_COUNT = DEFAULT_SYMBOLS.length;

/** Shared sizing so every toolbar icon button is about the same size. */
const ICON_BTN =
  "grid h-9 min-w-9 place-items-center rounded-md border border-border px-2 text-sm hover:border-accent";

/** Preset highlight colors offered in the H-button dropdown. */
const HIGHLIGHT_COLORS = ["#fde047", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e9d5ff", "#fecaca", "#a7f3d0"];

/** Greedily pack blocks into A4-height pages by their measured heights. */
function paginate(
  blocks: Block[],
  heights: Record<string, number>,
  pageContent: number,
): string[][] {
  const pages: string[][] = [];
  let cur: string[] = [];
  let curH = 0;
  for (const b of blocks) {
    const h = (heights[b.id] ?? 0) + 4; // + inter-block gap
    if (cur.length && curH + h > pageContent) {
      pages.push(cur);
      cur = [];
      curH = 0;
    }
    cur.push(b.id);
    curH += h;
  }
  pages.push(cur); // always at least one page (possibly empty)
  return pages;
}

/** A block with no meaningful content (used to auto-remove abandoned boxes). */
function isEmptyBlock(b: Block): boolean {
  switch (b.type) {
    case "heading":
      return !(b.value && b.value.trim());
    case "list":
      return listItems(b).every((x) => !x.trim());
    case "image":
    case "table":
    case "code":
    case "tikz":
    case "graph":
      return false;
    default:
      return !hasContent(b); // text or formula
  }
}

/** A document with no meaningful content (used to discard abandoned new notes). */
function isEmptyDoc(blocks: Block[]): boolean {
  return blocks.length === 0 || blocks.every(isEmptyBlock);
}

// ─── Section outline helpers ──────────────────────────────────────────────────

const isHeadingCollapsed = (b: Block): boolean => !!b.attrs?.collapsed;

/** The flat outline (one entry per heading), in document order. */
function computeOutline(blocks: Block[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const b of blocks) {
    if (b.type === "heading") {
      out.push({ id: b.id, text: b.value?.trim() || "Untitled heading", level: headingLevel(b), collapsed: isHeadingCollapsed(b) });
    }
  }
  return out;
}

/**
 * Block ids hidden because they live inside a collapsed section. A collapsed
 * heading hides every following block (incl. deeper headings) until the next
 * heading whose level is the same or higher. The collapsed heading itself shows.
 */
function hiddenBlockIds(blocks: Block[]): Set<string> {
  const hidden = new Set<string>();
  let hiding = false;
  let threshold = 0;
  for (const b of blocks) {
    if (b.type === "heading") {
      const lvl = headingLevel(b);
      if (hiding) {
        if (lvl <= threshold) hiding = false; // this heading starts a visible region
        else { hidden.add(b.id); continue; } // deeper heading — stay hidden
      }
      if (isHeadingCollapsed(b)) { hiding = true; threshold = lvl; }
      continue;
    }
    if (hiding) hidden.add(b.id);
  }
  return hidden;
}

/** [start, end) index range of a heading's section subtree (heading + its body). */
function sectionRange(blocks: Block[], headingId: string): [number, number] | null {
  const start = blocks.findIndex((b) => b.id === headingId);
  if (start < 0 || blocks[start].type !== "heading") return null;
  const level = headingLevel(blocks[start]);
  let end = start + 1;
  while (end < blocks.length) {
    const b = blocks[end];
    if (b.type === "heading" && headingLevel(b) <= level) break;
    end++;
  }
  return [start, end];
}

/** Move the `from` heading's whole section relative to the `to` section (or end). */
function reorderSectionBlocks(blocks: Block[], fromId: string, toId: string | null): Block[] {
  const from = sectionRange(blocks, fromId);
  if (!from) return blocks;
  const moving = blocks.slice(from[0], from[1]);
  const rest = [...blocks.slice(0, from[0]), ...blocks.slice(from[1])];
  if (toId === null) return [...rest, ...moving]; // drop at end
  const origTo = sectionRange(blocks, toId);
  const movingDown = !!origTo && origTo[0] > from[0];
  const to = sectionRange(rest, toId);
  if (!to) return blocks; // target was inside the moved subtree (e.g. its own child)
  // Dragging down → drop AFTER the target section; dragging up → drop BEFORE it.
  const at = movingDown ? to[1] : to[0];
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

function readLS(key: string, fallback: string[]): string[] {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    const parsed = v ? (JSON.parse(v) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : fallback;
  } catch {
    return fallback;
  }
}

type Picker = { kind: "symbol"; index: number } | { kind: "insert" } | null;
type Selected = { id: string; index: number; kind: "image" | "table" } | null;

function DocumentEditor({ id, primary, split, onActivate, onClose, onHeadings, onSaved, handleRef }: DocProps) {
  const { loading: authLoading } = useAuth();
  const [pkg, setPkg] = useState<NotePackage | null>(null);
  const [title, setTitle] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPara, setEditingPara] = useState(false);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);

  const toolbar1 = DEFAULT_TB1; // fixed default structures (no longer user-editable)
  // Eight editable symbol slots (always exactly SYMBOL_COUNT), changed via "Edit".
  const [symbols, setSymbols] = useState<string[]>(() =>
    [...readLS(SYM_KEY, DEFAULT_SYMBOLS), ...DEFAULT_SYMBOLS].slice(0, SYMBOL_COUNT),
  );
  const [editSyms, setEditSyms] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [tablePicker, setTablePicker] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState<DocumentTree | null>(null);
  // null = closed; { id: null } = drawing a new graph; { id } = editing an existing one.
  const [graphEdit, setGraphEdit] = useState<{ id: string | null } | null>(null);
  const [listMenu, setListMenu] = useState<null | "bullet" | "number">(null);
  const [hlMenu, setHlMenu] = useState(false);
  const [zoom, setZoom] = useState(1); // page size ratio
  const [hlColor, setHlColor] = useState(DEFAULT_HIGHLIGHT);
  const [heights, setHeights] = useState<Record<string, number>>({});

  const blockEls = useRef<Map<string, HTMLElement>>(new Map());
  const lastEditedId = useRef<string | null>(null);
  const pkgRef = useRef<NotePackage | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  // Undo/redo: stacks of whole-document snapshots. Consecutive text edits within
  // COALESCE_MS collapse into one step so typing isn't undone character-by-char.
  const undoStack = useRef<DocumentTree[]>([]);
  const redoStack = useRef<DocumentTree[]>([]);
  const lastSnapAt = useRef(0);
  const lastSnapCoalesced = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef(0);
  const sticky = useRef(false);
  const dragFrom = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addTarget = useRef<string | null>(null);
  // Mirrors of state read by the debounced autosave (avoid stale closures).
  const titleRef = useRef(title);
  titleRef.current = title;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const saveFnRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const savingRef = useRef(false); // a write is in progress
  const dirtyDuringSave = useRef(false); // a save was requested mid-write
  const inFlightRef = useRef<Promise<void> | null>(null); // the active write, so callers can await it
  // Empty-note auto-discard is allowed ONLY for a note created in this session
  // (?new=1) whose meta loaded and whose title is still the created default —
  // so a note merely opened from the library is never deleted.
  const createdNew = useRef(false);
  const metaPresentRef = useRef(false);
  const initialTitleRef = useRef<string | null>(null);
  const deletedRef = useRef(false); // note is being discarded; suppress saves
  const printedRef = useRef(false); // guards the one-shot ?print=1 auto-print

  useEffect(() => {
    if (primary && typeof window !== "undefined")
      createdNew.current = new URLSearchParams(window.location.search).get("new") === "1";
  }, [primary]);
  useEffect(() => {
    pkgRef.current = pkg;
  }, [pkg]);
  useEffect(() => {
    // The editable symbol slots are a global preference shared via localStorage.
    // In split view both panes persist to the same key (last write wins; the
    // other pane converges on its next mount) — acceptable for a rare action.
    if (typeof window !== "undefined") try { localStorage.setItem(SYM_KEY, JSON.stringify(symbols)); } catch { /* noop */ }
  }, [symbols]);
  // Autosave: debounce a write ~800ms after the last change to the note/title.
  // `saved` starts true (a freshly-loaded note is clean), so this never fires on
  // load — only after a real edit flips it dirty.
  useEffect(() => {
    if (saved) return;
    const t = setTimeout(() => { void saveFnRef.current(); }, 800);
    return () => clearTimeout(t);
  }, [pkg, title, saved]);
  // Flush any pending save when the tab is hidden/closed or the editor unmounts
  // (e.g. navigating back to the library), so the debounced write isn't lost.
  useEffect(() => {
    const flush = () => { if (!savedRef.current) void saveFnRef.current(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      // Discard ONLY a note created this session, still untouched (empty body +
      // unchanged title), whose meta actually loaded.
      const p = pkgRef.current;
      const titleUnchanged =
        initialTitleRef.current != null && titleRef.current === initialTitleRef.current;
      const discard =
        createdNew.current &&
        metaPresentRef.current &&
        p != null &&
        titleUnchanged &&
        isEmptyDoc(p.tree.blocks);
      if (discard) {
        deletedRef.current = true; // suppress any pending/late autosave
        savedRef.current = true;
        if (!savingRef.current) void getStore().deleteNote(id);
        // else: the in-flight save's finally performs the delete once it settles
      } else {
        flush();
      }
    };
  }, [id]);
  // Wait for the auth session to resolve so a directly-opened cloud note loads
  // from the cloud store (not a transient local miss) — see getStore().
  useEffect(() => {
    if (authLoading) return;
    (async () => {
      const store = getStore();
      const [p, meta] = await Promise.all([store.openNote(id), store.getNoteMeta(id)]);
      resetHistory(); // a freshly loaded document starts with an empty undo history
      setPkg(p);
      metaPresentRef.current = !!meta;
      const loadedTitle = meta?.title ?? "Untitled";
      initialTitleRef.current = loadedTitle;
      setTitle(loadedTitle);
    })().catch((e) => {
      console.error(e);
      // Never get stuck on "Opening note…": render the editor with an empty
      // document so the toolbar/header (and the rest of the UI) still appear.
      setPkg((prev) => prev ?? { noteId: id, tree: emptyDocument("flow"), latexCache: "", assets: [], updatedAt: new Date().toISOString(), rev: null });
    });
  }, [id, authLoading]);
  // Arrived via a "Download PDF" action (?print=1): open the print dialog once
  // the document has loaded and rendered.
  useEffect(() => {
    if (!primary || !pkg || printedRef.current) return;
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("print") !== "1") return;
    printedRef.current = true;
    const t = setTimeout(() => { void printPdf(); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg]);
  useEffect(() => {
    if (!editingId) return;
    lastEditedId.current = editingId; // remember for the topbar style dropdown
    const t = taRef.current;
    if (t) {
      t.focus();
      const n = t.value.length;
      try { t.setSelectionRange(n, n); } catch { /* noop */ }
      caretRef.current = n;
    }
  }, [editingId]);
  // Measure each block's height after every render (drives pagination).
  useLayoutEffect(() => {
    setHeights((prev) => {
      const next: Record<string, number> = {};
      let changed = Object.keys(prev).length !== blockEls.current.size;
      for (const [id, el] of blockEls.current) {
        next[id] = el.offsetHeight;
        if (prev[id] !== next[id]) changed = true;
      }
      return changed ? next : prev;
    });
  });

  // ── undo / redo (whole-document snapshots) ─────────────────────────────────
  const HISTORY_LIMIT = 100;
  const COALESCE_MS = 400;
  /** Snapshot the current tree before a change so it can be undone back to. */
  function snapshot(coalesce: boolean) {
    const prev = pkgRef.current?.tree;
    if (!prev) return;
    const now = Date.now();
    const merge = coalesce && lastSnapCoalesced.current && now - lastSnapAt.current <= COALESCE_MS;
    if (!merge) {
      undoStack.current.push(prev);
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
    }
    redoStack.current = []; // any new edit invalidates the redo stack
    lastSnapAt.current = now;
    lastSnapCoalesced.current = coalesce;
  }
  function resetHistory() {
    undoStack.current = [];
    redoStack.current = [];
    lastSnapCoalesced.current = false;
  }
  const applyTree = useCallback((tree: DocumentTree) => {
    setEditingId(null); // close any open editor so its draft can't fight the restore
    setSelected(null);
    setPkg((prev) => (prev ? { ...prev, tree } : prev));
    setSaved(false);
  }, []);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    const cur = pkgRef.current;
    if (!prev || !cur) return;
    redoStack.current.push(cur.tree);
    lastSnapCoalesced.current = false;
    applyTree(prev);
  }, [applyTree]);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    const cur = pkgRef.current;
    if (!next || !cur) return;
    undoStack.current.push(cur.tree);
    lastSnapCoalesced.current = false;
    applyTree(next);
  }, [applyTree]);

  // ── templates ──────────────────────────────────────────────────────────────
  /** Apply a template (undoable; fresh block ids). "add" appends its blocks and
   *  keeps the current page style; "replace" swaps in the whole template. */
  function applyTemplate(t: DocumentTree, action: "add" | "replace") {
    snapshot(false);
    setEditingId(null);
    setSelected(null);
    const fresh = freshTree(t);
    setPkg((prev) => {
      if (!prev) return prev;
      const tree = action === "add"
        ? { ...prev.tree, blocks: [...prev.tree.blocks, ...fresh.blocks] }
        : fresh;
      return { ...prev, tree };
    });
    setSaved(false);
    setTemplatesOpen(false);
    setConfirmTemplate(null);
  }
  /** Entry point from the design picker: apply directly, or ask when the note
   *  already has content (unless Settings has a saved preference). */
  function requestApplyTemplate(t: DocumentTree) {
    setTemplatesOpen(false);
    const blocks = pkgRef.current?.tree.blocks ?? [];
    const blank = blocks.every((b) => !hasContent(b));
    if (blank) { applyTemplate(t, "replace"); return; }
    const mode = getSettings().templateApplyMode;
    if (mode === "add") applyTemplate(t, "add");
    else if (mode === "replace") applyTemplate(t, "replace");
    else setConfirmTemplate(t); // "ask"
  }
  /** Save the current document as a reusable template. */
  function saveCurrentAsTemplate(name: string): SavedTemplate | null {
    const t = pkgRef.current?.tree;
    if (!t) return null;
    return saveTemplate(name, "Saved from a note", t, new Date().toISOString());
  }
  /** Apply a page background (or clear it). Undoable via setDocStyle's snapshot. */
  function applyBackground(bg: BuiltInBackground | null) {
    setDocStyle({ background: bg?.css, foreground: bg?.text });
    setTemplatesOpen(false);
  }

  // ⌘/Ctrl+Z = undo, ⌘/Ctrl+Shift+Z or Ctrl+Y = redo. Scoped to the pane the
  // user is in (or the primary pane when focus is outside any editor). Title and
  // caption inputs keep their native undo; the main block editor uses ours.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      const ae = document.activeElement as HTMLElement | null;
      // Leave native undo to other text fields (note title, captions, …).
      const isOtherField =
        !!ae && ae !== taRef.current &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
      if (isOtherField) return;
      const root = rootRef.current;
      const focusedHere = !!root && !!ae && root.contains(ae);
      if (!focusedHere) {
        if (!primary) return; // a non-primary pane only acts on its own focus
        if (ae && ae !== document.body) return; // focus is in the other pane
      }
      e.preventDefault();
      if (k === "y" || e.shiftKey) redo();
      else undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [primary, undo, redo]);

  // ── tree mutations ────────────────────────────────────────────────────────
  // `coalesce` merges rapid same-burst edits (text typing) into one undo step.
  function setBlocks(update: (blocks: Block[]) => Block[], coalesce = false) {
    snapshot(coalesce);
    setPkg((prev) => (prev ? { ...prev, tree: { ...prev.tree, blocks: update(prev.tree.blocks) } } : prev));
    setSaved(false);
  }
  function updateById(blockId: string, fn: (b: Block) => Block) {
    setBlocks((bs) => bs.map((b) => (b.id === blockId ? fn(b) : b)));
  }
  function updateImageItem(blockId: string, i: number, fn: (it: ReturnType<typeof imageItems>[number]) => ReturnType<typeof imageItems>[number]) {
    updateById(blockId, (b) => withImages(b, imageItems(b).map((it, k) => (k === i ? fn(it) : it))));
  }
  function updateTableItem(blockId: string, i: number, fn: (t: TableData) => TableData) {
    updateById(blockId, (b) => withTables(b, tableItems(b).map((t, k) => (k === i ? fn(t) : t))));
  }

  // Figure placement: each object's free 2D position within its block's box,
  // stored as a Placement {x,r} (fractions of \linewidth). A commit always
  // writes EVERY object's position so the in-flow LaTeX row stays consistent.
  function placeImages(blockId: string, positions: Placement[], widthFracs: number[]) {
    updateById(blockId, (b) => {
      const items = imageItems(b).map((it, i) => {
        const next: ImageItem = { ...it, pos: positions[i] };
        // Pin a measured width so exported inter-image gaps are exact.
        if (it.width == null && widthFracs[i] > 0) {
          next.width = Math.min(100, Math.max(1, Math.round(widthFracs[i] * 100)));
        }
        return next;
      });
      const attrs = { ...b.attrs };
      delete attrs.offset; // superseded by per-object pos
      return withImages({ ...b, attrs }, items);
    });
  }
  function placeTables(blockId: string, positions: Placement[]) {
    updateById(blockId, (b) => {
      const tables = tableItems(b).map((t, i) => ({ ...t, pos: positions[i] }));
      const attrs = { ...b.attrs };
      delete attrs.offset;
      return withTables({ ...b, attrs }, tables);
    });
  }
  function placeGraph(blockId: string, pos: Placement | undefined) {
    updateById(blockId, (b) => {
      const attrs = { ...b.attrs };
      if (pos) attrs.pos = pos;
      else delete attrs.pos;
      delete attrs.offset;
      return { ...b, attrs };
    });
  }
  /** Clear all placements in a figure block → back to the default centered layout. */
  function resetPlacement(blockId: string, kind: "image" | "table") {
    updateById(blockId, (b) => {
      const attrs = { ...b.attrs };
      delete attrs.offset;
      const drop = <T extends { pos?: Placement }>(o: T): T => {
        const c = { ...o };
        delete c.pos;
        return c;
      };
      return kind === "image"
        ? withImages({ ...b, attrs }, imageItems(b).map(drop))
        : withTables({ ...b, attrs }, tableItems(b).map(drop));
    });
  }

  // ── section outline (driven from the page's left sidebar) ──────────────────
  function scrollToBlock(blockId: string) {
    blockEls.current.get(blockId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function toggleSection(blockId: string) {
    updateById(blockId, (b) => ({ ...b, attrs: { ...b.attrs, collapsed: !b.attrs?.collapsed } }));
  }
  function reorderSections(fromId: string, toId: string | null) {
    setBlocks((bs) => reorderSectionBlocks(bs, fromId, toId));
  }
  useImperativeHandle(handleRef, () => ({ scrollToBlock, toggleSection, reorderSections }), [handleRef]);
  // Report the outline to the page whenever it actually changes (not every keystroke).
  const lastOutline = useRef("");
  useEffect(() => {
    const items = computeOutline(pkgRef.current?.tree.blocks ?? []);
    const key = JSON.stringify(items);
    if (key !== lastOutline.current) {
      lastOutline.current = key;
      onHeadings(items);
    }
  }, [pkg, onHeadings]);

  function commit(text: string, c: string | null) {
    if (!editingId) return;
    const next = editingPara ? withCalloutColor(paragraphFromSource(text, editingId), c) : displayFromSource(text, editingId);
    setBlocks((bs) => bs.map((b) => (b.id === editingId ? next : b)), true); // coalesce keystrokes
  }
  function startEdit(block: Block) {
    sticky.current = false; // never let a leftover one-shot absorb this session's first blur
    setSelected(null);
    setEditingId(block.id);
    setEditingPara(isParagraph(block));
    setDraft(blockEditSource(block));
    setColor(calloutColorOf(block));
  }
  function startEditHeading(block: Block) {
    sticky.current = false;
    setSelected(null);
    setEditingId(block.id);
  }
  function selectItem(blockId: string, index: number, kind: "image" | "table") {
    setEditingId(null);
    setSelected({ id: blockId, index, kind });
  }

  function addBlock(block: Block, edit = true) {
    setBlocks((bs) => {
      const anchor = editingId ?? selected?.id ?? null;
      const at = anchor ? bs.findIndex((b) => b.id === anchor) + 1 : bs.length;
      const next = [...bs];
      next.splice(at <= 0 ? bs.length : at, 0, block);
      return next;
    });
    if (edit) startEdit(block);
    else setEditingId(null);
  }
  function moveBlock(from: number | null, to: number) {
    if (from == null) return;
    const len = pkgRef.current?.tree.blocks.length ?? 0;
    if (to < 0 || to >= len || from === to) return;
    setBlocks((bs) => {
      const next = [...bs];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  }
  function deleteBlock(blockId: string) {
    setBlocks((bs) => bs.filter((b) => b.id !== blockId));
    if (editingId === blockId) setEditingId(null);
    if (selected?.id === blockId) setSelected(null);
  }
  const setBlockRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) blockEls.current.set(id, el);
    else blockEls.current.delete(id);
  };
  function setDocStyle(patch: Partial<DocumentStyle>) {
    snapshot(false);
    setPkg((prev) =>
      prev ? { ...prev, tree: { ...prev.tree, style: { ...prev.tree.style, ...patch } } } : prev,
    );
    setSaved(false);
  }
  /** Finish editing a block; auto-remove it if it was left empty. */
  function endEdit(blockId: string) {
    setEditingId(null);
    const b = pkgRef.current?.tree.blocks.find((x) => x.id === blockId);
    if (b && isEmptyBlock(b)) deleteBlock(blockId);
  }

  // ── text/formula editing ──────────────────────────────────────────────────
  function onDraftChange(text: string, caret: number) {
    setDraft(text);
    caretRef.current = caret;
    commit(text, color);
  }
  function pickColor(c: string | null) {
    setColor(c);
    commit(draft, c);
  }
  function spliceAtCaret(snippet: string, caretInside = false) {
    const cur = taRef.current?.value ?? draft;
    const s = taRef.current?.selectionStart ?? caretRef.current ?? cur.length;
    const e = taRef.current?.selectionEnd ?? s;
    const next = cur.slice(0, s) + snippet + cur.slice(e);
    const brace = snippet.indexOf("{}");
    const pos = caretInside && brace >= 0 ? s + brace + 1 : s + snippet.length;
    setDraft(next);
    caretRef.current = pos;
    commit(next, color);
    requestAnimationFrame(() => {
      const t = taRef.current;
      if (!t) return;
      t.focus();
      try { t.setSelectionRange(pos, pos); } catch { /* noop */ }
    });
  }
  function onInsert(latex: string) {
    if (editingId && editingPara) spliceAtCaret(`\\(${latex}\\)`, true);
    else if (editingId) spliceAtCaret(latex, true);
    else addBlock(displayFromSource(latex));
  }
  function wrapSelection(prefix: string, suffix: string = prefix) {
    if (!editingId || !editingPara) return;
    const t = taRef.current;
    if (!t) return;
    const s = t.selectionStart ?? 0;
    const e = t.selectionEnd ?? s;
    const cur = t.value;
    const sel = cur.slice(s, e) || "text";
    const next = cur.slice(0, s) + prefix + sel + suffix + cur.slice(e);
    const pos = s + prefix.length + sel.length + suffix.length;
    setDraft(next);
    caretRef.current = pos;
    commit(next, color);
    requestAnimationFrame(() => {
      const x = taRef.current;
      if (x) { x.focus(); try { x.setSelectionRange(pos, pos); } catch { /* noop */ } }
    });
  }
  function insertLink() {
    if (!editingId || !editingPara) return;
    const t = taRef.current;
    if (!t) return;
    const s = t.selectionStart ?? 0;
    const e = t.selectionEnd ?? s;
    const cur = t.value;
    const sel = cur.slice(s, e) || "link";
    const url = (typeof window !== "undefined" ? window.prompt("Link URL:", "https://") : "") || "";
    if (!url) return;
    const snippet = `[${sel}](${url})`;
    const next = cur.slice(0, s) + snippet + cur.slice(e);
    const pos = s + snippet.length;
    setDraft(next);
    caretRef.current = pos;
    commit(next, color);
    requestAnimationFrame(() => {
      const x = taRef.current;
      if (x) { x.focus(); try { x.setSelectionRange(pos, pos); } catch { /* noop */ } }
    });
  }
  function onPickSymbol(latex: string) {
    if (picker?.kind === "symbol") {
      const idx = picker.index;
      setSymbols((a) => a.map((x, i) => (i === idx ? latex : x)));
    }
    setPicker(null);
  }

  // ── headings ────────────────────────────────────────────────────────────────
  function insertHeading(level: HeadingLevel) {
    const h = makeHeading(level);
    addBlock(h, false);
    setEditingId(h.id);
  }
  function setHeadingText(blockId: string, text: string) { updateById(blockId, (b) => withHeading(b, { text })); }
  function setHeadingLevel(blockId: string, level: HeadingLevel) { updateById(blockId, (b) => withHeading(b, { level })); }
  function setHeadingNumbered(blockId: string, numbered: boolean) { updateById(blockId, (b) => withHeading(b, { numbered })); }
  function setHeadingAlign(blockId: string, align: ImageAlign) { updateById(blockId, (b) => withHeading(b, { align })); }

  /** Google-Docs-style topbar dropdown: set the current block's style. */
  function applyStyle(style: "text" | HeadingLevel) {
    const tid = editingId ?? lastEditedId.current;
    const cur = tid ? blocks.find((b) => b.id === tid) : null;
    if (style === "text") {
      if (cur && cur.type === "heading") {
        const p = paragraphFromSource(cur.value ?? "", cur.id);
        updateById(cur.id, () => p);
        startEdit(p);
      } else if (!cur || cur.type !== "text") {
        addBlock(paragraphFromSource(""));
      }
      return;
    }
    if (cur && cur.type === "heading") {
      setHeadingLevel(cur.id, style);
      setEditingId(cur.id);
    } else if (cur && cur.type === "text") {
      const h: Block = { ...makeHeading(style, draft || cur.value || ""), id: cur.id };
      updateById(cur.id, () => h);
      setSelected(null);
      setEditingId(cur.id);
    } else {
      insertHeading(style);
    }
  }

  // ── lists / equation ──────────────────────────────────────────────────────
  function insertList(ordered: boolean, marker?: ListMarker) {
    const l = makeList(ordered, marker);
    addBlock(l, false);
    setEditingId(l.id);
    setListMenu(null);
  }
  function setListText(blockId: string, text: string) {
    updateById(blockId, (b) => withList(b, text.split("\n")));
  }
  function setListOrdered(blockId: string, ordered: boolean) {
    updateById(blockId, (b) => withList(b, listItems(b), ordered));
  }
  function insertEquation() {
    addBlock(displayFromSource(""));
  }

  // ── graphs ────────────────────────────────────────────────────────────────
  function commitGraph(graph: GraphData) {
    const target = graphEdit?.id ?? null;
    if (target) updateById(target, (b) => withGraph(b, graph));
    else addBlock(makeGraphBlock(graph), false);
    setGraphEdit(null);
  }

  // ── images ────────────────────────────────────────────────────────────────
  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ref = await getStore().putAsset(id, file, { kind: "image", mime: file.type || "image/png" });
    setPkg((prev) => (prev ? { ...prev, assets: [...prev.assets, ref] } : prev));
    const target = addTarget.current;
    addTarget.current = null;
    if (target) {
      const cur = pkgRef.current?.tree.blocks.find((b) => b.id === target);
      const newIndex = cur ? imageItems(cur).length : 0;
      updateById(target, (b) => withImages(b, [...imageItems(b), { assetId: ref.id, alt: file.name }], imageAlign(b)));
      selectItem(target, newIndex, "image");
    } else {
      const block = makeImageBlock([{ assetId: ref.id, alt: file.name }], "center");
      addBlock(block, false);
      selectItem(block.id, 0, "image");
    }
  }
  function newImageRow() { addTarget.current = null; fileRef.current?.click(); }
  function addImageToRow(blockId: string) { addTarget.current = blockId; fileRef.current?.click(); }
  function imgCaption(blockId: string, i: number, text: string) {
    updateImageItem(blockId, i, (it) => ({ ...it, caption: text || undefined }));
  }
  function imgWidth(width: number | undefined) {
    if (!selected) return;
    updateImageItem(selected.id, selected.index, (it) => ({ ...it, width }));
  }
  function rowAlign(align: ImageAlign) {
    if (!selected) return;
    // An align preset also clears any free horizontal offset.
    updateById(selected.id, (b) => {
      const aligned = selected.kind === "image" ? withImages(b, imageItems(b), align) : withTables(b, tableItems(b), align);
      const attrs = { ...aligned.attrs };
      delete attrs.offset;
      return { ...aligned, attrs };
    });
  }
  function reorderImage(blockId: string, from: number, to: number) {
    updateById(blockId, (b) => {
      const items = [...imageItems(b)];
      if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return b;
      const [m] = items.splice(from, 1);
      items.splice(to, 0, m);
      return withImages(b, items);
    });
    setSelected((s) => (s && s.id === blockId ? { ...s, index: to } : s));
  }
  function deleteImage(blockId: string, i: number) {
    setBlocks((bs) => bs.flatMap((b) => {
      if (b.id !== blockId) return [b];
      const items = imageItems(b).filter((_, k) => k !== i);
      return items.length ? [withImages(b, items)] : [];
    }));
    setSelected(null);
  }

  // ── tables ──────────────────────────────────────────────────────────────────
  function insertTable(style: TableStyle) {
    setTablePicker(false);
    const block = { id: crypto.randomUUID(), type: "table" as const, attrs: { tables: [{ style, rows: demoRows() }], align: "center" } };
    addBlock(block, false);
    selectItem(block.id, 0, "table");
  }
  function addTableToRow(blockId: string) {
    const cur = pkgRef.current?.tree.blocks.find((b) => b.id === blockId);
    const newIndex = cur ? tableItems(cur).length : 0;
    updateById(blockId, (b) => withTables(b, [...tableItems(b), { style: "booktabs", rows: demoRows() }]));
    selectItem(blockId, newIndex, "table");
  }
  function tblCaption(blockId: string, i: number, text: string) { updateTableItem(blockId, i, (t) => ({ ...t, caption: text || undefined })); }
  function tblStyle(style: TableStyle) { if (selected) updateTableItem(selected.id, selected.index, (t) => ({ ...t, style })); }
  function tblCell(blockId: string, i: number, r: number, c: number, v: string) {
    updateTableItem(blockId, i, (t) => {
      const rows = t.rows.map((x) => [...x]);
      while (rows.length <= r) rows.push([]);
      while (rows[r].length <= c) rows[r].push("");
      rows[r][c] = v;
      return { ...t, rows };
    });
  }
  function tblAddRow() { if (!selected) return; updateTableItem(selected.id, selected.index, (t) => { const cols = Math.max(1, ...t.rows.map((r) => r.length)); return { ...t, rows: [...t.rows, Array.from({ length: cols }, () => "")] }; }); }
  function tblRemoveRow() { if (!selected) return; updateTableItem(selected.id, selected.index, (t) => (t.rows.length <= 1 ? t : { ...t, rows: t.rows.slice(0, -1) })); }
  function tblAddCol() { if (!selected) return; updateTableItem(selected.id, selected.index, (t) => ({ ...t, rows: t.rows.map((r) => [...r, ""]) })); }
  function tblRemoveCol() { if (!selected) return; updateTableItem(selected.id, selected.index, (t) => { const cols = Math.max(1, ...t.rows.map((r) => r.length)); return cols <= 1 ? t : { ...t, rows: t.rows.map((r) => r.slice(0, -1)) }; }); }
  function reorderTable(blockId: string, from: number, to: number) {
    updateById(blockId, (b) => {
      const items = [...tableItems(b)];
      if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return b;
      const [m] = items.splice(from, 1);
      items.splice(to, 0, m);
      return withTables(b, items);
    });
    setSelected((s) => (s && s.id === blockId ? { ...s, index: to } : s));
  }
  function deleteTable(blockId: string, i: number) {
    setBlocks((bs) => bs.flatMap((b) => {
      if (b.id !== blockId) return [b];
      const items = tableItems(b).filter((_, k) => k !== i);
      return items.length ? [withTables(b, items)] : [];
    }));
    setSelected(null);
  }

  // Unified drag-move: reorder within a row, or move an item across boxes.
  function moveImageItem(fromId: string, fromIndex: number, toId: string, toIndex: number) {
    if (fromId === toId) {
      reorderImage(fromId, fromIndex, toIndex);
      return;
    }
    const fromBlock = pkgRef.current?.tree.blocks.find((b) => b.id === fromId);
    const toBlock = pkgRef.current?.tree.blocks.find((b) => b.id === toId);
    if (!fromBlock || !toBlock) return;
    const item = imageItems(fromBlock)[fromIndex];
    if (!item) return;
    const at = Math.max(0, Math.min(toIndex, imageItems(toBlock).length));
    // Crossing boxes reflows both: drop every object's placement so each block
    // re-centers and the in-flow LaTeX stays consistent (all-or-none pos).
    const drop = (it: ImageItem): ImageItem => { const c = { ...it }; delete c.pos; return c; };
    setBlocks((bs) =>
      bs.flatMap((b) => {
        if (b.id === fromId) {
          const items = imageItems(b).filter((_, k) => k !== fromIndex).map(drop);
          return items.length ? [withImages(b, items)] : [];
        }
        if (b.id === toId) {
          const items = imageItems(b).map(drop);
          items.splice(at, 0, drop(item));
          return [withImages(b, items)];
        }
        return [b];
      }),
    );
    setSelected({ id: toId, index: at, kind: "image" });
  }
  function moveTableItem(fromId: string, fromIndex: number, toId: string, toIndex: number) {
    if (fromId === toId) {
      reorderTable(fromId, fromIndex, toIndex);
      return;
    }
    const fromBlock = pkgRef.current?.tree.blocks.find((b) => b.id === fromId);
    const toBlock = pkgRef.current?.tree.blocks.find((b) => b.id === toId);
    if (!fromBlock || !toBlock) return;
    const item = tableItems(fromBlock)[fromIndex];
    if (!item) return;
    const at = Math.max(0, Math.min(toIndex, tableItems(toBlock).length));
    const drop = (t: TableData): TableData => { const c = { ...t }; delete c.pos; return c; };
    setBlocks((bs) =>
      bs.flatMap((b) => {
        if (b.id === fromId) {
          const items = tableItems(b).filter((_, k) => k !== fromIndex).map(drop);
          return items.length ? [withTables(b, items)] : [];
        }
        if (b.id === toId) {
          const items = tableItems(b).map(drop);
          items.splice(at, 0, drop(item));
          return [withTables(b, items)];
        }
        return [b];
      }),
    );
    setSelected({ id: toId, index: at, kind: "table" });
  }

  function moveSelected(dir: number) {
    if (!selected) return;
    const to = selected.index + dir;
    if (selected.kind === "image") reorderImage(selected.id, selected.index, to);
    else reorderTable(selected.id, selected.index, to);
  }

  async function save() {
    if (deletedRef.current) return; // note is being discarded — don't resurrect it
    const p = pkgRef.current;
    if (!p) return;
    // Coalesce overlapping saves, but await the in-flight write so callers that
    // `await save()` (e.g. export) always observe a completed persist.
    if (savingRef.current) {
      dirtyDuringSave.current = true;
      await inFlightRef.current?.catch(() => {});
      return;
    }
    savingRef.current = true;
    dirtyDuringSave.current = false;
    const t = titleRef.current;
    setSaving(true);
    const run = (async () => {
      try {
        const store = getStore();
        await store.saveNote({ ...p, latexCache: documentToLatex(p.tree) });
        // `deletedAt: null` implicitly restores a trashed note the moment it is
        // edited — so edited work can never be silently purged from the bin.
        await store.updateNoteMeta(id, { title: t, deletedAt: null });
        onSaved?.(); // let the page refresh its recent-files list (title/recency)
        // Only clear the dirty flag if nothing changed while we were writing;
        // otherwise leave it dirty so the debounce schedules another save.
        if (pkgRef.current === p && titleRef.current === t) setSaved(true);
      } catch (e) {
        console.error("save failed", e);
      } finally {
        savingRef.current = false;
        setSaving(false);
        if (deletedRef.current) {
          // The note was abandoned during this write — remove it now (no zombie).
          void getStore().deleteNote(id);
        } else if (dirtyDuringSave.current) {
          // A save() was requested while this one ran — persist the latest once more.
          dirtyDuringSave.current = false;
          void saveFnRef.current();
        }
      }
    })();
    inFlightRef.current = run;
    await run;
  }
  saveFnRef.current = save;

  if (!pkg) {
    return <div className="grid h-full place-items-center text-muted">Opening note…</div>;
  }

  const blocks = pkg.tree.blocks;
  // Collapsed sections hide their body blocks in the editor view (content stays
  // in the tree and still exports); the heading itself remains visible.
  const hidden = hiddenBlockIds(blocks);
  const visibleBlocks = hidden.size ? blocks.filter((b) => !hidden.has(b.id)) : blocks;
  const headingNumbers = computeHeadingNumbers(blocks);
  const editingBlock = editingId ? blocks.find((b) => b.id === editingId) : null;
  const currentStyle: "text" | HeadingLevel =
    editingBlock && editingBlock.type === "heading" ? headingLevel(editingBlock) : "text";
  const keepFocus = (e: MouseEvent) => {
    if (editingId) { e.preventDefault(); sticky.current = true; }
  };

  // Print → "Save as PDF": show the WYSIWYG pages at 100% (so each A4 sheet maps
  // to one printed page) and open the browser print dialog. Print CSS hides the
  // editor chrome and forces true A4 sizing / page breaks.
  async function printPdf() {
    setShowSource(false);
    setEditingId(null);
    setSelected(null);
    setPicker(null);
    setTablePicker(false);
    const prev = zoom;
    if (prev !== 1) setZoom(1);
    // Let the re-layout/pagination settle at 100% before invoking print.
    await new Promise<void>((r) => setTimeout(r, prev !== 1 ? 450 : 150));
    window.print();
    if (prev !== 1) setZoom(prev);
  }

  // A4 page geometry (size adjustable via `zoom`) + document style + pagination.
  const pageW = Math.round(A4_W * zoom);
  const pageH = Math.round(A4_H * zoom);
  const margin = Math.round(pageW * 0.09);
  const pageContent = pageH - 2 * margin;
  const docStyle = pkg.tree.style ?? {};
  const fontSize = docStyle.fontSize ?? 14;
  const fontKey = docStyle.fontFamily ?? "Computer Modern";
  const fontFamily = fontFamilyOf(docStyle.fontFamily);
  const lineSpacing = docStyle.lineSpacing ?? 1.5;
  const indent = docStyle.indent ?? 0;
  const layout = docStyle.pageLayout ?? "vertical";
  const indexById = new Map(blocks.map((b, i) => [b.id, i] as const));
  const packed = paginate(visibleBlocks, heights, pageContent);
  // Always keep one completely blank page at the end so the canvas never feels
  // "full". paginate() only ends on an empty page for an empty document; once
  // there's content, append a fresh blank sheet. Same page list drives both the
  // vertical and horizontal layouts, so this works for both.
  const pages =
    packed[packed.length - 1].length === 0 ? packed : [...packed, []];
  // The last page with content — used so print suppresses the break after it
  // (`:last-child` would match the hidden, appended blank page instead).
  const lastContentPage = pages.reduce((acc, ids, i) => (ids.length ? i : acc), -1);
  const contentStyle = {
    padding: margin,
    fontSize: `${fontSize}px`,
    fontFamily,
    lineHeight: lineSpacing,
    ["--indent" as string]: `${indent}em`,
  } as CSSProperties;

  return (
    <main ref={rootRef} className="flex h-full min-h-0 flex-col" onMouseDown={onActivate}>
      <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />

      <header className="print-hide flex items-center gap-3 border-b border-border px-4 py-3">
        {split && <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">{primary ? "A" : "B"}</span>}
        <input value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} className="flex-1 bg-transparent text-lg font-semibold outline-none" />
        <div className="flex items-center gap-1">
          <button onMouseDown={(e) => e.preventDefault()} onClick={undo} disabled={undoStack.current.length === 0} title="Undo (⌘/Ctrl+Z)" aria-label="Undo" className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:border-accent disabled:opacity-40"><span className="text-base leading-none">↶</span>Undo</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={redo} disabled={redoStack.current.length === 0} title="Redo (⌘/Ctrl+Shift+Z)" aria-label="Redo" className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:border-accent disabled:opacity-40"><span className="text-base leading-none">↷</span>Redo</button>
        </div>
        <button onClick={() => setTemplatesOpen(true)} title="Templates & backgrounds" className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent">Design</button>
        <button onClick={() => setShowSource((s) => !s)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent">{showSource ? "Editor" : "LaTeX"}</button>
        <ExportMenu noteId={id} title={title} beforeExport={save} onPdf={printPdf} label="Export ▾" className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent" />
        <button onClick={save} title="Saves automatically; click to save now" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">{saving ? "Saving…" : saved ? "Saved" : "Save"}</button>
        {onClose && <button onClick={onClose} title="Close this pane" className="rounded-md border border-border px-2 py-1.5 text-sm text-muted hover:border-red-500 hover:text-red-500">✕</button>}
      </header>

      {/* Block tools */}
      <div className="print-hide flex flex-wrap items-center justify-center gap-2 border-b border-border px-6 py-2">
        {/* Title — the only control that keeps a word label */}
        <select value={typeof currentStyle === "number" ? String(currentStyle) : ""} onChange={(e) => { if (e.target.value) applyStyle(Number(e.target.value) as HeadingLevel); }} title="Make the current block a heading" className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="" disabled>Heading…</option>
          <option value={1}>Title</option>
          <option value={2}>Subtitle</option>
          <option value={3}>Subsubtitle</option>
          <option value={4}>Subsubsubtitle</option>
        </select>
        <span className="mx-1 h-7 w-px bg-border" />
        {/* Text · Equation */}
        <ToolButton onClick={() => addBlock(paragraphFromSource(""))} title="New paragraph (normal text)">T</ToolButton>
        <ToolButton onClick={insertEquation} title="Insert centered equation ($$…$$)">Σ</ToolButton>
        <ToolButton onClick={() => setGraphEdit({ id: null })} title="Insert interactive graph"><GraphIcon /></ToolButton>
        <span className="mx-1 h-7 w-px bg-border" />
        {/* Bold · Italic · Underline · Strike · Highlight */}
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("**")} title="Bold (**…**)" className={`${ICON_BTN} font-bold`}>B</button>
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("*")} title="Italic (*…*)" className={`${ICON_BTN} italic`}>I</button>
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("__")} title="Underline (__…__)" className={`${ICON_BTN} underline`}>U</button>
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("~~")} title="Strikethrough (~~…~~)" className={`${ICON_BTN} line-through`}>S</button>
        <HighlightButton color={hlColor} open={hlMenu} onToggle={() => setHlMenu((o) => !o)} onApply={() => wrapSelection(`==#${hlColor.replace("#", "")}:`, "==")} onColor={setHlColor} keepFocus={keepFocus} onColorMouseDown={() => { if (editingId) sticky.current = true; }} />
        <span className="mx-1 h-7 w-px bg-border" />
        {/* Picture · Table · Link */}
        <ToolButton onClick={newImageRow} title="Insert image">🖼</ToolButton>
        <ToolButton onClick={() => setTablePicker(true)} title="Insert table">▤</ToolButton>
        <button onMouseDown={keepFocus} onClick={insertLink} title="Insert link" className={ICON_BTN}>🔗</button>
        <span className="mx-1 h-7 w-px bg-border" />
        {/* Unnumbered · Numbered list */}
        <ListToolButton ordered={false} open={listMenu === "bullet"} onToggle={() => setListMenu((m) => (m === "bullet" ? null : "bullet"))} onInsert={(marker) => insertList(false, marker)} />
        <ListToolButton ordered={true} open={listMenu === "number"} onToggle={() => setListMenu((m) => (m === "number" ? null : "number"))} onInsert={(marker) => insertList(true, marker)} />
      </div>

      {/* Functions & symbols */}
      <div className="print-hide flex flex-wrap items-center justify-center gap-1.5 border-b border-border px-6 py-2">
        {/* Structures — fixed defaults (not user-editable) */}
        {toolbar1.map((latex, i) => (
          <button key={i} onMouseDown={keepFocus} onClick={() => onInsert(latex)} title={`Insert ${latex}`} className={ICON_BTN}>
            <Katex latex={previewLatex(latex)} />
          </button>
        ))}
        <span className="mx-2 h-7 w-px bg-border" />
        {/* Symbols — eight editable slots; "Edit" lets the user change any of them */}
        {symbols.map((latex, i) => (
          <button key={i} onMouseDown={(e) => { if (!editSyms) keepFocus(e); else if (editingId) sticky.current = true; }} onClick={() => (editSyms ? setPicker({ kind: "symbol", index: i }) : onInsert(latex))} title={editSyms ? "Click to change this symbol" : `Insert ${latex}`} className={`${ICON_BTN} ${editSyms ? "border-dashed border-accent/60" : ""}`}>
            <Katex latex={previewLatex(latex)} />
          </button>
        ))}
        <button onMouseDown={keepFocus} onClick={() => setEditSyms((s) => !s)} title="Change the symbols" className={`rounded-md border px-2 py-1 text-xs ${editSyms ? "border-accent text-accent" : "border-border text-muted"}`}>{editSyms ? "Done" : "Edit"}</button>
        <span className="mx-2 h-7 w-px bg-border" />
        <button onMouseDown={keepFocus} onClick={() => setPicker({ kind: "insert" })} title="Browse all functions & symbols" className="flex h-9 items-center rounded-md border border-border px-3 text-sm hover:border-accent">Functions and Symbols</button>
      </div>

      {/* Document settings */}
      {!showSource && (
        <div className="print-hide flex flex-wrap items-center justify-center gap-3 border-b border-border px-6 py-2 text-xs text-muted">
          <label className="flex items-center gap-1">Font
            <select value={fontKey} onChange={(e) => setDocStyle({ fontFamily: e.target.value })} className="rounded border border-border bg-background px-1 py-0.5" style={{ fontFamily }}>
              {Object.keys(FONTS).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Size
            <select value={fontSize} onChange={(e) => setDocStyle({ fontSize: Number(e.target.value) })} className="rounded border border-border bg-background px-1 py-0.5">
              {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Spacing
            <select value={lineSpacing} onChange={(e) => setDocStyle({ lineSpacing: Number(e.target.value) })} className="rounded border border-border bg-background px-1 py-0.5">
              {LINE_SPACINGS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Indent
            <select value={indent} onChange={(e) => setDocStyle({ indent: Number(e.target.value) })} className="rounded border border-border bg-background px-1 py-0.5">
              {INDENTS.map((s) => <option key={s} value={s}>{s === 0 ? "none" : `${s}em`}</option>)}
            </select>
          </label>
          <span className="mx-1 h-4 w-px bg-border" />
          <span>Pages</span>
          <div className="inline-flex overflow-hidden rounded border border-border">
            <button onClick={() => setDocStyle({ pageLayout: "vertical" })} className={`px-2 py-0.5 ${layout === "vertical" ? "bg-accent text-white" : "hover:bg-foreground/5"}`}>Vertical</button>
            <button onClick={() => setDocStyle({ pageLayout: "horizontal" })} className={`px-2 py-0.5 ${layout === "horizontal" ? "bg-accent text-white" : "hover:bg-foreground/5"}`}>Horizontal</button>
          </div>
          <span className="mx-1 h-4 w-px bg-border" />
          <label className="flex items-center gap-1" title="Page size">Zoom
            <input type="range" min={0.6} max={1.4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24" />
            <span className="w-9 text-right">{Math.round(zoom * 100)}%</span>
          </label>
        </div>
      )}

      {/* Body */}
      {showSource ? (
        <div className="mx-auto w-full max-w-3xl flex-1 p-8">
          <p className="mb-2 text-xs text-muted">Generated LaTeX (read-only — derived from the block tree)</p>
          <textarea readOnly value={documentToLatex(pkg.tree)} className="h-[70vh] w-full rounded-lg border border-border bg-surface p-4 font-mono text-sm" />
        </div>
      ) : (
        <div className="print-surface flex-1 overflow-auto p-8" style={{ background: "var(--background)" }}>
          <div className={`print-stack ${layout === "horizontal" ? "flex items-start gap-8" : "flex flex-col items-center gap-8"}`}>
            {pages.map((ids, p) => (
              <div key={p} className={`print-page relative shrink-0 text-foreground shadow-xl ring-1 ring-border ${docStyle.background ? "" : "bg-surface"} ${ids.length === 0 ? "print-hide" : ""} ${p === lastContentPage ? "last-print-page" : ""}`} style={{ width: pageW, minHeight: pageH, background: docStyle.background || undefined, color: docStyle.foreground || undefined }}>
                <div style={contentStyle}>
                  {blocks.length === 0 ? (
                    <button onClick={() => addBlock(paragraphFromSource(""))} className="w-full rounded-lg border border-dashed border-border p-8 text-center text-muted hover:border-accent">Empty note — click to start a paragraph, or use the toolbar.</button>
                  ) : (
                    <div className="space-y-1">
                      {ids.map((id) => {
                        const gi = indexById.get(id) ?? -1;
                        const b = blocks[gi];
                        return b ? (
                          <div key={id} ref={setBlockRef(id)}>{renderBlock(b, gi)}</div>
                        ) : null;
                      })}
                    </div>
                  )}
                  {p === pages.length - 1 && blocks.length > 0 && !editingId && !selected && (
                    <button onClick={() => addBlock(paragraphFromSource(""))} className="print-hide mt-1 block w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-foreground/[0.04]">Click to add text…</button>
                  )}
                </div>
                <span className="pointer-events-none absolute bottom-1.5 right-3 text-[10px] text-muted">{p < pages.length - 1 || ids.length > 0 ? p + 1 : null}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {picker?.kind === "insert" ? (
        <SymbolPicker
          title="Functions & symbols"
          onPick={onInsert}
          onClose={() => setPicker(null)}
          closeOnPick={false}
          keepFocus={keepFocus}
          onNavMouseDown={() => { if (editingId) sticky.current = true; }}
          autoFocusSearch={!editingId}
        />
      ) : picker ? (
        <SymbolPicker title="Choose a symbol for this slot" onPick={onPickSymbol} onClose={() => setPicker(null)} />
      ) : null}
      {tablePicker && <TablePicker onPick={insertTable} onClose={() => setTablePicker(false)} />}
      {graphEdit && (
        <GraphEditor
          initial={graphEdit.id ? graphModel(blocks.find((b) => b.id === graphEdit.id) ?? { id: "", type: "graph" }) : undefined}
          onPick={commitGraph}
          onClose={() => setGraphEdit(null)}
        />
      )}
      {templatesOpen && (
        <DesignPicker
          currentBackground={docStyle.background}
          onApplyBackground={applyBackground}
          onApply={requestApplyTemplate}
          onSaveCurrent={saveCurrentAsTemplate}
          onClose={() => setTemplatesOpen(false)}
        />
      )}
      {confirmTemplate && (
        <TemplateApplyDialog
          onAdd={(dontAsk) => { if (dontAsk) setSettings({ templateApplyMode: "add" }); applyTemplate(confirmTemplate, "add"); }}
          onReplace={(dontAsk) => { if (dontAsk) setSettings({ templateApplyMode: "replace" }); applyTemplate(confirmTemplate, "replace"); }}
          onCancel={() => setConfirmTemplate(null)}
        />
      )}
    </main>
  );

  // ── one block row (chrome + content) ──────────────────────────────────────
  function renderBlock(b: Block, i: number): ReactNode {
    const isHeading = b.type === "heading";
    const isList = b.type === "list";
    const isImage = b.type === "image";
    const isTable = b.type === "table";
    const isGraph = b.type === "graph";
    // Move targets are computed in VISIBLE-list space (then mapped back to the
    // full-array index) so arrows never swap a block with a hidden, collapsed-
    // section body block. Collapsed headings can't be nudged inline (use the
    // outline drag, which moves the whole section).
    const vIdx = hidden.has(b.id) ? -1 : visibleBlocks.findIndex((x) => x.id === b.id);
    const collapsedHeading = b.type === "heading" && isHeadingCollapsed(b);
    const canUp = vIdx > 0 && !collapsedHeading;
    const canDown = vIdx >= 0 && vIdx < visibleBlocks.length - 1 && !collapsedHeading;
    const moveVisible = (dir: -1 | 1) => {
      const target = visibleBlocks[vIdx + dir];
      if (target) moveBlock(i, indexById.get(target.id) ?? i);
    };
    return (
      <div className="group relative flex items-start gap-1 rounded-lg px-1 py-0.5 hover:bg-foreground/[0.03]" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveBlock(dragFrom.current, i); dragFrom.current = null; }}>
        <div className="print-hide flex flex-col items-center pt-1 text-muted opacity-0 transition group-hover:opacity-100">
          <button onClick={() => moveVisible(-1)} disabled={!canUp} title="Move up" className="leading-none hover:text-accent disabled:opacity-30">▲</button>
          <span draggable onDragStart={() => (dragFrom.current = i)} title="Drag to reorder block" className="cursor-grab select-none leading-none active:cursor-grabbing">⠿</span>
          <button onClick={() => moveVisible(1)} disabled={!canDown} title="Move down" className="leading-none hover:text-accent disabled:opacity-30">▼</button>
        </div>

        <div className="min-w-0 flex-1">
          {isHeading ? (
            b.id === editingId ? (
              <div className="rounded-md border border-accent/40 bg-surface p-2">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">{HEADING_NAMES[headingLevel(b)]}</span>
                  {headingLevel(b) === 1 ? (
                    <span className="text-muted">centered</span>
                  ) : (
                    <>
                      <span className="text-muted">Align</span>
                      {(["left", "center", "right"] as ImageAlign[]).map((a) => (
                        <button key={a} onMouseDown={(e) => e.preventDefault()} onClick={() => setHeadingAlign(b.id, a)} className={`rounded border px-1.5 py-0.5 capitalize ${headingAlign(b) === a ? "border-accent text-accent" : "border-border text-muted"}`}>{a}</button>
                      ))}
                    </>
                  )}
                  <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={headingNumbered(b)} onChange={(e) => setHeadingNumbered(b.id, e.target.checked)} /> numbered</label>
                  <button onClick={() => endEdit(b.id)} className="ml-auto rounded border border-border px-2 py-0.5">Done</button>
                </div>
                <input value={b.value ?? ""} autoFocus onChange={(e) => setHeadingText(b.id, e.target.value)} placeholder="Heading text…" style={{ textAlign: headingAlign(b) }} className="w-full bg-transparent text-xl font-semibold outline-none" />
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => toggleSection(b.id)} title={isHeadingCollapsed(b) ? "Expand section" : "Collapse section"} className="print-hide shrink-0 text-muted hover:text-accent">{isHeadingCollapsed(b) ? "▸" : "▾"}</button>
                <button onClick={() => startEditHeading(b)} className="block flex-1 text-left">
                  <HeadingDisplay block={b} number={headingNumbers.get(b.id)} />
                </button>
                {isHeadingCollapsed(b) && <span className="print-hide whitespace-nowrap text-xs italic text-muted">section hidden</span>}
              </div>
            )
          ) : isList ? (
            b.id === editingId ? (
              <div className="rounded-md border border-accent/40 bg-surface p-2">
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => setListOrdered(b.id, true)} className={`rounded border px-2 py-0.5 ${listOrdered(b) ? "border-accent text-accent" : "border-border text-muted"}`}>1. Numbered</button>
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => setListOrdered(b.id, false)} className={`rounded border px-2 py-0.5 ${!listOrdered(b) ? "border-accent text-accent" : "border-border text-muted"}`}>• Bulleted</button>
                  <button onClick={() => endEdit(b.id)} className="ml-auto rounded border border-border px-2 py-0.5">Done</button>
                </div>
                <textarea value={listItems(b).join("\n")} autoFocus onChange={(e) => setListText(b.id, e.target.value)} placeholder="One item per line…" rows={Math.max(2, listItems(b).length)} className="w-full resize-none bg-transparent text-sm outline-none" />
                <div className="mt-2 border-t border-border pt-2"><BlockView block={b} /></div>
              </div>
            ) : (
              <button onClick={() => { setSelected(null); setEditingId(b.id); }} className="w-full rounded-md px-2 py-1 text-left"><BlockView block={b} /></button>
            )
          ) : isImage ? (
            <>
              <ImageRowEditor
                blockId={b.id}
                items={imageItems(b)}
                align={imageAlign(b)}
                selectedIndex={selected?.id === b.id ? selected.index : null}
                onSelect={(idx) => selectItem(b.id, idx, "image")}
                onCommit={(positions, widthFracs) => placeImages(b.id, positions, widthFracs)}
                onReset={() => resetPlacement(b.id, "image")}
                onMoveAcross={(from, toId) => moveImageItem(b.id, from, toId, Number.MAX_SAFE_INTEGER)}
                onCaption={(idx, text) => imgCaption(b.id, idx, text)}
              />
              {selected?.id === b.id && renderControls(b)}
            </>
          ) : isTable ? (
            <>
              <TableRowEditor
                blockId={b.id}
                tables={tableItems(b)}
                align={tableAlign(b)}
                selectedIndex={selected?.id === b.id ? selected.index : null}
                onSelect={(idx) => selectItem(b.id, idx, "table")}
                onCommit={(positions) => placeTables(b.id, positions)}
                onReset={() => resetPlacement(b.id, "table")}
                onMoveAcross={(from, toId) => moveTableItem(b.id, from, toId, Number.MAX_SAFE_INTEGER)}
                onCell={(idx, r, c, v) => tblCell(b.id, idx, r, c, v)}
                onCaption={(idx, text) => tblCaption(b.id, idx, text)}
              />
              {selected?.id === b.id && renderControls(b)}
            </>
          ) : isGraph ? (
            <FigureBox
              blockId={b.id}
              group="graph"
              align="center"
              onSelect={() => { setSelected(null); setEditingId(null); setGraphEdit({ id: b.id }); }}
              onCommit={(positions) => placeGraph(b.id, positions[0])}
              items={[{
                key: b.id,
                pos: b.attrs?.pos,
                content: (
                  <div className="rounded-md px-2 py-1 hover:bg-foreground/[0.03]" title="Click to edit · drag to position">
                    <BlockView block={b} />
                  </div>
                ),
              }]}
            />
          ) : b.id === editingId ? (
            <EditBox taRef={taRef} para={editingPara} draft={draft} color={color} previewBlock={editingPara ? withCalloutColor(paragraphFromSource(draft, b.id), color) : displayFromSource(draft, b.id)} onChange={onDraftChange} onColor={pickColor} onExit={() => endEdit(b.id)} sticky={sticky} />
          ) : (
            <button onClick={() => startEdit(b)} className="w-full rounded-md px-2 py-1 text-left">
              {hasContent(b) ? <BlockView block={b} /> : <span className="text-muted">{isParagraph(b) ? "Empty paragraph" : "Empty formula"} — click to edit</span>}
            </button>
          )}
        </div>

        <button onClick={() => deleteBlock(b.id)} title="Delete block" className="mt-1 px-1 text-muted opacity-0 transition hover:text-red-500 group-hover:opacity-100">✕</button>
      </div>
    );
  }

  // ── inline control panel under the selected image/table block ──────────────
  function renderControls(block: Block): ReactNode {
    if (!selected) return null;
    const aligns: ImageAlign[] = ["left", "center", "right"];
    const curAlign = selected.kind === "image" ? imageAlign(block) : tableAlign(block);
    const count = selected.kind === "image" ? imageItems(block).length : tableItems(block).length;

    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
        <span className="font-medium">{selected.kind === "image" ? "Picture" : "Table"} #{selected.index + 1}</span>
        <span className="mx-1 h-5 w-px bg-border" />

        {selected.kind === "image" && (() => {
          const item = imageItems(block)[selected.index];
          if (!item) return null;
          return (
            <>
              <span className="text-muted">Size</span>
              <input type="range" min={5} max={100} value={item.width ?? 50} onChange={(e) => imgWidth(Number(e.target.value))} className="w-40" />
              <input type="number" min={5} max={100} value={item.width ?? ""} placeholder="auto" onChange={(e) => imgWidth(e.target.value === "" ? undefined : Number(e.target.value))} className="w-14 rounded border border-border bg-background px-1 text-center" />
              <span className="text-muted">%</span>
              <span className="mx-1 h-5 w-px bg-border" />
            </>
          );
        })()}

        {selected.kind === "table" && (() => {
          const t = tableItems(block)[selected.index];
          if (!t) return null;
          return (
            <>
              <span className="text-muted">Style</span>
              <select value={t.style} onChange={(e) => tblStyle(e.target.value as TableStyle)} className="rounded border border-border bg-background px-1 py-0.5">
                {TABLE_STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button onClick={tblAddRow} className="rounded border border-border px-1.5 py-0.5 hover:border-accent">＋Row</button>
              <button onClick={tblRemoveRow} className="rounded border border-border px-1.5 py-0.5 hover:border-accent">－Row</button>
              <button onClick={tblAddCol} className="rounded border border-border px-1.5 py-0.5 hover:border-accent">＋Col</button>
              <button onClick={tblRemoveCol} className="rounded border border-border px-1.5 py-0.5 hover:border-accent">－Col</button>
              <span className="mx-1 h-5 w-px bg-border" />
            </>
          );
        })()}

        <span className="text-muted">Align</span>
        {aligns.map((a) => (
          <button key={a} onClick={() => rowAlign(a)} className={`rounded px-1.5 py-0.5 capitalize ${curAlign === a ? "bg-accent text-white" : "border border-border hover:border-accent"}`}>{a}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />

        <button onClick={() => moveSelected(-1)} disabled={selected.index === 0} title="Move left" className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30">◀</button>
        <button onClick={() => moveSelected(1)} disabled={selected.index >= count - 1} title="Move right" className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30">▶</button>
        <button onClick={() => (selected.kind === "image" ? addImageToRow(block.id) : addTableToRow(block.id))} className="rounded border border-border px-2 py-0.5 hover:border-accent">＋ Add</button>
        <button onClick={() => (selected.kind === "image" ? deleteImage(block.id, selected.index) : deleteTable(block.id, selected.index))} className="rounded border border-border px-2 py-0.5 text-red-500 hover:border-red-400">🗑 Delete</button>
        <button onClick={() => setSelected(null)} className="ml-auto rounded border border-border px-2 py-0.5">✕ Done</button>
      </div>
    );
  }
}

// ─── The editor route: shared strip + left sidebar + up to two split panes ────

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [secondId, setSecondId] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const [outlineA, setOutlineA] = useState<OutlineItem[]>([]);
  const [outlineB, setOutlineB] = useState<OutlineItem[]>([]);
  const [notesRev, setNotesRev] = useState(0); // bumped on save → refresh recent files
  const handleA = useRef<DocHandle | null>(null);
  const handleB = useRef<DocHandle | null>(null);
  const bumpNotes = useCallback(() => setNotesRev((v) => v + 1), []);

  // Opening the primary doc resets the split; opening a file puts it in pane B.
  useEffect(() => { setSecondId(null); setActiveSlot("a"); }, [id]);

  const openSecond = useCallback((noteId: string) => {
    if (noteId === id) { setActiveSlot("a"); return; }
    setSecondId(noteId); // limit of 2: a new pick replaces the existing pane B
    setActiveSlot("b");
  }, [id]);
  const closeSecond = useCallback(() => { setSecondId(null); setActiveSlot("a"); }, []);

  const onHeadingsA = useCallback((o: OutlineItem[]) => setOutlineA(o), []);
  const onHeadingsB = useCallback((o: OutlineItem[]) => setOutlineB(o), []);

  const split = secondId !== null;
  const active: "a" | "b" = split ? activeSlot : "a";
  const activeHandle = active === "a" ? handleA : handleB;
  const activeOutline = active === "a" ? outlineA : outlineB;

  return (
    <div className="print-flow flex h-screen flex-col">
      <div className="print-hide flex items-center gap-3 border-b border-border px-4 py-2">
        <Link href="/" className="text-sm text-muted hover:text-accent">← Library</Link>
        <span className="text-sm font-semibold tracking-tight">Aquarius</span>
        {split && <span className="text-xs text-muted">Split view — click a pane to focus its tools &amp; outline</span>}
        <span className="ml-auto text-xs text-muted">{split ? "2 / 2 open" : "1 open"}</span>
      </div>

      <div className="print-flow flex min-h-0 flex-1">
        <EditorSidebar currentId={id} secondId={secondId} onOpen={openSecond} outline={activeOutline} handle={activeHandle} notesRev={notesRev} />
        <div className="print-flow flex min-w-0 flex-1">
          {/* Exactly one of print-flow / print-hide per wrapper, so only the active pane prints. */}
          <div className={`min-w-0 flex-1 overflow-hidden ${!split || active === "a" ? "print-flow" : "print-hide"} ${split ? "border-r border-border" : ""} ${split && active === "a" ? "ring-1 ring-inset ring-accent/50" : ""}`}>
            <DocumentEditor key={id} id={id} primary split={split} onActivate={() => setActiveSlot("a")} onHeadings={onHeadingsA} onSaved={bumpNotes} handleRef={handleA} />
          </div>
          {split && secondId && (
            <div className={`min-w-0 flex-1 overflow-hidden ${active === "b" ? "print-flow" : "print-hide"} ${active === "b" ? "ring-1 ring-inset ring-accent/50" : ""}`}>
              <DocumentEditor key={secondId} id={secondId} primary={false} split onActivate={() => setActiveSlot("b")} onClose={closeSecond} onHeadings={onHeadingsB} onSaved={bumpNotes} handleRef={handleB} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Left rail: a searchable recent-files list (top) and the section outline (bottom). */
function EditorSidebar({
  currentId,
  secondId,
  onOpen,
  outline,
  handle,
  notesRev,
}: {
  currentId: string;
  secondId: string | null;
  onOpen: (id: string) => void;
  outline: OutlineItem[];
  handle: MutableRefObject<DocHandle | null>;
  notesRev: number;
}) {
  return (
    <aside className="print-hide flex w-60 shrink-0 flex-col border-r border-border">
      <RecentFilesPanel currentId={currentId} secondId={secondId} onOpen={onOpen} notesRev={notesRev} />
      <SectionOutline outline={outline} handle={handle} />
    </aside>
  );
}

function RecentFilesPanel({ currentId, secondId, onOpen, notesRev }: { currentId: string; secondId: string | null; onOpen: (id: string) => void; notesRev: number }) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<NoteMeta[]>([]);
  const [results, setResults] = useState<NoteMeta[] | null>(null);

  // Refresh when the open documents change or any pane saves (titles/recency shift).
  useEffect(() => {
    getStore().listRecentNotes(60).then(setRecent).catch(() => {});
  }, [currentId, secondId, notesRev]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      getStore().searchNotes(q).then((r) => { if (alive) setResults([...r.title, ...r.content]); }).catch(() => {});
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  const list = results ?? recent;
  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-border">
      <div className="px-3 pb-2 pt-3">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Files</h2>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files…" className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted">{query.trim() ? "No matches." : "No files yet."}</p>
        ) : (
          list.map((n) => {
            const open = n.id === currentId || n.id === secondId;
            return (
              <button
                key={n.id}
                onClick={() => onOpen(n.id)}
                disabled={open}
                title={open ? "Already open" : "Open on the right (split view)"}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${open ? "bg-accent/10 text-accent" : "hover:bg-foreground/5"}`}
              >
                <span className="truncate">{n.title || "Untitled"}</span>
                {open && <span className="ml-auto shrink-0 text-[10px] uppercase">{n.id === currentId ? "A" : "B"}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Overleaf-style outline: click to jump, drag to reorder, eye to hide a section. */
function SectionOutline({ outline, handle }: { outline: OutlineItem[]; handle: MutableRefObject<DocHandle | null> }) {
  const dragId = useRef<string | null>(null);
  return (
    <div className="flex min-h-0 flex-[1.3] flex-col">
      <h2 className="px-3 pb-2 pt-3 text-xs font-medium uppercase tracking-wide text-muted">Sections</h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {outline.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted">No headings yet. Add a Title/Subtitle to outline this document.</p>
        ) : (
          <>
            {outline.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => { dragId.current = item.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId.current && dragId.current !== item.id) handle.current?.reorderSections(dragId.current, item.id);
                  dragId.current = null;
                }}
                className="group flex items-center gap-1 rounded-md hover:bg-foreground/5"
                style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
              >
                <span className="cursor-grab select-none px-0.5 text-muted opacity-0 group-hover:opacity-100" title="Drag to reorder">⠿</span>
                <button onClick={() => handle.current?.scrollToBlock(item.id)} className={`min-w-0 flex-1 truncate py-1 text-left text-sm ${item.collapsed ? "text-muted line-through" : ""}`} title={item.text}>
                  {item.text}
                </button>
                <button onClick={() => handle.current?.toggleSection(item.id)} title={item.collapsed ? "Show section" : "Hide section"} className="shrink-0 px-1 text-xs text-muted opacity-0 hover:text-accent group-hover:opacity-100">
                  {item.collapsed ? "🙈" : "👁"}
                </button>
              </div>
            ))}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragId.current) handle.current?.reorderSections(dragId.current, null); dragId.current = null; }}
              className="mt-1 rounded border border-dashed border-transparent py-1 text-center text-[10px] text-muted hover:border-border"
            >
              drop here to move to end
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HeadingDisplay({ block, number }: { block: Block; number?: string }) {
  const lvl = headingLevel(block);
  const cls = lvl === 1 ? "text-2xl font-bold" : lvl === 2 ? "text-xl font-semibold" : lvl === 3 ? "text-lg font-semibold" : "text-base font-semibold";
  const text = block.value || "Untitled heading";
  return <div className={cls} style={{ textAlign: headingAlign(block) }}>{number ? `${number} ` : ""}{text}</div>;
}

// ─── Edit box (paragraph/formula) ────────────────────────────────────────────
function EditBox({
  taRef, para, draft, color, previewBlock, onChange, onColor, onExit, sticky,
}: {
  taRef: RefObject<HTMLTextAreaElement | null>;
  para: boolean;
  draft: string;
  color: string | null;
  previewBlock: Block;
  onChange: (text: string, caret: number) => void;
  onColor: (c: string | null) => void;
  onExit: () => void;
  sticky: MutableRefObject<boolean>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hexDraft, setHexDraft] = useState(color ?? "");
  useEffect(() => setHexDraft(color ?? ""), [color]);

  function onFocusOut(e: FocusEvent<HTMLDivElement>) {
    if (boxRef.current && e.relatedTarget && boxRef.current.contains(e.relatedTarget as Node)) return;
    if (sticky.current) { sticky.current = false; return; }
    onExit();
  }

  // Keep Tab inside the box (its default focus-move would blur → exit). Escape
  // commits/leaves. Tab/Shift+Tab indent/outdent prose; in formula mode it only
  // holds focus (a literal tab is meaningless whitespace in LaTeX). Reads the
  // live textarea value, mirroring spliceAtCaret.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") { e.preventDefault(); onExit(); return; }
    if (e.key !== "Tab") return;
    e.preventDefault();
    if (!para) return; // formula: keep focus, don't inject whitespace into LaTeX
    const ta = e.currentTarget;
    const value = ta.value;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const restore = (s: number, en: number) =>
      requestAnimationFrame(() => { try { ta.setSelectionRange(s, en); } catch { /* noop */ } });
    const outdent = (line: string): number =>
      line.startsWith("\t") ? 1 : line.startsWith("  ") ? 2 : line.startsWith(" ") ? 1 : 0;

    // Multi-line selection → indent/outdent every line it touches (never replace).
    if (value.slice(start, end).includes("\n")) {
      const from = value.lastIndexOf("\n", start - 1) + 1;
      const lines = value.slice(from, end).split("\n");
      let firstDelta = 0;
      let totalDelta = 0;
      const out = lines.map((line, i) => {
        // A selection ending on a line boundary yields a trailing "" = the next
        // line; leave it untouched.
        if (i === lines.length - 1 && line === "") return line;
        const delta = e.shiftKey ? -outdent(line) : 1;
        if (i === 0) firstDelta = delta;
        totalDelta += delta;
        return e.shiftKey ? line.slice(-delta) : "\t" + line;
      });
      if (totalDelta === 0) return; // nothing to outdent
      const next = value.slice(0, from) + out.join("\n") + value.slice(end);
      onChange(next, end + totalDelta);
      restore(Math.max(from, start + firstDelta), end + totalDelta);
      return;
    }

    // Single line: outdent the line, or insert a tab at the caret.
    if (e.shiftKey) {
      const from = value.lastIndexOf("\n", start - 1) + 1;
      const drop = outdent(value.slice(from));
      if (!drop) return;
      const pos = Math.max(from, start - drop);
      onChange(value.slice(0, from) + value.slice(from + drop), pos);
      restore(pos, pos);
      return;
    }
    const pos = start + 1;
    onChange(value.slice(0, start) + "\t" + value.slice(end), pos);
    restore(pos, pos);
  }

  return (
    <div ref={boxRef} onBlur={onFocusOut} className="rounded-md border border-accent/40 bg-surface p-2">
      {para && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">Box:</span>
          <button onClick={() => onColor(null)} className={`rounded border px-2 py-0.5 text-xs ${color ? "border-border text-muted" : "border-accent text-accent"}`}>None</button>
          {CALLOUT_COLORS.map((c) => (
            <button key={c} onClick={() => onColor(c)} title={c} className="h-6 w-6 rounded" style={{ background: c, outline: color === c ? "2px solid var(--foreground)" : "1px solid rgba(0,0,0,.12)", outlineOffset: "1px" }} />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <input type="color" value={color ?? "#fef3c7"} onChange={(e) => onColor(e.target.value)} title="Custom color (wheel)" className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5" />
          <input type="text" value={hexDraft} onChange={(e) => { const v = e.target.value; setHexDraft(v); if (isHexColor(v)) onColor(v); }} placeholder="#RRGGBB" spellCheck={false} className="w-24 rounded border border-border bg-background px-2 py-0.5 font-mono text-xs outline-none focus:border-accent" />
        </div>
      )}
      <textarea ref={taRef} value={draft} spellCheck={para} onKeyDown={onKeyDown} onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? 0)} rows={para ? Math.max(2, draft.split("\n").length) : 2} placeholder={para ? "Type text… **bold**, *italic*, toolbar for formulas" : "LaTeX, e.g. \\frac{a}{b}"} className="w-full resize-none bg-transparent font-mono text-sm outline-none" />
      <div className="mt-2 border-t border-border pt-2">
        {draft.trim() ? <BlockView block={previewBlock} /> : <span className="text-xs text-muted">preview</span>}
      </div>
    </div>
  );
}

function ToolButton({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return <button onClick={onClick} title={title} className={ICON_BTN}>{children}</button>;
}

/** Small axes-with-a-curve glyph for the "insert graph" toolbar button. */
function GraphIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 1.5 V13.5 H14.5" />
      <path d="M3 11 C6 11 6.5 4 9 4 C11 4 12 8 14 8" stroke="var(--accent)" />
    </svg>
  );
}

// ─── List buttons (icon + style-dropdown) ────────────────────────────────────
const MARKER_GLYPH: Record<ListMarker, string> = {
  disc: "•", circle: "◦", square: "▪",
  decimal: "1.", "lower-alpha": "a.", "lower-roman": "i.",
};
const MARKER_NAME: Record<ListMarker, string> = {
  disc: "Disc", circle: "Circle", square: "Square",
  decimal: "Decimal", "lower-alpha": "Lower alpha", "lower-roman": "Lower roman",
};

function BulletedListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
      <circle cx="2.4" cy="4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="2.4" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="2.4" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <line x1="6" y1="4" x2="14.5" y2="4" />
      <line x1="6" y1="8" x2="14.5" y2="8" />
      <line x1="6" y1="12" x2="14.5" y2="12" />
    </svg>
  );
}

function NumberedListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
      <line x1="6" y1="4" x2="14.5" y2="4" />
      <line x1="6" y1="8" x2="14.5" y2="8" />
      <line x1="6" y1="12" x2="14.5" y2="12" />
      <text x="0" y="5.7" fontSize="5.6" fill="currentColor" stroke="none">1</text>
      <text x="0" y="9.9" fontSize="5.6" fill="currentColor" stroke="none">2</text>
      <text x="0" y="14.1" fontSize="5.6" fill="currentColor" stroke="none">3</text>
    </svg>
  );
}

function ListToolButton({ ordered, open, onToggle, onInsert }: {
  ordered: boolean;
  open: boolean;
  onToggle: () => void;
  onInsert: (marker?: ListMarker) => void;
}) {
  const markers = ordered ? NUMBER_MARKERS : BULLET_MARKERS;
  return (
    <span className="relative inline-flex">
      <button onClick={() => onInsert()} title={ordered ? "Numbered list" : "Bulleted list"} className="relative z-30 grid h-9 w-9 place-items-center rounded-l-md border border-border hover:border-accent">
        {ordered ? <NumberedListIcon /> : <BulletedListIcon />}
      </button>
      <button onClick={onToggle} title="List style" aria-label="List style" className={`relative z-30 grid h-9 w-5 place-items-center rounded-r-md border border-l-0 text-[9px] hover:border-accent ${open ? "border-accent text-accent" : "border-border text-muted"}`}>▾</button>
      {open && (
        <>
          <button className="fixed inset-0 z-20 cursor-default" aria-hidden tabIndex={-1} onClick={onToggle} />
          <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-border bg-surface p-1 shadow-lg">
            {markers.map((m) => (
              <button key={m} onClick={() => onInsert(m)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-foreground/[0.06]">
                <span className="inline-grid w-6 place-items-center font-mono text-xs text-muted">{MARKER_GLYPH[m]}</span>
                {MARKER_NAME[m]}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// ─── Highlight button (H + color dropdown) ───────────────────────────────────
function HighlightButton({ color, open, onToggle, onApply, onColor, keepFocus, onColorMouseDown }: {
  color: string;
  open: boolean;
  onToggle: () => void;
  onApply: () => void;
  onColor: (c: string) => void;
  keepFocus: (e: MouseEvent) => void;
  onColorMouseDown: () => void;
}) {
  return (
    <span className="relative inline-flex">
      <button onMouseDown={keepFocus} onClick={onApply} title="Highlight selection" className={`${ICON_BTN} relative z-30 rounded-r-none`} style={{ background: color, color: "#1f2937" }}>H</button>
      <button onMouseDown={keepFocus} onClick={onToggle} title="Highlight color" aria-label="Highlight color" className={`relative z-30 grid h-9 w-5 place-items-center rounded-r-md border border-l-0 text-[9px] hover:border-accent ${open ? "border-accent text-accent" : "border-border text-muted"}`}>▾</button>
      {open && (
        <>
          <button className="fixed inset-0 z-20 cursor-default" aria-hidden tabIndex={-1} onClick={onToggle} />
          <div className="absolute left-0 top-full z-30 mt-1 rounded-md border border-border bg-surface p-2 shadow-lg">
            <div className="grid grid-cols-4 gap-1">
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} onMouseDown={keepFocus} onClick={() => { onColor(c); onToggle(); }} title={c} className="h-6 w-6 rounded" style={{ background: c, outline: color.toLowerCase() === c ? "2px solid var(--foreground)" : "1px solid rgba(0,0,0,.12)", outlineOffset: "1px" }} />
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              Custom
              {/* sticky-only (no preventDefault) so the native color picker still opens while editing */}
              <input type="color" value={color} onMouseDown={onColorMouseDown} onChange={(e) => onColor(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5" />
            </label>
          </div>
        </>
      )}
    </span>
  );
}
