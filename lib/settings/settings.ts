/**
 * App-wide user settings (browser-local).
 *
 * Small, fundamental preferences kept in localStorage: the color theme and how
 * applying a template to a non-empty note behaves. Read synchronously anywhere;
 * `applyTheme` toggles the `theme-*` class the CSS palettes key off of
 * (app/globals.css). The no-flash initial apply is an inline script in
 * app/layout.tsx; this module is the source of truth thereafter.
 */

export type Theme = "system" | "light" | "dark";
/** What "Use this template" does when the note already has content. */
export type TemplateApplyMode = "ask" | "add" | "replace";

export interface AppSettings {
  theme: Theme;
  templateApplyMode: TemplateApplyMode;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  templateApplyMode: "ask",
};

export const SETTINGS_KEY = "aquarius.settings.v1";

export function getSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    if (patch.theme !== undefined) applyTheme(next.theme);
  }
  return next;
}

/** Force the `theme-light` / `theme-dark` class (or neither for "system"). */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const cl = document.documentElement.classList;
  cl.remove("theme-light", "theme-dark");
  if (theme === "light") cl.add("theme-light");
  else if (theme === "dark") cl.add("theme-dark");
}
