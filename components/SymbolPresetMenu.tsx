"use client";

/**
 * SymbolPresetMenu — switches the symbol strip between named sets, and saves
 * the current row as a new one.
 *
 * The strip fits ten or so symbols and which ten are right is entirely
 * scenario-dependent, so the menu leads with the built-in scenarios (linear
 * algebra, calculus, …) and keeps the user's own presets underneath, where they
 * can be renamed or removed. Saving takes whatever the strip holds right now —
 * including any slots edited by hand — so "get the row how you like it, then
 * name it" is the whole authoring flow.
 *
 * The toolbar owns the user-preset list (it needs it to name the current row);
 * this menu edits it and reports back through `onPresetsChanged`, including on
 * open — which is what picks up a preset saved in the other pane of a split
 * view.
 */

import { Icon } from "@/components/Icon";
import { Katex } from "@/components/Katex";
import { Menu } from "@/components/ui/Menu";
import { uiConfirm, uiPrompt } from "@/components/ui/dialogs";
import { previewLatex } from "@/lib/blocks/source";
import {
  BUILTIN_PRESETS,
  deleteUserPreset,
  renameUserPreset,
  saveUserPreset,
  type SymbolPreset,
} from "@/lib/symbolpresets";

/** The first few entries, rendered small — a row of glyphs identifies a preset
 *  far faster than its name does. */
function Sample({ symbols }: { symbols: string[] }) {
  return (
    <span className="flex items-center gap-1 overflow-hidden text-[11px] text-muted">
      {symbols.slice(0, 4).map((latex, i) => (
        <Katex key={i} latex={previewLatex(latex)} />
      ))}
    </span>
  );
}

export function SymbolPresetMenu({
  activeId,
  symbols,
  userPresets,
  onApply,
  onPresetsChanged,
  keepFocus,
}: {
  /** The preset the strip is showing; null once a slot has been hand-edited. */
  activeId: string | null;
  /** What the strip currently holds — what "Save current row…" captures. */
  symbols: string[];
  userPresets: SymbolPreset[];
  onApply: (preset: SymbolPreset) => void;
  /** Saved / renamed / deleted — the toolbar re-reads the list. */
  onPresetsChanged: () => void;
  keepFocus: (e: React.MouseEvent) => void;
}) {
  const active = [...BUILTIN_PRESETS, ...userPresets].find((p) => p.id === activeId);
  const label = active?.name ?? "Custom";

  const save = async (close: () => void) => {
    close();
    const name = await uiPrompt({
      title: "Save this symbol row",
      message: "Name it for the scenario it suits — “Linear algebra 2”, “My exam row”.",
      placeholder: "Preset name…",
      confirmLabel: "Save",
    });
    if (!name?.trim()) return;
    saveUserPreset(name, symbols);
    onPresetsChanged(); // the row is unchanged; it now has this name
  };

  const rename = async (p: SymbolPreset) => {
    const name = await uiPrompt({ title: "Rename preset", initial: p.name, confirmLabel: "Rename" });
    if (!name?.trim()) return;
    renameUserPreset(p.id, name);
    onPresetsChanged();
  };

  const remove = async (p: SymbolPreset) => {
    if (!(await uiConfirm({ title: "Delete preset", message: `Delete “${p.name}”? The symbols stay in the strip until you switch away.`, confirmLabel: "Delete", danger: true }))) return;
    deleteUserPreset(p.id);
    onPresetsChanged();
  };

  return (
    <Menu
      align="left"
      width="w-72"
      menuClassName="max-h-[60vh] overflow-y-auto"
      trigger={({ open, toggle }) => (
        <button
          onMouseDown={keepFocus}
          onClick={() => { if (!open) onPresetsChanged(); toggle(); }}
          aria-expanded={open}
          aria-haspopup="menu"
          title="Symbol presets — switch the row to suit what you're writing"
          className={`inline-flex h-9 max-w-[9rem] items-center gap-1 rounded-md px-2 text-xs transition ${
            open ? "bg-foreground/[0.06] text-foreground" : "text-muted hover:bg-foreground/[0.04] hover:text-foreground"
          }`}
        >
          <Icon name="templates" size={15} />
          <span className="truncate">{label}</span>
          <Icon name="chevron" size={13} />
        </button>
      )}
    >
      {(close) => (
        <div role="menu">
          <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-faint">Scenarios</div>
          {BUILTIN_PRESETS.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              onMouseDown={keepFocus}
              onClick={(e) => { e.preventDefault(); close(); onApply(p); }}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition hover:bg-foreground/[0.06]"
            >
              <span className="grid w-4 shrink-0 place-items-center pt-0.5 text-accent">
                {p.id === activeId && <Icon name="check" size={13} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{p.name}</span>
                <Sample symbols={p.symbols} />
              </span>
            </button>
          ))}

          {userPresets.length > 0 && (
            <>
              <div className="mt-1 border-t border-border-soft px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-faint">Your presets</div>
              {userPresets.map((p) => (
                <div key={p.id} className="flex items-center gap-1 rounded px-1 transition hover:bg-foreground/[0.06]">
                  <button
                    role="menuitem"
                    onMouseDown={keepFocus}
                    onClick={(e) => { e.preventDefault(); close(); onApply(p); }}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded px-1 py-1.5 text-left"
                  >
                    <span className="grid w-4 shrink-0 place-items-center pt-0.5 text-accent">
                      {p.id === activeId && <Icon name="check" size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{p.name}</span>
                      <Sample symbols={p.symbols} />
                    </span>
                  </button>
                  <button
                    onMouseDown={keepFocus}
                    onClick={(e) => { e.preventDefault(); void rename(p); }}
                    title={`Rename “${p.name}”`}
                    aria-label={`Rename ${p.name}`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:text-foreground"
                  >
                    <Icon name="editformula" size={13} />
                  </button>
                  <button
                    onMouseDown={keepFocus}
                    onClick={(e) => { e.preventDefault(); void remove(p); }}
                    title={`Delete “${p.name}”`}
                    aria-label={`Delete ${p.name}`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
            </>
          )}

          <div className="mt-1 border-t border-border-soft pt-1">
            <button
              role="menuitem"
              onMouseDown={keepFocus}
              onClick={(e) => { e.preventDefault(); void save(close); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-foreground/[0.06]"
            >
              <span className="grid w-4 shrink-0 place-items-center text-muted"><Icon name="plus" size={14} /></span>
              Save current row as…
            </button>
          </div>
        </div>
      )}
    </Menu>
  );
}
