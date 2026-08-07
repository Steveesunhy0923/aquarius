"use client";

/**
 * An imported PDF, shown as pages you can handwrite on.
 *
 * The note's blocks are empty by design — the content is the attached file — so
 * this replaces the block canvas entirely for `tree.source.kind === "pdf"`.
 *
 * Layering: each page is a rendered PDF bitmap with the shared InkSurface's
 * canvas on top, so annotation reuses the same stroke capture, palm rejection,
 * pressure and pointer handling as the writing surface, and ink coordinates
 * stay in one continuous document space across pages.
 *
 * Rendering is windowed: a 40-page PDF at devicePixelRatio 2 would be ~300 MB
 * of bitmaps if every page were live at once, so only the pages near the
 * viewport are rasterized and the rest are released back to a placeholder.
 * Strokes are never released — they are vector data and cheap.
 */

import { loadPdfjs, pdfOptions } from "@/lib/pdf/pdfjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { InkSurface, type InkSurfaceHandle } from "@/components/ink/InkSurface";
import type { Stroke } from "@/components/ink/strokes";
import type { DocumentSource } from "@/lib/blocks/types";

/** How many pages either side of the viewport keep a rendered bitmap. */
const WINDOW = 1;
/** Cap the raster scale: beyond this the memory cost buys nothing visible. */
const MAX_SCALE = 2;

export function PdfDocumentView({
  source,
  bytes,
  initialStrokes,
  canAnnotate,
  zoom,
  onStrokesChange,
  surfaceRef,
}: {
  source: DocumentSource;
  /** The PDF's bytes, already fetched from the asset store. */
  bytes: ArrayBuffer | null;
  initialStrokes?: Stroke[];
  canAnnotate: boolean;
  zoom: number;
  onStrokesChange?: (strokes: Stroke[]) => void;
  surfaceRef?: React.Ref<InkSurfaceHandle>;
}) {
  // The page size the ink surface lays out with. Every page is drawn into this
  // box; a mixed-size PDF (portrait + landscape) letterboxes rather than
  // shifting the ink coordinate space page to page.
  const base = source.pageSizes?.[0] ?? { width: 612, height: 792 };
  const pageSize = useMemo(
    () => ({ width: Math.round(base.width * zoom), height: Math.round(base.height * zoom) }),
    [base.width, base.height, zoom],
  );

  const [visible, setVisible] = useState<Set<number>>(() => new Set([0]));
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const docRef = useRef<Awaited<ReturnType<typeof openDoc>> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open the document once per byte identity.
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    let handle: Awaited<ReturnType<typeof openDoc>> | null = null;
    void (async () => {
      try {
        handle = await openDoc(bytes);
        if (cancelled) return void handle.task.destroy();
        docRef.current = handle;
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open this PDF.");
      }
    })();
    return () => {
      cancelled = true;
      setReady(false);
      docRef.current = null;
      handle?.task.destroy();
    };
  }, [bytes]);

  // Rasterize the pages in the window; release the ones that left it.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const doc = docRef.current;
      if (!doc) return;
      for (const i of visible) {
        if (cancelled) return;
        const canvas = canvases.current.get(i);
        if (!canvas || canvas.dataset.rendered === String(pageSize.width)) continue;
        try {
          const page = await doc.doc.getPage(i + 1);
          if (cancelled) return;
          const dpr = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
          const vp1 = page.getViewport({ scale: 1 });
          // Fit this page into the shared box, so pages of differing sizes stay
          // in one coordinate space instead of nudging the ink layer around.
          const fit = Math.min(pageSize.width / vp1.width, pageSize.height / vp1.height);
          const viewport = page.getViewport({ scale: fit * dpr });
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
          canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          canvas.dataset.rendered = String(pageSize.width);
          page.cleanup();
        } catch {
          /* a single unrenderable page must not take the document down */
        }
      }
      // Free bitmaps outside the window — width 0 releases the backing store.
      for (const [i, c] of canvases.current) {
        if (!visible.has(i) && c.width > 0) {
          c.width = 0;
          c.height = 0;
          delete c.dataset.rendered;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, visible, pageSize.width, pageSize.height]);

  const scrollHost = useRef<HTMLDivElement | null>(null);

  // Track which pages are near the viewport. Cheap: page geometry is known, so
  // this is arithmetic on scrollTop rather than an observer per page.
  useEffect(() => {
    const host = scrollHost.current;
    if (!host) return;
    const pitch = pageSize.height + 32;
    const update = () => {
      const first = Math.floor(host.scrollTop / pitch);
      const last = Math.floor((host.scrollTop + host.clientHeight) / pitch);
      const next = new Set<number>();
      for (let i = first - WINDOW; i <= last + WINDOW; i++) {
        if (i >= 0 && i < source.pageCount) next.add(i);
      }
      setVisible((prev) =>
        prev.size === next.size && [...next].every((i) => prev.has(i)) ? prev : next,
      );
    };
    update();
    host.addEventListener("scroll", update, { passive: true });
    return () => host.removeEventListener("scroll", update);
  }, [pageSize.height, source.pageCount]);

  if (error) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <p className="max-w-sm text-center text-sm text-danger">{error}</p>
      </div>
    );
  }

  return (
    <div ref={scrollHost} className="print-surface flex-1 overflow-auto" style={{ background: "var(--background)" }}>
      <InkSurface
        ref={surfaceRef}
        pageMode="a4"
        pageSize={pageSize}
        fixedPages={source.pageCount}
        initialStrokes={initialStrokes}
        className={canAnnotate ? "" : "pointer-events-none"}
        onStrokesChange={onStrokesChange}
        renderPage={(i) => (
          <canvas
            ref={(el) => {
              if (el) canvases.current.set(i, el);
              else canvases.current.delete(i);
            }}
            className="block h-full w-full bg-white"
          />
        )}
      />
    </div>
  );
}

async function openDoc(bytes: ArrayBuffer) {
  const lib = await loadPdfjs();
  const task = lib.getDocument(pdfOptions(bytes.slice(0)));
  const doc = await task.promise;
  return { task, doc };
}
