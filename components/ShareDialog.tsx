"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ChevronSelect, Dialog, DialogSection } from "@/components/ui/Dialog";
import { useAuth } from "@/lib/auth/AuthProvider";
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
import { BTN_PRIMARY } from "@/components/ui/primitives";

// Deterministic, pleasant avatar tint from a name, so each collaborator reads
// as a distinct person at a glance.
const AV_COLORS = ["#5b5bd6", "#3fb27f", "#d6735b", "#7b5bd6", "#d69b3f", "#3f9bd6", "#c44f8a"];
function avColor(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
      style={{ background: color }}
      aria-hidden
    >
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}

/** A role <select> with the Graphite chevron affordance. */
function RoleSelect({ value, onChange, ariaLabel }: { value: Role; onChange: (r: Role) => void; ariaLabel: string }) {
  return <ChevronSelect value={value} onChange={onChange} options={ROLES} ariaLabel={ariaLabel} />;
}

/** Manage who a note is shared with (owner), or show your access (collaborator). */
export function ShareDialog({
  noteId,
  access,
  onClose,
  onCollaboratorsChanged,
}: {
  noteId: string;
  access: Access;
  onClose: () => void;
  /**
   * Fired with the current collaborator count whenever this dialog loads or
   * changes the list. The editor uses it to open the live co-editing channel the
   * moment a note gains its first collaborator — without it, the owner keeps
   * editing alone until they reload the page, which is what made co-editing look
   * like it wasn't real-time at all.
   */
  onCollaboratorsChanged?: (count: number) => void;
}) {
  const isOwner = access === "owner";
  const { user, profile } = useAuth();
  const [collabs, setCollabs] = useState<Collaborator[]>([]);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const changedRef = useRef(onCollaboratorsChanged);
  changedRef.current = onCollaboratorsChanged;

  useEffect(() => {
    if (!isOwner) return;
    listCollaborators(noteId)
      .then((list) => { setCollabs(list); changedRef.current?.(list.length); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [noteId, isOwner]);

  const refresh = async () => {
    const list = await listCollaborators(noteId);
    setCollabs(list);
    changedRef.current?.(list.length);
  };

  const share = async () => {
    const u = username.trim().replace(/^@/, "");
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

  const ownerName = profile?.username ?? "you";
  const ownerEmail = user?.email ?? null;

  return (
    <Dialog title="Share document" onClose={onClose}>
      <div className="px-5 py-4">
        {!isOwner ? (
          <p className="text-sm text-muted">
            This document was shared with you — you have <b className="text-foreground">{access}</b> access. Only the owner can manage sharing.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 focus-within:border-accent">
                <span className="text-sm text-muted">@</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") share(); }}
                  placeholder="username"
                  aria-label="Username to share with"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted"
                />
              </div>
              <RoleSelect value={role} onChange={setRole} ariaLabel="Role for the new collaborator" />
              <button onClick={share} disabled={busy || !username.trim()} className={BTN_PRIMARY}>
                Share
              </button>
            </div>
            {err && <p className="mt-2 text-xs text-danger">{err}</p>}

            <DialogSection className="mb-2.5 mt-5">People with access</DialogSection>
            <ul className="space-y-2.5">
              {/* The owner — always has access. */}
              <li className="flex items-center gap-3">
                <Avatar name={ownerName} color="#5b5bd6" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">@{ownerName}</span>
                  {ownerEmail && <span className="block truncate text-xs text-muted">{ownerEmail}</span>}
                </span>
                <span className="shrink-0 text-sm text-muted">Owner</span>
              </li>

              {collabs.map((c) => (
                <li key={c.userId} className="flex items-center gap-3">
                  <Avatar name={c.displayName ?? c.username} color={avColor(c.username)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">@{c.username}</span>
                    {c.displayName && <span className="block truncate text-xs text-muted">{c.displayName}</span>}
                  </span>
                  <RoleSelect
                    value={c.role}
                    ariaLabel={`Role for @${c.username}`}
                    onChange={async (r) => { await setCollaboratorRole(noteId, c.userId, r); await refresh(); }}
                  />
                  <button
                    onClick={async () => { await removeCollaborator(noteId, c.userId); await refresh(); }}
                    title={`Remove @${c.username}`}
                    aria-label={`Remove @${c.username}`}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <Icon name="close" size={15} />
                  </button>
                </li>
              ))}
            </ul>

            {collabs.length === 0 && (
              <p className="mt-2.5 text-sm text-muted">Only you have access. Add someone by their username above.</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
