"use client";

import { BlockView } from "@/components/BlockView";
import { DocumentInspector } from "@/components/DocumentInspector";
import { FormatPopover } from "@/components/FormatPopover";
import { InsertMenu, type InsertAction } from "@/components/InsertMenu";
import { BoxMenu, lastBoxColor, rememberBoxColor } from "@/components/BoxMenu";
import { ChemToolbar } from "@/components/ChemToolbar";
import { activeChemField } from "@/components/ChemField";
import { EditBox, type EditBoxHandle } from "@/components/EditBox";
import { EditorSidebar } from "@/components/EditorSidebar";
import { ListEditor } from "@/components/ListEditor";
import { lineHandleOf, type LineHandle } from "@/components/RichLine";
import { uiPrompt } from "@/components/ui/dialogs";
import { ExportMenu } from "@/components/ExportMenu";
import { FigureBox } from "@/components/FigureBox";
import { FigureControls } from "@/components/FigureControls";
import { ChemFormulaBox, FormulaEditBox, StructuralFormulaBox } from "@/components/FormulaEditBox";
import { GraphEditor } from "@/components/GraphEditor";
import { ImageRowEditor } from "@/components/ImageRowEditor";
import { InkInsertPanel } from "@/components/ink/InkInsertPanel";
import { SymbolPicker } from "@/components/SymbolPicker";
import { SymbolToolbar } from "@/components/SymbolToolbar";
import { SymbolTab } from "@/components/SymbolTab";
import { Icon } from "@/components/Icon";
import { TablePicker } from "@/components/TablePicker";
import { TableRowEditor } from "@/components/TableRowEditor";
import {
  GROUP,
  GROUP_BTN,
  HEAD_BTN,
  TEXT_BTN,
} from "@/components/ToolbarControls";
import { CodeBlockView } from "@/components/CodeBlockView";
import { makeCodeBlock } from "@/lib/blocks/codeblock";
import { releaseNoteKernels, retainNoteKernels } from "@/lib/run/manager";
import { DesignPicker } from "@/components/DesignPicker";
import { ShareDialog } from "@/components/ShareDialog";
import { activeFormulaOpener, activeMathField, activeTextInserter } from "@/components/MathField";
import { activeMathEdit } from "@/components/MathEdit";
import { isStructural, structuralEquation } from "@/lib/matheditor";
import { PresenceAvatars } from "@/components/PresenceAvatars";
import { TemplateApplyDialog } from "@/components/TemplateApplyDialog";
import { getMyAccess, listCollaborators, markSharedNoteOpened, type Access } from "@/lib/sharing/sharing";
import { shiftCaret, useCollab, type PeerInfo } from "@/lib/collab";
import { SYNC_APPLIED_EVENT } from "@/lib/sync";
import { resolveNoteAccess } from "@/lib/editor/access";
import { capabilitiesFor, lockReason, type NoteKind } from "@/lib/editor/capabilities";
import { PdfDocumentView } from "@/components/pdf/PdfDocumentView";
import type { Stroke as InkStroke } from "@/components/ink/strokes";
import { getSettings, setSettings } from "@/lib/settings/settings";
import { useAppSettings } from "@/lib/settings/useAppSettings";
import { freshTree, saveTemplate, type BuiltInBackground, type SavedTemplate } from "@/lib/templates/templates";
import { appendToModule, builtinModules, fillFields, freshBlocks, listSavedModules, moduleFields, recordModuleUse, replaceModuleBlocks, saveModule, updateModule, type Module } from "@/lib/templates/modules";
import { ModuleFileEditor } from "@/components/ModuleFileEditor";
import { SectionToModuleDialog } from "@/components/SectionToModuleDialog";
import { ModuleFieldsDialog } from "@/components/ModuleFieldsDialog";
import { NoteLinkPicker, type NoteLinkPick } from "@/components/NoteLinkPicker";
import { makeNoteHref, NOTE_LINK_EVENT, type NoteLinkTarget } from "@/lib/blocks/notelink";
import { useAuth } from "@/lib/auth/AuthProvider";
import { CommandPalette } from "@/components/CommandPalette";
import { blockToKatex, documentToLatex } from "@/lib/blocks";
import { latexToExpr } from "@/lib/blocks/latex-expr";
import { ceInner, isChemBlock, tagChem, wrapCe } from "@/lib/blocks/chem";
import { CHEM_SYMBOLS } from "@/lib/chemsymbols";
import { emptyDocument } from "@/lib/blocks/types";
import { calloutColorOf, withCalloutColor } from "@/lib/blocks/callouts";
import { boxCssVars, boxEdges, boxOf, boxRun, extendBoxRun, inSameBox, newBox, restyleBoxRun, withBox, type BoxStyle } from "@/lib/blocks/boxes";
import { isEmptyBlock, isEmptyDoc } from "@/lib/blocks/empty";
import {
  computeOutline,
  hiddenBlockIds,
  isHeadingCollapsed,
  reorderSectionBlocks,
  sectionRange,
  type OutlineItem,
} from "@/lib/blocks/outline";
import {
  addShortcut,
  documentShortcuts,
  mergeShortcuts,
  moveShortcut,
  removeShortcut,
  renameShortcut,
  resolveShortcut,
  shortcutsFromBlocks,
  type SectionShortcut,
} from "@/lib/blocks/shortcuts";
import { renderedOffsetAt, sourceOffsetFor, formulaPointAt, type FormulaPoint } from "@/lib/editor/caret";
import { paginate } from "@/lib/editor/pagination";
import { moveRowItemAcross, reorderRowItem, type RowItems } from "@/lib/editor/rowItems";
import type { DocHandle, EditorCommand } from "@/lib/editor/types";
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
  blocksFromSource,
  displayFromSource,
  displayMathSource,
  hasContent,
  isParagraph,
  paragraphFromSource,
  runsFromSource,
} from "@/lib/blocks/source";
import { fillEnvCells } from "@/lib/blocks/mathenv";
import { defaultGraph, fitViewToExpr, graphModel, makeGraphBlock, newGraphId, SHAPE_PALETTE, withGraph, type GraphData } from "@/lib/blocks/graph";
import { DEFAULT_HIGHLIGHT } from "@/lib/blocks/format";
import { A4_W, A4_H, pageContentStyle, presetClass, resolveStyle, unindentedParagraphs } from "@/lib/blocks/docstyle";
import { listItems, listLevels, listMarker, listOrdered, makeList, withList, type ListMarker } from "@/lib/blocks/lists";
import { paraIndent, withParaIndent } from "@/lib/blocks/indent";
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
import { HistoryPanel } from "@/components/HistoryPanel";
import { CollabCursors, type RemoteCursor } from "@/components/CollabCursors";
import { getStore, isCloudActive, isOwnLocalNote } from "@/lib/storage";
import type { NotePackage, NoteSnapshot } from "@/lib/storage/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  type KeyboardEvent as ReactKeyboardEvent,
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
  /** The note's design shortcuts, for the sidebar's jump list. */
  onShortcuts: (items: SectionShortcut[]) => void;
  /** Fired after a successful save so the page can refresh the recent-files list. */
  onSaved?: () => void;
  handleRef: MutableRefObject<DocHandle | null>;
}

type Selected = { id: string; index: number; kind: "image" | "table" } | null;

// Item accessors for the generic figure-row reorder/move (lib/editor/rowItems).
const IMAGE_ROW: RowItems<ImageItem> = { items: imageItems, withItems: withImages };
const TABLE_ROW: RowItems<TableData> = { items: tableItems, withItems: withTables };

// Which strip the symbol bar shows (math or chemistry) — persisted like the
// toolbar's editable slots: a global preference, last write wins across panes.
const BAR_MODE_KEY = "aquarius.symbolbar";
/** "Keep the symbol strip open even outside a formula" — a global preference. */
const SYMBOL_PIN_KEY = "aquarius.symbolpin";
/** Min gap between throttled auto version-history snapshots (4 min). */
const AUTO_VERSION_INTERVAL_MS = 4 * 60 * 1000;
/**
 * How many times in a row the block-height measurement may re-run because of its
 * own previous result before it stops (see the measuring layout effect). A
 * settling layout takes one or two passes — images and webfonts can add a
 * couple; a measure/paginate feedback loop never stops on its own.
 */
const MAX_REMEASURES = 8;
/** Press target for anything you type into (paragraph, heading, list, formula):
 *  the words themselves, with no rectangle behind them. A document does not
 *  highlight a line because the pointer crossed it — the affordance is the text
 *  cursor. Object blocks (image, table, graph, code) keep their own chrome. */
const TEXT_HIT = "w-full cursor-text text-left";

