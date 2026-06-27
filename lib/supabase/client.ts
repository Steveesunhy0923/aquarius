/**
 * Supabase browser client — OPTIONAL.
 *
 * Aquarius is local-first: the app is fully functional with no Supabase
 * configured. This module returns `null` when env vars are absent, and the rest
 * of the app treats cloud sync as unavailable rather than crashing. Wire real
 * keys in `.env.local` (see `.env.example`) to enable cloud backup / sync.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null | undefined;

/** True when cloud sync is configured for this deployment. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

/**
 * Returns a singleton Supabase client, or `null` if not configured.
 * Callers MUST handle the null case (local-only mode).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  cached = isSupabaseConfigured()
    ? createClient(url as string, anonKey as string, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // PKCE: the OAuth redirect carries a `code` we exchange explicitly at
          // /auth/callback (see app/auth/callback/page.tsx) so failures surface a
          // message instead of silently leaving the user signed-out. Disable the
          // implicit URL detection to avoid a double-exchange of that code.
          flowType: "pkce",
          detectSessionInUrl: false,
        },
      })
    : null;
  return cached;
}
