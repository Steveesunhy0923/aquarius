"use client";

import { BlockView } from "@/components/BlockView";
import { Icon, type IconName } from "@/components/Icon";
import { ChevronSelect, Dialog, DialogSection } from "@/components/ui/Dialog";
import { calloutColorOf, withCalloutColor } from "@/lib/blocks/callouts";
import { headingAlign, headingLevel, headingNumbered, makeHeading, withHeading, HEADING_NAMES, type HeadingLevel } from "@/lib/blocks/headings";
import type { ImageAlign } from "@/lib/blocks/images";
import { listItems, listMarker, listOrdered, makeList, withList, type ListMarker } from "@/lib/blocks/lists";
import { blockEditSource, displayFromSource, paragraphFromSource } from "@/lib/blocks/source";
import { makeTableBlock, tableAlign, tableItems, TABLE_STYLES, type TableStyle } from "@/lib/blocks/tables";
import type { Block } from "@/lib/blocks/types";
import { freshBlocks } from "@/lib/templates/modules";
import { uiConfirm } from "@/components/ui/dialogs";
import { BTN, BTN_PRIMARY, FIELD_SM as FIELD } from "@/components/ui/primitives";
import { useMemo, useRef, useState } from "react";

/**
 * The module builder: create or edit a reusable section as a list of typed
 * PARTS (heading / text / list / formula / table) with a live preview. Blocks
 * the form can't express (images, graphs, code, drawings, multi-table rows)
 * round-trip untouched as "kept as-is" parts, so editing never loses content.
 */

type Part =
  // numbered/align (heading) and marker (list) have no editor UI — they're
  // carried through so an open-then-save never strips formatting.
  | { key: string; kind: "heading"; level: HeadingLevel; text: string; numbered: boolean; align: ImageAlign }
  | { key: string; kind: "para"; src: string; color: string | null }
  | { key: string; kind: "list"; ordered: boolean; items: string; marker?: ListMarker }
  // `source` is the original block; if the LaTeX is untouched on save, it
  // passes through unchanged (preserves structural-editor formula trees).
  | { key: string; kind: "formula"; latex: string; source?: Block }
  | { key: string; kind: "table"; style: TableStyle; rows: string }
  | { key: string; kind: "opaque"; block: Block; label: string };

const pkey = (): string => crypto.randomUUID();

const OPAQUE_LABELS: Record<string, string> = {
  image: "Image row",
  graph: "Graph",
  code: "Code block",
  tikz: "Drawing",
};

/** A single-table block with no caption/placement/align can be form-edited.
 *  Cells containing "|" would be corrupted by the pipe-separated text format,
 *  so those tables (like captioned/placed ones) take the kept-as-is path. */
function simpleTable(b: Block): { style: TableStyle; rows: string[][] } | null {
  const items = tableItems(b);
  if (items.length !== 1) return null;
  const t = items[0];
  if (t.caption || t.pos || tableAlign(b) !== "center") return null;
  if (typeof b.attrs?.offset === "number") return null;
  if (t.rows.some((r) => r.some((c) => c.includes("|")))) return null;
  return { style: t.style, rows: t.rows };
}

function partsFromBlocks(blocks: Block[]): Part[] {
  return blocks.map((b): Part => {
    if (b.type === "heading") {
      return { key: pkey(), kind: "heading", level: headingLevel(b), text: b.value ?? "", numbered: headingNumbered(b), align: headingAlign(b) };
    }
    if (b.type === "text") return { key: pkey(), kind: "para", src: blockEditSource(b), color: calloutColorOf(b) };
    if (b.type === "list") return { key: pkey(), kind: "list", ordered: listOrdered(b), items: listItems(b).join("\n"), marker: listMarker(b) };
    if (b.type === "math") return { key: pkey(), kind: "formula", latex: blockEditSource(b), source: b };
    if (b.type === "table") {
      const t = simpleTable(b);
      if (t) return { key: pkey(), kind: "table", style: t.style, rows: t.rows.map((r) => r.join(" | ")).join("\n") };
    }
    return { key: pkey(), kind: "opaque", block: b, label: OPAQUE_LABELS[b.type] ?? "Content" };
  });
}

/** One row per line, cells split by "|". Interior blank lines are real (empty)
 *  rows — only leading/trailing blanks are trimmed. */
function parseRows(text: string): string[][] {
  const lines = text.split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  const rows = lines.slice(start, end).map((line) => line.split("|").map((c) => c.trim()));
  return rows.length ? rows : [["", ""]];
}

function blocksFromParts(parts: Part[]): Block[] {
  return parts.map((p): Block => {
    switch (p.kind) {
      case "heading": return withHeading(makeHeading(p.level, p.text), { numbered: p.numbered, align: p.align });
      case "para": return withCalloutColor(paragraphFromSource(p.src), p.color);
      case "list": return withList(makeList(p.ordered, p.marker), p.items.split("\n"));
      case "formula":
        // Untouched formula → original block (keeps structural-editor trees).
        return p.source && blockEditSource(p.source) === p.latex ? p.source : displayFromSource(p.latex);
      case "table": return makeTableBlock(p.style, parseRows(p.rows));
      case "opaque": return p.block;
    }
  });
}

