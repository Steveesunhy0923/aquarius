"use client";

import { useEffect, useState } from "react";
import {
  listCollaborators,
  removeCollaborator,
  ROLES,
  setCollaboratorRole,
  shareNote,
  type Access,
  type Collaborator,
  type Role,
} from "@/lib/sharing/sharing";

/** Manage who a note is shared with (owner), or show your access (collaborator). */
export function ShareDialog({ noteId, access, onClose }: { noteId: string; access: Access; onClose: () => void }) {
  const isOwner = access === "owner";
  const [collabs, setCollabs] = useState<Collaborator[]>([]);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    listCollaborators(noteId).then(setCollabs).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [noteId, isOwner]);

  const refresh = async () => setCollabs(await listCollaborators(noteId));

  const share = async () => {
    const u = username.trim();
    if (!u) return;
    setBusy(true);
    setErr(null);
    try {
      await shareNote(noteId, u, role);
      setUsername("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Share document</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">✕</button>
        </div>

        {!isOwner ? (
          <p className="text-sm text-muted">
            This document was shared with you — you have <b>{access}</b> access. Only the owner can manage sharing.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") share(); }}
                placeholder="username"
                className="min-w-[8rem] flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <button onClick={share} disabled={busy || !username.trim()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                Share
              </button>
            </div>
            {err && <p className="mt-2 text-xs text-red-500">{err}</p>}

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">People with access</p>
              {collabs.length === 0 ? (
                <p className="text-sm text-muted">Not shared yet. Add someone by their username above.</p>
              ) : (
                <ul className="space-y-1.5">
                  {collabs.map((c) => (
                    <li key={c.userId} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        @{c.username}{c.displayName ? <span className="text-muted"> · {c.displayName}</span> : null}
                      </span>
                      <select
                        value={c.role}
                        onChange={async (e) => { await setCollaboratorRole(noteId, c.userId, e.target.value as Role); await refresh(); }}
                        className="rounded border border-border bg-background px-1.5 py-1 text-xs"
                      >
                        {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                      <button
                        onClick={async () => { await removeCollaborator(noteId, c.userId); await refresh(); }}
                        title="Remove"
                        className="shrink-0 text-muted hover:text-red-500"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
