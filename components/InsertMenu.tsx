"use client";

/**
 * InsertMenu — the single labelled entry point for "put something in the
 * document", replacing the row of insert glyphs that used to sit in the block
 * toolbar.
 *
 * The point isn't only space. A glyph has to carry its whole meaning alone, so
 * an icon-only row forces every mark to be self-explanatory at 18px — which is
 * exactly where `square-sigma` (equation), `Σ` (math mode) and `square-function`
 * (browse symbols) became indistinguishable. Behind a labelled menu the word
 * carries the meaning and the icon only has to aid recognition, so the same
 * actions get easier to find while taking one button of permanent space.
 */

import { Icon, type IconName } from "@/components/Icon";
import { Menu } from "@/components/ui/Menu";
import type { MouseEvent } from "react";

/** What a row inserts. Named separately from EditorCommand because the menu
 *  distinguishes bulleted from numbered lists, which the palette does not. */
export type InsertAction =
  | "paragraph" | "heading" | "bulletList" | "numberList"
  | "equation" | "chemistry" | "graph" | "table" | "code"
  | "image" | "link" | "noteLink";

type Row = {
  action: InsertAction;
  label: string;
  icon: IconName;
  hint?: string;
  /** Needs a live prose edit session (splices at the caret) — greyed out otherwise. */
  prose?: boolean;
};

const GROUPS: { name: string; rows: Row[] }[] = [
  {
    name: "Text",
    rows: [
      { action: "paragraph", label: "Paragraph", icon: "textstyle" },
      { action: "heading", label: "Heading", icon: "heading" },
      { action: "bulletList", label: "Bulleted list", icon: "list" },
      { action: "numberList", label: "Numbered list", icon: "listnumber" },
    ],
  },
  {
    name: "Maths & data",
    rows: [
      { action: "equation", label: "Equation", icon: "mathblock", hint: "$$" },
      { action: "chemistry", label: "Chemical equation", icon: "flask" },
      { action: "graph", label: "Graph", icon: "graph" },
      { action: "table", label: "Table", icon: "table" },
      { action: "code", label: "Code block", icon: "terminal" },
    ],
  },
  {
    name: "Media & links",
    rows: [
      { action: "image", label: "Image", icon: "image" },
      { action: "link", label: "Web link", icon: "link", prose: true },
      { action: "noteLink", label: "Link to a note", icon: "notebrackets", hint: "[[", prose: true },
    ],
  },
];

export function InsertMenu({ onPick, proseActive, keepFocus }: {
  onPick: (action: InsertAction) => void;
  /** True while a paragraph is open for editing — link inserts need a caret. */
  proseActive: boolean;
  /** Mousedown handler that preserves the editor's focus (sticky semantics), so
   *  opening the menu mid-paragraph doesn't discard the selection the link
   *  actions splice over. */
  keepFocus: (e: MouseEvent) => void;
}) {
  return (
    <Menu
      align="left"
      width="w-60"
      menuClassName="max-h-[70vh] overflow-y-auto"
      trigger={({ open, toggle }) => (
        <button
          onMouseDown={keepFocus}
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          title="Insert a block"
          className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${
            open ? "bg-accent text-white" : "bg-accent text-white hover:opacity-90"
          }`}
        >
          <Icon name="plus" size={15} />
          Insert
        </button>
      )}
    >
      {(close) => (
        <div role="menu">
          {GROUPS.map((g, gi) => (
            <div key={g.name} className={gi > 0 ? "mt-1 border-t border-border-soft pt-1" : ""}>
              <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-faint">
                {g.name}
              </div>
              {g.rows.map((r) => {
                const disabled = r.prose && !proseActive;
                return (
                  <button
                    key={r.action}
                    role="menuitem"
                    disabled={disabled}
                    title={disabled ? "Place the cursor in a paragraph first" : undefined}
                    onMouseDown={keepFocus}
                    onClick={(e) => { e.preventDefault(); close(); onPick(r.action); }}
                    className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm transition hover:bg-foreground/[0.06] disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    <span className="grid w-5 shrink-0 place-items-center text-muted"><Icon name={r.icon} size={16} /></span>
                    <span className="flex-1">{r.label}</span>
                    {r.hint && <span className="font-mono text-[11px] text-faint">{r.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Menu>
  );
}
