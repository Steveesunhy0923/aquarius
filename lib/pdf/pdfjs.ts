"use client";

/**
 * Loading pdf.js — deliberately at runtime, from a vendored copy.
 *
 * `import("/pdfjs/pdf.min.mjs")` is marked ignore-by-bundler, so the library
 * never enters a webpack/turbopack chunk and is never evaluated during the
 * static export's prerender pass (where DOMMatrix and Path2D do not exist).
 * scripts/prepare-pdfjs.mjs puts the files under public/, which Next copies
 * verbatim into out/ and the Capacitor shell serves from capacitor://localhost —
 * so one root-absolute path works in dev, in the export, and on the iPad.
 *
 * ── The workerPort trap (this is the whole reason this file exists) ─────────
 * pdf.js decides how to start its worker like this (build/pdf.mjs):
 *
 *     if (!PDFWorker._isSameOrigin(window.location, workerSrc)) {
 *       workerSrc = PDFWorker._createCDNWrapper(new URL(workerSrc, …).href);
 *     }
 *
 * and `_isSameOrigin` returns false whenever the page's origin is the string
 * "null" — which is exactly what `new URL("capacitor://localhost/…").origin`
 * evaluates to, because `capacitor:` is a non-special scheme. So on the iPad
 * shell, and ONLY there, setting `workerSrc` makes pdf.js wrap the worker in a
 * `blob:` module that re-imports a capacitor:// URL from an opaque origin. That
 * fails, and it fails on device only — after everything looked fine in Chrome.
 *
 * Constructing the Worker ourselves and handing over `workerPort` skips that
 * branch entirely: pdf.js adopts the port and never calls `new Worker`.
 */

import type * as PdfjsNS from "pdfjs-dist";

/** Where prepare-pdfjs.mjs put everything. Root-absolute on purpose. */
const BASE = "/pdfjs/";
const abs = (p: string) => new URL(BASE + p, window.location.href).href;

let libPromise: Promise<typeof PdfjsNS> | null = null;
let worker: Worker | null = null;

/** The pdf.js module, loaded once per session with our worker already bound. */
export function loadPdfjs(): Promise<typeof PdfjsNS> {
  return (libPromise ??= (async () => {
    const lib: typeof PdfjsNS = await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ abs("pdf.min.mjs")
    );
    // pdf.worker.min.mjs is an ES module with no static imports — self-contained,
    // so a module Worker at an absolute URL is all it needs.
    worker ??= new Worker(abs("pdf.worker.min.mjs"), { type: "module" });
    lib.GlobalWorkerOptions.workerPort = worker;
    return lib;
  })());
}

/**
 * getDocument options that make every side asset resolve in all three targets.
 * Without cMapUrl a CJK document renders blank glyphs; without standardFontDataUrl
 * a PDF that relies on the base-14 fonts falls back to boxes.
 */
export function pdfOptions(data: ArrayBuffer) {
  return {
    data,
    cMapUrl: abs("cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: abs("standard_fonts/"),
    wasmUrl: abs("wasm/"),
    // Never run JavaScript embedded in a user-supplied PDF.
    enableScripting: false,
    isEvalSupported: false,
  };
}

export interface PdfPageSize {
  width: number;
  height: number;
}

/** Open a PDF and report how many pages it has and how big each one is. */
export async function readPdf(bytes: ArrayBuffer): Promise<{
  pageCount: number;
  sizes: PdfPageSize[];
  destroy: () => void;
}> {
  const lib = await loadPdfjs();
  // pdf.js DETACHES the buffer it is given; hand it a copy so the caller can
  // still store the original bytes as the note's asset.
  const task = lib.getDocument(pdfOptions(bytes.slice(0)));
  const doc = await task.promise;
  const sizes: PdfPageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
    page.cleanup();
  }
  // Tearing down the LOADING TASK is what releases the worker's document
  // structures; the proxy alone only exposes a page-cache cleanup().
  return { pageCount: doc.numPages, sizes, destroy: () => void task.destroy() };
}
