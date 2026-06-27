"use client";

import { useEffect, type ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { applyTheme, getSettings } from "@/lib/settings/settings";

/** Client-side context providers mounted once at the app root. */
export function Providers({ children }: { children: ReactNode }) {
  // The inline script in layout.tsx applies the theme pre-paint; re-apply on
  // mount as a safety net (e.g. settings changed in another tab).
  useEffect(() => {
    applyTheme(getSettings().theme);
  }, []);
  return <AuthProvider>{children}</AuthProvider>;
}
