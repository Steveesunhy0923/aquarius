#!/usr/bin/env node
/**
 * Write out/precache-manifest.json — the list of files the service worker
 * (public/sw.js) downloads so the app opens with no network.
 *
 * Run by scripts/build-static.mjs after a successful export; it only makes
 * sense for the static export, where out/ IS the site.
 *
 *   { "version": "<hash>", "files": ["/", "/editor/", "/_next/static/…", …] }
 *
 * WHAT IS LISTED: every page, RSC payload, script, stylesheet, font and icon —
 * the things without which a route does not render. Including the dynamically
 * imported chunks (MathLive, CodeMirror, the lazy editor panels) is the reason
 * this is a build-time list rather than something the worker infers from the
 * HTML: those chunks appear in no page's markup, and an editor that opens
 * offline but cannot open a formula is not offline-capable.
 *
 * WHAT IS NOT: Pyodide (~13 MB) and pdf.js (~5 MB). Most sessions never run
 * Python or open a PDF; the worker caches those the first time they are used.
 *
 * `version` changes whenever any listed file's name or size does (hashed
 * chunk names change with their content; the HTML embeds the build id), which
 * is what tells the worker a new build exists.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
const MANIFEST = "precache-manifest.json";

/** Top-level directories cached on first use instead (see header). */
const ON_DEMAND = new Set(["pyodide", "pdfjs"]);
/** Never precached: the worker itself, this manifest, and source maps. */
const SKIP = (rel) => rel === "sw.js" || rel === MANIFEST || rel.endsWith(".map") || path.basename(rel).startsWith(".");

if (!existsSync(out)) {
  console.error("build-precache: out/ not found — run the static export first.");
  process.exit(1);
}

function* walk(dir, rel = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!rel && ON_DEMAND.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name), childRel);
    } else if (entry.isFile() && !SKIP(childRel)) {
      yield childRel;
    }
  }
}

/** The URL a file is served at: `editor/index.html` → `/editor/` (the export
 *  uses trailingSlash, and that is the form navigations take). */
const toUrl = (rel) => {
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel}`;
};

const hash = createHash("sha256");
const files = [];
let bytes = 0;
for (const rel of [...walk(out)].sort()) {
  const { size } = statSync(path.join(out, rel));
  const url = encodeURI(toUrl(rel));
  files.push(url);
  bytes += size;
  hash.update(`${url}\0${size}\n`);
}

// Page markup can change without its size changing; the build id (the one
// directory under _next/static that is not a known asset folder) pins it.
const buildIds = readdirSync(path.join(out, "_next", "static")).filter((n) => !["chunks", "css", "media"].includes(n));
hash.update(buildIds.join(","));

const manifest = { version: hash.digest("hex").slice(0, 16), files };
writeFileSync(path.join(out, MANIFEST), JSON.stringify(manifest));
console.log(`build-precache: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB, version ${manifest.version}`);
