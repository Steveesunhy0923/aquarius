/**
 * What the sync status indicator says, as a pure function of the engine's
 * state — kept apart from the component (components/SyncStatus.tsx) so the
 * wording, which is the whole point of the indicator, can be tested.
 */

import { isAuthError } from "./engine";
import type { SyncSnapshot } from "./types";

export type SyncTone = "ok" | "busy" | "warn" | "bad";

export interface SyncView {
  tone: SyncTone;
  label: string;
  /** The full sentence: tooltip, accessible name, and the toast on click. */
  detail: string;
}

const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** The one place that decides what the user is told about sync. `now` is
 *  injectable so the wording is testable. */
export function describeSync(s: SyncSnapshot & { online: boolean }, now: number = Date.now()): SyncView {
  const waiting = s.pending > 0 ? ` ${changes(s.pending)} waiting to sync.` : "";
  if (!s.online) {
    return {
      tone: "warn",
      label: s.pending > 0 ? `Offline · ${s.pending}` : "Offline",
      detail: `You're offline. Everything is saved on this device and will sync when you reconnect.${waiting}`,
    };
  }
  if (s.status === "syncing") {
    return { tone: "busy", label: "Syncing…", detail: "Syncing with the cloud…" };
  }
  if (s.status === "error") {
    const auth = isAuthError({ message: s.lastError ?? "" });
    return {
      tone: "bad",
      label: "Sync problem",
      detail: auth
        ? `Your session expired — sign in again to finish syncing. Your work is saved on this device.${waiting}`
        : `Couldn't sync with the cloud. Your work is saved on this device and will be retried.${waiting}`,
    };
  }
  if (s.status === "offline") {
    return {
      tone: "warn",
      label: s.pending > 0 ? `Can't reach cloud · ${s.pending}` : "Can't reach cloud",
      detail: `The cloud couldn't be reached. Everything is saved on this device and will be retried.${waiting}`,
    };
  }
  if (s.pending > 0) {
    // Between a save and the debounced push that carries it.
    return { tone: "busy", label: "Syncing…", detail: `${changes(s.pending)} about to sync.` };
  }
  const when = ago(s.lastSyncedAt, now);
  return { tone: "ok", label: "Synced", detail: `All changes are synced to the cloud${when ? ` · last checked ${when}` : ""}.` };
}