const partHasContent = (p: Part): boolean => {
  switch (p.kind) {
    case "heading": return p.text.trim().length > 0;
    case "para": return p.src.trim().length > 0;
    case "list": return p.items.trim().length > 0;
    case "formula": return p.latex.trim().length > 0;
    case "table": return p.rows.trim().length > 0;
    case "opaque": return true;
  }
};

const HEADING_OPTIONS = ([1, 2, 3, 4] as const).map((l) => ({ id: String(l), label: HEADING_NAMES[l] }));
const TABLE_OPTIONS = TABLE_STYLES.map((s) => ({ id: s.id, label: s.name }));

/** The "add a part" palette: label + factory. */
const ADD_PARTS: { label: string; icon: IconName; make: () => Part }[] = [
  { label: "Heading", icon: "heading", make: () => ({ key: pkey(), kind: "heading", level: 2, text: "", numbered: false, align: "left" }) },
  { label: "Text", icon: "paragraph", make: () => ({ key: pkey(), kind: "para", src: "", color: null }) },
  { label: "Bullets", icon: "list", make: () => ({ key: pkey(), kind: "list", ordered: false, items: "" }) },
  { label: "Numbered", icon: "listnumber", make: () => ({ key: pkey(), kind: "list", ordered: true, items: "" }) },
  { label: "Formula", icon: "displayeq", make: () => ({ key: pkey(), kind: "formula", latex: "" }) },
  { label: "Table", icon: "table", make: () => ({ key: pkey(), kind: "table", style: "lines", rows: "Column A | Column B\n | " }) },
];