function DocumentEditor({ id, primary, split, onActivate, onClose, onHeadings, onShortcuts, onSaved, handleRef }: DocProps) {
  const { loading: authLoading, user } = useAuth();
  const [pkg, setPkg] = useState<NotePackage | null>(null);
  const [title, setTitle] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPara, setEditingPara] = useState(false);
  // The edited formula is chemistry: `draft` is then the mhchem source (the
  // inside of \ce{...}) edited in ChemFormulaBox, wrapped back on commit.
  const [editingChem, setEditingChem] = useState(false);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);

  const [symbolsOpen, setSymbolsOpen] = useState(false); // the "browse all symbols" picker
  const [chemOpen, setChemOpen] = useState(false); // the "browse all chemistry" picker
  // Which strip the symbol bar shows — math (default) or its chemistry mirror.
  // A lightweight global preference like the toolbar slots (localStorage-backed).
  const [barMode, setBarModeState] = useState<"math" | "chem">(() =>
    typeof window !== "undefined" && localStorage.getItem(BAR_MODE_KEY) === "chem" ? "chem" : "math",
  );
  function setBarMode(m: "math" | "chem") {
    setBarModeState(m);
    if (typeof window !== "undefined") try { localStorage.setItem(BAR_MODE_KEY, m); } catch { /* noop */ }
  }
  const [tablePicker, setTablePicker] = useState(false);
  const [inkOpen, setInkOpen] = useState(false); // handwriting → LaTeX bottom sheet
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState<DocumentTree | null>(null);
  const [moduleEdit, setModuleEdit] = useState<Module | null>(null); // module builder via the / menu's pencil
  // A captured section on its way into a module (new, or added to / replacing one).
  const [sectionSave, setSectionSave] = useState<{ blocks: Block[]; name: string } | null>(null);
  // Note-link picker: the [from,to) draft range the picked link will replace,
  // what that range contained at open time (so a stale range never splices
  // blind), and an optional user-selected label (toolbar path).
  const [linkPicker, setLinkPicker] = useState<{ from: number; to: number; expect: string; label?: string } | null>(null);
  // "Fill in the fields" prompt for a module/template with {{field}} tokens:
  // holds the pending insertion, run via `proceed` once values are gathered.
  const [fieldsPrompt, setFieldsPrompt] = useState<{ name: string; fields: string[]; proceed: (values: Record<string, string>) => void } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false); // version-history timeline
  // Current user's access to this note: "owner" (incl. local/guest), an editor
  // role, or a read-only role. Drives the Share dialog and read-only mode.
  const [access, setAccess] = useState<Access>("owner");
  // What the note IS, which locks editing independently of who you are: an
  // imported PDF may be annotated but not restructured. Read fail-closed from
  // BOTH the tree and the asset list — `tree.source` travels through the collab
  // layer, but if a future change ever drops it again, the attached pdf asset
  // still says what this note is, and the lock holds.
  const kind: NoteKind =
    pkg?.tree.source?.kind === "pdf" || pkg?.assets.some((a) => a.kind === "pdf") ? "pdf" : "document";
  const caps = useMemo(() => capabilitiesFor({ access, kind }), [access, kind]);
  const capsRef = useRef(caps);
  capsRef.current = caps;
  const locked = lockReason({ access, kind });
  /** Shorthand for "the block tree is not editable" — the common render gate. */
  const readOnly = !caps.editBlocks;
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
  // Mirrors of the open edit session, read by applyRemoteTree (which is a stable
  // callback and would otherwise close over the first render's values).
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;
  const editingChemRef = useRef(false);
  editingChemRef.current = editingChem;
  const draftRef = useRef("");
  draftRef.current = draft;
  // Set when a peer's edit rewrote the open draft: where to put our caret once
  // the controlled <textarea> has re-rendered (see the layout effect below).
  const remoteCaretRef = useRef<number | null>(null);
  const applyRemoteTree = useCallback((tree: DocumentTree) => {
    lastRemoteTreeRef.current = tree;
    // Update content WITHOUT marking the editor dirty (autosave stays gated on
    // `saved`, so only the client that actually edited persists) and WITHOUT
    // pushing an undo snapshot (you only undo your own actions).
    setPkg((prev) => (prev ? { ...prev, tree } : prev));

    // A peer typed in the block WE have open. The draft is separate state, so
    // without this we'd neither see their characters nor keep them: our next
    // keystroke would commit the stale draft and splice their text back out.
    const openId = editingIdRef.current;
    if (!openId) return;
    const block = tree.blocks.find((b) => b.id === openId);
    if (!block) return;
    const source = blockEditSource(block);
    const next = editingChemRef.current ? (ceInner(source) ?? "") : source;
    const cur = draftRef.current;
    if (next === cur) return;
    remoteCaretRef.current = shiftCaret(cur, next, taRef.current?.selectionStart ?? caretRef.current);
    draftRef.current = next;
    setDraft(next);
  }, []);
  const collab = useCollab({ noteId: id, access, enabled: shared, pkg, applyRemoteTree });
  // null = closed; { id: null } = drawing a new graph; { id } = editing an existing one.
  const [graphEdit, setGraphEdit] = useState<{ id: string | null } | null>(null);
  const [hlMenu, setHlMenu] = useState(false);
  const [zoom, setZoom] = useState(1); // page size ratio
  // Section folding is opt-in (Settings → Fold sections). Off, no heading gets a
  // fold arrow and a section folded earlier shows in full.
  const { sectionFolding } = useAppSettings();
  // Document settings panel (typeface, leading, indent, zoom, page flow). Open
  // by default on a full-width pane; a split pane is too narrow to give 240px
  // away before the user has asked for it.
  const [inspectorOpen, setInspectorOpen] = useState(!split);
  // Keep the symbol tab open without a formula (the top bar's Σ button, ⌘/).
  // It otherwise opens beside a formula holding the caret — see `symbolTabOpen`.
  const [symbolsPinned, setSymbolsPinned] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem(SYMBOL_PIN_KEY) === "1",
  );
  function toggleSymbolPin() {
    setSymbolsPinned((v) => {
      const next = !v;
      if (typeof window !== "undefined") try { localStorage.setItem(SYMBOL_PIN_KEY, next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  }
  /** The top-bar Σ button: opens the symbol tab without a formula (and keeps
   *  it open), or puts it away again. */
  const symbolsBtnRef = useRef<HTMLButtonElement>(null);
  // The tab closed by hand while this formula is open stays shut until the
  // caret moves to another block or formula, or the top-bar button opens it.
  const [tabDismissed, setTabDismissed] = useState(false);
  function toggleSymbolTab() {
    setTabDismissed(false);
    toggleSymbolPin();
  }
  function closeSymbolTab() {
    if (symbolsPinned) toggleSymbolPin();
    setTabDismissed(true);
  }
  // A non-empty selection inside the prose textarea raises the format popover.
  const [hasSelection, setHasSelection] = useState(false);
  // Pane too narrow to give the inspector its own column (see DocumentInspector).
  const [paneNarrow, setPaneNarrow] = useState(false);
  // Which inline formula editor is open inside the paragraph being edited, if
  // any. A paragraph is a `text` block, so block type alone cannot tell us the
  // caret is in a formula — EditBox reports it.
  const [inlineEditor, setInlineEditor] = useState<"math" | "chem" | null>(null);
  // Opening an inline editor swaps the strip to that editor's symbol set for the
  // duration. setBarModeState (not setBarMode) on purpose: this is a transient
  // follow-the-caret change and must not overwrite the stored preference. The
  // Σ/⚗ switch still works afterwards.
  const onInlineEditor = useCallback((kind: "math" | "chem" | null) => {
    setInlineEditor(kind);
    if (kind) setBarModeState(kind);
  }, []);
  // A new formula (another block, or a formula opening in a line) brings the
  // symbol tab back even if the last one was closed.
  useEffect(() => { setTabDismissed(false); }, [editingId, inlineEditor]);

  // ── Imported PDF ───────────────────────────────────────────────────────────
  const pdfSource = pkg?.tree.source?.kind === "pdf" ? pkg.tree.source : null;
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  // Fetch the file's bytes once. They live in the asset store, NOT the tree —
  // a 30 MB buffer inside the document would be cloned on every undo snapshot.
  useEffect(() => {
    if (!pdfSource) return void setPdfBytes(null);
    let cancelled = false;
    void (async () => {
      const blob = await getStore().getAsset(pdfSource.assetId);
      if (cancelled || !blob) return;
      setPdfBytes(await blob.data.arrayBuffer());
    })();
    return () => { cancelled = true; };
  }, [pdfSource?.assetId]); // eslint-disable-line react-hooks/exhaustive-deps -- identity is the asset id
  /**
   * Annotations ride in `tree.style.annotations` — vector strokes, small next
   * to the PDF itself, and part of the tree so they sync, version and export
   * with the note rather than needing their own lifecycle.
   *
   * Seeded ONCE into the surface (see InkSurface's `initialStrokes`), so the
   * round trip back through this state can't wipe ink mid-draw.
   */
  const initialAnnotations = useMemo(
    () => (pkg?.tree.style?.annotations as InkStroke[] | undefined) ?? [],
    // Identity must change only when a DIFFERENT note loads.
    [pkg?.noteId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const onAnnotationChange = useCallback((strokes: InkStroke[]) => {
    if (!capsRef.current.annotate) return;
    setPkg((prev) =>
      prev
        ? { ...prev, tree: { ...prev.tree, style: { ...prev.tree.style, annotations: strokes } } }
        : prev,
    );
    setSaved(false);
  }, []);
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
  const lastAutoVersionAt = useRef(0); // throttle auto version-history snapshots
  const taRef = useRef<LineHandle>(null);
  const caretRef = useRef(0);
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
  // A peer's edit rewrote the open draft: React has just re-rendered the
  // controlled <textarea> (which parks the caret at the end), so put it back
  // where the text we were typing still is. Layout effect = before paint, so
  // the caret never visibly jumps.
  useLayoutEffect(() => {
    const at = remoteCaretRef.current;
    if (at == null) return;
    remoteCaretRef.current = null;
    const ta = taRef.current;
    if (!ta || document.activeElement !== ta.el) return;
    const pos = Math.min(at, ta.value.length);
    ta.setSelectionRange(pos, pos);
    caretRef.current = pos;
  }, [draft]);
  // Announce which block we're editing so peers can flag our "typing line".
  useEffect(() => {
    if (!collab.active) return;
    collab.setEditing(editingId);
    if (!editingId) collab.setCursor(null); // left the block → clear our caret for peers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, collab.active, collab.setEditing]);
  // Broadcast our caret / selection for the collaborator-cursor overlay. A single
  // document-level `selectionchange` listener covers typing, arrow-key moves and
  // clicks across every editor surface (they're all <textarea>s in this pane).
  useEffect(() => {
    if (!collab.active) return;
    const onSel = () => {
      // Every text line in this pane is a RichLine (paragraphs, list items).
      const ae = document.activeElement as HTMLElement | null;
      const line = lineHandleOf(ae);
      if (!editingId || !ae || !line || !rootRef.current?.contains(ae)) return;
      const start = line.selectionStart;
      const end = line.selectionEnd;
      collab.setCursor({ blockId: editingId, start: Math.min(start, end), end: Math.max(start, end) });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [collab.active, editingId, collab.setCursor]);
  // Does the prose textarea hold a non-empty selection? That is what raises the
  // format popover, so formatting appears where it can act instead of sitting
  // inert in a permanent row. Same `selectionchange` source as the collab caret
  // above, but unconditional — it drives our own chrome, not a peer broadcast.
  useEffect(() => {
    if (!editingPara) { setHasSelection(false); return; }
    const read = () => {
      const ta = taRef.current;
      // Only OUR textarea counts: a selection in the title field or a table cell
      // must not raise a popover that would splice into the paragraph instead.
      if (!ta || document.activeElement !== ta.el) { setHasSelection(false); return; }
      setHasSelection((ta.selectionEnd ?? 0) > (ta.selectionStart ?? 0));
    };
    read();
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, [editingPara, editingId]);
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
  // Remote peers' carets/selections (excluding self). "measurable" = do a precise
  // text-node caret (prose/headings) vs. anchoring at the block's leading edge.
  const remoteCursors = useMemo<RemoteCursor[]>(() => {
    const out: RemoteCursor[] = [];
    for (const p of collab.peers) {
      if (p.userId === selfId || !p.cursor) continue;
      const blk = pkgRef.current?.tree.blocks.find((b) => b.id === p.cursor!.blockId);
      const measurable = blk?.type === "text" || blk?.type === "heading";
      out.push({ peer: p, blockId: p.cursor.blockId, start: p.cursor.start, end: p.cursor.end, measurable });
    }
    return out;
  }, [collab.peers, selfId]);
  // Code-block kernels live for the note's editing session (ref-counted, so a
  // split view holding the same note twice doesn't kill its twin's kernel).
  useEffect(() => {
    retainNoteKernels(id);
    return () => releaseNoteKernels(id);
  }, [id]);
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
        isEmptyDoc(p.tree.blocks) &&
        // An IMPORTED note is legitimately block-less — its content is the
        // attached file, not the tree. Without this it would be deleted the
        // moment you navigated away from the PDF you just imported.
        !p.tree.source &&
        p.assets.length === 0;
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
  // Determine the current user's access (owner / role) for this note. Guest
  // notes and notes held in our own sync mirror are always "owner" — a note we
  // just created lives locally for the length of the push debounce, and asking
  // the sharing layer during that window answers "no such note", which used to
  // render every new note as deleted. Only notes we do NOT hold (shared with
  // us, or opened by URL) go to the sharing layer. See lib/editor/access.ts.
  useEffect(() => {
    if (authLoading) return;
    if (!isCloudActive()) { setAccess("owner"); return; }
    let alive = true;
    const check = async () => {
      let resolution;
      if (await isOwnLocalNote(id)) {
        resolution = resolveNoteAccess({ mirroredLocally: true });
      } else {
        try {
          resolution = resolveNoteAccess({ mirroredLocally: false, cloudAccess: await getMyAccess(id) });
        } catch {
          resolution = resolveNoteAccess({ mirroredLocally: true }); // offline: assume ours
        }
      }
      if (!alive) return;
      setGone(resolution.kind === "gone");
      if (resolution.kind === "access") setAccess(resolution.access);
    };
    void check();
    // A pull can delete a note removed on another device; re-check after each
    // sync so a genuine deletion still surfaces (and a late push clears a
    // transient "gone" from before this fix's data landed).
    const onSync = () => void check();
    window.addEventListener(SYNC_APPLIED_EVENT, onSync);
    return () => {
      alive = false;
      window.removeEventListener(SYNC_APPLIED_EVENT, onSync);
    };
  }, [id, authLoading]);
  // Is this note shared? A collaborator role implies yes; an owner must have at
  // least one collaborator. Drives whether the live co-editing channel opens.
  // `sharedRev` re-runs the check on demand — the Share dialog bumps it so the
  // channel opens the instant a note gains its first collaborator, and the
  // window-focus listener catches a share made from another tab or device.
  const [sharedRev, setSharedRev] = useState(0);
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
  }, [id, authLoading, access, sharedRev]);
  // An owner who shares from another tab/device should still go live here.
  useEffect(() => {
    if (access !== "owner" || shared || !isCloudActive()) return;
    const onFocus = () => setSharedRev((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [access, shared]);
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
    const t: { focus(): void; value: string; setSelectionRange(start: number, end: number): void } | null = taRef.current ?? headingRef.current;
    if (t) {
      t.focus();
      const n = Math.min(pendingCaret.current ?? t.value.length, t.value.length);
      pendingCaret.current = null;
      try { t.setSelectionRange(n, n); } catch { /* noop */ }
      caretRef.current = n;
    }
  }, [editingId]);
  /**
   * Measure each block's height after every render (drives pagination).
   *
   * This is a feedback loop by nature: the heights decide the page breaks, and a
   * page break can change a height (a block at the top of a page is styled
   * differently from one mid-page). The styles are written so it converges —
   * anything position-dependent trims with MARGINS, which offsetHeight ignores
   * (see the `:first-child` heading rule in app/globals.css) — but a rule that
   * forgets that would spin here forever, which is what "Maximum update depth
   * exceeded" was: a heading crossing a page boundary measured shorter at the
   * top of the new page, fitted on the old one again, and bounced.
   *
   * So this counts CONSECUTIVE re-measures that were themselves caused by the
   * last measurement, and stops after a few. Any other reason to re-render (a
   * keystroke, a zoom change, a font finishing loading) resets the count, so
   * normal editing is never throttled. Stalling leaves the page break one line
   * off; looping freezes the editor.
   */
  const remeasures = useRef(0);
  const selfInduced = useRef(false);
  const heightsRef = useRef<Record<string, number>>({});
  useLayoutEffect(() => {
    remeasures.current = selfInduced.current ? remeasures.current + 1 : 0;
    selfInduced.current = false;
    if (remeasures.current >= MAX_REMEASURES) return; // let the current breaks stand
    const prev = heightsRef.current;
    const next: Record<string, number> = {};
    let changed = Object.keys(prev).length !== blockEls.current.size;
    for (const [id, el] of blockEls.current) {
      next[id] = el.offsetHeight;
      if (prev[id] !== next[id]) changed = true;
    }
    if (!changed) return;
    heightsRef.current = next;
    selfInduced.current = true;
    setHeights(next);
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
    // applyTree writes setPkg DIRECTLY, bypassing setBlocks' guard — so undo
    // needs its own. Today the stack is empty on a locked note (snapshots are
    // only taken by gated mutators), but that is an incidental invariant, not
    // a check, and annotation will start pushing snapshots.
    if (!capsRef.current.editBlocks) return;
    const prev = undoStack.current.pop();
    const cur = pkgRef.current;
    if (!prev || !cur) return;
    redoStack.current.push(cur.tree);
    lastSnapCoalesced.current = false;
    applyTree(prev);
  }, [applyTree]);
  const redo = useCallback(() => {
    if (!capsRef.current.editBlocks) return;
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
    setTemplatesOpen(false);
    setConfirmTemplate(null);
    const proceed = (values: Record<string, string>) => {
      snapshot(false);
      setEditingId(null);
      setSelected(null);
      const fresh = freshTree(t);
      fresh.blocks = fillFields(fresh.blocks, values);
      setPkg((prev) => {
        if (!prev) return prev;
        // The design's sections become the note's shortcut list (lib/blocks/
        // shortcuts.ts). "Replace" adopts the design's list wholesale; "add"
        // merges its sections into whatever the note already had.
        const stamped = shortcutsFromBlocks(fresh.blocks);
        const tree = action === "add"
          ? {
              ...prev.tree,
              blocks: [...prev.tree.blocks, ...fresh.blocks],
              shortcuts: mergeShortcuts(documentShortcuts(prev.tree), stamped),
            }
          : { ...fresh, shortcuts: stamped };
        return { ...prev, tree };
      });
      setSaved(false);
    };
    const fields = moduleFields(t.blocks);
    if (fields.length === 0) proceed({});
    else setFieldsPrompt({ name: "This template", fields, proceed });
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
        !!ae && ae !== taRef.current?.el && !ae.closest("[data-richline]") &&
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

  // Watch the pane's own width, not the window's: in split view two panes share
  // the viewport, so the window size says nothing about how much room this one
  // has for a side panel.
  // Keyed on `pkg`, not []: <main> doesn't exist until the note has loaded (the
  // component returns a placeholder before then), so a mount-only effect would
  // observe nothing and never retry.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setPaneNarrow(entry.contentRect.width < 1024));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pkg]);

  // ⌘/Ctrl+/ pins the symbol strip open. The strip is otherwise contextual (it
  // follows a maths caret), and this is the escape hatch for anyone who would
  // rather have it permanently — the old behaviour, now opt-in.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key !== "/") return;
      const root = rootRef.current;
      const ae = document.activeElement as HTMLElement | null;
      const focusedHere = !!root && !!ae && root.contains(ae);
      if (!focusedHere && (!primary || (ae && ae !== document.body))) return;
      e.preventDefault();
      toggleSymbolPin();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [primary]);

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

  // ── section shortcuts (the design's jump list — lib/blocks/shortcuts.ts) ────
  /** Edit the note's shortcut list. Tree-level like the document style, so it
   *  goes through setPkg rather than setBlocks. */
  function editShortcuts(fn: (list: SectionShortcut[]) => SectionShortcut[]) {
    if (!capsRef.current.editBlocks) return;
    setPkg((prev) => {
      if (!prev) return prev;
      const next = fn(documentShortcuts(prev.tree));
      if (next === prev.tree.shortcuts) return prev;
      return { ...prev, tree: { ...prev.tree, shortcuts: next } };
    });
    setSaved(false);
  }

  /**
   * Follow a shortcut: scroll to its section, or — when the note doesn't have
   * that section (not written yet, or deleted) — add it and scroll there.
   *
   * The section comes from the module catalog when a module goes by that name,
   * so "Worked example" arrives with its worked-example body rather than as a
   * bare heading; otherwise it is a heading plus somewhere to write.
   */
  function jumpToShortcut(shortcutId: string) {
    const tree = pkgRef.current?.tree;
    if (!tree) return;
    const sc = documentShortcuts(tree).find((s) => s.id === shortcutId);
    if (!sc) return;
    const target = resolveShortcut(tree.blocks, sc);
    if (target) { scrollToBlock(target.id); return; }
    if (!capsRef.current.editBlocks) return; // a viewer can't add the section
    const named = [...listSavedModules(), ...builtinModules()].find(
      (m) => m.name.trim().toLowerCase() === sc.label.trim().toLowerCase(),
    );
    if (named) { paletteInsertModule(named); return; }
    const head = makeHeading(2, sc.label);
    setBlocks((bs) => [...bs, head, paragraphFromSource("")]);
    setTimeout(() => scrollToBlock(head.id), 60);
  }
  useImperativeHandle(handleRef, () => ({
    scrollToBlock,
    scrollToTop,
    toggleSection,
    reorderSections,
    saveSectionAsModule: (hid: string) => void saveSectionAsModule(hid),
    insertModule: paletteInsertModule,
    jumpToShortcut,
    addShortcut: (label: string) => editShortcuts((l) => addShortcut(l, label)),
    removeShortcut: (sid: string) => editShortcuts((l) => removeShortcut(l, sid)),
    renameShortcut: (sid: string, label: string) => editShortcuts((l) => renameShortcut(l, sid, label)),
    moveShortcut: (from: string, to: string | null) => editShortcuts((l) => moveShortcut(l, from, to)),
    runCommand,
    capabilities: () => capsRef.current,
  }), [handleRef]);
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
  // Same for the shortcut list (changes on apply-a-design and on edits to it).
  const lastShortcuts = useRef("");
  useEffect(() => {
    const items = documentShortcuts(pkgRef.current?.tree);
    const key = JSON.stringify(items);
    if (key !== lastShortcuts.current) {
      lastShortcuts.current = key;
      onShortcuts(items);
    }
  }, [pkg, onShortcuts]);

  function commit(text: string, c: string | null) {
    if (!editingId) return;
    const next = editingPara
      ? withCalloutColor(paragraphFromSource(text, editingId), c)
      : editingChem
        ? tagChem(displayFromSource(wrapCe(text), editingId))
        : displayFromSource(text, editingId);
    // Rebuilt from source every keystroke, so what the source does not carry —
    // the paragraph's indent, the box the line sits in — is taken over from the
    // block being replaced.
    setBlocks((bs) => bs.map((b) => (b.id === editingId ? withBox(editingPara ? withParaIndent(next, paraIndent(b)) : next, boxOf(b)) : b)), true); // coalesce keystrokes
  }
  /** Where the caret should open, in SOURCE offsets — set from the press that
   *  started the edit, consumed by the focus effect. */
  const pendingCaret = useRef<number | null>(null);
  /**
   * Close whatever block is open before opening `next`.
   *
   * Leaving is part of ARRIVING, in the same handler and the same render — not
   * a blur the browser may deliver late, early, or (for a MathLive field) never.
   * That is what makes one press land the caret in the line under it every
   * time, and it keeps `endEdit`'s tidying (drop an abandoned empty block,
   * promote a typed `$$…$$`) on the path out.
   */
  function leaveOpenBlock(next: string | null) {
    const open = editingIdRef.current;
    if (open && open !== next) {
      // A formula open in that line is written first, its last keystroke
      // included, while the page's draft still belongs to that line.
      editBoxRef.current?.commitInline();
      endEdit(open);
    }
  }
  // Deliberately NOT called from startEdit: splitParagraph, mergeBack/Forward,
  // backOut and listToParagraph rewrite the block they are leaving in the same
  // update, and running endEdit's tidy against a tree that has not caught up
  // would judge the wrong text (an Enter at the start of a line would see an
  // "empty" block and delete it). Those paths hand the block over themselves;
  // the pointer and stepToBlock are the transitions that need this.
  /**
   * Enter a block from the pointer.
   *
   * On MOUSEDOWN, not click. A click only fires when mousedown and mouseup
   * share a target, and swapping the previous block out of edit mode re-renders
   * the line being pressed — so the click never arrived and the first press on
   * a line did nothing. `preventDefault` keeps the browser from moving focus to
   * the hit target as well, so the only thing that decides where the caret goes
   * is the effect that follows `editingId`.
   *
   * The leave belongs HERE and not on a capture handler further up the row:
   * React flushes a discrete event's updates as soon as the capture phase has
   * run, so closing the previous block from up there re-rendered the line being
   * pressed before this handler was ever dispatched — the same swallowed press,
   * one phase earlier.
   */
  function pressToEdit(e: MouseEvent, blockId: string, run: () => void) {
    if (e.button !== 0) return;
    e.preventDefault();
    leaveOpenBlock(blockId);
    run();
  }
  /** Where a press opened the formula being edited, as fractions of its
   *  rendered box — the formula editor puts its caret there (FormulaEditBox). */
  const formulaPoint = useRef<FormulaPoint | null>(null);
  function startEdit(block: Block, forceChem = false, at?: { el: HTMLElement; x: number; y: number }) {
    if (readOnlyRef.current) return;
    setSelected(null);
    setEditingId(block.id);
    setEditingPara(isParagraph(block));
    const source = blockEditSource(block);
    // Chemistry identity is STORED (attrs.kind = "chem"): a \ce formula always
    // reopens in the chem editor, and a math formula is never sniffed into it.
    // Legacy notes (no kind tag) fall back to detecting a single pure \ce{…}.
    const legacyChem = !isParagraph(block) && block.type === "math" && block.attrs?.kind == null;
    const chem = forceChem || isChemBlock(block) || (legacyChem && ceInner(source) != null);
    setEditingChem(chem);
    const text = chem ? (ceInner(source) ?? "") : source;
    setDraft(text);
    setColor(calloutColorOf(block));
    // A click INTO the text opens the caret there; anything else (the ⌘K
    // palette, a jump from the outline) opens at the end.
    const hit = at && isParagraph(block) ? renderedOffsetAt(at.el, at.x, at.y) : null;
    formulaPoint.current = at && !isParagraph(block) ? formulaPointAt(at.el, at.x, at.y) : null;
    pendingCaret.current = hit == null ? null : sourceOffsetFor(text, at!.el.textContent ?? "", hit);
  }
  /**
   * Enter inside a paragraph: keep `before` here, and carry `after` into a new
   * paragraph below, with the caret at its start.
   *
   * One tree update, so it is ONE undo step — and the caret lands in the new
   * block by way of `startEdit`, which is what makes Enter feel like the next
   * line rather than an insert command.
   */
  function splitParagraph(blockId: string, before: string, after: string) {
    if (!capsRef.current.editBlocks) return;
    // Both halves keep the paragraph's indent, as Enter carries a paragraph's
    // formatting onto the next line in Docs.
    const all = pkgRef.current?.tree.blocks ?? [];
    const at = all.findIndex((b) => b.id === blockId);
    const cur = all[at];
    const indent = paraIndent(cur);
    // …and the box it sits in. Except Enter on an empty last line of a box,
    // which steps out of the box as Enter on an empty bullet leaves a list: the
    // line stays where it is, under the box now rather than in it.
    const box = boxOf(cur);
    if (box && before === "" && after === "" && !inSameBox(all[at + 1], cur)) {
      updateById(blockId, (b) => withBox(b, null));
      return;
    }
    const head = withBox(promoteEquation(before, blockId) ?? withParaIndent(withCalloutColor(paragraphFromSource(before, blockId), color), indent), box);
    const tail = withBox(withParaIndent(withCalloutColor(paragraphFromSource(after), color), indent), box);
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === blockId);
      if (i < 0) return bs;
      const next = [...bs];
      next.splice(i, 1, head, tail);
      return next;
    });
    startEdit(tail);
    pendingCaret.current = 0;
  }

  /**
   * `$$…$$` on its own is an EQUATION, so a paragraph holding nothing else
   * becomes a display formula block when the edit ends — the counterpart of
   * `$…$`, which stays inline in the prose. Returns null when the source is
   * anything other than one whole display equation.
   */
  function promoteEquation(src: string, id: string): Block | null {
    const latex = displayMathSource(src);
    if (latex == null) return null;
    const block = displayFromSource(latex, id);
    return ceInner(latex) != null ? tagChem(block) : block;
  }

  /**
   * Where the caret goes when a line is deleted: the END of the nearest
   * non-empty line before it — a paragraph, a heading, a list (its last
   * non-empty item) or an equation. Blank lines and objects (images, tables,
   * graphs, code) are passed over. With no such line before it, the START of
   * the nearest one after; failing that, the nearest blank line either side.
   * Null when the note has no other line at all. Read while `blockId` is still
   * in the tree, and only ever before deleting it.
   */
  function lineNear(blockId: string, beforeOnly = false): { block: Block; edge: "start" | "end" } | null {
    const all = pkgRef.current?.tree.blocks ?? [];
    const folded = sectionFolding ? hiddenBlockIds(all) : new Set<string>();
    const bs = all.filter((b) => b.id === blockId || !folded.has(b.id));
    const i = bs.findIndex((b) => b.id === blockId);
    if (i < 0) return null;
    const isLine = (b: Block) => isParagraph(b) || b.type === "heading" || b.type === "list" || b.type === "math";
    const filled = (b: Block) => isLine(b) && !isEmptyBlock(b);
    const before = (ok: (b: Block) => boolean) => bs.slice(0, i).reverse().find(ok);
    const after = (ok: (b: Block) => boolean) => bs.slice(i + 1).find(ok);
    const hit = before(filled);
    if (hit) return { block: hit, edge: "end" };
    if (beforeOnly) {
      const blank = before(isLine);
      return blank ? { block: blank, edge: "end" } : null;
    }
    const next = after(filled);
    if (next) return { block: next, edge: "start" };
    const blankBefore = before(isLine);
    if (blankBefore) return { block: blankBefore, edge: "end" };
    const blankAfter = after(isLine);
    return blankAfter ? { block: blankAfter, edge: "start" } : null;
  }

  /** Open `block` for editing with the caret at its start or end. */
  function moveCaretTo({ block, edge }: { block: Block; edge: "start" | "end" }) {
    setSelected(null);
    if (block.type === "list") {
      const items = listItems(block);
      const filledAt = items.map((t) => t.trim() !== "");
      const item = edge === "end" ? filledAt.lastIndexOf(true) : filledAt.indexOf(true);
      listCaret.current = item >= 0 ? item : edge === "end" ? items.length - 1 : 0;
      listCaretOffset.current = edge === "end" ? null : 0;
      setEditingPara(false);
      setEditingId(block.id);
      return;
    }
    if (block.type === "heading") {
      startEditHeading(block);
      pendingCaret.current = edge === "start" ? 0 : (block.value ?? "").length;
      return;
    }
    startEdit(block);
    // A formula takes its caret from its own field; only text lines use this.
    if (isParagraph(block)) pendingCaret.current = edge === "start" ? 0 : blockEditSource(block).length;
  }

  /** Backspace in an empty paragraph: remove it and carry on at the end of the
   *  nearest non-empty line before it (lineNear). The last line of a note stays,
   *  so the caret always has somewhere to be. */
  function backOut(blockId: string) {
    if (!capsRef.current.editBlocks) return;
    const near = lineNear(blockId);
    if (!near) return;
    setEditingId(null);
    deleteBlock(blockId);
    moveCaretTo(near);
  }

  /** The hover delete button. Deleting the line the caret is in moves the caret
   *  to the nearest non-empty line before it, the same as Backspace. */
  function removeBlock(blockId: string) {
    const near = editingIdRef.current === blockId ? lineNear(blockId) : null;
    deleteBlock(blockId);
    if (near) moveCaretTo(near);
  }

  const headingRef = useRef<HTMLInputElement>(null);

  /**
   * Walk the caret out of this block and into the one `dir` away — the thing
   * that makes a stack of blocks read as one document rather than a column of
   * boxes. Returns false when there is nowhere to go (the arrow key then does
   * its ordinary thing).
   */
  function stepToBlock(blockId: string, dir: -1 | 1, edge: "start" | "end"): boolean {
    if (!capsRef.current.editBlocks) return false;
    const all = pkgRef.current?.tree.blocks ?? [];
    const collapsed = sectionFolding ? hiddenBlockIds(all) : new Set<string>();
    const bs = all.filter((b) => !collapsed.has(b.id)); // a hidden section is not walked into
    const i = bs.findIndex((b) => b.id === blockId);
    const next = i < 0 ? null : bs[i + dir];
    if (!next) return false;
    leaveOpenBlock(next.id);
    if (isParagraph(next)) {
      startEdit(next);
      pendingCaret.current = edge === "start" ? 0 : blockEditSource(next).length;
      return true;
    }
    if (next.type === "heading") {
      startEditHeading(next);
      pendingCaret.current = edge === "start" ? 0 : (next.value ?? "").length;
      return true;
    }
    return false;
  }

  /**
   * Move a whole paragraph one indent step in or out (lib/blocks/indent.ts):
   * Tab at its start, Shift+Tab, ⌘] / ⌘[, and Backspace at its start. Returns
   * false when it is already as far as it goes, so the key can do its ordinary
   * thing instead.
   */
  function indentParagraph(blockId: string, delta: 1 | -1): boolean {
    if (!capsRef.current.editBlocks) return false;
    const cur = pkgRef.current?.tree.blocks.find((b) => b.id === blockId);
    if (!cur || !isParagraph(cur) || withParaIndent(cur, paraIndent(cur) + delta) === cur) return false;
    updateById(blockId, (b) => withParaIndent(b, paraIndent(b) + delta));
    return true;
  }

  /**
   * Enter in an equation: the formula is finished, so the caret moves to a new
   * line under it, as Enter does at the end of any other line. An equation left
   * empty becomes that line rather than staying behind as an empty slot.
   */
  function lineAfterFormula(blockId: string) {
    if (!capsRef.current.editBlocks) return;
    // The new line stays in the equation's box, if it is in one.
    const para = withBox(paragraphFromSource(""), boxOf(pkgRef.current?.tree.blocks.find((b) => b.id === blockId)));
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === blockId);
      if (i < 0) return bs;
      const next = [...bs];
      if (isEmptyBlock(bs[i])) next.splice(i, 1, para);
      else next.splice(i + 1, 0, para);
      return next;
    });
    startEdit(para);
    pendingCaret.current = 0;
  }

  /** The visible block directly before `blockId` (a folded section's body is
   *  not a line you can join onto), or null at the top of the note. */
  function blockBefore(blockId: string): Block | null {
    const all = pkgRef.current?.tree.blocks ?? [];
    const folded = sectionFolding ? hiddenBlockIds(all) : new Set<string>();
    const bs = all.filter((b) => b.id === blockId || !folded.has(b.id));
    const i = bs.findIndex((b) => b.id === blockId);
    return i > 0 ? bs[i - 1] : null;
  }

  /**
   * Bring a line's words up onto the end of the line before it, the caret at
   * the seam: what deleting the line break in front of a line does in any
   * document. `prev` may be a paragraph (a blank one included), a heading, or a
   * list, whose last item takes the words. An equation or an object cannot hold
   * words, so nothing moves in front of one and this returns false. `remove`
   * takes the joined line out of the tree, in the same update.
   */
  function joinOnto(prev: Block, text: string, remove: (bs: Block[]) => Block[]): boolean {
    if (!capsRef.current.editBlocks) return false;
    if (isParagraph(prev)) {
      const head = blockEditSource(prev);
      const joined = withBox(withParaIndent(withCalloutColor(paragraphFromSource(head + text, prev.id), calloutColorOf(prev)), paraIndent(prev)), boxOf(prev));
      setBlocks((all) => remove(all).map((b) => (b.id === prev.id ? joined : b)));
      startEdit(joined);
      pendingCaret.current = head.length;
      return true;
    }
    if (prev.type === "heading") {
      const head = prev.value ?? "";
      // A heading is one line: soft breaks in the joined words become spaces.
      const joined: Block = { ...prev, value: head + text.replace(/\s*\n\s*/g, " ") };
      setBlocks((all) => remove(all).map((b) => (b.id === prev.id ? joined : b)));
      startEditHeading(joined);
      pendingCaret.current = head.length;
      return true;
    }
    if (prev.type === "list") {
      const items = listItems(prev);
      const last = items.length - 1;
      const head = items[last] ?? "";
      const joined = withList(prev, [...items.slice(0, last), head + text], undefined, listLevels(prev));
      setBlocks((all) => remove(all).map((b) => (b.id === prev.id ? joined : b)));
      listCaret.current = last;
      listCaretOffset.current = head.length;
      setSelected(null);
      setEditingPara(false);
      setEditingId(prev.id);
      return true;
    }
    return false;
  }

  /** Backspace at the front of a paragraph that has words: join it onto the
   *  line before it (joinOnto). */
  function mergeBack(blockId: string, text: string) {
    const prev = blockBefore(blockId);
    if (prev) joinOnto(prev, text, (all) => all.filter((b) => b.id !== blockId));
  }

  /**
   * Backspace at the front of a list's FIRST item (ListEditor). Its words come
   * up onto the line before the list, and the item leaves the list (the list
   * goes when it was the only one). An empty item is a blank line being
   * deleted: the caret goes to the end of the nearest non-empty line before.
   */
  function listFrontBack(listId: string) {
    if (!capsRef.current.editBlocks) return;
    const list = pkgRef.current?.tree.blocks.find((b) => b.id === listId);
    if (!list || list.type !== "list") return;
    const items = listItems(list);
    const levels = listLevels(list);
    const rest = (all: Block[]) =>
      items.length > 1
        ? all.map((b) => (b.id === listId ? withList(b, items.slice(1), undefined, levels.slice(1)) : b))
        : all.filter((b) => b.id !== listId);
    if (!(items[0] ?? "").trim()) {
      const near = lineNear(listId, true);
      if (!near) return;
      setBlocks((all) => rest(all));
      moveCaretTo(near);
      return;
    }
    const prev = blockBefore(listId);
    if (prev) joinOnto(prev, items[0], rest);
  }

  /** Delete at the end of a paragraph: pull the next one up into it. */
  function mergeForward(blockId: string, text: string) {
    if (!capsRef.current.editBlocks) return;
    const bs = pkgRef.current?.tree.blocks ?? [];
    const i = bs.findIndex((b) => b.id === blockId);
    const next = i >= 0 ? bs[i + 1] : null;
    if (!next || !isParagraph(next)) return;
    const joined = withBox(withParaIndent(withCalloutColor(paragraphFromSource(text + blockEditSource(next), blockId), color), paraIndent(bs[i])), boxOf(bs[i]));
    setBlocks((all) => all.filter((b) => b.id !== next.id).map((b) => (b.id === blockId ? joined : b)));
    startEdit(joined);
    pendingCaret.current = text.length;
  }

  /** The heading input's keyboard: the same document-wide caret rules as prose,
   *  plus Enter, which starts the body text under the heading. */
  function onHeadingKey(e: ReactKeyboardEvent<HTMLInputElement>, b: Block) {
    const el = e.currentTarget;
    const at = el.selectionStart ?? 0;
    const to = el.selectionEnd ?? at;
    const collapsed = at === to;
    if (e.key === "Escape") { e.preventDefault(); endEdit(b.id); return; }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      addBlock(paragraphFromSource(""));
      return;
    }
    if (e.nativeEvent.isComposing || !collapsed) return;
    if (e.key === "ArrowUp" || (e.key === "ArrowLeft" && at === 0)) {
      if (stepToBlock(b.id, -1, "end")) e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "ArrowRight" && at === el.value.length)) {
      if (stepToBlock(b.id, 1, "start")) e.preventDefault();
      return;
    }
    if (e.key === "Backspace" && at === 0 && el.value !== "") {
      const prev = blockBefore(b.id);
      if (prev && joinOnto(prev, el.value, (all) => all.filter((x) => x.id !== b.id))) e.preventDefault();
      return;
    }
    if (e.key === "Backspace" && at === 0 && el.value === "") {
      e.preventDefault();
      const near = lineNear(b.id);
      if (!near) return;
      setEditingId(null);
      deleteBlock(b.id);
      moveCaretTo(near);
    }
  }

  function startEditHeading(block: Block) {
    if (readOnlyRef.current) return;
    setSelected(null);
    setEditingId(block.id);
  }
  function selectItem(blockId: string, index: number, kind: "image" | "table") {
    // Selecting a figure reveals its edit controls (add row/col, delete, align)
    // and makes table cells editable — so it is an edit entry point, not just
    // a selection, and needs the same gate as startEdit.
    if (!capsRef.current.editBlocks) return;
    leaveOpenBlock(blockId); // a table cell ends a line the same way a line does
    setEditingId(null);
    setSelected({ id: blockId, index, kind });
  }

  /**
   * Insert a block relative to the cursor, the way a word processor does: an
   * empty line the cursor is already sitting in IS the insertion point, so
   * "Insert ▸ Table" from a blank paragraph replaces that paragraph rather than
   * pushing a table below it and stranding the blank line above.
   */
  function addBlock(block: Block, edit = true, chem = false) {
    const anchor = editingId ?? selected?.id ?? null;
    // A block added from inside a box joins it, as a line typed there would;
    // one that brings its own box (Insert ▸ Box) keeps that.
    const placed = boxOf(block) ? block : withBox(block, boxOf(pkgRef.current?.tree.blocks.find((b) => b.id === anchor)));
    const tagged = chem ? tagChem(placed) : placed; // store chem identity, don't sniff it later
    setBlocks((bs) => {
      const i = anchor ? bs.findIndex((b) => b.id === anchor) : -1;
      const next = [...bs];
      if (i >= 0 && isParagraph(bs[i]) && isEmptyBlock(bs[i])) next.splice(i, 1, tagged);
      else next.splice(i >= 0 ? i + 1 : bs.length, 0, tagged);
      return next;
    });
    if (edit) startEdit(tagged, chem);
    else setEditingId(null);
  }
  /** Slash-insert: rebuild the edited paragraph without its `/query` and splice
   *  the module's blocks in right after it — ONE tree update, one undo step.
   *  A paragraph that existed only to host the slash is dropped entirely. */
  function insertModule(m: Module, cleanedDraft: string) {
    if (readOnlyRef.current) return;
    const anchor = editingId;
    const hostColor = color;
    const proceed = (values: Record<string, string>) => {
      const fresh = fillFields(freshBlocks(m.blocks), values);
      if (fresh.length === 0) return;
      setBlocks((bs) => {
        const i = anchor ? bs.findIndex((b) => b.id === anchor) : -1;
        if (i < 0 || !anchor) return [...bs, ...fresh];
        const cleaned = withBox(withCalloutColor(paragraphFromSource(cleanedDraft, anchor), hostColor), boxOf(bs[i]));
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
    };
    const fields = moduleFields(m.blocks);
    if (fields.length === 0) { proceed({}); return; }
    setFieldsPrompt({ name: m.name, fields, proceed });
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
        const cleaned = withBox(withCalloutColor(paragraphFromSource(cleanedDraft, anchor), color), boxOf(bs[i]));
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
  function saveSectionAsModule(headingId: string) {
    const bs = pkgRef.current?.tree.blocks ?? [];
    const range = sectionRange(bs, headingId);
    if (!range) return;
    setSectionSave({
      blocks: bs.slice(range[0], range[1]),
      name: bs[range[0]].value?.trim() || "Untitled section",
    });
  }

  function deleteBlock(blockId: string) {
    setBlocks((bs) => bs.filter((b) => b.id !== blockId));
    if (editingId === blockId) setEditingId(null);
    if (selected?.id === blockId) setSelected(null);
  }
  // ── coloured boxes (lib/blocks/boxes.ts, components/BoxMenu) ───────────────
  /** What the Box menu acts on: the line holding the caret, or the selected figure. */
  function boxTargetId(): string | null {
    return editingId ?? selected?.id ?? null;
  }
  function targetBox(id: string | null): BoxStyle | null {
    return id ? boxOf(pkgRef.current?.tree.blocks.find((b) => b.id === id)) : null;
  }
  /** Put the line holding the caret in `box`; with no caret, start a boxed line
   *  at the end of the note. */
  function openBox(box: BoxStyle) {
    if (!capsRef.current.editBlocks) return;
    const id = boxTargetId();
    if (id) {
      updateById(id, (b) => withBox(b, box));
      return;
    }
    const fresh = withBox(paragraphFromSource(""), box);
    setBlocks((cur) => [...cur, fresh]);
    startEdit(fresh);
  }
  /** A colour from the Box menu recolours the box the caret is in, or boxes the
   *  line. `live` (the colour wheel being dragged) is one undo step. */
  function pickBoxColor(c: string, live = false) {
    if (!capsRef.current.editBlocks) return;
    rememberBoxColor(c);
    const id = boxTargetId();
    if (id && targetBox(id)) setBlocks((all) => restyleBoxRun(all, id, { color: c }), live);
    else openBox(newBox(c));
  }
  /** A title typed or picked in the Box menu, or typed into the box's own bar. */
  function setBoxTitle(title: string, blockId: string | null = boxTargetId()) {
    if (!capsRef.current.editBlocks) return;
    if (blockId && targetBox(blockId)) setBlocks((all) => restyleBoxRun(all, blockId, { title }), true);
    else openBox(newBox(lastBoxColor(), title));
  }
  function extendBox() {
    const id = boxTargetId();
    if (id) setBlocks((all) => extendBoxRun(all, id));
  }
  function removeBox() {
    const id = boxTargetId();
    if (id) setBlocks((all) => restyleBoxRun(all, id, null));
  }

  const setBlockRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) blockEls.current.set(id, el);
    else blockEls.current.delete(id);
  };
  function setDocStyle(patch: Partial<DocumentStyle>) {
    if (!capsRef.current.editDocStyle) return;
    // An indent set here is chosen, so it survives the legacy-default rule in
    // docstyle → storedIndent.
    if (patch.indent !== undefined) patch = { ...patch, indentChosen: true };
    snapshot(false);
    setPkg((prev) =>
      prev ? { ...prev, tree: { ...prev.tree, style: { ...prev.tree.style, ...patch } } } : prev,
    );
    setSaved(false);
  }
  /**
   * Click on the empty space below the last block: start a fresh paragraph at
   * the END of the document.
   *
   * Deliberately NOT addBlock(), which inserts after whatever is under the
   * cursor — clicking the bottom of the page means "write here", so it appends
   * regardless of where the caret happened to be.
   */
  function appendParagraph() {
    if (!capsRef.current.editBlocks) return;
    const bs = pkgRef.current?.tree.blocks ?? [];
    const openId = editingIdRef.current;
    const open = openId ? bs.find((b) => b.id === openId) : null;
    // Already sitting in an empty paragraph: clicking below it should leave the
    // cursor where it is rather than stack a second empty block.
    if (open && isParagraph(open) && isEmptyBlock(open)) return;
    const last = bs[bs.length - 1];
    if (last && isParagraph(last) && isEmptyBlock(last)) { startEdit(last); return; }
    if (openId) endEdit(openId); // commits, and drops it if it was left empty
    const fresh = paragraphFromSource("");
    setBlocks((cur) => [...cur, fresh]);
    startEdit(fresh);
  }

  /** Finish editing a block; auto-remove it if it was left empty. */
  function endEdit(blockId: string) {
    setEditingId(null);
    const b = pkgRef.current?.tree.blocks.find((x) => x.id === blockId);
    if (b && isEmptyBlock(b)) {
      // Decided again against the LATEST blocks: this copy can trail a change
      // reported on the way out (a formula's last keystroke arrives with the
      // Escape), and deleting on it threw a just-typed equation away.
      setBlocks((bs) => bs.filter((x) => x.id !== blockId || !isEmptyBlock(x)));
      if (selected?.id === blockId) setSelected(null);
      return;
    }
    // `$$…$$` typed into a paragraph is an equation: make it one on the way out.
    if (b && isParagraph(b)) {
      const eq = promoteEquation(blockEditSource(b), blockId);
      if (eq) setBlocks((bs) => bs.map((x) => (x.id === blockId ? withBox(eq, boxOf(x)) : x)));
    }
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
  /** The strip's Text button: words inside the formula holding the caret, in
   *  whichever editor that formula is open in. */
  function toggleFormulaText() {
    const me = activeMathEdit();
    if (me) { me.toggleText(); return; }
    activeMathField()?.toggleText();
  }
  function onInsert(latex: string) {
    // Environment skeletons (\begin{bmatrix}\end{bmatrix}) carry no cells, so
    // every rewrite below gets a filled 2×2 grid to work with: `#?` boxes on the
    // MathLive-backed surfaces, and empty cells wherever the LaTeX is stored or
    // rendered by KaTeX (which is what MathField itself saves a matrix as).
    const katexSafe = fillEnvCells(latex, () => "");
    // A focused structural editor (beta) wins — insert the real block structure.
    // It maps environments to real matrix blocks itself, so it takes the
    // skeleton unexpanded (see insertSnippet in lib/matheditor/ops.ts).
    const me = activeMathEdit();
    if (me) { me.insert(latex); return; }
    // A focused MathField (standalone equation OR an open inline-math popover)
    // wins: insert the snippet structurally. Empty `{}` groups and environment
    // cells become `#?` placeholder boxes so e.g. \frac{}{} and a matrix are
    // tabbable — the Desmos feel.
    const field = activeMathField();
    if (field) {
      const snippet = fillEnvCells(latex.replace(/\{\}/g, "{#?}"), () => "#?");
      field.insert(snippet);
      // ∫/∑/∏ etc.: MathLive selects the UPPER bound first. Nudge to the LOWER
      // bound so it's the first field you fill. (Tab/Shift+Tab switch bounds;
      // MathLive's arrow keys don't reliably move between sub/superscript.)
      if (/_\{#\?\}/.test(snippet) && /\^\{#\?\}/.test(snippet)) field.command("moveToNextPlaceholder");
      return;
    }
    // A focused chemistry field: embed the math via mhchem's $...$ escape — the
    // mirror of onInsertChem routing \ce into a focused MathField. Without this
    // a math-strip click would fall through and clobber the chem edit session.
    // Plain <input>, so `#?` would splice in as literal text — empty cells here.
    const chem = activeChemField();
    if (chem) { chem.insert(`$${katexSafe}$`); return; }
    // A focused source textbox (a list item) → splice it as an inline formula.
    // Wrapped in `$…$`, because the item is stored as SOURCE: bare `\alpha`
    // there is the five characters, not the letter (see renderSource).
    // A list item holding the caret opens its formula box with the structure,
    // the same as a sentence does below.
    const openFormula = activeFormulaOpener();
    if (openFormula) { openFormula(fillEnvCells(latex.replace(/\{\}/g, "{\\placeholder{}}"), () => "\\placeholder{}")); return; }
    const textInsert = activeTextInserter();
    if (textInsert) { textInsert(`$${katexSafe}$`); return; }
    // Editing prose: open the inline-math BOX editor seeded with the structure
    // (empty `{}` → visible \placeholder{} boxes) instead of splicing raw LaTeX.
    if (editingId && editingPara) {
      const seeded = latex.replace(/\{\}/g, "{\\placeholder{}}");
      editBoxRef.current?.openMath(fillEnvCells(seeded, () => "\\placeholder{}"));
      return;
    }
    // Not editing: open a new equation (structural when the beta is on).
    addBlock(getSettings().mathEditorBeta ? structuralEquation(latex) : displayFromSource(katexSafe));
  }
  /** Chemistry-toolbar/palette insert — the parallel of onInsert. `latex` is the
   *  catalog's full form (\ce{...} for species/arrows, plain math for the
   *  Quantities/Units entries). NO `{}`→placeholder rewriting happens here:
   *  mhchem braces are literal content, and rewriting would corrupt them. */
  function onInsertChem(latex: string) {
    const src = ceInner(latex); // null for non-\ce entries (quantities, \pu units)
    // A focused chemistry field wins: splice the mhchem source at its caret
    // (non-\ce entries embed as $math$ — mhchem's math escape).
    const chem = activeChemField();
    if (chem) { chem.insert(src ?? `$${latex}$`); return; }
    // A focused math surface takes the full LaTeX form as-is (MathLive parses
    // \ce natively; the structural editor stores it as one opaque atom).
    const me = activeMathEdit();
    if (me) { me.insert(latex); return; }
    const field = activeMathField();
    if (field) { field.insert(latex); return; }
    // A list item holding the caret: the chemistry goes into the item as maths.
    const textInsert = activeTextInserter();
    if (textInsert) { textInsert(`$${latex}$`); return; }
    // Editing prose: open the inline-chemistry popover seeded with the source
    // (quantities open the regular inline-math box instead — they ARE math).
    if (editingId && editingPara) {
      if (src != null) editBoxRef.current?.openChem(src);
      else editBoxRef.current?.openMath(latex);
      return;
    }
    // Not editing: chemistry becomes a new chemical-equation block; non-\ce
    // entries fall through to the math path (structural beta included).
    if (src != null) addBlock(displayFromSource(latex), true, true);
    else onInsert(latex);
  }
  /**
   * Insert a handwriting reading from the ink sheet.
   *
   * `src` is paragraph source: prose with `\( ... \)` inline math. Ancha's
   * unified mode routinely returns both in one reading, which the single-LaTeX
   * dispatchers cannot represent — a MathLive field or a structural formula
   * tree has no atom for the word "let".
   *
   * So: a reading that is PURELY one formula keeps the old behavior exactly
   * (focused math field, chem field, table cell, fresh equation block); a mixed
   * or multi-line reading splices into the prose being edited, or becomes fresh
   * blocks. Both are one undo step.
   */
  function insertRecognized(src: string) {
    const runs = runsFromSource(src);
    const onlyMath = runs.length === 1 && runs[0].kind === "math";
    if (onlyMath) {
      const tex = blockToKatex((runs[0] as { kind: "math"; block: Block }).block);
      if (ceInner(tex) != null) onInsertChem(tex);
      else onInsert(tex);
      return;
    }
    // Editing prose: land it at the caret, where the writer was looking.
    if (editingId && editingPara && taRef.current) {
      const t = taRef.current;
      spliceIntoTextarea(t.selectionStart ?? caretRef.current, t.selectionEnd ?? caretRef.current, src);
      return;
    }
    // A list item holding the caret: the reading lands beside its bullet, on
    // the item's one line. Turning it into blocks under the list is what left a
    // bullet empty with the handwritten sentence and its maths below it.
    const textInsert = activeTextInserter();
    if (textInsert) {
      const line = src.replace(/\s*\n\s*/g, " ").trim();
      if (line) textInsert(line);
      return;
    }
    const fresh = blocksFromSource(src);
    if (fresh.length === 0) return;
    const anchorId = editingId ?? selected?.id ?? null;
    setBlocks((bs) => {
      const i = anchorId ? bs.findIndex((b) => b.id === anchorId) : -1;
      const next = [...bs];
      if (i < 0) next.push(...fresh);
      else next.splice(i + 1, 0, ...fresh);
      return next;
    });
    setEditingId(null);
    setSelected(null);
    setTimeout(() => scrollToBlock(fresh[0].id), 60);
  }

  /** Replace [from, to) of the editing textarea with `insert`, commit, and
   *  restore focus with the caret after the insertion — or at `caretAt`, for an
   *  insert the user is meant to type INTO (an empty `$…$` pair). */
  function spliceIntoTextarea(from: number, to: number, insert: string, caretAt?: number) {
    const t = taRef.current;
    if (!t) return;
    const cur = t.value;
    const next = cur.slice(0, from) + insert + cur.slice(to);
    const pos = caretAt ?? from + insert.length;
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
    const url = (await uiPrompt({ title: "Insert link", placeholder: "https://…", initial: "https://", confirmLabel: "Insert" }))?.trim();
    if (!url) return;
    spliceIntoTextarea(s, e, `[${sel}](${url})`);
  }

  // ── note links ([[ or the toolbar button → picker → [title](note://…)) ─────
  /** Open the picker to replace the `[[query` trigger range (the inline menu's
   *  "browse" escape hatch, so the range may be longer than just "[["). */
  function openNoteLinkPicker(from: number, to: number) {
    if (readOnlyRef.current) return;
    setLinkPicker({ from, to, expect: taRef.current?.value.slice(from, to) ?? "[[" });
  }
  function toolbarNoteLink() {
    if (!editingId || !editingPara) return;
    const t = taRef.current;
    if (!t) return;
    const s = t.selectionStart ?? 0;
    const e = t.selectionEnd ?? s;
    const sel = t.value.slice(s, e);
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
        const p = withBox(paragraphFromSource(cur.value ?? "", cur.id), boxOf(cur));
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
      const h: Block = withBox({ ...makeHeading(style, draft || cur.value || ""), id: cur.id }, boxOf(cur));
      updateById(cur.id, () => h);
      setSelected(null);
      setEditingId(cur.id);
    } else {
      insertHeading(style);
    }
  }

  // ── lists / equation ──────────────────────────────────────────────────────
  function insertList(ordered: boolean, marker?: ListMarker) {
    // Google Docs: a list button pressed in a line puts THAT line in the list,
    // text and caret kept, rather than starting an empty list under it.
    const open = editingId && editingPara ? pkgRef.current?.tree.blocks.find((b) => b.id === editingId) : null;
    if (open && isParagraph(open)) {
      const ta = taRef.current;
      const text = ta?.value ?? draft;
      paragraphToList(open.id, ordered, text, ta?.selectionStart ?? text.length, marker);
      return;
    }
    listCaret.current = null; // a fresh list opens in its first (only) item
    listCaretOffset.current = null;
    const l = makeList(ordered, marker);
    addBlock(l, false);
    setEditingPara(false);
    setEditingId(l.id);
  }
  /**
   * Turn a paragraph into a list item: the list buttons pressed in it, or a
   * bullet ("- ", "1. ") typed at its start (EditBox → listTrigger). `text`
   * is its live source, and the caret opens at `caret` in the item. A paragraph
   * directly under a list of the same kind joins that list as its last item,
   * as in Docs, so a list you stepped out of carries on.
   */
  function paragraphToList(blockId: string, ordered: boolean, text: string, caret: number, marker?: ListMarker) {
    if (!capsRef.current.editBlocks) return;
    const bs = pkgRef.current?.tree.blocks ?? [];
    const i = bs.findIndex((b) => b.id === blockId);
    if (i < 0) return;
    const prev = i > 0 ? bs[i - 1] : null;
    const joins = prev?.type === "list" && listOrdered(prev) === ordered && (!marker || listMarker(prev) === marker);
    const target = joins && prev
      ? withList(prev, [...listItems(prev), text], undefined, [...listLevels(prev), 0])
      : withBox(withList(makeList(ordered, marker), [text]), boxOf(bs[i]));
    const item = joins && prev ? listItems(prev).length : 0;
    setBlocks((all) =>
      joins && prev
        ? all.filter((b) => b.id !== blockId).map((b) => (b.id === prev.id ? target : b))
        : all.map((b) => (b.id === blockId ? target : b)),
    );
    listCaret.current = item;
    listCaretOffset.current = Math.max(0, Math.min(caret, text.length));
    setSelected(null);
    setEditingPara(false);
    setEditingId(target.id);
  }
  /** Which item of a rendered list a click landed in (for the caret). */
  const listCaret = useRef<number | null>(null);
  /** Where in that item the caret opens (null: the end). */
  const listCaretOffset = useRef<number | null>(null);
  function listItemAt(target: HTMLElement): number | null {
    // `data-item` is the index into attrs.items: the read view leaves blank
    // items out, so a row's position among its siblings is not its index.
    const n = Number(target.closest<HTMLElement>("li[data-item]")?.dataset.item);
    return Number.isInteger(n) ? n : null;
  }
  function setListItems(blockId: string, items: string[], levels: number[]) {
    updateById(blockId, (b) => withList(b, items, undefined, levels));
  }
  /**
   * Enter on an empty list item: leave the list. What came before it stays a
   * list, what came after becomes a second one, and a new paragraph goes
   * between them — where the caret lands. A list with nothing left before the
   * break is replaced by the paragraph outright, so "bullet, Enter, Enter"
   * turns an accidental list back into prose.
   */
  function listToParagraph(blockId: string, before: string[], trailing: string[], beforeLevels?: number[], trailingLevels?: number[]) {
    if (!capsRef.current.editBlocks) return;
    // Out of the list, but not out of the box the list sits in.
    const box = boxOf(pkgRef.current?.tree.blocks.find((b) => b.id === blockId));
    const para = withBox(paragraphFromSource(""), box);
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === blockId);
      if (i < 0) return bs;
      const ordered = listOrdered(bs[i]);
      const keep = before.some((t) => t.trim());
      const tail = trailing.some((t) => t.trim()) ? [withBox(withList(makeList(ordered), trailing, undefined, trailingLevels), box)] : [];
      const next = [...bs];
      next.splice(i, 1, ...(keep ? [withList(bs[i], before, undefined, beforeLevels), para, ...tail] : [para, ...tail]));
      return next;
    });
    startEdit(para);
  }
  function setListOrdered(blockId: string, ordered: boolean) {
    updateById(blockId, (b) => withList(b, listItems(b), ordered));
  }
  /**
   * An equation is always a line of its own, centred: after the paragraph or
   * list holding the caret, or in place of an empty line — never inside the
   * words, even in a bullet. A formula IN the words is the formula button's job.
   * A formula open in the current line is written first, last keystroke included.
   */
  function insertEquation() {
    editBoxRef.current?.commitInline();
    addBlock(getSettings().mathEditorBeta ? structuralEquation() : displayFromSource(""));
  }
  /** Insert ▸ Chemical equation: the chemistry twin of insertEquation. */
  function insertChemEquation() {
    editBoxRef.current?.commitInline();
    addBlock(displayFromSource(""), true, true);
  }
  /**
   * Inline formula: `$…$` at the caret — wrapped around the selection if there
   * is one, otherwise an empty pair with the caret between the dollars, ready
   * to type into.
   */
  function insertFormula() {
    if (!capsRef.current.editBlocks) return;
    // In a sentence, a formula is typed in a box at the caret
    // (components/RichLine), starting from any selected text — never as
    // `$…$` source for the writer to fill in.
    if (editingId && editingPara && taRef.current) { editBoxRef.current?.openMath(""); return; }
    // A list item holding the caret opens the same box in the item (ListEditor).
    const openFormula = activeFormulaOpener();
    if (openFormula) { openFormula(""); return; }
    // Another textbox that holds maths as source (a table cell).
    const textInsert = activeTextInserter();
    if (textInsert) { textInsert("$$", 1); return; }
    // No caret anywhere to hold an inline formula. A formula with no sentence
    // around it is just an equation, so open one.
    insertEquation();
  }

  // ── code blocks ───────────────────────────────────────────────────────────
  /** Insert a runnable code block after the cursor. Its own mini IDE manages
   *  focus (like graph/table/image), so never route it into startEdit. */
  function insertCode(langId?: string) {
    // Language is switched on the block itself (CodeBlockView owns that picker),
    // so the toolbar no longer carries a second one.
    addBlock(makeCodeBlock(langId ?? "python"), false);
  }

  // ── graphs ────────────────────────────────────────────────────────────────
  function commitGraph(graph: GraphData) {
    const target = graphEdit?.id ?? null;
    if (target) updateById(target, (b) => withGraph(b, graph));
    else addBlock(makeGraphBlock(graph), false);
    setGraphEdit(null);
  }
  /** "Plot this equation": drop a graph block (framed to fit the curve) right
   *  after a display formula, plotting it as y = f(x). Gated by `plottableExpr`
   *  so it only runs on formulas that actually parse to a function of x. */
  function plotEquation(b: Block, expr: string) {
    if (readOnlyRef.current) return;
    const g = defaultGraph();
    g.view = fitViewToExpr(expr);
    g.shapes = [{ id: newGraphId(), kind: "function", expr, color: SHAPE_PALETTE[0] }];
    const gb = makeGraphBlock(g);
    setBlocks((bs) => {
      const i = bs.findIndex((x) => x.id === b.id);
      const next = [...bs];
      next.splice(i < 0 ? bs.length : i + 1, 0, gb);
      return next;
    });
    setEditingId(null);
    setSelected(null);
    setTimeout(() => scrollToBlock(gb.id), 60);
  }

  // ── ⌘K command palette bridge ─────────────────────────────────────────────
  /** Insert a module (or preset stack) as a fresh section after the cursor.
   *  Unlike the slash flow there is no `/query` paragraph to clean up, so this
   *  just splices after the current anchor (or appends), raising the fields
   *  dialog for `{{token}}` modules exactly like the slash inserter. */
  function paletteInsertModule(m: Module) {
    if (readOnlyRef.current) return;
    const anchorId = editingId ?? selected?.id ?? null;
    const proceed = (values: Record<string, string>) => {
      const fresh = fillFields(freshBlocks(m.blocks), values);
      if (fresh.length === 0) return;
      setBlocks((bs) => {
        const i = anchorId ? bs.findIndex((b) => b.id === anchorId) : -1;
        const next = [...bs];
        if (i < 0) next.push(...fresh);
        else next.splice(i + 1, 0, ...fresh);
        return next;
      });
      recordModuleUse(m.id);
      setEditingId(null);
      setSelected(null);
      setTimeout(() => scrollToBlock(fresh[0].id), 60);
    };
    const fields = moduleFields(m.blocks);
    if (fields.length === 0) { proceed({}); return; }
    setFieldsPrompt({ name: m.name, fields, proceed });
  }

  /** Dispatch a row of the toolbar's Insert menu. Everything here already had a
   *  home in the editor — the menu only changes how it is reached, so each arm
   *  is a straight call rather than a second implementation. */
  function onInsertAction(action: InsertAction) {
    switch (action) {
      case "paragraph": addBlock(paragraphFromSource("")); break;
      case "box": addBlock(withBox(paragraphFromSource(""), newBox(lastBoxColor()))); break;
      case "heading": insertHeading(2); break;
      case "bulletList": insertList(false); break;
      case "numberList": insertList(true); break;
      case "equation": insertEquation(); break;
      // A chemical equation is a math block tagged `attrs.kind = "chem"`, which
      // is what opens it in the mhchem editor rather than the maths one.
      case "chemistry": insertChemEquation(); break;
      case "graph": setGraphEdit({ id: null }); break;
      case "table": setTablePicker(true); break;
      case "code": insertCode(); break;
      case "image": newImageRow(); break;
      case "link": void insertLink(); break;
      case "noteLink": toolbarNoteLink(); break;
    }
  }

  /** Dispatch a named palette command to the matching editor action. */
  function runCommand(cmd: EditorCommand) {
    switch (cmd) {
      case "insertParagraph": addBlock(paragraphFromSource("")); break;
      case "insertHeading": insertHeading(2); break;
      case "insertList": insertList(false); break;
      case "insertEquation": insertEquation(); break;
      case "insertTable": setTablePicker(true); break;
      case "insertGraph": setGraphEdit({ id: null }); break;
      case "insertCode": insertCode(); break;
      case "insertImage": newImageRow(); break;
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "save": void save(); break;
      case "print": void printPdf(); break;
      case "toggleSource": setShowSource((v) => !v); break;
      case "openShare": setShareOpen(true); break;
      case "openTemplates": setTemplatesOpen(true); break;
      case "openSymbols": setSymbolsOpen(true); break;
      case "openInk": setInkOpen(true); break;
      case "openHistory": setHistoryOpen(true); break;
    }
  }

  // ── version history ────────────────────────────────────────────────────────
  /** Save the current tree as a named manual version (persists latest first). */
  async function saveVersion(label: string) {
    if (!capsRef.current.editHistory) return;
    await save();
    const tree = pkgRef.current?.tree;
    if (!tree) return;
    await getStore().saveSnapshot(id, tree, { label, kind: "manual" });
    lastAutoVersionAt.current = Date.now(); // a manual save resets the auto throttle
  }
  /** Replace the note with a past version. The current tree is snapshotted first
   *  (as a version AND onto the undo stack) so the restore is reversible. */
  async function restoreSnapshot(snap: NoteSnapshot) {
    if (!capsRef.current.editHistory) return;
    const cur = pkgRef.current;
    if (!cur) return;
    try { await getStore().saveSnapshot(id, cur.tree, { label: "Before restore", kind: "auto" }); } catch { /* best-effort */ }
    snapshot(false); // push current tree so Ctrl-Z undoes the restore
    applyTree(snap.tree);
    setHistoryOpen(false);
    void saveFnRef.current();
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
    if (!capsRef.current.persist) return; // viewer/commenter: nothing to persist (RLS also blocks)
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
        // Version-history timeline: capture an auto snapshot of the saved tree,
        // throttled so rapid autosaves don't flood history (pruned to the newest
        // AUTO_SNAPSHOT_KEEP in the store). Best-effort — never fails the save.
        const nowMs = Date.now();
        if (nowMs - lastAutoVersionAt.current > AUTO_VERSION_INTERVAL_MS) {
          lastAutoVersionAt.current = nowMs;
          void store.saveSnapshot(id, p.tree, { label: "Autosave", kind: "auto" }).catch(() => {});
        }
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
  const hidden = sectionFolding ? hiddenBlockIds(blocks) : new Set<string>();
  const visibleBlocks = hidden.size ? blocks.filter((b) => !hidden.has(b.id)) : blocks;
  const headingNumbers = computeHeadingNumbers(blocks);
  const editingBlock = editingId ? blocks.find((b) => b.id === editingId) : null;
  const currentStyle: "text" | HeadingLevel =
    editingBlock && editingBlock.type === "heading" ? headingLevel(editingBlock) : "text";
  /**
   * A press on empty document space ends the current edit.
   *
   * Every way OUT of a block is explicit: this, Escape, and pressing into
   * another block. NOTHING exits on blur. An editor that closes when it loses
   * focus is one that a dialog, a colour picker or a re-render can close behind
   * the writer's back — and it made "click the next line" a coin flip, because
   * the re-render triggered by the blur-exit replaced the node the press had
   * landed on, so the browser never delivered the click that would have opened
   * it (mousedown and mouseup must share a target for a click to fire).
   *
   * Layered, like Escape: an open inline formula popover is committed first
   * (never discarded), and the block edit ends on the next press.
   */
  const exitOnBlankClick = (e: MouseEvent) => {
    if (!editingId && !selected) return;
    const t = e.target as HTMLElement | null;
    // Blank = inside the document surface, but not on a block and not on a
    // control. Anything interactive handles its own press.
    if (!t || t.closest("[data-btype]")) return;
    if (t.closest("button, a, input, select, textarea, math-field, [contenteditable]")) return;
    if (editBoxRef.current?.commitInline()) return;
    setSelected(null);
    if (editingId) endEdit(editingId);
  };

  /** Toolbar and symbol presses hold the caret where it is, so what they insert
   *  lands at the caret rather than at the end of the line. */
  const keepFocus = (e: MouseEvent) => {
    // A MathField or a table-cell textbox isn't tracked by `editingId`, but a
    // caret in one is still a caret an insert should land at.
    if (editingId || activeMathField() || activeTextInserter()) e.preventDefault();
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
  const docStyle = pkg.tree.style ?? {};
  const style = resolveStyle(docStyle);
  const margin = Math.round(pageW * style.marginRatio);
  const pageContent = pageH - 2 * margin;
  const layout = style.pageLayout;
  // The symbol strip follows the caret: it is on screen while a formula is open
  // for editing, and otherwise only if the user pinned it (⌘/). Derived from the
  // block's TYPE rather than `editingPara`, because heading edits set
  // `editingId` without touching that flag and would otherwise count as maths.
  // "The caret is somewhere a symbol can land": a formula block being edited, or
  // an inline formula opened inside a paragraph.
  const inFormula = editingBlock?.type === "math" || inlineEditor !== null;
  const symbolTabOpen = caps.editBlocks && (symbolsPinned || (inFormula && !tabDismissed));
  /**
   * What the symbol tab sits beside: the formula holding the caret — an open
   * formula box inside a line, or the equation's own block — or, with no
   * formula, the top-bar button that opened it.
   */
  const symbolTabAnchor = (): DOMRect | null => {
    const el = editingId ? blockEls.current.get(editingId) : null;
    if (el && inFormula) {
      const open = [...el.querySelectorAll<HTMLElement>(".aq-inline-math")].find((c) => (c.lastElementChild?.childElementCount ?? 0) > 0);
      if (open) return open.getBoundingClientRect();
      if (editingBlock?.type === "math") return el.getBoundingClientRect();
    }
    return symbolsBtnRef.current?.getBoundingClientRect() ?? null;
  };
  const indexById = new Map(blocks.map((b, i) => [b.id, i] as const));
  const noIndent = unindentedParagraphs(visibleBlocks);
  // Each block's place in its box, over the blocks as laid out.
  const boxEdgeById = boxEdges(visibleBlocks);
  // The box holding the caret (or the selected figure), for the Box menu.
  const boxTargetAt = editingId ?? selected?.id;
  const caretBoxRun = boxTargetAt != null && indexById.has(boxTargetAt) ? boxRun(blocks, indexById.get(boxTargetAt)!) : null;
  const caretBox = caretBoxRun ? boxOf(blocks[caretBoxRun[0]]) : null;
  const packed = paginate(visibleBlocks, heights, pageContent, style.paraSkip);
  // Always keep one completely blank page at the end so the canvas never feels
  // "full". paginate() only ends on an empty page for an empty document; once
  // there's content, append a fresh blank sheet. Same page list drives both the
  // vertical and horizontal layouts, so this works for both.
  const pages =
    packed[packed.length - 1].length === 0 ? packed : [...packed, []];
  // The last page with content — used so print suppresses the break after it
  // (`:last-child` would match the hidden, appended blank page instead).
  const lastContentPage = pages.reduce((acc, ids, i) => (ids.length ? i : acc), -1);
  const contentStyle = pageContentStyle(style, pageW) as CSSProperties;

  return (
    <main ref={rootRef} className="relative flex h-full min-h-0 flex-col" onMouseDown={onActivate}>
      <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />

      {/* ── Header: what the document IS and what you do TO it ───────────────
          Per-block actions live in the bar below; nothing here changes text. */}
      <header className="print-hide flex items-center gap-2 border-b border-border px-4 py-2.5">
        {split && <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">{primary ? "A" : "B"}</span>}
        <input value={title} readOnly={!caps.editTitle} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
        {!readOnly && (
          <div className="flex items-center">
            <button onMouseDown={(e) => e.preventDefault()} onClick={undo} disabled={undoStack.current.length === 0} title="Undo (⌘/Ctrl+Z)" aria-label="Undo" className={HEAD_BTN}><Icon name="undo" size={18} /></button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={redo} disabled={redoStack.current.length === 0} title="Redo (⌘/Ctrl+Shift+Z)" aria-label="Redo" className={HEAD_BTN}><Icon name="redo" size={18} /></button>
          </div>
        )}
        {collab.active && <PresenceAvatars peers={collab.peers} selfId={user?.id ?? null} connected={collab.connected} />}
        {/* Save is a STATUS, not an action: the note autosaves, so a floppy-disk
            button spent premium header space implying work the app already did.
            It stays clickable (and ⌘S still works) for the "save right now"
            reflex, but it reads as the state it reports. */}
        {!caps.persist
          ? <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-sm text-muted"><Icon name="lock" size={14} />{access === "commenter" ? "Comment only" : "View only"}</span>
          : (
            <button
              onClick={save}
              title={saving ? "Saving…" : saved ? "All changes saved" : "Unsaved changes — click to save now"}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-sm transition ${saving ? "text-accent" : saved ? "text-muted hover:bg-foreground/[0.06]" : "text-accent hover:bg-accent-soft"}`}
            >
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${saving ? "animate-pulse bg-accent" : saved ? "bg-faint" : "bg-accent"}`} />
              {saving ? "Saving…" : saved ? "Saved" : "Unsaved"}
            </button>
          )}
        {isCloudActive() && <button onClick={() => setShareOpen(true)} title="Share this document" aria-label="Share" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"><Icon name="share" size={16} />Share</button>}
        <ExportMenu noteId={id} title={title} beforeExport={save} onPdf={printPdf} label={<Icon name="download" size={18} />} className={HEAD_BTN} />
        {caps.editHistory && <button onClick={() => setHistoryOpen(true)} title="Version history" aria-label="Version history" className={HEAD_BTN}><Icon name="history" size={18} /></button>}
        {onClose && <button onClick={onClose} title="Close this pane" aria-label="Close pane" className="grid h-9 w-9 place-items-center rounded-md text-muted transition hover:bg-danger/10 hover:text-danger"><Icon name="close" size={17} /></button>}
      </header>

      {/* ── The one permanent bar ─────────────────────────────────────────────
          Insert is a labelled menu, so a glyph no longer has to carry a whole
          action on its own; what stays visible is the small set worth muscle
          memory. Formatting that needs a selection lives in FormatPopover. */}
      <div className={`print-hide flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 ${readOnly ? "hidden" : "flex"}`}>
        <InsertMenu onPick={onInsertAction} proseActive={!!editingId && editingPara} keepFocus={keepFocus} />

        {/* Block style — the one control that always kept a word label. */}
        <select
          value={typeof currentStyle === "number" ? String(currentStyle) : "text"}
          onChange={(e) => applyStyle(e.target.value === "text" ? "text" : (Number(e.target.value) as HeadingLevel))}
          title="Style of the current block"
          aria-label="Block style"
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none hover:border-accent focus:border-accent"
        >
          <option value="text">Body text</option>
          <option value={1}>Title</option>
          <option value={2}>Subtitle</option>
          <option value={3}>Subsubtitle</option>
          <option value={4}>Subsubsubtitle</option>
        </select>

        <span className="mx-0.5 h-6 w-px bg-border" />

        {/* Character formatting. Also reachable from the selection popover; here
            they double as "wrap the word I'm about to type". */}
        <span className={GROUP}>
          <button onMouseDown={keepFocus} onClick={() => wrapSelection("**")} title="Bold (**…**)" aria-label="Bold" className={GROUP_BTN}><Icon name="bold" size={16} /></button>
          <button onMouseDown={keepFocus} onClick={() => wrapSelection("*")} title="Italic (*…*)" aria-label="Italic" className={GROUP_BTN}><Icon name="italic" size={16} /></button>
          <button onMouseDown={keepFocus} onClick={() => wrapSelection("__")} title="Underline (__…__)" aria-label="Underline" className={GROUP_BTN}><Icon name="underline" size={16} /></button>
          <button onMouseDown={keepFocus} onClick={() => wrapSelection("~~")} title="Strikethrough (~~…~~)" aria-label="Strikethrough" className={GROUP_BTN}><Icon name="strike" size={16} /></button>
        </span>

        <span className={GROUP}>
          <button onMouseDown={keepFocus} onClick={() => insertList(false)} title="Bulleted list" aria-label="Bulleted list" className={GROUP_BTN}><Icon name="list" size={16} /></button>
          <button onMouseDown={keepFocus} onClick={() => insertList(true)} title="Numbered list" aria-label="Numbered list" className={GROUP_BTN}><Icon name="listnumber" size={16} /></button>
        </span>

        {/* A coloured box, LaTeX's tcolorbox: the line holding the caret goes in
            one, and the menu recolours, titles, grows or removes the box the
            caret is in. */}
        <BoxMenu
          box={caretBox}
          canExtend={!!caretBoxRun && caretBoxRun[1] < blocks.length - 1}
          keepFocus={keepFocus}
          onColor={pickBoxColor}
          onTitle={(t) => setBoxTitle(t)}
          onExtend={extendBox}
          onRemove={removeBox}
        />

        {/* Maths, the same pair-of-buttons shape as the lists: one in the
            sentence, one on its own line — which is exactly what `$…$` and
            `$$…$$` mean when typed. */}
        <span className={GROUP}>
          <button onMouseDown={keepFocus} onClick={insertFormula} title="Formula in the text ($…$)" aria-label="Insert a formula in the text" className={GROUP_BTN}><Icon name="inlineformula" size={16} /></button>
          <button onMouseDown={keepFocus} onClick={insertEquation} title="Equation on its own line ($$…$$)" aria-label="Insert an equation" className={GROUP_BTN}><Icon name="displayeq" size={16} /></button>
          <button ref={symbolsBtnRef} onMouseDown={keepFocus} onClick={toggleSymbolTab} title="Symbols — open the symbol tab (⌘/)" aria-label="Symbol tab" aria-pressed={symbolsPinned} className={`${GROUP_BTN} ${symbolsPinned ? "bg-accent-soft text-accent" : ""}`}><Icon name="sum" size={16} /></button>
        </span>

        <span className="mx-0.5 h-6 w-px bg-border" />

        <button onClick={() => setShowSource((s) => !s)} title={showSource ? "Back to the visual editor" : "Show the LaTeX source"} aria-label={showSource ? "Show visual editor" : "Show LaTeX source"} aria-pressed={showSource} className={`${TEXT_BTN} ${showSource ? "bg-accent-soft text-accent" : ""}`}><Icon name="tex" size={20} /></button>
        {/* keepFocus (like Insert link): opening the sheet while editing prose keeps the block editor
            alive, so Insert routes the recognized LaTeX into it as inline math. */}
        <button onMouseDown={keepFocus} onClick={() => setInkOpen((o) => !o)} title="Handwrite notes — Ancha reads words and formulas together" aria-label="Handwrite notes with Ancha" aria-pressed={inkOpen} className={`${TEXT_BTN} ${inkOpen ? "bg-accent-soft text-accent" : ""}`}><Icon name="penline" size={17} />Handwrite</button>

        <span className="flex-1" />

        {caps.editBlocks && <button onClick={() => setTemplatesOpen(true)} title="Design — templates, modules & backgrounds" aria-label="Design — templates, modules and backgrounds" className={TEXT_BTN}><Icon name="colorwheel" size={17} />Design</button>}
        <button onClick={() => setInspectorOpen((v) => !v)} title="Document settings — typeface, spacing, page flow" aria-label="Document settings" aria-pressed={inspectorOpen} className={`${TEXT_BTN} ${inspectorOpen ? "bg-accent-soft text-accent" : ""}`}><Icon name="textstyle" size={17} />Document</button>
      </div>

      {/* ── Symbols — a small movable tab beside the formula being edited ─────
          It opens under the equation or inline formula holding the caret and
          follows it; drag it anywhere and it keeps that place relative to the
          next formula too. The top bar's Σ button (or ⌘/) opens it without a
          formula. The tab shows the math set or its chemistry mirror. */}
      {symbolTabOpen && (
        <SymbolTab
          anchor={symbolTabAnchor}
          anchorKind={inFormula ? "formula" : "bar"}
          mode={barMode}
          onMode={setBarMode}
          onClose={closeSymbolTab}
          keepFocus={keepFocus}
        >
          {barMode === "chem" ? (
            <ChemToolbar compact onInsert={onInsertChem} onNewEquation={insertChemEquation} onBrowse={() => setChemOpen(true)} keepFocus={keepFocus} />
          ) : (
            <SymbolToolbar compact onInsert={onInsert} onText={toggleFormulaText} onBrowse={() => setSymbolsOpen(true)} keepFocus={keepFocus} />
          )}
        </SymbolTab>
      )}

      {locked === "access" && (
        <div className="print-hide flex items-center justify-center gap-1.5 border-b border-border bg-warning/10 px-6 py-2 text-center text-sm text-warning">
          <Icon name="lock" size={14} /> You have {access === "commenter" ? "comment-only" : "view-only"} access to this shared document — your changes won’t be saved.
        </div>
      )}
      {/* An import is locked for a different reason than a share is, so it must
          not borrow the sharing copy — nothing here is going unsaved. */}
      {locked === "pdf" && (
        <div className="print-hide flex items-center justify-center gap-1.5 border-b border-border bg-accent-soft px-6 py-2 text-center text-sm text-accent">
          <Icon name="penline" size={14} /> Imported {pkg.tree.source?.filename ? `“${pkg.tree.source.filename}”` : "PDF"} — you can handwrite on it. Other editing is off for imported files.
        </div>
      )}

      {/* Body + inspector. The row exists so document settings can sit BESIDE
          the page: they are tuned while watching the text reflow, which a strip
          above the canvas could never show at the same time. `min-w-0` keeps
          the canvas from pushing the panel off-screen at narrow widths. */}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
      {/* Body — an imported PDF replaces the block canvas entirely: its content
          is the attached file, and its tree is deliberately block-less. */}
      {pdfSource ? (
        <PdfDocumentView
          source={pdfSource}
          bytes={pdfBytes}
          initialStrokes={initialAnnotations}
          canAnnotate={caps.annotate}
          zoom={zoom}
          onStrokesChange={onAnnotationChange}
        />
      ) : showSource ? (
        <div className="mx-auto w-full max-w-3xl flex-1 p-8">
          <p className="mb-2 text-xs text-muted">Generated LaTeX (read-only — derived from the block tree)</p>
          <textarea readOnly value={documentToLatex(pkg.tree)} className="h-[70vh] w-full rounded-lg border border-border bg-surface p-4 font-mono text-sm" />
        </div>
      ) : (
        <div onMouseDown={exitOnBlankClick} className={`print-surface flex-1 overflow-auto p-8 ${inkOpen ? "pb-[52vh]" : ""}`} style={{ background: "var(--background)" }}>
          <div className={`print-stack ${layout === "horizontal" ? "flex items-start gap-8" : "flex flex-col items-center gap-8"}`}>
            {pages.map((ids, p) => (
              <div key={p} className={`print-page relative shrink-0 text-foreground shadow-xl ring-1 ring-border ${docStyle.background ? "" : "bg-surface"} ${ids.length === 0 ? "print-hide" : ""} ${p === lastContentPage ? "last-print-page" : ""}`} style={{ width: pageW, minHeight: pageH, background: docStyle.background || undefined, color: docStyle.foreground || undefined }}>
                <div className={`${presetClass(style.preset)} flex flex-col`} style={{ ...contentStyle, minHeight: pageH }}>
                  {blocks.length === 0 ? null : (
                    <div className="flex flex-col" style={{ gap: "var(--para-skip)" }}>
                      {ids.map((id, k) => {
                        const gi = indexById.get(id) ?? -1;
                        const b = blocks[gi];
                        if (!b) return null;
                        const editors = remoteEditing.get(id);
                        // A boxed block draws its slice of the box (`.aq-box` in
                        // app/globals.css). The frame closes at the box's ends and
                        // wherever a page break cuts it, as a breakable tcolorbox's does.
                        const edge = boxEdgeById.get(id);
                        // Highlight a block a collaborator is editing (outline does
                        // not affect offsetHeight, so pagination is unaffected) and
                        // flag it with their name(s), Google-Docs style.
                        return (
                          <div
                            key={id}
                            ref={setBlockRef(id)}
                            data-btype={b.type}
                            data-noindent={noIndent.has(id) ? "" : undefined}
                            data-box-start={edge?.start ? "" : undefined}
                            data-box-end={edge?.end ? "" : undefined}
                            data-box-top={edge && (edge.start || k === 0) ? "" : undefined}
                            data-box-bottom={edge && (edge.end || k === ids.length - 1) ? "" : undefined}
                            data-box-titled={edge?.start && edge.box.title ? "" : undefined}
                            className={edge ? "aq-box relative" : "relative"}
                            style={{ ...(edge ? boxCssVars(edge.box) : null), ...(editors ? { outline: `2px solid ${editors[0].color}`, outlineOffset: "3px", borderRadius: "3px" } : null) } as CSSProperties}
                          >
                            {/* The peer's name rides on their live caret flag
                                (CollabCursors); a peer with no broadcast caret
                                yet still gets a name pill here as a fallback. */}
                            {editors && (
                              <span className="print-hide pointer-events-none absolute -top-2.5 right-0 z-10 flex gap-1">
                                {editors.filter((peer) => !peer.cursor).map((peer) => (
                                  <span key={peer.userId} className="rounded px-1.5 py-0.5 text-[10px] font-medium leading-none text-white shadow" style={{ backgroundColor: peer.color }}>{peer.username}</span>
                                ))}
                              </span>
                            )}
                            {edge?.start && edge.box.title && (
                              <div className="aq-box-title">
                                {caps.editBlocks
                                  ? <input value={edge.box.title} onChange={(e) => setBoxTitle(e.target.value, id)} aria-label="Box title" spellCheck />
                                  : edge.box.title}
                              </div>
                            )}
                            {renderBlock(b)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* The rest of the sheet is a write target: clicking the empty
                      space below the last block starts a paragraph at the end.
                      No chrome at rest — the affordance is a text cursor plus a
                      caret that fades in where the line would begin. It is a
                      <button>, so exitOnBlankClick leaves it alone and this
                      handler wins. */}
                  {caps.editBlocks && p >= lastContentPage && (
                    <button
                      onClick={appendParagraph}
                      aria-label="Add a paragraph at the end"
                      // items-start: a <button> centres its content, which would
                      // float the caret halfway down the sheet instead of where
                      // the new line actually begins.
                      className="group print-hide flex min-h-10 flex-1 cursor-text items-start rounded-md text-left"
                    >
                      {/* The caret is a "your cursor would land here" hint, so
                          it must not show while a real caret already exists —
                          clicking the zone opens an edit box directly above it,
                          and the pointer is still hovering, which showed two
                          insertion points at once. */}
                      <span aria-hidden className={`mt-1 block h-[1.15em] w-px bg-foreground/50 opacity-0 transition-opacity duration-100 ${editingId || selected ? "" : "group-hover:opacity-100"}`} />
                    </button>
                  )}
                </div>
                <span className="pointer-events-none absolute bottom-1.5 right-3 text-[10px] text-muted">{p < pages.length - 1 || ids.length > 0 ? p + 1 : null}</span>
              </div>
            ))}
          </div>
        </div>
      )}
        </div>
        {/* The PDF viewer owns its own zoom/annotation chrome and has no block
            tree to style, so the inspector would be all dead controls there. */}
        {inspectorOpen && !pdfSource && (
          <DocumentInspector
            preset={style.preset}
            fontKey={style.fontKey}
            fontFamily={style.fontFamily}
            fontSize={style.fontSize}
            lineSpacing={style.lineSpacing}
            indent={style.indent}
            layout={layout}
            zoom={zoom}
            showSource={showSource}
            canEditStyle={caps.editDocStyle}
            onStyle={setDocStyle}
            onZoom={setZoom}
            onToggleSource={() => setShowSource((v) => !v)}
            onClose={() => setInspectorOpen(false)}
            overlay={paneNarrow}
          />
        )}
      </div>

      {/* Formatting for a live selection — see FormatPopover for why it anchors
          to the edit box rather than the selection rectangle. */}
      {caps.editBlocks && (
        <FormatPopover
          // The block wrapper, not the textarea: EditBox stacks its own colour
          // and insert-formula rows above the text, and anchoring to the
          // textarea would drop the popover on top of them.
          getAnchor={() => (editingId ? blockEls.current.get(editingId) ?? null : null)}
          visible={hasSelection && !!editingId && editingPara}
          hlColor={hlColor}
          hlOpen={hlMenu}
          onHlToggle={() => setHlMenu((o) => !o)}
          onHlApply={() => wrapSelection(`==#${hlColor.replace("#", "")}:`, "==")}
          onHlColor={setHlColor}
          onWrap={(marker) => wrapSelection(marker)}
          onLink={() => void insertLink()}
          onNoteLink={toolbarNoteLink}
          keepFocus={keepFocus}
        />
      )}

      {symbolsOpen && (
        <SymbolPicker
          title="Functions & symbols"
          onPick={onInsert}
          onClose={() => setSymbolsOpen(false)}
          closeOnPick={false}
          keepFocus={keepFocus}
          autoFocusSearch={!editingId}
        />
      )}
      {chemOpen && (
        <SymbolPicker
          title="Chemistry library"
          symbols={CHEM_SYMBOLS}
          searchPlaceholder="Search… (e.g. water, sulfate, equilibrium, isotope)"
          onPick={onInsertChem}
          onClose={() => setChemOpen(false)}
          closeOnPick={false}
          keepFocus={keepFocus}
          autoFocusSearch={!editingId}
        />
      )}
      {tablePicker && <TablePicker onPick={insertTable} onClose={() => setTablePicker(false)} />}
      {inkOpen && !readOnly && (
        <InkInsertPanel
          onInsert={insertRecognized}
          onClose={() => setInkOpen(false)}
          suspendEscape={symbolsOpen || chemOpen || tablePicker || templatesOpen || !!confirmTemplate || !!moduleEdit || shareOpen || !!graphEdit}
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
          onInsertModule={(m) => { setTemplatesOpen(false); paletteInsertModule(m); }}
          onSaveCurrent={saveCurrentAsTemplate}
          onClose={() => setTemplatesOpen(false)}
        />
      )}
      {collab.active && <CollabCursors cursors={remoteCursors} blockEls={blockEls} />}
      {shareOpen && (
        <ShareDialog
          noteId={id}
          access={access}
          onClose={() => setShareOpen(false)}
          onCollaboratorsChanged={(count) => { if ((count > 0) !== shared) setSharedRev((n) => n + 1); }}
        />
      )}
      {historyOpen && (
        <HistoryPanel
          noteId={id}
          canWrite={!readOnly}
          onClose={() => setHistoryOpen(false)}
          onRestore={(snap) => void restoreSnapshot(snap)}
          onSaveVersion={saveVersion}
        />
      )}
      {linkPicker && (
        <NoteLinkPicker currentId={id} onPick={insertNoteLink} onClose={() => setLinkPicker(null)} />
      )}
      {moduleEdit && (
        <ModuleFileEditor
          initial={{ name: moduleEdit.name, blocks: moduleEdit.blocks }}
          onSave={(name, blocks) => { updateModule(moduleEdit.id, name, blocks); setModuleEdit(null); }}
          onClose={() => setModuleEdit(null)}
        />
      )}
      {sectionSave && (
        <SectionToModuleDialog
          section={sectionSave.blocks}
          suggestedName={sectionSave.name}
          modules={listSavedModules()}
          onCreate={(name) => { saveModule(name, sectionSave.blocks, new Date().toISOString()); setSectionSave(null); }}
          onAppend={(moduleId) => { appendToModule(moduleId, sectionSave.blocks); setSectionSave(null); }}
          onReplace={(moduleId) => { replaceModuleBlocks(moduleId, sectionSave.blocks); setSectionSave(null); }}
          onClose={() => setSectionSave(null)}
        />
      )}
      {confirmTemplate && (
        <TemplateApplyDialog
          onAdd={(dontAsk) => { if (dontAsk) setSettings({ templateApplyMode: "add" }); applyTemplate(confirmTemplate, "add"); }}
          onReplace={(dontAsk) => { if (dontAsk) setSettings({ templateApplyMode: "replace" }); applyTemplate(confirmTemplate, "replace"); }}
          onCancel={() => setConfirmTemplate(null)}
        />
      )}
      {fieldsPrompt && (
        <ModuleFieldsDialog
          name={fieldsPrompt.name}
          fields={fieldsPrompt.fields}
          onSubmit={(values) => { setFieldsPrompt(null); fieldsPrompt.proceed(values); }}
          onCancel={() => setFieldsPrompt(null)}
        />
      )}
    </main>
  );

  // ── one block row (chrome + content) ──────────────────────────────────────
  function renderBlock(b: Block): ReactNode {
    const isHeading = b.type === "heading";
    const isList = b.type === "list";
    // Text reads as text: the hover tint is for the object blocks (image,
    // table, graph, code), where "this is one thing you can move" is useful.
    // A formula counts as text here: it is a line you type into, so it gets the
    // text cursor and no hover rectangle. The tint is for the OBJECT blocks
    // (image, table, graph, code), where "this is one thing you can move" helps.
    const isTextBlock = isHeading || isList || isParagraph(b) || b.type === "math";
    const isImage = b.type === "image";
    const isTable = b.type === "table";
    const isGraph = b.type === "graph";
    const isCode = b.type === "code";
    // A display formula that parses to y = f(x) gets a hover "Plot" action.
    const plotExpr = b.id === editingId ? null : plottableExpr(b);
    // The hover row carries NO vertical padding: it would sit between every
    // pair of paragraphs, which under the LaTeX preset are meant to abut.
    return (
      // No reorder column in the margin (removed 2026-09-13): a block moves by
      // cut and paste like a line of any document, and whole sections still
      // drag in the outline.
      <div className={`group relative flex items-start gap-1 rounded-lg px-1 ${isTextBlock ? "" : "hover:bg-foreground/[0.03]"}`}>
        <div className="min-w-0 flex-1">
          {isHeading ? (
            b.id === editingId ? (
              // Edited where it sits, in its own type — the settings that used
              // to sit in a bar above it are a hover strip now (HeadingBar).
              <div className="group/edit relative flex items-baseline gap-1">
                {headingNumbers.get(b.id) && (
                  <span className={`${headingClass(b)} aq-heading shrink-0 text-muted`} data-level={headingLevel(b)}>{headingNumbers.get(b.id)}</span>
                )}
                <input
                  ref={headingRef}
                  value={b.value ?? ""}
                  autoFocus
                  onChange={(e) => setHeadingText(b.id, e.target.value)}
                  onKeyDown={(e) => onHeadingKey(e, b)}
                  style={{ textAlign: headingAlign(b) }}
                  data-level={headingLevel(b)}
                  className={`aq-heading w-full bg-transparent p-0 caret-accent outline-none ${headingClass(b)}`}
                />
                <HeadingBar block={b} onAlign={(a) => setHeadingAlign(b.id, a)} onNumbered={(v) => setHeadingNumbered(b.id, v)} />
              </div>
            ) : (
              <div className="flex items-center gap-1">
                {sectionFolding && (
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => toggleSection(b.id)} title={isHeadingCollapsed(b) ? "Expand section" : "Collapse section"} aria-label={isHeadingCollapsed(b) ? "Expand section" : "Collapse section"} aria-expanded={!isHeadingCollapsed(b)} className="print-hide grid shrink-0 place-items-center text-muted hover:text-accent"><Icon name="chevron" size={16} style={{ transform: isHeadingCollapsed(b) ? "rotate(-90deg)" : "none", transition: "transform .12s" }} /></button>
                )}
                <button onMouseDown={(e) => pressToEdit(e, b.id, () => startEditHeading(b))} className="block flex-1 cursor-text text-left">
                  <HeadingDisplay block={b} number={headingNumbers.get(b.id)} />
                </button>
                {sectionFolding && isHeadingCollapsed(b) && <span className="print-hide whitespace-nowrap text-xs italic text-muted">section hidden</span>}
              </div>
            )
          ) : isList ? (
            b.id === editingId ? (
              <ListEditor
                block={b}
                focusItem={listCaret.current}
                focusOffset={listCaretOffset.current}
                onItems={(items, caret, levels) => { listCaret.current = caret; setListItems(b.id, items, levels); }}
                onOrdered={(o) => setListOrdered(b.id, o)}
                onExit={() => endEdit(b.id)}
                onLeave={(dir) => stepToBlock(b.id, dir, dir === -1 ? "end" : "start")}
                onSplitOut={(before, beforeLevels, trailing, trailingLevels) => listToParagraph(b.id, before, trailing, beforeLevels, trailingLevels)}
                onInlineEditor={onInlineEditor}
                onFrontBack={() => listFrontBack(b.id)}
              />
            ) : (
              <button
                onMouseDown={(e) => pressToEdit(e, b.id, () => {
                  if (!capsRef.current.editBlocks) return;
                  setSelected(null);
                  listCaret.current = listItemAt(e.target as HTMLElement);
                  listCaretOffset.current = null;
                  setEditingPara(false);
                  setEditingId(b.id);
                })}
                className={TEXT_HIT}
              >
                <BlockView block={b} />
              </button>
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
              onSelect={() => { if (!capsRef.current.editBlocks) return; leaveOpenBlock(b.id); setSelected(null); setEditingId(null); setGraphEdit({ id: b.id }); }}
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
          ) : isCode ? (
            // No preventDefault: CodeMirror needs the press to place its own
            // caret. This only closes the line that was open.
            <div onMouseDown={() => leaveOpenBlock(b.id)}>
            <CodeBlockView
              block={b}
              noteId={id}
              readOnly={readOnly}
              // A run can finish after its block was deleted; committing then
              // would push a no-op undo step and dirty the note for nothing.
              onChange={(fn, coalesce) => {
                if (!pkgRef.current?.tree.blocks.some((x) => x.id === b.id)) return;
                setBlocks((bs) => bs.map((x) => (x.id === b.id ? fn(x) : x)), coalesce);
              }}
              />
            </div>
          ) : b.id === editingId ? (
            editingPara ? (
              <EditBox ref={editBoxRef} taRef={taRef} para={editingPara} draft={draft} color={color} onChange={onDraftChange} onColor={pickColor} onExit={() => endEdit(b.id)} onInsertModule={insertModule} onEditModule={editModule} onNoteLink={openNoteLinkPicker} onInlineEditor={onInlineEditor} onSplit={(before, after) => splitParagraph(b.id, before, after)} onBackOut={() => backOut(b.id)} onStep={(dir, edge) => stepToBlock(b.id, dir, edge)} onMerge={(dir, text) => (dir === -1 ? mergeBack(b.id, text) : mergeForward(b.id, text))} indent={paraIndent(b)} onIndent={(d) => indentParagraph(b.id, d)} onAutoList={(ordered, rest) => paragraphToList(b.id, ordered, rest, 0)} />
            ) : editingChem ? (
              <ChemFormulaBox draft={draft} onChange={onDraftChange} onExit={() => endEdit(b.id)} onEnter={() => lineAfterFormula(b.id)} />
            ) : getSettings().mathEditorBeta && isStructural(b) ? (
              <StructuralFormulaBox block={b} onChange={(next) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? withBox(next, boxOf(x)) : x)), true)} onExit={() => endEdit(b.id)} onEnter={() => lineAfterFormula(b.id)} initialPoint={formulaPoint.current} />
            ) : (
              <FormulaEditBox draft={draft} onChange={onDraftChange} onExit={() => endEdit(b.id)} onEnter={() => lineAfterFormula(b.id)} initialPoint={formulaPoint.current} />
            )
          ) : (
            <button
              onMouseDown={(e) => { const el = e.currentTarget, x = e.clientX, y = e.clientY; pressToEdit(e, b.id, () => startEdit(b, false, { el, x, y })); }}
              className={TEXT_HIT}
            >
              {hasContent(b) || (isParagraph(b) && calloutColorOf(b)) ? (
                <BlockView block={b} />
              ) : isParagraph(b) ? (
                // A blank line keeps its height so it stays clickable, and says
                // nothing — a document does not caption its own empty lines.
                <span>&nbsp;</span>
              ) : (
                // An empty formula has no glyphs to click, so it shows the slot
                // itself: a bare box, no words.
                <span className="mx-auto my-1 block h-7 w-24 rounded border border-dashed border-border" />
              )}
            </button>
          )}
        </div>

        <div className="print-hide flex flex-col items-center">
          {plotExpr && (
            <button onClick={() => plotEquation(b, plotExpr)} title="Plot this equation" aria-label="Plot this equation" className="mt-1 grid place-items-center px-1 text-faint opacity-0 transition hover:text-accent group-hover:opacity-100"><Icon name="plotaxes" size={16} /></button>
          )}
          <button onClick={() => removeBlock(b.id)} title="Delete block" aria-label="Delete block" className="mt-1 grid place-items-center px-1 text-faint opacity-0 transition hover:text-danger group-hover:opacity-100"><Icon name="trash" size={16} /></button>
        </div>
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
  useEffect(() => { setSecondId(null); setActiveSlot("a"); }, [id]);

  const openSecond = useCallback((noteId: string) => {
    if (noteId === id) { setActiveSlot("a"); return; }
    setSecondId(noteId); // limit of 2: a new pick replaces the existing pane B
    setActiveSlot("b");
  }, [id]);
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
      <div className="print-hide flex items-center gap-3 border-b border-border px-4 py-2">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted hover:text-accent"><Icon name="back" size={14} />Library</Link>
        <span className="text-sm font-semibold tracking-tight">Aquarius</span>
        {split && <span className="text-xs text-muted">Split view — click a pane to focus its tools &amp; outline</span>}
        <button onClick={() => setPaletteOpen(true)} title="Command palette (⌘K)" className="ml-auto flex items-center gap-1.5 rounded-control border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">
          <Icon name="search" size={13} />
          <span className="hidden sm:inline">Search</span>
          <kbd className="rounded border border-border px-1 text-[10px]">⌘K</kbd>
        </button>
        <span className="text-xs text-muted">{split ? "2 / 2 open" : "1 open"}</span>
      </div>

      <div className="print-flow flex min-h-0 flex-1">
        <EditorSidebar currentId={id} secondId={secondId} activeId={active === "b" && secondId ? secondId : id} onOpen={openSecond} outline={activeOutline} shortcuts={activeShortcuts} handle={activeHandle} notesRev={notesRev} />
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
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        handle={activeHandle.current}
        currentNoteId={active === "b" && secondId ? secondId : id}
        onOpenNote={openNoteFromPalette}
      />
    </div>
  );
}

/** The plottable `y = f(x)` expression for a display-math block, or null when
 *  it isn't a single-variable function (chem blocks and non-math never plot). */
function plottableExpr(b: Block): string | null {
  if (b.type !== "math" || isChemBlock(b)) return null;
  try {
    return latexToExpr(blockToKatex(b))?.expr ?? null;
  } catch {
    return null;
  }
}

/** A heading's type, shared by the rendered heading and the input that edits it
 *  — the point of editing in place is that they are the same size and weight. */
function headingClass(block: Block): string {
  const lvl = headingLevel(block);
  return lvl === 1 ? "text-2xl font-bold" : lvl === 2 ? "text-xl font-semibold" : lvl === 3 ? "text-lg font-semibold" : "text-base font-semibold";
}

/** Alignment and numbering for the heading being edited: a strip that appears
 *  on hover, floating clear of the text instead of pushing it down. */
function HeadingBar({ block, onAlign, onNumbered }: {
  block: Block;
  onAlign: (a: ImageAlign) => void;
  onNumbered: (v: boolean) => void;
}) {
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <div className="print-hide absolute -top-7 right-0 z-20 hidden items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted shadow-sm group-hover/edit:flex">
      <span className="mr-0.5">{HEADING_NAMES[headingLevel(block)]}</span>
      {headingLevel(block) !== 1 && (["left", "center", "right"] as ImageAlign[]).map((a) => (
        <button key={a} onMouseDown={keep} onClick={() => onAlign(a)} title={`Align ${a}`} className={`rounded px-1 capitalize ${headingAlign(block) === a ? "text-accent" : "hover:text-foreground"}`}>{a}</button>
      ))}
      <label className="ml-1 flex items-center gap-1" onMouseDown={keep}>
        <input type="checkbox" checked={headingNumbered(block)} onChange={(e) => onNumbered(e.target.checked)} /> numbered
      </label>
    </div>
  );
}

function HeadingDisplay({ block, number }: { block: Block; number?: string }) {
  const lvl = headingLevel(block);
  const cls = headingClass(block);
  const text = block.value || "\u00A0"; // a blank heading is a blank line, not a label
  // `aq-heading` + the level: under the LaTeX preset these absolute sizes are
  // restated as \Large / \large / \normalsize of the body (app/globals.css).
  return <div className={`aq-heading ${cls}`} data-level={lvl} style={{ textAlign: headingAlign(block) }}>{number ? `${number} ` : ""}{text}</div>;
}
