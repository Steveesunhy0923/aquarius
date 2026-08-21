"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { BTN_DANGER, FIELD } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth/AuthProvider";

const CONFIRM_WORD = "DELETE";

/**
 * Permanent account deletion (App Store Guideline 5.1.1(v) / GDPR): explains
 * exactly what goes away, requires typing DELETE, then calls
 * `deleteAccount()` — Storage bytes, then the `delete_account()` RPC
 * (migration 0012), then a local sign-out back to guest mode.
 *
 * SCOPE CHANGED WITH ATORKU. `delete_account()` deletes the `auth.users` row, and
 * that row is no longer "the Aquarius account" — it is the shared Atorku account.
 * Deleting from here therefore ends the account for every Atorku app, not just
 * this one. The copy below says so, because a user who reads "delete my
 * Aquarius account" and loses their Virgo sign-in has been misled by us.
 */
export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { deleteAccount } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await deleteAccount();
      onClose(); // signed out — the library falls back to the local store
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Delete Atorku account" onClose={busy ? () => {} : onClose} maxWidth="max-w-sm">
      <div className="px-5 py-4">
        <p className="text-sm">
          This permanently deletes your <strong>Atorku account</strong> — the one you use for every
          Atorku app, not just Aquarius. You will be signed out of Virgo and anything else Atorku too.
        </p>
        <p className="mt-3 text-sm">
          It also deletes every cloud note, notebook, subject, image, version
          history, and share you own. Collaborators lose access to notes you
          shared. Notes in this device&rsquo;s local guest library are not
          affected, and Virgo&rsquo;s tasks and calendar stay on your device.
          This cannot be undone.
        </p>
        <p className="mt-3 text-xs text-muted">
          Export anything you want to keep first (note menu → Export → .aqnote).
        </p>
        <input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={`Type ${CONFIRM_WORD} to confirm`}
          className={`${FIELD} mt-3`}
        />
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <button
          onClick={run}
          disabled={busy || typed.trim() !== CONFIRM_WORD}
          className={`mt-4 w-full ${BTN_DANGER}`}
        >
          {busy ? "Deleting…" : "Permanently delete my account"}
        </button>
      </div>
    </Dialog>
  );
}
