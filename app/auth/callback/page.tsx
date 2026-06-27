"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * OAuth / magic-link landing page. The browser client (flowType: pkce,
 * detectSessionInUrl) exchanges the `code` in the URL for a session on load; we
 * poll briefly for that session, surface any provider error, then go home.
 */
export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabaseClient();
    if (!sb) {
      router.replace("/");
      return;
    }
    (async () => {
      const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
      // Provider-side error (e.g. consent denied, redirect mismatch).
      const provErr = params.get("error_description") ?? params.get("error");
      if (provErr) {
        setError(provErr);
        return;
      }
      const code = params.get("code");
      if (!code) {
        // No code to exchange — already signed in, or nothing to do.
        router.replace("/");
        return;
      }
      const { error: exErr } = await sb.auth.exchangeCodeForSession(code);
      if (exErr) {
        setError(exErr.message);
        return;
      }
      router.replace("/");
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [router]);

  return (
    <div className="grid min-h-screen place-items-center p-8 text-sm text-muted">
      {error ? (
        <div className="max-w-sm text-center">
          <p className="mb-2 font-medium text-red-500">Sign-in failed</p>
          <p className="mb-4">{error}</p>
          <button onClick={() => router.replace("/")} className="rounded border border-border px-3 py-1.5 hover:border-accent">
            Back to library
          </button>
        </div>
      ) : (
        "Signing you in…"
      )}
    </div>
  );
}
