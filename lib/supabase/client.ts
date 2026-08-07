/**
 * Supabase browser client — OPTIONAL.
 *
 * Aquarius is local-first: the app is fully functional with no Supabase
 * configured. This module returns `null` when env vars are absent, and the rest
 * of the app treats cloud sync as unavailable rather than crashing. Wire real
 * keys in `.env.local` (see `.env.example`) to enable cloud backup / sync.
 *
 * The client itself now comes from `@orka/auth`, because this project is the
 * ORKA project: one `auth.users` row is one Orka account, shared with Virgo and
 * whatever else joins the franchise. What stays here is everything that is
 * genuinely Aquarius-specific —
 *
 *   - reading `process.env.NEXT_PUBLIC_*` at module scope. Next.js inlines
 *     those literals at build time; Virgo needs `import.meta.env.VITE_*`. A
 *     shared package that read either would be broken in the other app, so
 *     config is injected rather than discovered.
 *   - the `eventsPerSecond: 40` realtime override, which exists for live
 *     co-editing in this app and nothing else.
 *   - the singleton. Several modules (profile, sharing, cloud storage, collab)
 *     call `getSupabaseClient()` directly rather than going through the auth
 *     context, and they must all receive the SAME instance: two clients means
 *     two GoTrueClients racing on one storage key.
 */

import { createOrkaClient } from "@orka/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  cached = createOrkaClient({
    url,
    anonKey,
    // supabase-js defaults to 10 outbound events/sec, shared across the
    // per-keystroke Yjs "update" broadcasts AND per-selectionchange cursor
    // presence (lib/collab/provider.ts). Fast typing blows that budget and
    // remote edits arrive in laggy bursts. Lift it so live co-editing keeps up
    // with a fast typist.
    realtimeParams: { eventsPerSecond: 40 },
  });
  return cached;
}
