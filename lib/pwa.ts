/**
 * Register the service worker (public/sw.js) that keeps the app shell
 * available offline. See that file for what it caches and why it is safe.
 *
 * Production only: in `next dev` a worker caching hashed chunks fights hot
 * reload and outlives the dev server. And only over http(s) — the Capacitor
 * shell serves its bundled files from a custom scheme, where they are already
 * local and service workers are not available.
 */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(window.location.protocol)) return;

  const register = () => {
    // Failure (private mode, a browser that blocks it) just means no offline
    // shell — exactly the behaviour before the worker existed.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  };
  // After load, so the worker's precache never competes with the first paint.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
