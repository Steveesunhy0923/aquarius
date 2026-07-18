"use client";

import { type ReactNode, useState } from "react";

/**
 * Menu — the Graphite dropdown shell: caller-rendered trigger, invisible
 * full-screen click-catcher, and the floating panel. Pass `children` as a
 * function to get a `close` callback for the items.
 */
export function Menu({
  trigger,
  width = "w-44",
  align = "right",
  menuClassName,
  children,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  width?: string;
  align?: "left" | "right";
  menuClassName?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <span className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={(e) => { e.preventDefault(); close(); }}
          />
          <div className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-50 mt-1 ${width} rounded-md border border-border bg-surface p-1 text-sm shadow-lg ${menuClassName ?? ""}`}>
            {typeof children === "function" ? children(close) : children}
          </div>
        </>
      )}
    </span>
  );
}

/** A single row inside a Menu panel. */
export function MenuItem({
  onClick,
  danger,
  disabled,
  children,
}: {
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); onClick?.(); }}
      disabled={disabled}
      className={`block w-full rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06] ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}
