"use client";

import { BlockView } from "@/components/BlockView";
import { ImageRowEditor } from "@/components/ImageRowEditor";
import { Katex } from "@/components/Katex";
import { SymbolPicker } from "@/components/SymbolPicker";
import { TablePicker } from "@/components/TablePicker";
import { TableRowEditor } from "@/components/TableRowEditor";
import { documentToLatex } from "@/lib/blocks";
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
} from "@/lib/blocks/images";
import {
  blockEditSource,
  displayFromSource,
  hasContent,
  isParagraph,
  paragraphFromSource,
  previewLatex,
} from "@/lib/blocks/source";
import { DEFAULT_HIGHLIGHT } from "@/lib/blocks/format";
import { listItems, listOrdered, makeList, withList } from "@/lib/blocks/lists";
import {
  TABLE_STYLES,
  demoRows,
  tableAlign,
  tableItems,
  withTables,
  type TableData,
  type TableStyle,
} from "@/lib/blocks/tables";
import type { Block, DocumentStyle } from "@/lib/blocks/types";
import { getStore } from "@/lib/storage";
import type { NotePackage } from "@/lib/storage/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
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

const TB1_KEY = "aquarius.toolbar1";
const TB2_KEY = "aquarius.toolbar2";
const DEFAULT_TB1 = ["\\frac{}{}", "\\sqrt{}", "^{}", "\\sum_{}^{}", "\\int_{}^{}", "\\sin", "\\cos", "\\neq", "\\pi", "\\alpha"];
const DEFAULT_TB2 = ["\\infty", "\\rightarrow", "\\in", "\\leq"];
const TB2_MAX = 8;
const A4_W = 794; // A4 width  in px @ 96dpi (210mm)
const A4_H = 1123; // A4 height in px @ 96dpi (297mm)

const FONTS: Record<string, string> = {
  "Computer Modern":
    '"Computer Modern Serif", "Latin Modern Roman", "CMU Serif", Georgia, serif',
  Serif: 'Georgia, "Times New Roman", serif',
  "Sans-serif": 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  Monospace: 'ui-monospace, "SF Mono", Menlo, monospace',
};
const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24];
const LINE_SPACINGS = [1, 1.15, 1.5, 2];
const INDENTS = [0, 1, 1.5, 2];

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
      return false;
    default:
      return !hasContent(b); // text or formula
  }
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

