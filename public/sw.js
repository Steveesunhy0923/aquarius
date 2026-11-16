/*
 * Aquarius service worker — makes the app SHELL available offline.
 *
 * The data was always offline (IndexedDB). The app that reads it was not: with
 * no network the page itself failed to load, so "offline-capable" meant "if
 * you already have the tab open". This worker closes that gap.
 *
 * It is deliberately conservative, because a bad service worker is the one bug
 * a redeploy cannot fix for people who already have it:
 *
 *   • Pages are NETWORK-FIRST. Online, the server always wins, so a deploy is
 *     picked up on the next navigation exactly as it was before this file
 *     existed. The cache only answers when the network does not.
 *   • Only same-origin GETs are touched. Supabase, the PDF/unfurl API routes
 *     and every write pass straight through.
 *   • Cache-first is used only for /_next/static/*, whose file names contain a
 *     content hash — a cached copy can never be stale.
 *
 * WHAT GETS CACHED
 *   Shell (precached): the list in /precache-manifest.json, written at build
 *     time by scripts/build-precache.mjs — every page, RSC payload, script,
 *     stylesheet and font of the static export. Each build has a `version`;
 *     a new one is downloaded into its own cache and only swapped in once it
 *     is complete, so a half-downloaded build is never served. The previous
 *     build's cache is kept one generation, for tabs still running its code.
 *   Runtime (on first use): the large optional runtimes — Pyodide (~13 MB),
 *     pdf.js (~5 MB) — which most sessions never load.
 *
 * Builds without a precache manifest (`next dev`, `next start`) still work:
 * nothing is precached and everything else behaves the same.
 */

const MANIFEST_URL = "/precache-manifest.json";
const META = "aq-meta"; // holds the pointer to the current/previous shell caches
const RUNTIME = "aq-runtime-v1";
const SHELL_PREFIX = "aq-shell-";
const POINTER = "/__aq/shell-pointer";
const NAV_TIMEOUT_MS = 4000;

/** { current: string|null, previous: string|null } — shell cache names. */
let pointer = null;

async function readPointer() {
  if (pointer) return pointer;
  try {
    const res = await (await caches.open(META)).match(POINTER);
    pointer = res ? await res.json() : { current: null, previous: null };
  } catch {
    pointer = { current: null, previous: null };
  }
  return pointer;
}

async function writePointer(next) {
  pointer = next;
  await (await caches.open(META)).put(POINTER, new Response(JSON.stringify(next), { headers: { "content-type": "application/json" } }));
}

let precaching = null;

/** Fetch the build's file list and, if it is a build we do not hold yet,
 *  download all of it into a fresh cache before making it current. */
function precache() {
  precaching ??= (async () => {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) return; // a build without one (dev / server mode)
    const manifest = await res.json();
    if (!manifest || typeof manifest.version !== "string" || !Array.isArray(manifest.files)) return;

    const name = SHELL_PREFIX + manifest.version;
    const p = await readPointer();
    if (p.current === name) return;

    const cache = await caches.open(name);
    const queue = [...manifest.files];
    const worker = async () => {
      for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
        if (await cache.match(url)) continue; // resumed after an interrupted install
        const r = await fetch(url, { cache: "no-cache" });
        if (!r.ok || r.redirected) throw new Error(`precache ${url}: ${r.status}`);
        await cache.put(url, r);
      }
    };
    // All or nothing: one failure rejects, the pointer is not moved, and the
    // partial cache is picked up where it left off next time.
    await Promise.all(Array.from({ length: 6 }, worker));

    await writePointer({ current: name, previous: p.current });
    const keep = new Set([name, p.current]);
    for (const key of await caches.keys()) {
      if (key.startsWith(SHELL_PREFIX) && !keep.has(key)) await caches.delete(key);
    }
    // Hashed chunks fetched while this build was still downloading are now in
    // the shell (or belong to a build two generations back).
    const runtime = await caches.open(RUNTIME);
    for (const req of await runtime.keys()) {
      if (new URL(req.url).pathname.startsWith("/_next/static/")) await runtime.delete(req);
    }
  })().finally(() => {
    precaching = null;
  });
  return precaching;
}

