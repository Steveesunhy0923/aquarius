/**
 * Origin for the server API routes (/api/unfurl, /api/pdf, …).
 *
 * Empty in the normal web app — same-origin fetches. The static-export builds
 * that the Capacitor/desktop shells bundle have no server at all, so they set
 * NEXT_PUBLIC_API_ORIGIN to the hosted deployment (e.g. https://aquarius.app)
 * at build time. Callers must degrade gracefully when the fetch fails — an
 * offline shell is a supported state, and the API routes are conveniences
 * (link previews, typeset PDF), never the data path.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

/** `apiUrl("/api/unfurl?…")` → same-origin path, or absolute in shell builds. */
export const apiUrl = (path: string): string => `${API_ORIGIN}${path}`;
