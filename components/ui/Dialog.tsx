"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

const CLOSE_BTN = "grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-foreground/[0.05] hover:text-foreground";
const SECTION = "text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted";
const SELECT = "appearance-none rounded-md border border-border bg-surface py-1.5 pl-3 pr-8 text-sm outline-none hover:border-accent focus:border-accent";

// Escape closes the TOPMOST dialog only: mounted dialogs stack their tokens,
// and the top one swallows the event (capture phase, like SymbolPicker) so it
// never reaches an underlying dialog or the editor's own Escape handling.
const dialogStack: symbol[] = [];

/**
 * Dialog — the Graphite modal shell: scrim (click-outside closes), rounded
 * panel, ruled header with title + close button, Escape closes. Callers own
 * the body markup (typically `<div className="px-5 py-4">…</div>`).
 */
export function Dialog({
  title,
  onClose,
  maxWidth = "max-w-md",
  zIndex,
  children,
}: {
  title: string;
  onClose: () => void;
  maxWidth?: string;
  zIndex?: string;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Scrim dismissal requires the PRESS to start on the scrim itself — a
  // text-selection drag that starts inside the panel and releases over the
  // scrim dispatches its click on the scrim (common-ancestor rule) and must
  // not close the dialog.
  const pressOnScrim = useRef(false);
  useEffect(() => {
    const token = Symbol("dialog");
    dialogStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      if (dialogStack[dialogStack.length - 1] !== token) return; // not topmost
      e.preventDefault();
      e.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      const i = dialogStack.indexOf(token);
      if (i >= 0) dialogStack.splice(i, 1);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  return (
    <div
      className={`fixed inset-0 ${zIndex ?? "z-50"} grid place-items-center bg-foreground/25 p-4`}
      onMouseDown={(e) => { pressOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const wasScrim = pressOnScrim.current;
        pressOnScrim.current = false;
        if (wasScrim && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`w-full ${maxWidth} overflow-hidden rounded-xl border border-border bg-surface shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className={CLOSE_BTN}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Section eyebrow heading inside a dialog body. */
export function DialogSection({
  children,
  className = "mb-2 mt-5 first:mt-0",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={`${className} ${SECTION}`}>{children}</p>;
}

/** A native <select> with the Graphite chevron affordance. */
export function ChevronSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { id: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <div className="relative shrink-0">
      <select value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value as T)} className={SELECT}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
        <Icon name="chevron" size={13} />
      </span>
    </div>
  );
}
