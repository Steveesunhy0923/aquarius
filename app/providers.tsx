"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/AuthProvider";

/** Client-side context providers mounted once at the app root. */
export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
