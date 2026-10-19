"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { BlockView } from "@/components/BlockView";
import { ChemFormulaBox, FormulaEditBox } from "@/components/FormulaEditBox";
import { EditBox } from "@/components/EditBox";
import { Icon, type IconName } from "@/components/Icon";
import { ListEditor } from "@/components/ListEditor";
import type { LineHandle } from "@/components/RichLine";
import { TableRowEditor } from "@/components/TableRowEditor";
import { Dialog } from "@/components/ui/Dialog";
import { uiConfirm } from "@/components/ui/dialogs";
import { BTN, BTN_PRIMARY, FIELD_SM as FIELD } from "@/components/ui/primitives";
import { calloutColorOf, withCalloutColor } from "@/lib/blocks/callouts";
import { ceInner, isChemBlock, tagChem, wrapCe } from "@/lib/blocks/chem";
import { headingAlign, headingLevel, makeHeading } from "@/lib/blocks/headings";
import { listItems, makeList, withList } from "@/lib/blocks/lists";
import { blockEditSource, displayFromSource, isParagraph, paragraphFromSource } from "@/lib/blocks/source";
import { makeTableBlock, tableAlign, tableItems, withTables } from "@/lib/blocks/tables";
import type { Block } from "@/lib/blocks/types";
import { freshBlocks } from "@/lib/templates/modules";

/**
 * ModuleFileEditor — a module edited as a small FILE, not as a form.
 *
 * A module is a piece of a note, so it is written the way a note is written:
 * every line is edited where it sits, in its own type, with the same components
 * the document surface uses (`EditBox` for prose, `ListEditor` for bullets,
 * `FormulaEditBox` for maths, `TableRowEditor` for tables). The parts form this
 * replaces made you describe a section — "a heading part, then a list part" —
 * in widgets that looked nothing like the result; here you just write it.
 *
 * What it deliberately does NOT do: delete a block when it is left empty. In a
 * note an empty line is litter, but a module's empty list item, blank formula
 * slot and empty callout ARE the module — they are the spaces the writer fills
 * in once it is inserted (docs/MODULES.md item 9).
 */

const TEXT_HIT = "w-full cursor-text text-left";

/** What the Insert row can add: the block kinds a section is made of. */
const INSERTS: { label: string; icon: IconName; make: () => Block }[] = [
  { label: "Text", icon: "paragraph", make: () => paragraphFromSource("") },
  { label: "Heading", icon: "heading", make: () => makeHeading(2, "") },
  { label: "Bullets", icon: "list", make: () => makeList(false) },
  { label: "Numbered", icon: "listnumber", make: () => makeList(true) },
  { label: "Formula", icon: "displayeq", make: () => displayFromSource("") },
  { label: "Table", icon: "table", make: () => makeTableBlock("lines", [["Column A", "Column B"], ["", ""]]) },
];

