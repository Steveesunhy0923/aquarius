/**
 * Where Ancha lives.
 *
 * On this Mac she is `http://127.0.0.1:8787` and nothing needs configuring.
 * On a real iPad that address means *the iPad*, so handwriting silently reads
 * as "Ancha is offline" — she is on the Mac, across the LAN. Hence two ways to
 * point at her, checked in this order:
 *
 *   1. a runtime override in localStorage — settable from the device itself
 *      (the /ink lab's endpoint field), which matters because you cannot edit
 *      an env file from an iPad and a NEXT_PUBLIC_* change needs a dev-server
 *      restart to take effect;
 *   2. NEXT_PUBLIC_ANCHA_ORIGIN, for a build that always talks to a fixed host;
 *   3. loopback, the desktop default.
 *
 * Mirrors lib/api.ts's NEXT_PUBLIC_API_ORIGIN pattern. Note that reaching her
 * over the LAN also needs the SERVER to stop listening on loopback only —
 * `python serve.py --host 0.0.0.0` (see ml/serve.py).
 */

const KEY = "aquarius.ancha.origin";
const ENV_ORIGIN = process.env.NEXT_PUBLIC_ANCHA_ORIGIN ?? "";
export const DEFAULT_ANCHA_ORIGIN = "http://127.0.0.1:8787";

/** Trim a user-typed origin into something fetchable, or "" if unusable. */
export function normalizeOrigin(raw: string): string {
  const s = raw.trim().replace(/\/+$/, "");
  if (!s) return "";
  // A bare host or host:port is the natural thing to type on a phone keyboard.
  const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`;
  try {
    const u = new URL(withScheme);
    // No port typed → assume Ancha's, not the browser's 80/443.
    if (!u.port && u.protocol === "http:") u.port = "8787";
    return u.origin;
  } catch {
    return "";
  }
}

/** The origin to call right now. Safe during SSR (falls back to env/default). */
export function anchaOrigin(): string {
  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved) return saved;
    } catch {
      /* private mode / storage disabled — fall through to the build-time value */
    }
  }
  return ENV_ORIGIN || DEFAULT_ANCHA_ORIGIN;
}

/** Persist a device-local override. Empty string clears it. */
export function setAnchaOrigin(raw: string): string {
  const origin = normalizeOrigin(raw);
  try {
    if (origin) window.localStorage.setItem(KEY, origin);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage disabled — the value still applies for this page load */
  }
  return origin || (ENV_ORIGIN || DEFAULT_ANCHA_ORIGIN);
}

/** True when the override is set (so the UI can show it is not the default). */
export function hasAnchaOverride(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export const anchaUrl = (path: string): string => `${anchaOrigin()}${path}`;
