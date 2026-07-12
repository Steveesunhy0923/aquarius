"use client";

import { Icon } from "@/components/Icon";
import { Menu, MenuItem } from "@/components/ui/Menu";

/** Dropdown to import a note from an .aqnote file or a link to one. */
export function ImportMenu({
  disabled,
  onFile,
  onLink,
}: {
  disabled: boolean;
  onFile: () => void;
  onLink: () => void;
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
          <MenuItem onClick={() => { close(); onFile(); }}>
            From file <span className="text-muted">(.aqnote)</span>
          </MenuItem>
          <MenuItem onClick={() => { close(); onLink(); }}>From link…</MenuItem>
        </>
      )}
    </Menu>
  );
}
