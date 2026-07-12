"use client";

import { documentToLatex } from "@/lib/blocks";
import { getStore } from "@/lib/storage";
import type { ReactNode } from "react";
import { Menu, MenuItem } from "@/components/ui/Menu";

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
  label?: ReactNode;
}) {
  async function run(fmt: "tex" | "aqnote") {
    try {
      if (beforeExport) await beforeExport();
      await downloadNote(noteId, title, fmt);
    } catch (e) {
      console.error("export failed", e);
    }
  }

  return (
    <Menu
      width="w-48"
      menuClassName={menuClassName}
      trigger={({ open, toggle }) => (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
          title="Export / download"
          aria-label="Export / download"
          aria-haspopup="menu"
          aria-expanded={open}
          className={className}
        >
          {label}
        </button>
      )}
    >
      {(close) => (
        <>
          {onPdf && (
            <MenuItem onClick={() => { close(); onPdf(); }}>
              PDF <span className="text-muted">(print)</span>
            </MenuItem>
          )}
          <MenuItem onClick={() => { close(); void run("tex"); }}>
            LaTeX <span className="text-muted">(.tex)</span>
          </MenuItem>
          <MenuItem onClick={() => { close(); void run("aqnote"); }}>
            Aquarius bundle <span className="text-muted">(.aqnote)</span>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
