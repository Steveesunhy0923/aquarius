"use client";

import { BlockView } from "@/components/BlockView";
import { DocStyleBar } from "@/components/DocStyleBar";
import { EditBox, type EditBoxHandle } from "@/components/EditBox";
import { EditorSidebar } from "@/components/EditorSidebar";
import { uiPrompt } from "@/components/ui/dialogs";
import { ExportMenu } from "@/components/ExportMenu";
import { FigureBox } from "@/components/FigureBox";
import { FigureControls } from "@/components/FigureControls";
import { FormulaEditBox, StructuralFormulaBox } from "@/components/FormulaEditBox";
import { GraphEditor } from "@/components/GraphEditor";
import { ImageRowEditor } from "@/components/ImageRowEditor";
import { InkInsertPanel } from "@/components/ink/InkInsertPanel";
import { SymbolPicker } from "@/components/SymbolPicker";
import { SymbolToolbar } from "@/components/SymbolToolbar";
import { Icon } from "@/components/Icon";
import { TablePicker } from "@/components/TablePicker";
import { TableRowEditor } from "@/components/TableRowEditor";
import {
  HEAD_BTN,
  HEAD_BTN_BASE,
  HEAD_BTN_HOVER,
  HighlightButton,
  ICON_BTN,
  ListToolButton,
  ToolButton,
} from "@/components/ToolbarControls";
import { DesignPicker } from "@/components/DesignPicker";
import { ShareDialog } from "@/components/ShareDialog";
import { activeMathField, activeTextInserter } from "@/components/MathField";
import { activeMathEdit } from "@/components/MathEdit";
import { isStructural, structuralEquation } from "@/lib/matheditor";
import { PresenceAvatars } from "@/components/PresenceAvatars";
import { TemplateApplyDialog } from "@/components/TemplateApplyDialog";
import { getMyAccess, listCollaborators, markSharedNoteOpened, type Access } from "@/lib/sharing/sharing";
import { useCollab, type PeerInfo } from "@/lib/collab";
import { getSettings, setSettings } from "@/lib/settings/settings";
import { freshTree, saveTemplate, type BuiltInBackground, type SavedTemplate } from "@/lib/templates/templates";
import { freshBlocks, listSavedModules, recordModuleUse, saveModule, updateModule, type Module } from "@/lib/templates/modules";
import { ModuleEditorDialog } from "@/components/ModuleEditorDialog";
import { NoteLinkPicker, type NoteLinkPick } from "@/components/NoteLinkPicker";
import { makeNoteHref, NOTE_LINK_EVENT, type NoteLinkTarget } from "@/lib/blocks/notelink";
import { useAuth } from "@/lib/auth/AuthProvider";
import { documentToLatex } from "@/lib/blocks";
import { emptyDocument } from "@/lib/blocks/types";
import { calloutColorOf, withCalloutColor } from "@/lib/blocks/callouts";
import { isEmptyBlock, isEmptyDoc } from "@/lib/blocks/empty";
import {
  computeOutline,
  hiddenBlockIds,
  isHeadingCollapsed,
  reorderSectionBlocks,
  sectionRange,
  type OutlineItem,
} from "@/lib/blocks/outline";
import { paginate } from "@/lib/editor/pagination";
import { moveRowItemAcross, reorderRowItem, type RowItems } from "@/lib/editor/rowItems";
import type { DocHandle } from "@/lib/editor/types";
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
} from "@/lib/blocks/source";
import { graphModel, makeGraphBlock, withGraph, type GraphData } from "@/lib/blocks/graph";
import { DEFAULT_HIGHLIGHT } from "@/lib/blocks/format";
import { A4_W, A4_H, fontFamilyOf } from "@/lib/blocks/docstyle";
import { listItems, listOrdered, makeList, withList, type ListMarker } from "@/lib/blocks/lists";
import {
  demoRows,
  makeTableBlock,
  tableAlign,
  tableItems,
  withTables,
  type TableData,
  type TableStyle,
} from "@/lib/blocks/tables";
import type { Block, DocumentStyle, DocumentTree, Placement } from "@/lib/blocks/types";
import { getStore, isCloudActive } from "@/lib/storage";
import type { NotePackage } from "@/lib/storage/types";
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
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";

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

type Selected = { id: string; index: number; kind: "image" | "table" } | null;

// Item accessors for the generic figure-row reorder/move (lib/editor/rowItems).
const IMAGE_ROW: RowItems<ImageItem> = { items: imageItems, withItems: withImages };
const TABLE_ROW: RowItems<TableData> = { items: tableItems, withItems: withTables };

