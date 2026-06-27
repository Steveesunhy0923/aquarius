/**
 * Cached current-user id.
 *
 * `getStore()` (lib/storage/index.ts) is synchronous, but whether to return the
 * cloud or the local store depends on the auth session, which supabase-js only
 * exposes asynchronously. The AuthProvider keeps this module's cache in sync via
 * `setCachedUserId()` on every auth state change, so `getStore()` can decide
 * without awaiting. Pure module state — no imports, safe on the server (stays
 * null until the client sets it).
 */

let cachedUserId: string | null = null;

/** The signed-in user's id, or null when signed out / not yet known. */
export function getCachedUserId(): string | null {
  return cachedUserId;
}

/** Set by AuthProvider on every auth state change. */
export function setCachedUserId(id: string | null): void {
  cachedUserId = id;
}