export function ModuleEditorDialog({ initial, create, onSave, onClose, zIndex = "z-[70]" }: {
  /** null/undefined = build a new module from scratch. */
  initial?: { name: string; blocks: Block[] } | null;
  /** Saving creates a NEW module even when prefilled (e.g. customizing a built-in). */
  create?: boolean;
  onSave: (name: string, blocks: Block[]) => void;
  onClose: () => void;
  zIndex?: string;
}) {
  const isNew = create ?? !initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [parts, setParts] = useState<Part[]>(() =>
    initial
      ? partsFromBlocks(initial.blocks)
      : [
          { key: pkey(), kind: "heading", level: 2, text: "", numbered: false, align: "left" },
          { key: pkey(), kind: "para", src: "", color: null },
        ],
  );
  const preview = useMemo(() => freshBlocks(blocksFromParts(parts.filter(partHasContent))), [parts]);
  const canSave = name.trim().length > 0 && parts.some(partHasContent);

  // Dirty guard: closing (Escape / scrim / Cancel) with unsaved edits asks
  // first — same expectation GraphEditor sets. Keys are per-render identity
  // only, so strip them before comparing.
  const strip = (ps: Part[]) => ps.map(({ key: _key, ...rest }) => rest);
  const baseline = useRef<string | null>(null);
  if (baseline.current === null) baseline.current = JSON.stringify([initial?.name ?? "", strip(parts)]);
  const dirty = JSON.stringify([name, strip(parts)]) !== baseline.current;
  async function requestClose() {
    if (dirty && !(await uiConfirm({ title: "Discard this module?", message: "Your unsaved changes will be lost.", confirmLabel: "Discard", danger: true }))) return;
    onClose();
  }

  const patch = (key: string, fn: (p: Part) => Part) =>
    setParts((ps) => ps.map((p) => (p.key === key ? fn(p) : p)));
  const remove = (key: string) => setParts((ps) => ps.filter((p) => p.key !== key));
  const move = (key: string, dir: -1 | 1) =>
    setParts((ps) => {
      const i = ps.findIndex((p) => p.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ps.length) return ps;
      const next = [...ps];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = () => {
    if (!canSave) return;
    onSave(name.trim(), blocksFromParts(parts.filter(partHasContent)));
  };

  return (
    <Dialog title={isNew ? "New module" : "Edit module"} onClose={() => void requestClose()} maxWidth="max-w-3xl" zIndex={zIndex}>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        <div className="mb-4 flex items-center gap-2">
          <span className="shrink-0 text-sm font-medium">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Theorem & proof"
            // Always steal focus on open: when the pencil in the `/` menu opens
            // this dialog, the note's textarea is still focused — without this,
            // typing would keep mutating the note behind the scrim.
            autoFocus
            className={FIELD}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_15rem]">
          {/* ── parts ── */}
          <div>
            <DialogSection className="mb-2">Structure</DialogSection>
            <div className="space-y-2">
              {parts.map((p, i) => (
                <div key={p.key} className="group/part flex items-start gap-1 rounded-lg border border-border bg-background p-2">
                  <div className="flex flex-col items-center gap-0.5 pt-1 text-faint">
                    <button onClick={() => move(p.key, -1)} disabled={i === 0} title="Move up" aria-label="Move part up" className="grid place-items-center rounded hover:text-accent disabled:opacity-30"><Icon name="moveup" size={13} /></button>
                    <button onClick={() => move(p.key, 1)} disabled={i === parts.length - 1} title="Move down" aria-label="Move part down" className="grid place-items-center rounded hover:text-accent disabled:opacity-30"><Icon name="movedown" size={13} /></button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <PartEditor part={p} onPatch={(fn) => patch(p.key, fn)} />
                  </div>
                  <button onClick={() => remove(p.key)} title="Remove part" aria-label="Remove part" className="mt-1 grid place-items-center px-1 text-faint hover:text-danger"><Icon name="trash" size={15} /></button>
                </div>
              ))}
              {parts.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted">Empty module — add a part below.</p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted">Add:</span>
              {ADD_PARTS.map((a) => (
                <button
                  key={a.label}
                  onClick={() => setParts((ps) => [...ps, a.make()])}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-accent"
                >
                  <Icon name={a.icon} size={13} /> {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── live preview ── */}
          <div className="min-w-0">
            <DialogSection className="mb-2">Preview</DialogSection>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-surface p-3">
              {preview.length === 0 ? (
                <p className="text-xs text-muted">Preview appears as you fill in the parts.</p>
              ) : (
                <div className="origin-top-left scale-[0.85] space-y-1 [width:118%]">
                  {preview.map((b) => (
                    <div key={b.id}><BlockView block={b} /></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border-soft px-5 py-3">
        <p className="text-xs text-muted">Insert modules anywhere by typing <span className="font-mono">/</span> in a paragraph.</p>
        <div className="flex gap-2">
          <button onClick={() => void requestClose()} className={BTN}>Cancel</button>
          <button onClick={save} disabled={!canSave} className={BTN_PRIMARY}>
            {isNew ? "Create module" : "Save changes"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── one part's kind-specific editor ──────────────────────────────────────────

function PartEditor({ part, onPatch }: { part: Part; onPatch: (fn: (p: Part) => Part) => void }) {
  switch (part.kind) {
    case "heading":
      return (
        <div className="flex items-center gap-2">
          <ChevronSelect
            value={String(part.level)}
            onChange={(v) => onPatch((p) => ({ ...(p as typeof part), level: Number(v) as HeadingLevel }))}
            options={HEADING_OPTIONS}
            ariaLabel="Heading level"
          />
          <input
            value={part.text}
            onChange={(e) => onPatch((p) => ({ ...(p as typeof part), text: e.target.value }))}
            placeholder="Heading text…"
            className={`${FIELD} font-medium`}
          />
        </div>
      );
    case "para":
      return (
        <textarea
          value={part.src}
          onChange={(e) => onPatch((p) => ({ ...(p as typeof part), src: e.target.value }))}
          placeholder="Text… **bold**, *italic*, \(x^2\) for inline math, {{Field}} for a fill-in blank"
          rows={Math.min(6, Math.max(2, part.src.split("\n").length))}
          className={`${FIELD} resize-none`}
        />
      );
    case "list":
      return (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs">
            <button onClick={() => onPatch((p) => ({ ...(p as typeof part), ordered: false, marker: undefined }))} className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${!part.ordered ? "border-accent text-accent" : "border-border text-muted"}`}><Icon name="list" size={12} />Bullets</button>
            <button onClick={() => onPatch((p) => ({ ...(p as typeof part), ordered: true, marker: undefined }))} className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${part.ordered ? "border-accent text-accent" : "border-border text-muted"}`}><Icon name="listnumber" size={12} />Numbered</button>
          </div>
          <textarea
            value={part.items}
            onChange={(e) => onPatch((p) => ({ ...(p as typeof part), items: e.target.value }))}
            placeholder="One item per line…"
            rows={Math.min(6, Math.max(2, part.items.split("\n").length))}
            className={`${FIELD} resize-none`}
          />
        </div>
      );
    case "formula":
      return (
        <input
          value={part.latex}
          onChange={(e) => onPatch((p) => ({ ...(p as typeof part), latex: e.target.value }))}
          placeholder="LaTeX, e.g. E = mc^2"
          spellCheck={false}
          className={`${FIELD} font-mono`}
        />
      );
    case "table":
      return (
        <div>
          <div className="mb-1.5">
            <ChevronSelect
              value={part.style}
              onChange={(v) => onPatch((p) => ({ ...(p as typeof part), style: v as TableStyle }))}
              options={TABLE_OPTIONS}
              ariaLabel="Table style"
            />
          </div>
          <textarea
            value={part.rows}
            onChange={(e) => onPatch((p) => ({ ...(p as typeof part), rows: e.target.value }))}
            placeholder={"One row per line, cells split by |\nTrial | Result | Uncertainty"}
            rows={Math.min(8, Math.max(3, part.rows.split("\n").length))}
            spellCheck={false}
            className={`${FIELD} resize-none font-mono`}
          />
        </div>
      );
    case "opaque":
      return (
        <div className="flex items-center gap-2 py-1 text-xs text-muted">
          <Icon name="lock" size={13} />
          {part.label} — kept exactly as saved (edit it in a note, then re-save the section).
        </div>
      );
  }
}
