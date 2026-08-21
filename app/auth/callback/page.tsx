"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { handleAuthCallback } from "@atorku/auth";
import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * OAuth / email-link landing page.
 *
 * The client sets `flowType: "pkce"` and `detectSessionInUrl: false`, so
 * NOTHING exchanges the `code` on its own — this page does it explicitly. That
 * is deliberate: an explicit exchange surfaces a real message when it fails,
 * where an automatic one would just leave the visitor silently signed out.
 *
 * (The previous version of this comment said the client auto-exchanged and that
 * we polled for the result. It never did — `detectSessionInUrl` has been false
 * throughout, and the code below has always exchanged explicitly. Corrected
 * rather than carried forward.)
 *
 * The exchange itself now lives in `@atorku/auth`, so this route, the Atorku site's
 * callback and Virgo's boot-time hook cannot drift apart.
 */
export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    const sb = getSupabaseClient();
    if (!sb) {
      router.replace("/");
      return;
    }
    // Exactly once. An authorization code is single-use, so React's
    // double-invoked development effect would fail the second exchange and
    // report an error over a sign-in that had actually succeeded.
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      try {
        const { handled } = await handleAuthCallback(sb, window.location.href);
        // No code in the URL: already signed in, or nothing to do.
        void handled;
        router.replace("/");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [router]);

  return (
    <div className="grid min-h-screen place-items-center p-8 text-sm text-muted">
      {error ? (
        <div className="max-w-sm text-center">
          <p className="mb-2 font-medium text-danger">Sign-in failed</p>
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