type Picker = { kind: "slot"; index: number } | { kind: "palette" } | null;
type Selected = { id: string; index: number; kind: "image" | "table" } | null;

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();

  const [pkg, setPkg] = useState<NotePackage | null>(null);
  const [title, setTitle] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [saved, setSaved] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPara, setEditingPara] = useState(false);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);

  const [toolbar1, setToolbar1] = useState<string[]>(() => readLS(TB1_KEY, DEFAULT_TB1));
  const [toolbar2, setToolbar2] = useState<string[]>(() => readLS(TB2_KEY, DEFAULT_TB2));
  const [editSlots, setEditSlots] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [tablePicker, setTablePicker] = useState(false);
  const [zoom, setZoom] = useState(1); // page size ratio
  const [hlColor, setHlColor] = useState(DEFAULT_HIGHLIGHT);
  const [heights, setHeights] = useState<Record<string, number>>({});

  const blockEls = useRef<Map<string, HTMLElement>>(new Map());
  const lastEditedId = useRef<string | null>(null);
  const pkgRef = useRef<NotePackage | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef(0);
  const sticky = useRef(false);
  const dragFrom = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addTarget = useRef<string | null>(null);

  useEffect(() => {
    pkgRef.current = pkg;
  }, [pkg]);
  useEffect(() => {
    if (typeof window !== "undefined") try { localStorage.setItem(TB1_KEY, JSON.stringify(toolbar1)); } catch { /* noop */ }
  }, [toolbar1]);
  useEffect(() => {
    if (typeof window !== "undefined") try { localStorage.setItem(TB2_KEY, JSON.stringify(toolbar2)); } catch { /* noop */ }
  }, [toolbar2]);
  useEffect(() => {
    (async () => {
      const store = getStore();
      const [p, meta] = await Promise.all([store.openNote(id), store.getNoteMeta(id)]);
      setPkg(p);
      setTitle(meta?.title ?? "Untitled");
    })().catch(console.error);
  }, [id]);
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

  // ── tree mutations ────────────────────────────────────────────────────────
  function setBlocks(update: (blocks: Block[]) => Block[]) {
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

  function commit(text: string, c: string | null) {
    if (!editingId) return;
    const next = editingPara ? withCalloutColor(paragraphFromSource(text, editingId), c) : displayFromSource(text, editingId);
    setBlocks((bs) => bs.map((b) => (b.id === editingId ? next : b)));
  }
  function startEdit(block: Block) {
    setSelected(null);
    setEditingId(block.id);
    setEditingPara(isParagraph(block));
    setDraft(blockEditSource(block));
    setColor(calloutColorOf(block));
  }
  function startEditHeading(block: Block) {
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
    setPicker((p) => {
      if (p?.kind === "slot") setToolbar1((a) => a.map((x, i) => (i === p.index ? latex : x)));
      else if (p?.kind === "palette") setToolbar2((a) => (a.length >= TB2_MAX ? a : [...a, latex]));
      return null;
    });
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
  function insertList(ordered: boolean) {
    const l = makeList(ordered);
    addBlock(l, false);
    setEditingId(l.id);
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
    if (selected.kind === "image") updateById(selected.id, (b) => withImages(b, imageItems(b), align));
    else updateById(selected.id, (b) => withTables(b, tableItems(b), align));
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
    setBlocks((bs) =>
      bs.flatMap((b) => {
        if (b.id === fromId) {
          const items = imageItems(b).filter((_, k) => k !== fromIndex);
          return items.length ? [withImages(b, items)] : [];
        }
        if (b.id === toId) {
          const items = [...imageItems(b)];
          items.splice(at, 0, item);
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
    setBlocks((bs) =>
      bs.flatMap((b) => {
        if (b.id === fromId) {
          const items = tableItems(b).filter((_, k) => k !== fromIndex);
          return items.length ? [withTables(b, items)] : [];
        }
        if (b.id === toId) {
          const items = [...tableItems(b)];
          items.splice(at, 0, item);
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
    const p = pkgRef.current;
    if (!p) return;
    const store = getStore();
    await store.saveNote({ ...p, latexCache: documentToLatex(p.tree) });
    await store.updateNoteMeta(id, { title });
    setSaved(true);
  }

  if (!pkg) {
    return <main className="grid min-h-screen place-items-center text-muted">Opening note…</main>;
  }

  const blocks = pkg.tree.blocks;
  const headingNumbers = computeHeadingNumbers(blocks);
  const editingBlock = editingId ? blocks.find((b) => b.id === editingId) : null;
  const currentStyle: "text" | HeadingLevel =
    editingBlock && editingBlock.type === "heading" ? headingLevel(editingBlock) : "text";
  const keepFocus = (e: MouseEvent) => {
    if (editingId) { e.preventDefault(); sticky.current = true; }
  };

  // A4 page geometry (size adjustable via `zoom`) + document style + pagination.
  const pageW = Math.round(A4_W * zoom);
  const pageH = Math.round(A4_H * zoom);
  const margin = Math.round(pageW * 0.09);
  const pageContent = pageH - 2 * margin;
  const docStyle = pkg.tree.style ?? {};
  const fontSize = docStyle.fontSize ?? 14;
  const fontKey = docStyle.fontFamily ?? "Computer Modern";
  const fontFamily = FONTS[fontKey] ?? FONTS["Computer Modern"];
  const lineSpacing = docStyle.lineSpacing ?? 1.5;
  const indent = docStyle.indent ?? 0;
  const layout = docStyle.pageLayout ?? "vertical";
  const indexById = new Map(blocks.map((b, i) => [b.id, i] as const));
  const packed = paginate(blocks, heights, pageContent);
  // Always keep one completely blank page at the end so the canvas never feels
  // "full". paginate() only ends on an empty page for an empty document; once
  // there's content, append a fresh blank sheet. Same page list drives both the
  // vertical and horizontal layouts, so this works for both.
  const pages =
    packed[packed.length - 1].length === 0 ? packed : [...packed, []];
  const contentStyle = {
    padding: margin,
    fontSize: `${fontSize}px`,
    fontFamily,
    lineHeight: lineSpacing,
    ["--indent" as string]: `${indent}em`,
  } as CSSProperties;

  return (
    <main className="flex min-h-screen flex-col">
      <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />

      <header className="flex items-center gap-4 border-b border-border px-6 py-3">
        <Link href="/" className="text-sm text-muted hover:text-accent">← Library</Link>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} className="flex-1 bg-transparent text-lg font-semibold outline-none" />
        <button onClick={() => setShowSource((s) => !s)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent">{showSource ? "Editor" : "LaTeX"}</button>
        <button onClick={save} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">{saved ? "Saved" : "Save"}</button>
      </header>

      {/* Block tools */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-2">
        <ToolButton onClick={() => addBlock(paragraphFromSource(""))} title="New paragraph (normal text)">¶ Text</ToolButton>
        <select value={typeof currentStyle === "number" ? String(currentStyle) : ""} onChange={(e) => { if (e.target.value) applyStyle(Number(e.target.value) as HeadingLevel); }} title="Make the current block a heading" className="rounded-md border border-border bg-background px-2 py-1 text-sm">
          <option value="" disabled>Heading…</option>
          <option value={1}>Title</option>
          <option value={2}>Subtitle</option>
          <option value={3}>Subsubtitle</option>
          <option value={4}>Subsubsubtitle</option>
        </select>
        <ToolButton onClick={() => insertList(false)} title="Bulleted list">• List</ToolButton>
        <ToolButton onClick={() => insertList(true)} title="Numbered list">1. List</ToolButton>
        <ToolButton onClick={insertEquation} title="Insert centered equation ($$…$$)">Σ Eqn</ToolButton>
        <ToolButton onClick={newImageRow} title="Insert image">🖼 Image</ToolButton>
        <ToolButton onClick={() => setTablePicker(true)} title="Insert table">▤ Table</ToolButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("**")} title="Bold (**…**)" className="rounded-md border border-border px-2.5 py-1 text-sm font-bold hover:border-accent">B</button>
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("*")} title="Italic (*…*)" className="rounded-md border border-border px-2.5 py-1 text-sm italic hover:border-accent">I</button>
        <button onMouseDown={keepFocus} onClick={() => wrapSelection("__")} title="Underline (__…__)" className="rounded-md border border-border px-2.5 py-1 text-sm underline hover:border-accent">U</button>
        <button onMouseDown={keepFocus} onClick={() => wrapSelection(`==#${hlColor.replace("#", "")}:`, "==")} title="Highlight" className="rounded-md border border-border px-2.5 py-1 text-sm hover:border-accent" style={{ background: hlColor, color: "#1f2937" }}>H</button>
        <input type="color" value={hlColor} onChange={(e) => setHlColor(e.target.value)} onMouseDown={() => { if (editingId) sticky.current = true; }} title="Highlight color" className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent p-0.5" />
        <button onMouseDown={keepFocus} onClick={insertLink} title="Insert link" className="rounded-md border border-border px-2.5 py-1 text-sm hover:border-accent">🔗</button>
        <span className="ml-auto text-xs text-muted">{editingId ? (editingPara ? "B/I/U/H/link format the selection" : "editing a formula") : "pick a style or insert"}</span>
      </div>

      {/* Toolbar 1 — Structures */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-6 py-2">
        <span className="w-16 text-xs text-muted">Structures</span>
        {toolbar1.map((latex, i) => (
          <button key={i} onMouseDown={(e) => { if (!editSlots) keepFocus(e); }} onClick={() => (editSlots ? setPicker({ kind: "slot", index: i }) : onInsert(latex))} title={editSlots ? "Click to change this slot" : `Insert ${latex}`} className={`grid h-9 min-w-9 place-items-center rounded-md border px-2 text-sm hover:border-accent ${editSlots ? "border-dashed border-accent/60" : "border-border"}`}>
            <Katex latex={previewLatex(latex)} />
          </button>
        ))}
        <button onClick={() => setEditSlots((s) => !s)} title="Customize the structure slots" className={`ml-1 rounded-md border px-2 py-1 text-xs ${editSlots ? "border-accent text-accent" : "border-border text-muted"}`}>{editSlots ? "Done" : "⚙ Edit"}</button>
      </div>

      {/* Toolbar 2 — Symbols */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-6 py-2">
        <span className="w-16 text-xs text-muted">Symbols</span>
        {toolbar2.map((latex, i) => (
          <span key={i} className="group/sym relative">
            <button onMouseDown={keepFocus} onClick={() => onInsert(latex)} title={`Insert ${latex}`} className="grid h-9 min-w-9 place-items-center rounded-md border border-border px-2 text-sm hover:border-accent">
              <Katex latex={previewLatex(latex)} />
            </button>
            <button onClick={() => setToolbar2((a) => a.filter((_, j) => j !== i))} title="Remove from palette" className="absolute -right-1 -top-1 hidden h-4 w-4 place-items-center rounded-full bg-red-500 text-[10px] text-white group-hover/sym:grid">✕</button>
          </span>
        ))}
        {toolbar2.length < TB2_MAX && (
          <button onClick={() => setPicker({ kind: "palette" })} title="Add a symbol from the library" className="grid h-9 w-9 place-items-center rounded-md border border-dashed border-border text-muted hover:border-accent">＋</button>
        )}
        <span className="ml-2 text-xs text-muted">{toolbar2.length}/{TB2_MAX}</span>
      </div>

      {/* Document settings */}
      {!showSource && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-2 text-xs text-muted">
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
        <div className="flex-1 overflow-auto p-8" style={{ background: "var(--background)" }}>
          <div className={layout === "horizontal" ? "flex items-start gap-8" : "flex flex-col items-center gap-8"}>
            {pages.map((ids, p) => (
              <div key={p} className="relative shrink-0 bg-surface text-foreground shadow-xl ring-1 ring-border" style={{ width: pageW, minHeight: pageH }}>
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
                    <button onClick={() => addBlock(paragraphFromSource(""))} className="mt-1 block w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-foreground/[0.04]">Click to add text…</button>
                  )}
                </div>
                <span className="pointer-events-none absolute bottom-1.5 right-3 text-[10px] text-muted">{p + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {picker && (
        <SymbolPicker title={picker.kind === "slot" ? "Choose a structure for this slot" : "Add a symbol to your palette"} onPick={onPickSymbol} onClose={() => setPicker(null)} />
      )}
      {tablePicker && <TablePicker onPick={insertTable} onClose={() => setTablePicker(false)} />}
    </main>
  );

  // ── one block row (chrome + content) ──────────────────────────────────────
  function renderBlock(b: Block, i: number): ReactNode {
    const isHeading = b.type === "heading";
    const isList = b.type === "list";
    const isImage = b.type === "image";
    const isTable = b.type === "table";
    return (
      <div className="group relative flex items-start gap-1 rounded-lg px-1 py-0.5 hover:bg-foreground/[0.03]" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveBlock(dragFrom.current, i); dragFrom.current = null; }}>
        <div className="flex flex-col items-center pt-1 text-muted opacity-0 transition group-hover:opacity-100">
          <button onClick={() => moveBlock(i, i - 1)} disabled={i === 0} title="Move up" className="leading-none hover:text-accent disabled:opacity-30">▲</button>
          <span draggable onDragStart={() => (dragFrom.current = i)} title="Drag to reorder block" className="cursor-grab select-none leading-none active:cursor-grabbing">⠿</span>
          <button onClick={() => moveBlock(i, i + 1)} disabled={i === blocks.length - 1} title="Move down" className="leading-none hover:text-accent disabled:opacity-30">▼</button>
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
              <button onClick={() => startEditHeading(b)} className="block w-full text-left">
                <HeadingDisplay block={b} number={headingNumbers.get(b.id)} />
              </button>
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
              <ImageRowEditor blockId={b.id} items={imageItems(b)} align={imageAlign(b)} selectedIndex={selected?.id === b.id ? selected.index : null} onSelect={(idx) => selectItem(b.id, idx, "image")} onMove={moveImageItem} onCaption={(idx, text) => imgCaption(b.id, idx, text)} />
              {selected?.id === b.id && renderControls(b)}
            </>
          ) : isTable ? (
            <>
              <TableRowEditor blockId={b.id} tables={tableItems(b)} align={tableAlign(b)} selectedIndex={selected?.id === b.id ? selected.index : null} onSelect={(idx) => selectItem(b.id, idx, "table")} onMove={moveTableItem} onCell={(idx, r, c, v) => tblCell(b.id, idx, r, c, v)} onCaption={(idx, text) => tblCaption(b.id, idx, text)} />
              {selected?.id === b.id && renderControls(b)}
            </>
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

  // Tab indents within the text instead of moving focus out (which exits the box).
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    if (e.shiftKey) {
      // Shift+Tab outdents: drop a tab (or up to two spaces) before the caret.
      const before = draft.slice(0, start);
      const drop = before.endsWith("\t") ? 1 : before.endsWith("  ") ? 2 : before.endsWith(" ") ? 1 : 0;
      if (!drop) return;
      const pos = start - drop;
      onChange(draft.slice(0, pos) + draft.slice(start), pos);
      requestAnimationFrame(() => { try { ta.setSelectionRange(pos, pos); } catch { /* noop */ } });
      return;
    }
    const pos = start + 1;
    onChange(draft.slice(0, start) + "\t" + draft.slice(end), pos);
    requestAnimationFrame(() => { try { ta.setSelectionRange(pos, pos); } catch { /* noop */ } });
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
  return <button onClick={onClick} title={title} className="rounded-md border border-border px-3 py-1 text-sm hover:border-accent">{children}</button>;
}
