"use client";

import { documentToLatex } from "@/lib/blocks";
import { downloadText, safeName } from "@/lib/export/download";
import { exportTypesetPdf } from "@/lib/export/pdf";
import { getStore } from "@/lib/storage";
import type { ReactNode } from "react";
import { uiAlert } from "@/components/ui/dialogs";
import { Menu, MenuItem } from "@/components/ui/Menu";

/** Export a note to a downloadable file in the given format. */
export async function downloadNote(
  noteId: string,
  title: string,
  fmt: "tex" | "aqnote",
): Promise<void> {
  const store = getStore();
  if (fmt === "tex") {
    const pkg = await store.openNote(noteId);
    downloadText(`${safeName(title)}.tex`, documentToLatex(pkg.tree), "application/x-tex");
  } else {
    const bundle = await store.exportNote(noteId);
    downloadText(`${safeName(title)}.aqnote`, JSON.stringify(bundle, null, 2), "application/json");
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

  // Typeset PDF via /api/pdf; when the server is unreachable (offline, static
  // shell, no Tectonic installed) fall back to the print path.
  async function runTypeset() {
    try {
      if (beforeExport) await beforeExport();
      const r = await exportTypesetPdf(noteId, title);
      if (r.ok) return;
      if (r.reason === "compile") {
        await uiAlert({
          title: "Typeset PDF failed",
          message: `The LaTeX compile failed.${r.log ? `\n\n…${r.log.slice(-600)}` : ""}`,
        });
      } else if (onPdf) {
        onPdf();
      } else {
        await uiAlert({
          title: "Typeset PDF unavailable",
          message: "The PDF server isn't reachable — use PDF (print) instead.",
        });
      }
    } catch (e) {
      console.error("pdf export failed", e);
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
          <MenuItem onClick={() => { close(); void runTypeset(); }}>
            PDF <span className="text-muted">(typeset)</span>
          </MenuItem>
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
