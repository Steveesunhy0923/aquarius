"use client";

import { documentToLatex } from "@/lib/blocks";
import { getStore } from "@/lib/storage";
import { useState } from "react";

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so the download has actually started in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Unicode-aware, no leading/trailing dots/underscores; falls back to "note".
const safeName = (s: string) =>
  (s ?? "")
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._]+|[._]+$/g, "") || "note";

/** Export a note to a downloadable file in the given format. */
export async function downloadNote(
  noteId: string,
  title: string,
  fmt: "tex" | "aqnote",
): Promise<void> {
  const store = getStore();
  if (fmt === "tex") {
    const pkg = await store.openNote(noteId);
    download(`${safeName(title)}.tex`, documentToLatex(pkg.tree), "application/x-tex");
  } else {
    const bundle = await store.exportNote(noteId);
    download(`${safeName(title)}.aqnote`, JSON.stringify(bundle, null, 2), "application/json");
  }
}

/**
 * Export/download a note in a chosen format. `.tex` is the LaTeX serialization;
 * `.aqnote` is the portable, re-importable bundle (content + inlined assets).
 * `beforeExport` lets the editor flush unsaved changes before reading storage.
 */
export function ExportMenu({
  noteId,
  title,
  beforeExport,
  onPdf,
  className = "",
  menuClassName = "",
  label = "Export",
}: {
  noteId: string;
  title: string;
  beforeExport?: () => Promise<void>;
  /** Optional PDF action (browser print → Save as PDF), shown as a menu item. */
  onPdf?: () => void;
  className?: string;
  menuClassName?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  async function run(fmt: "tex" | "aqnote") {
    setOpen(false);
    try {
      if (beforeExport) await beforeExport();
      await downloadNote(noteId, title, fmt);
    } catch (e) {
      console.error("export failed", e);
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        title="Export / download"
        className={className}
      >
        {label}
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={(e) => { e.preventDefault(); setOpen(false); }}
          />
          <div className={`absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-border bg-surface p-1 text-sm shadow-lg ${menuClassName}`}>
            {onPdf && (
              <button onClick={(e) => { e.preventDefault(); setOpen(false); onPdf(); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06]">
                PDF <span className="text-muted">(print)</span>
              </button>
            )}
            <button onClick={(e) => { e.preventDefault(); run("tex"); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06]">
              LaTeX <span className="text-muted">(.tex)</span>
            </button>
            <button onClick={(e) => { e.preventDefault(); run("aqnote"); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06]">
              Aquarius bundle <span className="text-muted">(.aqnote)</span>
            </button>
          </div>
        </>
      )}
    </span>
  );
}
