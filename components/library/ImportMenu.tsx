"use client";

import { Icon } from "@/components/Icon";
import { Menu, MenuItem } from "@/components/ui/Menu";

/** Dropdown to import: a PDF to annotate, an .aqnote bundle, or a link to one. */
export function ImportMenu({
  disabled,
  onFile,
  onLink,
  onPdf,
}: {
  disabled: boolean;
  onFile: () => void;
  onLink: () => void;
  onPdf: () => void;
}) {
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
          disabled={disabled}
          title="Import a note"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted"
        >
          <Icon name="import" size={14} /> Import
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem onClick={() => { close(); onPdf(); }}>
            PDF to annotate <span className="text-muted">(.pdf)</span>
          </MenuItem>
          <MenuItem onClick={() => { close(); onFile(); }}>
            From file <span className="text-muted">(.aqnote)</span>
          </MenuItem>
          <MenuItem onClick={() => { close(); onLink(); }}>From link…</MenuItem>
        </>
      )}
    </Menu>
  );
}
