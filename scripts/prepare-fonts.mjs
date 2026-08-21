#!/usr/bin/env node
/**
 * Vendor Computer Modern (CMU Serif) into public/fonts/cm/ — the typeface a
 * LaTeX document is set in, and therefore the app's default document font.
 *
 * It used to arrive through `@import url("https://cdn.jsdelivr.net/…@latest")`
 * in globals.css, which meant the default style silently degraded to Georgia
 * offline and inside the Capacitor shell (capacitor://localhost can't reach a
 * CDN), and floated on an unpinned `@latest`. Same fix, same pattern, and for
 * the same reasons as scripts/prepare-pdfjs.mjs: copy the bytes into public/,
 * where Next serves them in dev, `output: "export"` copies them into out/, and
 * the iPad shell has them on disk.
 *
 * Only the four text faces are copied (roman/italic × regular/bold, woff2 only
 * — every browser we ship to supports it). The package's own CSS is NOT used:
 * it declares `font-style: roman`, which is not a valid CSS value, so those
 * faces never match. app/globals.css declares the @font-face rules instead.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(path.dirname(require.resolve("computer-modern/package.json")), "fonts");
const DEST = path.join(ROOT, "public", "fonts", "cm");
const VERSION = require("computer-modern/package.json").version;
const STAMP = path.join(DEST, ".version");

// Source name → served name. The package files carry weight 500 for the
// regular cut; the served names say what the face IS, since the @font-face
// rules in globals.css assign the weights.
const FILES = {
  "cmu-serif-500-roman.woff2": "cmu-serif-regular.woff2",
  "cmu-serif-500-italic.woff2": "cmu-serif-italic.woff2",
  "cmu-serif-700-roman.woff2": "cmu-serif-bold.woff2",
  "cmu-serif-700-italic.woff2": "cmu-serif-bold-italic.woff2",
};

if (fs.existsSync(STAMP) && fs.readFileSync(STAMP, "utf8").trim() === VERSION) {
  process.stdout.write(`computer-modern ${VERSION} already vendored\n`);
  process.exit(0);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

let bytes = 0;
for (const [from, to] of Object.entries(FILES)) {
  const src = path.join(SRC, from);
  if (!fs.existsSync(src)) {
    throw new Error(`computer-modern is missing ${from} — did its layout change in ${VERSION}?`);
  }
  const dest = path.join(DEST, to);
  fs.copyFileSync(src, dest);
  bytes += fs.statSync(dest).size;
}

// The OFL requires the license to travel with the fonts.
fs.copyFileSync(
  path.join(path.dirname(SRC), "OFL.txt"),
  path.join(DEST, "OFL.txt"),
);

fs.writeFileSync(STAMP, `${VERSION}\n`);
process.stdout.write(
  `vendored computer-modern ${VERSION} → public/fonts/cm (${(bytes / 1e3).toFixed(0)} KB)\n`,
);
