#!/usr/bin/env node
/**
 * Vendor the Pyodide core runtime into public/pyodide/ so Python code blocks
 * run offline (same pattern as prepare-mathlive; see lib/run/py-kernel.ts).
 *
 * Only the core files are copied (~14 MB: JS glue + wasm + stdlib + lock
 * file) — NOT the full package set, which is hundreds of MB. Third-party
 * packages (numpy, …) still stream from the CDN on demand when online.
 *
 * Unlike prepare-mathlive this skips when already current (a .version stamp),
 * because copying 14 MB on every `npm run dev` would be wasteful.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "pyodide");
const dest = path.join(root, "public", "pyodide");
const stamp = path.join(dest, ".version");

const FILES = [
  "pyodide.js",
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

if (!existsSync(src)) {
  console.error("prepare-pyodide: node_modules/pyodide missing — run npm install.");
  process.exit(1);
}

const version = JSON.parse(readFileSync(path.join(src, "package.json"), "utf8")).version;
const current = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : null;
if (current === version && FILES.every((f) => existsSync(path.join(dest, f)))) {
  process.exit(0); // already vendored at this version
}

mkdirSync(dest, { recursive: true });
for (const f of FILES) copyFileSync(path.join(src, f), path.join(dest, f));
writeFileSync(stamp, version + "\n");
console.log(`prepare-pyodide: vendored pyodide ${version} → public/pyodide/`);
