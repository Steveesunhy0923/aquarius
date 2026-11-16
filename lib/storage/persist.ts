/**
 * Ask the browser to keep this origin's data.
 *
 * IndexedDB is "best-effort" storage by default: under disk pressure the
 * browser may evict an origin's data wholesale, without asking, and Safari
 * additionally clears script-writable storage for sites it has not seen used
 * in seven days. For a guest that IS the library — there is no cloud copy —
 * and for a signed-in user it is every edit not yet pushed.
 * `navigator.storage.persist()` moves the origin to "persistent", which is
 * exempt from eviction.
 *
 * Called after the first real save rather than on load: Firefox answers this
 * request with a permission prompt, and a prompt on first visit, before the
 * visitor has written anything worth keeping, is both unexplained and likely
 * to be dismissed for good. Chrome and Safari decide silently.
 *
 * Asked once per page load; a refusal is not an error (the data is simply as
 * durable as it was before).
 */

let asked = false;

export function requestPersistentStorage(): void {
  if (asked) return;
  asked = true;
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.persist) return;
  void (async () => {
    try {
      if (await storage.persisted?.()) return;
      await storage.persist();
    } catch {
      // Unsupported or blocked (e.g. a private window) — nothing to do.
    }
  })();
}

/** Whether the origin's storage is currently exempt from eviction. */
export async function isStoragePersistent(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}
