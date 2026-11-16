#!/usr/bin/env node
/**
 * Render the installable-app icons from the Aquarius glyph (app/icon.svg).
 *
 *   public/icons/icon-192.png   web manifest
 *   public/icons/icon-512.png   web manifest (also the splash image)
 *   app/apple-icon.png          iOS home screen (Next links it automatically)
 *
 * The favicon is the bare accent glyph on transparency, which is right for a
 * browser tab and wrong for a home screen: iOS paints transparency black, and
 * Android crops an icon to whatever shape the launcher uses. So these are
 * full-bleed accent squares with the glyph in white, kept inside the central
 * 60% — well within the "safe zone" (the inner 80%) a maskable icon is
 * guaranteed to keep, which lets one image serve as both `any` and `maskable`.
 *
 * The PNGs are committed; this only needs re-running if the glyph or the
 * accent colour changes. It drives a local Chrome through puppeteer-core
 * (already a devDependency), so CHROME_PATH must point at one:
 *
 *   node scripts/generate-icons.mjs
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ACCENT = "#5b5bd6"; // --accent in app/globals.css; also the manifest theme_color

const glyph = readFileSync(path.join(root, "app", "icon.svg"), "utf8")
  .replace(/stroke="#[0-9a-fA-F]+"/, 'stroke="#ffffff"')
  .replace("<svg ", '<svg width="100%" height="100%" ');

const targets = [
  { file: "public/icons/icon-192.png", size: 192 },
  { file: "public/icons/icon-512.png", size: 512 },
  { file: "app/apple-icon.png", size: 180 },
];

mkdirSync(path.join(root, "public", "icons"), { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  for (const { file, size } of targets) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px;background:${ACCENT};display:grid;place-items:center">
         <div style="width:60%;height:60%">${glyph}</div>
       </body>`,
    );
    await page.screenshot({ path: path.join(root, file), type: "png" });
    console.log(`wrote ${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
