"use client";

import { useState } from "react";
import {
  getSettings,
  setSettings,
  type AppSettings,
  type TemplateApplyMode,
  type Theme,
} from "@/lib/settings/settings";

const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

const TEMPLATE_MODES: { id: TemplateApplyMode; label: string; desc: string }[] = [
  { id: "ask", label: "Always ask", desc: "Prompt each time the note already has content." },
  { id: "add", label: "Add to the note", desc: "Append the template to the existing content." },
  { id: "replace", label: "Replace the note", desc: "Discard current content and start fresh." },
];

/** Fundamental app preferences (browser-local): theme + template behavior. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(() => getSettings());
  const update = (patch: Partial<AppSettings>) => setS(setSettings(patch));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">✕</button>
        </div>

        {/* Theme */}
        <section className="mb-5">
          <p className="mb-2 text-sm font-medium">Appearance</p>
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => update({ theme: t.id })}
                className={`rounded-md px-3 py-1.5 text-sm ${s.theme === t.id ? "bg-accent text-white" : "text-muted hover:bg-foreground/5"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* Math input */}
        <section className="mb-5">
          <p className="mb-2 text-sm font-medium">Math input</p>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 hover:border-accent">
            <input type="checkbox" className="mt-0.5" checked={s.mathKeyboard} onChange={(e) => update({ mathKeyboard: e.target.checked })} />
            <span>
              <span className="block text-sm font-medium">On-screen math keyboard</span>
              <span className="block text-xs text-muted">Pop up a math keyboard when editing a formula. Off by default — use the toolbar to insert symbols and structures.</span>
            </span>
          </label>
          <label className="mt-1.5 flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 hover:border-accent">
            <input type="checkbox" className="mt-0.5" checked={s.mathEditorBeta} onChange={(e) => update({ mathEditorBeta: e.target.checked })} />
            <span>
              <span className="block text-sm font-medium">Structural formula editor <span className="rounded bg-accent/15 px-1 text-[10px] font-semibold uppercase text-accent">beta</span></span>
              <span className="block text-xs text-muted">Edit new equations by filling in boxes you navigate with arrow keys (better integral/bound handling). Existing formulas keep the current editor.</span>
            </span>
          </label>
        </section>

        {/* Template behavior */}
        <section>
          <p className="mb-1 text-sm font-medium">Applying a template</p>
          <p className="mb-2 text-xs text-muted">When you use a template on a note that isn’t empty.</p>
          <div className="space-y-1.5">
            {TEMPLATE_MODES.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 hover:border-accent">
                <input
                  type="radio"
                  name="tpl-mode"
                  className="mt-0.5"
                  checked={s.templateApplyMode === m.id}
                  onChange={() => update({ templateApplyMode: m.id })}
                />
                <span>
                  <span className="block text-sm font-medium">{m.label}</span>
                  <span className="block text-xs text-muted">{m.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
