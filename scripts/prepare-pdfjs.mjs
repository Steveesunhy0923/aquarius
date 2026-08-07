#!/usr/bin/env node
/**
 * Vendor pdf.js into public/pdfjs/ so it loads at RUNTIME, never through the
 * bundler — the same pattern scripts/prepare-pyodide.mjs uses for Pyodide, and
 * for the same reasons:
 *
 *  - `output: "export"` prerenders every page in Node, and a top-level import
 *    of pdfjs would be evaluated there, where DOMMatrix/Path2D do not exist and
 *    its optional native canvas dependency IS reachable. Loading from a URL at
 *    runtime keeps it strictly in the browser.
 *  - Next copies public/ verbatim into out/, and the Capacitor shell serves
 *    that through capacitor://localhost, so one root-absolute path (/pdfjs/…)
 *    works in dev, in the static export, and on the iPad.
 *
 * Deliberately NOT copied: wasm/quickjs-eval.wasm (AcroForm scripting, which we
 * keep disabled), the *_nowasm_fallback.js shims (WebAssembly exists everywhere
 * we ship), web/, image_decoders/, and every .map.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.dirname(require.resolve("pdfjs-dist/package.json"));
const DEST = path.join(ROOT, "public", "pdfjs");
const VERSION = require("pdfjs-dist/package.json").version;
const STAMP = path.join(DEST, ".version");

// The LEGACY build, not the modern one: it is the variant pdf.js supports on
// Safari, and the iPad is the target that matters here. Costs ~50 KB.
const FILES = [
  "legacy/build/pdf.min.mjs",
  "legacy/build/pdf.worker.min.mjs",
  "wasm/jbig2.wasm",
  "wasm/openjpeg.wasm",
  "wasm/qcms_bg.wasm",
];
const DIRS = ["cmaps", "standard_fonts"];

if (fs.existsSync(STAMP) && fs.readFileSync(STAMP, "utf8").trim() === VERSION) {
  process.stdout.write(`pdfjs ${VERSION} already vendored\n`);
  process.exit(0);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

let bytes = 0;
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  bytes += fs.statSync(to).size;
};

for (const rel of FILES) {
  const from = path.join(SRC, rel);
  if (!fs.existsSync(from)) {
    throw new Error(`pdfjs-dist is missing ${rel} — did its layout change in ${VERSION}?`);
  }
  // Flatten legacy/build/* to the root so the runtime path stays /pdfjs/<file>.
  copy(from, path.join(DEST, rel.startsWith("legacy/build/") ? path.basename(rel) : rel));
}
for (const dir of DIRS) {
  const from = path.join(SRC, dir);
  if (!fs.existsSync(from)) throw new Error(`pdfjs-dist is missing ${dir}/`);
  for (const name of fs.readdirSync(from)) {
    copy(path.join(from, name), path.join(DEST, dir, name));
  }
}

fs.writeFileSync(STAMP, `${VERSION}\n`);
process.stdout.write(`vendored pdfjs ${VERSION} → public/pdfjs (${(bytes / 1e6).toFixed(1)} MB)\n`);