function DocumentEditor({ id, primary, split, onActivate, onClose, onHeadings, onSaved, handleRef }: DocProps) {
  const { loading: authLoading, user } = useAuth();
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

  const [symbolsOpen, setSymbolsOpen] = useState(false); // the "browse all symbols" picker
  const [tablePicker, setTablePicker] = useState(false);
  const [inkOpen, setInkOpen] = useState(false); // handwriting → LaTeX bottom sheet
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState<DocumentTree | null>(null);
  const [moduleEdit, setModuleEdit] = useState<Module | null>(null); // module builder via the / menu's pencil
  // Note-link picker: the [from,to) draft range the picked link will replace,
  // what that range contained at open time (so a stale range never splices
  // blind), and an optional user-selected label (toolbar path).
  const [linkPicker, setLinkPicker] = useState<{ from: number; to: number; expect: string; label?: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Current user's access to this note: "owner" (incl. local/guest), an editor
  // role, or a read-only role. Drives the Share dialog and read-only mode.
  const [access, setAccess] = useState<Access>("owner");
  const readOnly = access === "viewer" || access === "commenter";
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // The signed-in user has NO access to this cloud note (never shared, or the
  // owner un-shared/deleted it). Renders a dead-end screen instead of a blank
  // phantom document whose saves would silently fail against RLS.
  const [gone, setGone] = useState(false);
  // Real-time co-editing is eligible only for a SHARED cloud note (a Role access
  // implies it's shared; an owner must actually have collaborators).
  const [shared, setShared] = useState(false);
  // A remote-originated tree is stored here by reference; the bridge effect that
  // pushes local edits into the Y.Doc skips a tree it recognizes as remote, so a
  // remote edit never loops back into the doc (and the initial projection from
  // the authoritative `ydoc` never clobbers it with a stale local tree).
  const lastRemoteTreeRef = useRef<DocumentTree | null>(null);
  const applyRemoteTree = useCallback((tree: DocumentTree) => {
    lastRemoteTreeRef.current = tree;
    // Update content WITHOUT marking the editor dirty (autosave stays gated on
    // `saved`, so only the client that actually edited persists) and WITHOUT
    // pushing an undo snapshot (you only undo your own actions).
    setPkg((prev) => (prev ? { ...prev, tree } : prev));
  }, []);
  const collab = useCollab({ noteId: id, access, enabled: shared, pkg, applyRemoteTree });
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
  const editBoxRef = useRef<EditBoxHandle>(null); // open the inline-math box editor from the toolbar
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
  const jumpedRef = useRef(false); // guards the one-shot ?block=<id> scroll (note links)

  useEffect(() => {
    if (primary && typeof window !== "undefined")
      createdNew.current = new URLSearchParams(window.location.search).get("new") === "1";
  }, [primary]);
  useEffect(() => {
    pkgRef.current = pkg;
  }, [pkg]);
  // Autosave: debounce a write ~800ms after the last change to the note/title.
  // `saved` starts true (a freshly-loaded note is clean), so this never fires on
  // load — only after a real edit flips it dirty.
  useEffect(() => {
    if (saved) return;
    const t = setTimeout(() => { void saveFnRef.current(); }, 800);
    return () => clearTimeout(t);
  }, [pkg, title, saved]);
  // Bridge LOCAL edits into the Y.Doc when collab is active. Every editor mutator
  // funnels into a NEW `pkg.tree` object, while a remote-applied tree is the exact
  // object stored in `lastRemoteTreeRef` — so identity-comparing cleanly skips
  // remote-originated changes (no feedback loop), regardless of render timing.
  useEffect(() => {
    if (!collab.active || !pkg) return;
    if (pkg.tree === lastRemoteTreeRef.current) return; // came from a remote apply
    collab.pushLocalTree(pkg.tree);
    // `pushLocalTree` is stable (useCallback); `collab.active` is a boolean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg, collab.active, collab.pushLocalTree]);
  // Announce which block we're editing so peers can flag our "typing line".
  useEffect(() => {
    if (collab.active) collab.setEditing(editingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, collab.active, collab.setEditing]);
  // Map of blockId → peers (excluding self) currently editing that block.
  const selfId = user?.id ?? null;
  const remoteEditing = useMemo(() => {
    const m = new Map<string, PeerInfo[]>();
    for (const p of collab.peers) {
      if (p.userId === selfId || !p.editingId) continue;
      const arr = m.get(p.editingId);
      if (arr) arr.push(p); else m.set(p.editingId, [p]);
    }
    return m;
  }, [collab.peers, selfId]);
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
  // Determine the current user's access (owner / role) for this note. Local and
  // guest notes are always "owner"; cloud notes ask the sharing layer.
  useEffect(() => {
    if (authLoading) return;
    if (!isCloudActive()) { setAccess("owner"); return; }
    let alive = true;
    getMyAccess(id)
      .then((a) => {
        if (!alive) return;
        if (a === null) setGone(true); // cloud note we can't see: gone or never ours
        else setAccess(a);
      })
      .catch(() => { if (alive) setAccess("owner"); });
    return () => { alive = false; };
  }, [id, authLoading]);
  // Is this note shared? A collaborator role implies yes; an owner must have at
  // least one collaborator. Drives whether the live co-editing channel opens.
  useEffect(() => {
    if (authLoading) return;
    if (!isCloudActive()) { setShared(false); return; }
    if (access === "viewer" || access === "commenter" || access === "editor") {
      setShared(true);
      // First open of a note shared with me: move it out of the "Shared with
      // me" inbox into the library's Uncategorized section.
      void markSharedNoteOpened(id);
      return;
    }
    let alive = true;
    listCollaborators(id)
      .then((c) => { if (alive) setShared(c.length > 0); })
      .catch(() => { if (alive) setShared(false); });
    return () => { alive = false; };
  }, [id, authLoading, access]);
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
  // Arrived via a note link with a section target (?block=<id>): scroll to it
  // once the document has loaded and rendered. The one-shot flag is consumed
  // INSIDE the timeout so a pkg update in the first 500ms (collab initial
  // sync) re-arms the timer instead of eating the scroll.
  useEffect(() => {
    if (!primary || !pkg || jumpedRef.current) return;
    if (typeof window === "undefined") return;
    const b = new URLSearchParams(window.location.search).get("block");
    if (!b) return;
    const t = setTimeout(() => {
      jumpedRef.current = true;
      scrollToBlock(b);
    }, 500);
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
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current) return; // viewer/commenter: no edits persist
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
    const el = blockEls.current.get(blockId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Not rendered — a note link can target a heading hidden inside a collapsed
    // ancestor section: expand the ancestors, then scroll on the next frame.
    const bs = pkgRef.current?.tree.blocks ?? [];
    if (!hiddenBlockIds(bs).has(blockId)) return; // truly gone — nothing to do
    setBlocks((list) => {
      const at = list.findIndex((b) => b.id === blockId);
      if (at < 0) return list;
      return list.map((b) => {
        if (b.type !== "heading" || !b.attrs?.collapsed) return b;
        const range = sectionRange(list, b.id);
        if (!range || at <= range[0] || at >= range[1]) return b;
        const attrs = { ...b.attrs };
        delete attrs.collapsed;
        return { ...b, attrs };
      });
    });
    setTimeout(() => blockEls.current.get(blockId)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  }
  /** Scroll the page surface back to the top (whole-note link to this pane). */
  function scrollToTop() {
    rootRef.current?.querySelector(".print-surface")?.scrollTo({ top: 0, behavior: "smooth" });
  }
  // The ink sheet covers the lower ~half of the pane; when it opens, bring the
  // block being edited (the insertion target) back into the visible half. The
  // scroll container gains matching bottom padding while the sheet is open.
  useEffect(() => {
    if (!inkOpen) return;
    const target = editingId ?? selected?.id;
    if (target) setTimeout(() => scrollToBlock(target), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inkOpen]);
  function toggleSection(blockId: string) {
    updateById(blockId, (b) => ({ ...b, attrs: { ...b.attrs, collapsed: !b.attrs?.collapsed } }));
  }
  function reorderSections(fromId: string, toId: string | null) {
    setBlocks((bs) => reorderSectionBlocks(bs, fromId, toId));
  }
  useImperativeHandle(handleRef, () => ({ scrollToBlock, scrollToTop, toggleSection, reorderSections, saveSectionAsModule: (hid: string) => void saveSectionAsModule(hid) }), [handleRef]);
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
    if (readOnlyRef.current) return;
    sticky.current = false; // never let a leftover one-shot absorb this session's first blur
    setSelected(null);
    setEditingId(block.id);
    setEditingPara(isParagraph(block));
    setDraft(blockEditSource(block));
    setColor(calloutColorOf(block));
  }
  function startEditHeading(block: Block) {
    if (readOnlyRef.current) return;
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
  /** Slash-insert: rebuild the edited paragraph without its `/query` and splice
   *  the module's blocks in right after it — ONE tree update, one undo step.
   *  A paragraph that existed only to host the slash is dropped entirely. */
  function insertModule(m: Module, cleanedDraft: string) {
    if (readOnlyRef.current) return;
    const anchor = editingId;
    const fresh = freshBlocks(m.blocks);
    if (fresh.length === 0) return;
    setBlocks((bs) => {
      const i = anchor ? bs.findIndex((b) => b.id === anchor) : -1;
      if (i < 0 || !anchor) return [...bs, ...fresh];
      const cleaned = withCalloutColor(paragraphFromSource(cleanedDraft, anchor), color);
      const next = [...bs];
      if (isEmptyBlock(cleaned)) next.splice(i, 1, ...fresh);
      else {
        next[i] = cleaned;
        next.splice(i + 1, 0, ...fresh);
      }
      return next;
    });
    recordModuleUse(m.id);
    setEditingId(null);
    setSelected(null);
    setTimeout(() => scrollToBlock(fresh[0].id), 60);
  }

  /** Pencil in the `/` menu: commit the draft without its `/query` (dropping
   *  the paragraph if that leaves it empty — same contract as insertModule),
   *  end the edit, and open the builder on the FRESH stored copy so a stale
   *  menu snapshot can't clobber a newer version of the module. */
  function editModule(m: Module, cleanedDraft: string) {
    if (readOnlyRef.current) return;
    const anchor = editingId;
    if (anchor) {
      setBlocks((bs) => {
        const i = bs.findIndex((b) => b.id === anchor);
        if (i < 0) return bs;
        const cleaned = withCalloutColor(paragraphFromSource(cleanedDraft, anchor), color);
        const next = [...bs];
        if (isEmptyBlock(cleaned)) next.splice(i, 1);
        else next[i] = cleaned;
        return next;
      });
      setEditingId(null);
      setSelected(null);
    }
    setModuleEdit(listSavedModules().find((x) => x.id === m.id) ?? m);
  }

  /** "Save section as module" (outline hover action): capture the heading's
   *  whole section (`sectionRange`) as a reusable, personal module. */
  async function saveSectionAsModule(headingId: string) {
    const bs = pkgRef.current?.tree.blocks ?? [];
    const range = sectionRange(bs, headingId);
    if (!range) return;
    const section = bs.slice(range[0], range[1]);
    const name = (
      await uiPrompt({
        title: "Save section as module",
        message: "Modules are reusable sections — type / while writing to insert one.",
        placeholder: "Module name",
        initial: bs[range[0]].value?.trim() || "Untitled section",
        confirmLabel: "Save",
      })
    )?.trim();
    if (!name) return;
    saveModule(name, section, new Date().toISOString());
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
    if (readOnlyRef.current) return;
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
  function onInsert(latex: string) {
    // A focused structural editor (beta) wins — insert the real block structure.
    const me = activeMathEdit();
    if (me) { me.insert(latex); return; }
    // A focused MathField (standalone equation OR an open inline-math popover)
    // wins: insert the snippet structurally. Empty `{}` groups become `#?`
    // placeholder boxes so e.g. \frac{}{} is tabbable — the Desmos feel.
    const field = activeMathField();
    if (field) {
      const snippet = latex.replace(/\{\}/g, "{#?}");
      field.insert(snippet);
      // ∫/∑/∏ etc.: MathLive selects the UPPER bound first. Nudge to the LOWER
      // bound so it's the first field you fill. (Tab/Shift+Tab switch bounds;
      // MathLive's arrow keys don't reliably move between sub/superscript.)
      if (/_\{#\?\}/.test(snippet) && /\^\{#\?\}/.test(snippet)) field.command("moveToNextPlaceholder");
      return;
    }
    // A focused plain textbox (e.g. a table cell) → splice the raw LaTeX there.
    const textInsert = activeTextInserter();
    if (textInsert) { textInsert(latex); return; }
    // Editing prose: open the inline-math BOX editor seeded with the structure
    // (empty `{}` → visible \placeholder{} boxes) instead of splicing raw LaTeX.
    if (editingId && editingPara) {
      editBoxRef.current?.openMath(latex.replace(/\{\}/g, "{\\placeholder{}}"));
      return;
    }
    // Not editing: open a new equation (structural when the beta is on).
    addBlock(getSettings().mathEditorBeta ? structuralEquation(latex) : displayFromSource(latex));
  }
  /** Replace [from, to) of the editing textarea with `insert`, commit, and
   *  restore focus with the caret after the insertion. */
  function spliceIntoTextarea(from: number, to: number, insert: string) {
    const t = taRef.current;
    if (!t) return;
    const cur = t.value;
    const next = cur.slice(0, from) + insert + cur.slice(to);
    const pos = from + insert.length;
    setDraft(next);
    caretRef.current = pos;
    commit(next, color);
    requestAnimationFrame(() => {
      const x = taRef.current;
      if (x) { x.focus(); try { x.setSelectionRange(pos, pos); } catch { /* noop */ } }
    });
  }
  function wrapSelection(prefix: string, suffix: string = prefix) {
    if (!editingId || !editingPara) return;
    const t = taRef.current;
    if (!t) return;
    const s = t.selectionStart ?? 0;
    const e = t.selectionEnd ?? s;
    const sel = t.value.slice(s, e) || "text";
    spliceIntoTextarea(s, e, prefix + sel + suffix);
  }
  async function insertLink() {
    if (!editingId || !editingPara) return;
    const t = taRef.current;
    if (!t) return;
    const s = t.selectionStart ?? 0;
    const e = t.selectionEnd ?? s;
    const sel = t.value.slice(s, e) || "link";
    // The dialog steals focus once; the toolbar mousedown already armed the
    // one-shot `sticky` so the edit box stays open across it.
    const url = (await uiPrompt({ title: "Insert link", placeholder: "https://…", initial: "https://", confirmLabel: "Insert" }))?.trim();
    if (!url) return;
    spliceIntoTextarea(s, e, `[${sel}](${url})`);
  }

  // ── note links ([[ or the toolbar button → picker → [title](note://…)) ─────
  /** Open the picker to replace the "[[" trigger range. Arms the one-shot
   *  `sticky` so the picker's focus-steal doesn't exit the edit box. */
  function openNoteLinkPicker(from: number, to: number) {
    if (readOnlyRef.current) return;
    sticky.current = true;
    setLinkPicker({ from, to, expect: "[[" });
  }
  function toolbarNoteLink() {
    if (!editingId || !editingPara) return;
    const t = taRef.current;
    if (!t) return;
    const s = t.selectionStart ?? 0;
    const e = t.selectionEnd ?? s;
    const sel = t.value.slice(s, e);
    sticky.current = true;
    // A selection becomes the link's label (mirrors Insert link's behavior).
    setLinkPicker({ from: s, to: e, expect: sel, label: sel.trim() || undefined });
  }
  function insertNoteLink(pick: NoteLinkPick) {
    const range = linkPicker;
    setLinkPicker(null);
    const ta = taRef.current;
    if (!range || !ta) return;
    // Square brackets and inline-math delimiters would break the [text](url)
    // marker — strip them from whichever label we use.
    const label =
      (range.label ?? `${pick.title}${pick.section ? ` › ${pick.section}` : ""}`)
        .replace(/\\[()]/g, "")
        .replace(/[[\]]/g, "")
        .trim() || "note";
    const marker = `[${label}](${makeNoteHref(pick.noteId, pick.blockId)})`;
    // The range was captured at open time — only splice if it still matches;
    // otherwise fall back to the caret rather than cutting arbitrary text.
    if (ta.value.slice(range.from, range.to) === range.expect) {
      spliceIntoTextarea(range.from, range.to, marker);
    } else {
      const at = ta.selectionStart ?? ta.value.length;
      spliceIntoTextarea(at, at, marker);
    }
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
    addBlock(getSettings().mathEditorBeta ? structuralEquation() : displayFromSource(""));
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
    if (!file || readOnlyRef.current) return;
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
    updateById(blockId, (b) => reorderRowItem(IMAGE_ROW, b, from, to));
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
    const block = makeTableBlock(style, demoRows());
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
    updateById(blockId, (b) => reorderRowItem(TABLE_ROW, b, from, to));
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
    const res = moveRowItemAcross(IMAGE_ROW, pkgRef.current?.tree.blocks ?? [], fromId, fromIndex, toId, toIndex);
    if (!res) return;
    setBlocks(res.update);
    setSelected({ id: toId, index: res.at, kind: "image" });
  }
  function moveTableItem(fromId: string, fromIndex: number, toId: string, toIndex: number) {
    if (fromId === toId) {
      reorderTable(fromId, fromIndex, toIndex);
      return;
    }
    const res = moveRowItemAcross(TABLE_ROW, pkgRef.current?.tree.blocks ?? [], fromId, fromIndex, toId, toIndex);
    if (!res) return;
    setBlocks(res.update);
    setSelected({ id: toId, index: res.at, kind: "table" });
  }

  function moveSelected(dir: number) {
    if (!selected) return;
    const to = selected.index + dir;
    if (selected.kind === "image") reorderImage(selected.id, selected.index, to);
    else reorderTable(selected.id, selected.index, to);
  }

  async function save() {
    if (readOnlyRef.current) return; // viewer/commenter: nothing to persist (RLS also blocks)
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
        // When collab is active, persist the authoritative Yjs snapshot (which
        // encodes ALL merged peers' edits) alongside the materialized read model;
        // otherwise preserve any existing snapshot. cloud.ts omits a null ydoc.
        const ydoc = collab.snapshot() ?? p.ydoc ?? null;
        await store.saveNote({ ...p, latexCache: documentToLatex(p.tree), ydoc });
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

  if (gone) {
    return (
      <div className="grid h-full place-items-center">
        <div className="text-center">
          <p className="text-sm text-muted">This note is no longer available — it may have been unshared or deleted.</p>
          <Link href="/" className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
            <Icon name="back" size={15} /> Back to Library
          </Link>
        </div>
      </div>
    );
  }
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
    if (editingId) { e.preventDefault(); sticky.current = true; return; }
    // Also hold focus for a focused MathField or a table-cell textbox (which
    // aren't tracked by `editingId`) so a toolbar/symbol click inserts into them.
    if (activeMathField() || activeTextInserter()) e.preventDefault();
  };

  // Print → "Save as PDF": show the WYSIWYG pages at 100% (so each A4 sheet maps
  // to one printed page) and open the browser print dialog. Print CSS hides the
  // editor chrome and forces true A4 sizing / page breaks.
  async function printPdf() {
    setShowSource(false);
    setEditingId(null);
    setSelected(null);
    setSymbolsOpen(false);
    setTablePicker(false);
    setInkOpen(false);
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
    <main ref={rootRef} className="relative flex h-full min-h-0 flex-col" onMouseDown={onActivate}>
      <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />

      <header className="print-hide flex items-center gap-3 border-b border-border px-4 py-3">
        {split && <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">{primary ? "A" : "B"}</span>}
        <input value={title} readOnly={readOnly} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} className="flex-1 bg-transparent text-lg font-semibold outline-none" />
        {!readOnly && (
          <div className="flex items-center">
            <button onMouseDown={(e) => e.preventDefault()} onClick={undo} disabled={undoStack.current.length === 0} title="Undo (⌘/Ctrl+Z)" aria-label="Undo" className={HEAD_BTN}><Icon name="undo" size={18} /></button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={redo} disabled={redoStack.current.length === 0} title="Redo (⌘/Ctrl+Shift+Z)" aria-label="Redo" className={HEAD_BTN}><Icon name="redo" size={18} /></button>
          </div>
        )}
        {!readOnly && <button onClick={() => setTemplatesOpen(true)} title="Design — templates, modules & backgrounds" aria-label="Design — templates, modules and backgrounds" className={HEAD_BTN}><Icon name="templates" size={18} /></button>}
        {collab.active && <PresenceAvatars peers={collab.peers} selfId={user?.id ?? null} connected={collab.connected} />}
        {isCloudActive() && <button onClick={() => setShareOpen(true)} title="Share this document" aria-label="Share" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"><Icon name="share" size={16} />Share</button>}
        <button onClick={() => setShowSource((s) => !s)} title={showSource ? "Back to the visual editor" : "Show the LaTeX source"} aria-label={showSource ? "Show visual editor" : "Show LaTeX source"} aria-pressed={showSource} className={`${HEAD_BTN_BASE} ${showSource ? "bg-accent-soft text-accent" : HEAD_BTN_HOVER}`}><Icon name="code" size={18} /></button>
        <ExportMenu noteId={id} title={title} beforeExport={save} onPdf={printPdf} label={<Icon name="export" size={18} />} className={HEAD_BTN} />
        {readOnly
          ? <span className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted"><Icon name="lock" size={15} />{access === "commenter" ? "Comment only" : "View only"}</span>
          : <button onClick={save} title={saving ? "Saving…" : saved ? "Saved — up to date" : "Unsaved changes — click to save now"} aria-label={saving ? "Saving" : saved ? "Saved" : "Save now"} className={`grid h-9 w-9 place-items-center rounded-md transition ${saving ? "animate-pulse text-accent" : saved ? `${HEAD_BTN_HOVER}` : "text-accent hover:bg-accent-soft"}`}><Icon name="save" size={18} /></button>}
        {onClose && <button onClick={onClose} title="Close this pane" aria-label="Close pane" className="grid h-9 w-9 place-items-center rounded-md text-muted transition hover:bg-red-500/10 hover:text-red-500"><Icon name="close" size={17} /></button>}
      </header>

      {/* Block tools — hidden in read-only (viewer/commenter) mode */}
      <div className={`print-hide flex-wrap items-center justify-center gap-2 border-b border-border px-6 py-2 ${readOnly ? "hidden" : "flex"}`}>
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
        <ToolButton onClick={() => addBlock(paragraphFromSource(""))} title="New paragraph (normal text)"><Icon name="paragraph" size={17} /></ToolButton>
        <ToolButton onClick={insertEquation} title="Insert centered equation ($$…$$)"><Icon name="displayeq" size={19} /></ToolButton>
        <ToolButton onClick={() => setGraphEdit({ id: null })} title="Insert interactive graph"><Icon name="graph" size={19} /></ToolButton>
        <span className="mx-1 h-7 w-px bg-border" />
        {/* Bold · Italic · Underline · Strike · Highlight */}
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("**")} title="Bold (**…**)" aria-label="Bold" className={ICON_BTN}><Icon name="bold" size={16} /></button>
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("*")} title="Italic (*…*)" aria-label="Italic" className={ICON_BTN}><Icon name="italic" size={16} /></button>
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("__")} title="Underline (__…__)" aria-label="Underline" className={ICON_BTN}><Icon name="underline" size={16} /></button>
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("~~")} title="Strikethrough (~~…~~)" aria-label="Strikethrough" className={ICON_BTN}><Icon name="strike" size={16} /></button>
        <HighlightButton color={hlColor} open={hlMenu} onToggle={() => setHlMenu((o) => !o)} onApply={() => wrapSelection(`==#${hlColor.replace("#", "")}:`, "==")} onColor={setHlColor} keepFocus={keepFocus} onColorMouseDown={() => { if (editingId) sticky.current = true; }} />
        <span className="mx-1 h-7 w-px bg-border" />
        {/* Picture · Table · Link */}
        <ToolButton onClick={newImageRow} title="Insert image"><Icon name="image" size={18} /></ToolButton>
        <ToolButton onClick={() => setTablePicker(true)} title="Insert table"><Icon name="table" size={18} /></ToolButton>
        <button onMouseDown={keepFocus} onClick={insertLink} title="Insert link" aria-label="Insert link" className={ICON_BTN}><Icon name="link" size={18} /></button>
        <button onMouseDown={keepFocus} onClick={toolbarNoteLink} title="Link to another note (or type [[ while writing)" aria-label="Link to another note" className={ICON_BTN}><Icon name="notelink" size={18} /></button>
        {/* keepFocus (like Insert link): opening the sheet while editing prose keeps the block editor
            alive, so Insert routes the recognized LaTeX into it as inline math. */}
        <button onMouseDown={keepFocus} onClick={() => setInkOpen((o) => !o)} title="Handwrite a formula (ink → LaTeX)" aria-label="Handwrite a formula" aria-pressed={inkOpen} className={`grid h-9 min-w-9 place-items-center rounded-md border px-2 text-sm ${inkOpen ? "border-accent bg-accent-soft text-accent" : "border-border hover:border-accent"}`}><Icon name="ink" size={18} /></button>
        <span className="mx-1 h-7 w-px bg-border" />
        {/* Unnumbered · Numbered list */}
        <ListToolButton ordered={false} open={listMenu === "bullet"} onToggle={() => setListMenu((m) => (m === "bullet" ? null : "bullet"))} onInsert={(marker) => insertList(false, marker)} />
        <ListToolButton ordered={true} open={listMenu === "number"} onToggle={() => setListMenu((m) => (m === "number" ? null : "number"))} onInsert={(marker) => insertList(true, marker)} />
      </div>

      {/* Functions & symbols */}
      <SymbolToolbar
        onInsert={onInsert}
        onBrowse={() => setSymbolsOpen(true)}
        keepFocus={keepFocus}
        markSticky={() => { if (editingId) sticky.current = true; }}
      />

      {/* Document settings */}
      {!showSource && (
        <DocStyleBar
          fontKey={fontKey}
          fontFamily={fontFamily}
          fontSize={fontSize}
          lineSpacing={lineSpacing}
          indent={indent}
          layout={layout}
          zoom={zoom}
          onStyle={setDocStyle}
          onZoom={setZoom}
        />
      )}

      {readOnly && (
        <div className="print-hide flex items-center justify-center gap-1.5 border-b border-border bg-amber-500/10 px-6 py-2 text-center text-sm text-amber-700 dark:text-amber-400">
          <Icon name="lock" size={14} /> You have {access === "commenter" ? "comment-only" : "view-only"} access to this shared document — your changes won’t be saved.
        </div>
      )}

      {/* Body */}
      {showSource ? (
        <div className="mx-auto w-full max-w-3xl flex-1 p-8">
          <p className="mb-2 text-xs text-muted">Generated LaTeX (read-only — derived from the block tree)</p>
          <textarea readOnly value={documentToLatex(pkg.tree)} className="h-[70vh] w-full rounded-lg border border-border bg-surface p-4 font-mono text-sm" />
        </div>
      ) : (
        <div className={`print-surface flex-1 overflow-auto p-8 ${inkOpen ? "pb-[52vh]" : ""}`} style={{ background: "var(--background)" }}>
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
                        if (!b) return null;
                        const editors = remoteEditing.get(id);
                        // Highlight a block a collaborator is editing (outline does
                        // not affect offsetHeight, so pagination is unaffected) and
                        // flag it with their name(s), Google-Docs style.
                        return (
                          <div
                            key={id}
                            ref={setBlockRef(id)}
                            className="relative"
                            style={editors ? { outline: `2px solid ${editors[0].color}`, outlineOffset: "3px", borderRadius: "3px" } : undefined}
                          >
                            {editors && (
                              <span className="print-hide pointer-events-none absolute -top-2.5 right-0 z-10 flex gap-1">
                                {editors.map((peer) => (
                                  <span key={peer.userId} className="rounded px-1.5 py-0.5 text-[10px] font-medium leading-none text-white shadow" style={{ backgroundColor: peer.color }}>{peer.username}</span>
                                ))}
                              </span>
                            )}
                            {renderBlock(b, gi)}
                          </div>
                        );
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

      {symbolsOpen && (
        <SymbolPicker
          title="Functions & symbols"
          onPick={onInsert}
          onClose={() => setSymbolsOpen(false)}
          closeOnPick={false}
          keepFocus={keepFocus}
          onNavMouseDown={() => { if (editingId) sticky.current = true; }}
          autoFocusSearch={!editingId}
        />
      )}
      {tablePicker && <TablePicker onPick={insertTable} onClose={() => setTablePicker(false)} />}
      {inkOpen && !readOnly && (
        <InkInsertPanel
          onInsert={onInsert}
          onClose={() => setInkOpen(false)}
          markSticky={() => { if (editingId) sticky.current = true; }}
          suspendEscape={symbolsOpen || tablePicker || templatesOpen || !!confirmTemplate || !!moduleEdit || shareOpen || !!graphEdit}
        />
      )}
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
      {shareOpen && <ShareDialog noteId={id} access={access} onClose={() => setShareOpen(false)} />}
      {linkPicker && (
        <NoteLinkPicker currentId={id} onPick={insertNoteLink} onClose={() => setLinkPicker(null)} />
      )}
      {moduleEdit && (
        <ModuleEditorDialog
          initial={{ name: moduleEdit.name, blocks: moduleEdit.blocks }}
          onSave={(name, blocks) => { updateModule(moduleEdit.id, name, blocks); setModuleEdit(null); }}
          onClose={() => setModuleEdit(null)}
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
        <div className="print-hide flex flex-col items-center gap-0.5 pt-1 text-faint opacity-0 transition group-hover:opacity-100">
          <button onClick={() => moveVisible(-1)} disabled={!canUp} title="Move up" aria-label="Move block up" className="grid place-items-center rounded hover:text-accent disabled:opacity-30"><Icon name="moveup" size={14} /></button>
          <span draggable onDragStart={() => (dragFrom.current = i)} title="Drag to reorder block" aria-label="Drag to reorder block" className="grid cursor-grab place-items-center select-none hover:text-accent active:cursor-grabbing"><Icon name="drag" size={14} /></span>
          <button onClick={() => moveVisible(1)} disabled={!canDown} title="Move down" aria-label="Move block down" className="grid place-items-center rounded hover:text-accent disabled:opacity-30"><Icon name="movedown" size={14} /></button>
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
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => toggleSection(b.id)} title={isHeadingCollapsed(b) ? "Expand section" : "Collapse section"} aria-label={isHeadingCollapsed(b) ? "Expand section" : "Collapse section"} aria-expanded={!isHeadingCollapsed(b)} className="print-hide grid shrink-0 place-items-center text-muted hover:text-accent"><Icon name="chevron" size={16} style={{ transform: isHeadingCollapsed(b) ? "rotate(-90deg)" : "none", transition: "transform .12s" }} /></button>
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
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => setListOrdered(b.id, true)} className={`flex items-center gap-1 rounded border px-2 py-0.5 ${listOrdered(b) ? "border-accent text-accent" : "border-border text-muted"}`}><Icon name="listnumber" size={14} />Numbered</button>
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => setListOrdered(b.id, false)} className={`flex items-center gap-1 rounded border px-2 py-0.5 ${!listOrdered(b) ? "border-accent text-accent" : "border-border text-muted"}`}><Icon name="list" size={14} />Bulleted</button>
                  <button onClick={() => endEdit(b.id)} className="ml-auto rounded border border-border px-2 py-0.5">Done</button>
                </div>
                <textarea value={listItems(b).join("\n")} autoFocus onChange={(e) => setListText(b.id, e.target.value)} placeholder="One item per line…" rows={Math.max(2, listItems(b).length)} className="w-full resize-none bg-transparent text-sm outline-none" />
                <div className="pointer-events-none mt-2 border-t border-border pt-2"><BlockView block={b} /></div>
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
            editingPara ? (
              <EditBox ref={editBoxRef} taRef={taRef} para={editingPara} draft={draft} color={color} previewBlock={withCalloutColor(paragraphFromSource(draft, b.id), color)} onChange={onDraftChange} onColor={pickColor} onExit={() => endEdit(b.id)} onInsertModule={insertModule} onEditModule={editModule} onNoteLink={openNoteLinkPicker} sticky={sticky} />
            ) : getSettings().mathEditorBeta && isStructural(b) ? (
              <StructuralFormulaBox block={b} onChange={(next) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? next : x)), true)} onExit={() => endEdit(b.id)} sticky={sticky} />
            ) : (
              <FormulaEditBox draft={draft} onChange={onDraftChange} onExit={() => endEdit(b.id)} sticky={sticky} />
            )
          ) : (
            <button onClick={() => startEdit(b)} className="w-full rounded-md px-2 py-1 text-left">
              {hasContent(b) ? <BlockView block={b} /> : <span className="text-muted">{isParagraph(b) ? "Empty paragraph" : "Empty formula"} — click to edit</span>}
            </button>
          )}
        </div>

        <button onClick={() => deleteBlock(b.id)} title="Delete block" aria-label="Delete block" className="mt-1 grid place-items-center px-1 text-faint opacity-0 transition hover:text-red-500 group-hover:opacity-100"><Icon name="trash" size={16} /></button>
      </div>
    );
  }

  // ── inline control panel under the selected image/table block ──────────────
  function renderControls(block: Block): ReactNode {
    if (!selected) return null;
    return (
      <FigureControls
        block={block}
        selected={selected}
        onImgWidth={imgWidth}
        onTblStyle={tblStyle}
        onTblAddRow={tblAddRow}
        onTblRemoveRow={tblRemoveRow}
        onTblAddCol={tblAddCol}
        onTblRemoveCol={tblRemoveCol}
        onAlign={rowAlign}
        onMove={moveSelected}
        onAdd={() => (selected.kind === "image" ? addImageToRow(block.id) : addTableToRow(block.id))}
        onDelete={() => (selected.kind === "image" ? deleteImage(block.id, selected.index) : deleteTable(block.id, selected.index))}
        onDone={() => setSelected(null)}
      />
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
  const paneBRef = useRef<HTMLDivElement | null>(null); // which pane a note-link click came from
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

  const split = secondId !== null;
  const active: "a" | "b" = split ? activeSlot : "a";
  const activeHandle = active === "a" ? handleA : handleB;
  const activeOutline = active === "a" ? outlineA : outlineB;

  return (
    <div className="print-flow flex h-screen flex-col">
      <div className="print-hide flex items-center gap-3 border-b border-border px-4 py-2">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted hover:text-accent"><Icon name="back" size={14} />Library</Link>
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
            <div ref={paneBRef} className={`min-w-0 flex-1 overflow-hidden ${active === "b" ? "print-flow" : "print-hide"} ${active === "b" ? "ring-1 ring-inset ring-accent/50" : ""}`}>
              <DocumentEditor key={secondId} id={secondId} primary={false} split onActivate={() => setActiveSlot("b")} onClose={closeSecond} onHeadings={onHeadingsB} onSaved={bumpNotes} handleRef={handleB} />
            </div>
          )}
        </div>
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
