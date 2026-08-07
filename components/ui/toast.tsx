"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Lightweight toast notifications.
 *
 * Mirrors the imperative-queue pattern of components/ui/dialogs.tsx: a single
 * <Toaster /> host is mounted once in Providers, and anywhere in the app can
 * call uiToast(...) to pop an auto-dismissing card. If the host isn't mounted
 * (e.g. during SSR) the call is a harmless no-op — toasts are non-critical UI.
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastOptions {
  title: string;
  message?: string;
  action?: ToastAction;
  /** Auto-dismiss after this many ms. 0 keeps it until dismissed. Default 6000. */
  duration?: number;
}
type Toast = ToastOptions & { id: number };

let enqueue: ((t: Toast) => void) | null = null;
let seq = 0;

/** Pop a toast. No-op if the <Toaster /> host isn't mounted. */
export function uiToast(opts: ToastOptions): void {
  enqueue?.({ ...opts, id: seq++ });
}

/** Host for uiToast — mount exactly once (see Providers). */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    enqueue = (t) => setToasts((q) => [...q, t]);
    return () => { enqueue = null; };
  }, []);

  const dismiss = (id: number) => setToasts((q) => q.filter((t) => t.id !== id));
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:items-end">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // Keep the latest onDismiss without resetting the auto-dismiss timer on every
  // parent re-render (the map hands us a fresh closure each time).
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const d = toast.duration ?? 6000;
    if (d <= 0) return;
    const timer = setTimeout(() => dismissRef.current(), d);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration]);

  return (
    <div className="pointer-events-auto w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-control border border-border bg-surface shadow-card">
      <div className="flex items-start gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{toast.title}</p>
          {toast.message && (
            <p className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-muted">{toast.message}</p>
          )}
          {toast.action && (
            <button
              onClick={() => { toast.action!.onClick(); dismissRef.current(); }}
              className="mt-2 text-xs font-medium text-accent hover:underline"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          onClick={() => dismissRef.current()}
          aria-label="Dismiss"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-control text-muted hover:bg-foreground/5 hover:text-foreground"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}
