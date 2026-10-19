"use client";

/**
 * BoxMenu — the top bar's coloured box: LaTeX's tcolorbox, for setting a
 * definition, a theorem or a worked example apart from the text around it.
 * The model is lib/blocks/boxes.ts; the page draws it with `.aq-box`.
 *
 * Out of a box, a colour or a title puts the line holding the caret in a new
 * one (with no caret, a boxed line starts at the end of the note). In a box,
 * the same controls restyle it, and it can take in the block below or be taken
 * apart again. The panel stays open while it is used: every change is already
 * on the page behind it, so trying colours needs no reopening.
 */

import { Icon } from "@/components/Icon";
import { TEXT_BTN } from "@/components/ToolbarControls";
import { Menu } from "@/components/ui/Menu";
import { EYEBROW, FIELD_SM } from "@/components/ui/primitives";
import { BOX_COLORS, BOX_TITLES, DEFAULT_BOX_COLOR, isBoxColor, type BoxStyle } from "@/lib/blocks/boxes";
import { useEffect, useState, type MouseEvent } from "react";

const COLOR_KEY = "aquarius.box-color";

/** The colour last picked, for a box started without choosing one (Insert ▸ Box, a title pick). */
export function lastBoxColor(): string {
  try {
    const v = localStorage.getItem(COLOR_KEY);
    return v && isBoxColor(v) ? v.toLowerCase() : DEFAULT_BOX_COLOR;
  } catch {
    return DEFAULT_BOX_COLOR;
  }
}

export function rememberBoxColor(color: string) {
  try {
    localStorage.setItem(COLOR_KEY, color);
  } catch {
    /* no storage: the default stands in next time */
  }
}

export function BoxMenu({ box, canExtend, keepFocus, onColor, onTitle, onExtend, onRemove }: {
  /** The box holding the caret, or null. */
  box: BoxStyle | null;
  /** A block follows that box, so it has something to take in. */
  canExtend: boolean;
  /** Mousedown handler that holds the caret in its line while a button acts on it. */
  keepFocus: (e: MouseEvent) => void;
  /** `live`: the colour wheel or hex field is mid-change — one undo step for the burst. */
  onColor: (color: string, live?: boolean) => void;
  onTitle: (title: string) => void;
  onExtend: () => void;
  onRemove: () => void;
}) {
  const color = box?.color ?? null;
  // The hex field is typed into, so it keeps a draft and reports only a whole colour.
  const [hex, setHex] = useState("");
  useEffect(() => setHex(color ?? ""), [color]);
  const press = (fn: () => void) => ({
    onMouseDown: keepFocus,
    onClick: (e: MouseEvent) => {
      e.preventDefault();
      fn();
    },
  });

  return (
    <Menu
      align="left"
      width="w-64"
      trigger={({ open, toggle }) => (
        <button
          onMouseDown={keepFocus}
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-pressed={box != null}
          title="Coloured box"
          className={`${TEXT_BTN} ${box || open ? "bg-accent-soft text-accent" : ""}`}
        >
          {/* In a box, the glyph takes the box's colour. */}
          <span className="grid place-items-center" style={color ? { color } : undefined}>
            <Icon name="box" size={17} />
          </span>
          Box
          <Icon name="chevron" size={10} />
        </button>
      )}
    >
      <div className="space-y-2 p-1.5">
        <div className="grid grid-cols-8 gap-1.5">
          {BOX_COLORS.map((c) => (
            <button
              key={c}
              {...press(() => onColor(c))}
              title={c}
              aria-label={`Box colour ${c}`}
              aria-pressed={color === c}
              className="h-6 w-6 rounded-full transition hover:scale-110"
              style={{ background: c, outline: color === c ? "2px solid var(--foreground)" : undefined, outlineOffset: 2 }}
            />
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Custom
          {/* No preventDefault: the native picker needs the press. Taking focus is
              harmless — leaving a line is explicit, never a blur. */}
          <input
            type="color"
            value={color ?? DEFAULT_BOX_COLOR}
            onChange={(e) => onColor(e.target.value, true)}
            className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
          />
          <input
            value={hex}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHex(v);
              if (isBoxColor(v)) onColor(v.toLowerCase(), true);
            }}
            spellCheck={false}
            aria-label="Hex colour"
            className="w-20 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground outline-none focus:border-accent"
          />
        </label>
        <div className="border-t border-border-soft pt-2">
          <div className={`${EYEBROW} mb-1.5`}>Title</div>
          {box && (
            <input value={box.title ?? ""} onChange={(e) => onTitle(e.target.value)} aria-label="Box title" className={`${FIELD_SM} mb-1.5`} />
          )}
          <div className="flex flex-wrap gap-1">
            {BOX_TITLES.map((t) => {
              const on = box?.title === t;
              return (
                <button
                  key={t}
                  {...press(() => onTitle(on ? "" : t))}
                  aria-pressed={on}
                  className={`rounded-full border px-2 py-0.5 text-xs transition ${on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:border-accent hover:text-foreground"}`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
        {box && (
          <div className="flex items-center justify-between border-t border-border-soft pt-1.5">
            <button
              {...press(onExtend)}
              disabled={!canExtend}
              className="rounded px-2 py-1 text-xs text-muted transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
            >
              Include next block
            </button>
            <button {...press(onRemove)} className="rounded px-2 py-1 text-xs text-muted transition hover:bg-danger/10 hover:text-danger">
              Remove box
            </button>
          </div>
        )}
      </div>
    </Menu>
  );
}