async function fromShell(request, options) {
  const p = await readPointer();
  for (const name of [p.current, p.previous]) {
    if (!name) continue;
    const hit = await (await caches.open(name)).match(request, options);
    if (hit) return hit;
  }
  return undefined;
}

const cacheable = (res) => res && res.status === 200 && res.type === "basic";

async function putRuntime(request, response) {
  try {
    await (await caches.open(RUNTIME)).put(request, response);
  } catch {
    // Quota exceeded, or a response the Cache API refuses — serving is unaffected.
  }
}

/** Content-hashed files: any cached copy is the right one. */
async function cacheFirst(request) {
  const hit = (await fromShell(request)) ?? (await (await caches.open(RUNTIME)).match(request));
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) void putRuntime(request, res.clone());
  return res;
}

/** Large, unhashed runtimes: answer from cache at once, refresh behind it. */
function staleWhileRevalidate(event) {
  const { request } = event;
  return (async () => {
    const cached = (await fromShell(request)) ?? (await (await caches.open(RUNTIME)).match(request));
    const refresh = fetch(request)
      .then((res) => {
        if (cacheable(res)) void putRuntime(request, res.clone());
        return res;
      })
      .catch(() => undefined);
    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }
    return (await refresh) ?? Response.error();
  })();
}

/** Everything else same-origin (RSC payloads, the manifest, icons). */
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (err) {
    // RSC payloads are requested as /path/index.txt?_rsc=<hash>.
    const hit = await fromShell(request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

/** The cached page for a navigation: the exact path, then its directory form
 *  (the export is /editor/index.html, addressed as /editor/ or /editor). */
async function cachedPage(url) {
  const path = url.pathname;
  const candidates = path.endsWith("/") ? [path] : [path, `${path}/`];
  for (const candidate of candidates) {
    const hit = await fromShell(candidate, { ignoreSearch: true });
    if (hit) return hit;
  }
  return undefined;
}

async function navigate(event) {
  const url = new URL(event.request.url);
  const network = fetch(event.request);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), NAV_TIMEOUT_MS);
  });
  try {
    // On a connection that is technically up but going nowhere, stop waiting
    // and open from the cache — but only if there is a cached page to open.
    const first = await Promise.race([network, timeout]);
    if (first === "timeout") {
      const cached = await cachedPage(url);
      if (cached) {
        network.catch(() => {}); // abandoned, not unhandled
        return cached;
      }
      return await network;
    }
    // Online: a good moment to notice a new build and fetch it behind the page.
    event.waitUntil(precache().catch(() => {}));
    return first;
  } catch {
    const cached = await cachedPage(url);
    if (cached) return cached;
    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
        "<title>Offline — Aquarius</title><body style='font:16px system-ui;padding:2rem;max-width:32rem;margin:auto'>" +
        "<h1 style='font-size:1.25rem'>You're offline</h1>" +
        "<p>This page hasn't been saved for offline use yet. Open Aquarius once while online and it will be.</p>" +
        "<p><a href='/'>Back to your library</a></p>",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("install", (event) => {
  // A failed precache must not block installation: the worker is still useful
  // (runtime caching), and it retries on the next online navigation.
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, CDNs: not ours to cache
  if (url.pathname.startsWith("/api/") || url.pathname === MANIFEST_URL || url.pathname === "/sw.js") return;
  if (request.headers.has("range")) return; // partial responses cannot be cached

  if (request.mode === "navigate") {
    event.respondWith(navigate(event));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  } else if (/^\/(pyodide|pdfjs|mathlive|fonts|icons)\//.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  } else {
    event.respondWith(networkFirst(request));
  }
});
