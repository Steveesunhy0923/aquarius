"use client";

import { useEffect, type ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { MathKeyboardDismiss } from "@/components/MathKeyboardDismiss";
import { ShareNotifier } from "@/components/ShareNotifier";
import { SystemDialogs } from "@/components/ui/dialogs";
import { Toaster } from "@/components/ui/toast";
import { initMonitoring } from "@/lib/monitoring";
import { registerServiceWorker } from "@/lib/pwa";
import { applyMathKeyboard, applyTheme, getSettings } from "@/lib/settings/settings";

/** Client-side context providers mounted once at the app root. */
export function Providers({ children }: { children: ReactNode }) {
  // The inline script in layout.tsx applies the theme pre-paint; re-apply on
  // mount as a safety net (e.g. settings changed in another tab), and reflect the
  // on-screen-keyboard preference onto <html> for the MathLive chrome CSS.
  useEffect(() => {
    applyTheme(getSettings().theme);
    applyMathKeyboard(getSettings().mathKeyboard);
    // Uncaught errors + unhandled rejections → Sentry, when a DSN is configured
    // (a no-op otherwise — see lib/monitoring.ts).
    initMonitoring();
    // Offline app shell (production builds only — see lib/pwa.ts).
    registerServiceWorker();
  }, []);
  return (
    <AuthProvider>
      {children}
      <MathKeyboardDismiss />
      <SystemDialogs />
      <Toaster />
      <ShareNotifier />
    </AuthProvider>
  );
}