export function ModuleFileEditor({ initial, onSave, onClose, zIndex = "z-[70]" }: {
  /** null/undefined = a new module, opening on one empty line. */
  initial?: { name: string; blocks: Block[] } | null;
  onSave: (name: string, blocks: Block[]) => void;
  onClose: () => void;
  zIndex?: string;
}) {
  const isNew = !initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [blocks, setBlocks] = useState<Block[]>(() =>
    initial ? freshBlocks(initial.blocks) : [paragraphFromSource("")],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPara, setEditingPara] = useState(false);
  const [editingChem, setEditingChem] = useState(false);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<string | null>(null);
  /** A table is "selected" rather than edited — that is how its cells open. */
  const [selected, setSelected] = useState<string | null>(null);
  const taRef = useRef<LineHandle | null>(null);
  const headingRef = useRef<HTMLInputElement | null>(null);

  const baseline = useRef(JSON.stringify([initial?.name ?? "", initial?.blocks ?? []]));
  const dirty = JSON.stringify([name, blocks]) !== baseline.current;
  const canSave = name.trim().length > 0 && blocks.length > 0;

  async function requestClose() {
    if (dirty && !(await uiConfirm({ title: "Discard this module?", message: "Your unsaved changes will be lost.", confirmLabel: "Discard", danger: true }))) return;
    onClose();
  }

  /**
   * The caret follows the line that is open, the way it does in a note.
   *
   * `EditBox` does not focus itself — the document surface drives it through the
   * line handle — so without this the line opened but the keystrokes went
   * wherever focus already was (the Name field, which had it on open). Headings,
   * formulas and lists focus themselves, so only prose needs it. The caret lands
   * at the end of the line; the note can open it under the pointer because it
   * tracks the press, which a dialog this size does not need.
   */
  useEffect(() => {
    if (!editingId) return;
    const b = blocks.find((x) => x.id === editingId);
    if (!b || !isParagraph(b)) return;
    const line = taRef.current;
    if (!line) return;
    line.focus();
    const end = line.value.length;
    line.setSelectionRange(end, end);
    // Only when the OPEN LINE changes: re-running on every keystroke would drag
    // the caret back to the end while typing mid-line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // ── editing one line ───────────────────────────────────────────────────────
  const replace = (id: string, fn: (b: Block) => Block) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? fn(b) : b)));

  function startEdit(block: Block) {
    setSelected(null);
    setEditingId(block.id);
    setEditingPara(isParagraph(block));
    const source = blockEditSource(block);
    const chem = isChemBlock(block);
    setEditingChem(chem);
    setDraft(chem ? (ceInner(source) ?? "") : source);
    setColor(calloutColorOf(block));
  }
  /** Close the previous line before opening this one, in the same handler —
   *  otherwise the re-render swallows the press (see EditorClient.pressToEdit). */
  function pressToEdit(e: ReactMouseEvent, run: () => void) {
    if (e.button !== 0) return;
    e.preventDefault();
    run();
  }
  const endEdit = () => setEditingId(null); // empty blocks STAY: they are the skeleton

  /** Rebuild the edited block from its source on every keystroke, as the note does. */
  function commit(text: string, c: string | null) {
    if (!editingId) return;
    const next = editingPara
      ? withCalloutColor(paragraphFromSource(text, editingId), c)
      : editingChem
        ? tagChem(displayFromSource(wrapCe(text), editingId))
        : displayFromSource(text, editingId);
    replace(editingId, () => next);
  }
  function onDraftChange(text: string) {
    setDraft(text);
    commit(text, color);
  }

  function insert(block: Block, edit = true) {
    setBlocks((bs) => {
      const i = editingId ? bs.findIndex((b) => b.id === editingId) : -1;
      const next = [...bs];
      next.splice(i >= 0 ? i + 1 : bs.length, 0, block);
      return next;
    });
    if (edit && (isParagraph(block) || block.type === "math" || block.type === "heading")) startEdit(block);
    else setEditingId(null);
  }

  function splitPara(before: string, after: string) {
    if (!editingId) return;
    const id = editingId;
    const head = withCalloutColor(paragraphFromSource(before, id), color);
    const tail = withCalloutColor(paragraphFromSource(after), color);
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      if (i < 0) return bs;
      const next = [...bs];
      next.splice(i, 1, head, tail);
      return next;
    });
    startEdit(tail);
  }

  /** Backspace at the start of a line: join it onto the one above. */
  function mergeBack(id: string, text: string) {
    const i = blocks.findIndex((b) => b.id === id);
    const prev = i > 0 ? blocks[i - 1] : null;
    if (!prev || !isParagraph(prev)) return;
    const joined = paragraphFromSource(blockEditSource(prev) + text, prev.id);
    setBlocks((bs) => bs.filter((b) => b.id !== id).map((b) => (b.id === prev.id ? withCalloutColor(joined, calloutColorOf(prev)) : b)));
    startEdit(joined);
  }
  /** Delete at the end of a line: pull the next one up onto it. */
  function mergeForward(id: string, text: string) {
    const i = blocks.findIndex((b) => b.id === id);
    const nextB = i >= 0 ? blocks[i + 1] : null;
    if (!nextB || !isParagraph(nextB)) return;
    const joined = paragraphFromSource(text + blockEditSource(nextB), id);
    setBlocks((bs) => bs.filter((b) => b.id !== nextB.id).map((b) => (b.id === id ? withCalloutColor(joined, color) : b)));
    setDraft(blockEditSource(joined));
  }

  /** An arrow key off either end of a line carries the caret to its neighbour. */
  function stepTo(id: string, dir: -1 | 1): boolean {
    const i = blocks.findIndex((b) => b.id === id);
    const next = i < 0 ? null : blocks[i + dir];
    if (!next) return false;
    if (isParagraph(next) || next.type === "math" || next.type === "heading" || next.type === "list") {
      startEdit(next);
      return true;
    }
    return false;
  }

  function onHeadingKey(e: ReactKeyboardEvent<HTMLInputElement>, b: Block) {
    if (e.key === "Escape") { e.preventDefault(); endEdit(); return; }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      insert(paragraphFromSource(""));
      return;
    }
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const at = el.selectionStart ?? 0;
    if ((e.key === "ArrowUp" || (e.key === "ArrowLeft" && at === 0)) && stepTo(b.id, -1)) e.preventDefault();
    else if ((e.key === "ArrowDown" || (e.key === "ArrowRight" && at === el.value.length)) && stepTo(b.id, 1)) e.preventDefault();
  }

  const removeBlock = (id: string) => {
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    if (editingId === id) setEditingId(null);
    if (selected === id) setSelected(null);
  };

  // ── one line ───────────────────────────────────────────────────────────────
  // A plain function, NOT a nested component: a component declared in here is a
  // new type on every render, so React would unmount and remount the line on
  // each keystroke — the EditBox lost focus after the first character typed.
  const renderLine = (b: Block) => {
    const editing = b.id === editingId;
    if (b.type === "heading") {
      return editing ? (
        <input
          ref={headingRef}
          value={b.value ?? ""}
          autoFocus
          onChange={(e) => replace(b.id, (x) => ({ ...x, value: e.target.value }))}
          onKeyDown={(e) => onHeadingKey(e, b)}
          style={{ textAlign: headingAlign(b) }}
          data-level={headingLevel(b)}
          className="aq-heading w-full bg-transparent p-0 font-semibold caret-accent outline-none"
        />
      ) : (
        <button onMouseDown={(e) => pressToEdit(e, () => startEdit(b))} className={TEXT_HIT}><BlockView block={b} /></button>
      );
    }
    if (b.type === "list") {
      return editing ? (
        <ListEditor
          block={b}
          focusItem={null}
          onItems={(items, _caret, levels) => replace(b.id, (x) => withList(x, items, undefined, levels))}
          onOrdered={(o) => replace(b.id, (x) => withList(x, listItems(x), o))}
          onExit={endEdit}
          onLeave={(dir) => stepTo(b.id, dir)}
          onSplitOut={(before, beforeLevels) => replace(b.id, (x) => withList(x, before, undefined, beforeLevels))}
        />
      ) : (
        <button onMouseDown={(e) => pressToEdit(e, () => startEdit(b))} className={TEXT_HIT}><BlockView block={b} /></button>
      );
    }
    if (b.type === "math") {
      if (!editing) {
        return <button onMouseDown={(e) => pressToEdit(e, () => startEdit(b))} className={TEXT_HIT}><BlockView block={b} /></button>;
      }
      return editingChem ? (
        <ChemFormulaBox draft={draft} onChange={(src) => onDraftChange(src)} onExit={endEdit} onEnter={() => insert(paragraphFromSource(""))} />
      ) : (
        <FormulaEditBox draft={draft} onChange={(t) => onDraftChange(t)} onExit={endEdit} onEnter={() => insert(paragraphFromSource(""))} />
      );
    }
    if (b.type === "table") {
      return (
        <TableRowEditor
          blockId={b.id}
          tables={tableItems(b)}
          align={tableAlign(b)}
          selectedIndex={selected === b.id ? 0 : null}
          onSelect={() => { setEditingId(null); setSelected(b.id); }}
          onCommit={() => { /* a module carries no page placement */ }}
          onReset={() => { /* nothing to reset without placement */ }}
          onMoveAcross={() => { /* single-table rows only in a module */ }}
          onCell={(idx, r, c, v) => replace(b.id, (x) => withTables(x, tableItems(x).map((t, i) => (i === idx ? { ...t, rows: t.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row)) } : t))))}
          onCaption={(idx, text) => replace(b.id, (x) => withTables(x, tableItems(x).map((t, i) => (i === idx ? { ...t, caption: text } : t))))}
        />
      );
    }
    if (isParagraph(b)) {
      return editing ? (
        <EditBox
          taRef={taRef}
          para
          draft={draft}
          color={color}
          onChange={(text) => onDraftChange(text)}
          onColor={(c) => { setColor(c); commit(draft, c); }}
          onExit={endEdit}
          onSplit={splitPara}
          onBackOut={() => removeBlock(b.id)}
          onStep={(dir) => stepTo(b.id, dir)}
          onMerge={(dir, text) => (dir === -1 ? mergeBack(b.id, text) : mergeForward(b.id, text))}
        />
      ) : (
        <button onMouseDown={(e) => pressToEdit(e, () => startEdit(b))} className={TEXT_HIT}><BlockView block={b} /></button>
      );
    }
    // Images, graphs, code, drawings: shown as they are — a module keeps them,
    // and they are edited in a note, where their tools live.
    return <div className="opacity-90"><BlockView block={b} /></div>;
  };

  return (
    <Dialog title={isNew ? "New module" : "Edit module"} onClose={() => void requestClose()} maxWidth="max-w-2xl" zIndex={zIndex}>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="shrink-0 text-sm font-medium">Name</span>
          {/* Always steals focus on open: the `/` menu's pencil leaves the note's
              line focused, and typing would otherwise go into the note. */}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Theorem & proof" autoFocus className={FIELD} />
        </div>

        {/* The file: the module's own little page, written like any note. */}
        <div className="rounded-lg border border-border bg-surface px-6 py-5">
          {blocks.map((b) => (
            <div key={b.id} className="group relative flex items-start gap-1 rounded px-1 hover:bg-foreground/[0.02]">
              <div className="min-w-0 flex-1 py-0.5">{renderLine(b)}</div>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => removeBlock(b.id)}
                title="Remove this line"
                aria-label="Remove this line"
                className="mt-1 shrink-0 px-1 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
          {blocks.length === 0 && (
            <button onClick={() => insert(paragraphFromSource(""))} className="w-full cursor-text py-2 text-left text-sm text-faint">
              Click to write
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">Insert:</span>
          {INSERTS.map((a) => (
            <button key={a.label} onClick={() => insert(a.make())} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-accent">
              <Icon name={a.icon} size={13} /> {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border-soft px-5 py-3">
        <p className="text-xs text-muted">Insert modules anywhere by typing <span className="font-mono">/</span> in a paragraph.</p>
        <div className="flex gap-2">
          <button onClick={() => void requestClose()} className={BTN}>Cancel</button>
          <button onClick={() => canSave && onSave(name.trim(), blocks)} disabled={!canSave} className={BTN_PRIMARY}>
            {isNew ? "Create module" : "Save changes"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
