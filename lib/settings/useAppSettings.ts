"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, getSettings, SETTINGS_EVENT, SETTINGS_KEY, type AppSettings } from "./settings";

/**
 * The app settings, kept current: re-read when this tab changes them
 * (`setSettings` fires SETTINGS_EVENT) or another tab does (`storage`).
 *
 * Starts from the defaults and reads localStorage in an effect, so a
 * server-rendered or statically exported page hydrates without a mismatch.
 */
export function useAppSettings(): AppSettings {
  const [settings, setState] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    const read = () => setState(getSettings());
    const onStorage = (e: StorageEvent) => { if (e.key === SETTINGS_KEY) read(); };
    read();
    window.addEventListener(SETTINGS_EVENT, read);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, read);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return settings;
}
