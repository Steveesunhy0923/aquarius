"use client";

import { useState } from "react";
import { ChevronSelect, Dialog, DialogSection } from "@/components/ui/Dialog";
import {
  getSettings,
  setSettings,
  type AppSettings,
  type InkCanvasSize,
  type TemplateApplyMode,
  type Theme,
} from "@/lib/settings/settings";

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const INK_SIZES: { id: InkCanvasSize; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "tall", label: "Tall" },
  { id: "page", label: "Full page" },
];

const TEMPLATE_MODES: { id: TemplateApplyMode; label: string }[] = [
  { id: "ask", label: "Always ask" },
  { id: "add", label: "Add to the note" },
  { id: "replace", label: "Replace the note" },
];

/** A Graphite toggle switch. */
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

const ROW = "flex items-center gap-3 border-t border-border-soft py-3";

/** Fundamental app preferences (browser-local): theme + math input + templates. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(() => getSettings());
  const update = (patch: Partial<AppSettings>) => setS(setSettings(patch));

  return (
    <Dialog title="Settings" onClose={onClose}>
      <div className="px-5 py-4">
        {/* Appearance */}
        <DialogSection>Appearance</DialogSection>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm">Theme</span>
          <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => update({ theme: t.id })}
                className={`rounded-md px-3 py-1.5 transition ${s.theme === t.id ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Math input */}
        <DialogSection>Math input</DialogSection>
        <div className={ROW}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm">On-screen math keyboard</span>
            <span className="block text-xs text-muted">Pop up a math keyboard when editing a formula. Off by default — the toolbar inserts symbols and structures.</span>
          </span>
          <Toggle on={s.mathKeyboard} onClick={() => update({ mathKeyboard: !s.mathKeyboard })} />
        </div>
        <div className={ROW}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm">
              Structural formula editor
              <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">beta</span>
            </span>
            <span className="block text-xs text-muted">Fill-in-the-boxes editor with better integral/bound handling. Existing formulas keep the current editor.</span>
          </span>
          <Toggle on={s.mathEditorBeta} onClick={() => update({ mathEditorBeta: !s.mathEditorBeta })} />
        </div>

        {/* Handwriting */}
        <DialogSection>Handwriting</DialogSection>
        <div className={ROW}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm">Sheet size</span>
            <span className="block text-xs text-muted">How large the handwriting sheet opens. Full page gives A4 sheets that add a new page as you write.</span>
          </span>
          <div className="inline-flex shrink-0 rounded-lg border border-border p-0.5 text-xs">
            {INK_SIZES.map((z) => (
              <button
                key={z.id}
                onClick={() => update({ inkCanvasSize: z.id })}
                className={`rounded-md px-3 py-1.5 transition ${s.inkCanvasSize === z.id ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>

        {/* Templates */}
        <DialogSection>Templates</DialogSection>
        <div className={ROW}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm">Applying to a non-empty note</span>
            <span className="block text-xs text-muted">When you use a template on a note that already has content.</span>
          </span>
          <ChevronSelect
            value={s.templateApplyMode}
            onChange={(v) => update({ templateApplyMode: v })}
            options={TEMPLATE_MODES}
          />
        </div>
      </div>
    </Dialog>
  );
}
