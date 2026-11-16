"use client";

import { useRef } from "react";

import { uiToast } from "@/components/ui/toast";
import { describeSync, type SyncTone as Tone } from "@/lib/sync/describe";
import { useSyncStatus } from "@/lib/sync/useSyncStatus";

/**
 * Cloud-sync status for the signed-in user — the answer to "is my work
 * actually backed up?". The editor's own "Saved" pill only ever meant "written
 * to this device"; a note could sit unpushed (offline, an expired session, a
 * rejected write) with nothing on screen saying so.
 *
 * Renders nothing for a guest: with no account there is no cloud copy to be
 * in or out of step with.
 *
 * A status, but also a button: clicking syncs now, and when something is
 * wrong it says what — a tooltip alone is unreachable on a touch screen.
 */

const TEXT: Record<Tone, string> = {
  ok: "text-muted hover:bg-foreground/[0.06]",
  busy: "text-accent hover:bg-accent-soft",
  warn: "text-warning hover:bg-warning-soft",
  bad: "text-danger hover:bg-danger-soft",
};
const DOT: Record<Tone, string> = {
  ok: "bg-success",
  busy: "animate-pulse bg-accent",
  warn: "bg-warning",
  bad: "bg-danger",
};

const TOAST_MS = 9000;

export function SyncStatus({ className = "" }: { className?: string }) {
  const sync = useSyncStatus();
  const lastToastAt = useRef(0);
  if (!sync) return null;
  const view = describeSync(sync);

  const onClick = () => {
    sync.retry();
    if (view.tone === "ok" || view.tone === "busy") return;
    // One explanation at a time: impatient re-clicks retry, they don't stack
    // a column of identical toasts up the screen.
    const now = Date.now();
    if (now - lastToastAt.current < TOAST_MS) return;
    lastToastAt.current = now;
    uiToast({
      title: view.label.split(" · ")[0],
      message: view.tone === "bad" && sync.lastError ? `${view.detail} (${sync.lastError})` : view.detail,
      duration: TOAST_MS,
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${view.detail} Click to sync now.`}
      aria-label={`Cloud sync: ${view.detail}`}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs transition ${TEXT[view.tone]} ${className}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[view.tone]}`} />
      <span role="status" aria-live="polite">{view.label}</span>
    </button>
  );
}
