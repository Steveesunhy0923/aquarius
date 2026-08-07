"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isDefaultUsername, setUsername, validateUsername } from "@/lib/profile/profile";
import { AuthDialog } from "./AuthDialog";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { BTN_PRIMARY_SM as PRIMARY, BTN_SM, EYEBROW as SECTION } from "@/components/ui/primitives";

const LINK = "text-xs text-muted hover:text-accent";
// Inline field: shares its flex row with a Save/Set button, so `min-w-0 flex-1`
// (not the block `FIELD`'s `w-full`).
const INPUT = "min-w-0 flex-1 rounded-control border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";
const RULE = "my-1 h-px bg-border-soft";

/**
 * Library-header account control. Hidden entirely when Supabase isn't configured
 * (local-only deployment). Signed out → a "Sign in" button. Signed in → an
 * avatar that opens a menu to set a username, link providers, push local notes
 * to the cloud, and sign out.
 */
export function AccountMenu() {
  const { configured, loading, user, profile, linkedProviders, signOut, setPassword, linkGoogle, linkApple, refreshProfile } = useAuth();
  const [dialog, setDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!configured || loading) return null;

  if (!user) {
    return (
      <>
        <button onClick={() => setDialog(true)} className={BTN_SM}>
          Sign in
        </button>
        {dialog && <AuthDialog onClose={() => setDialog(false)} />}
      </>
    );
  }

  const username = profile?.username ?? "…";
  const needsUsername = profile ? isDefaultUsername(profile.username) : false;
  const initial = (profile?.displayName ?? username).charAt(0).toUpperCase();
  const hasGoogle = linkedProviders.includes("google");
  const hasApple = linkedProviders.includes("apple");
  const hasPassword = linkedProviders.includes("email");

  return (
    <>
    <Menu
      width="w-72"
      trigger={({ open, toggle }) => (
        <button
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-sm hover:border-accent"
        >
          <span className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote avatar
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
            {needsUsername && <span className="absolute -right-0 -top-0 h-2 w-2 rounded-full bg-warning" />}
          </span>
          <span className="max-w-[10rem] truncate">{username}</span>
          <Icon name="chevron" size={12} className="text-muted" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2 py-1.5">
            <p className={`mb-1 ${SECTION}`}>Signed in as</p>
            <UsernameForm current={username} highlight={needsUsername} onSaved={refreshProfile} />
          </div>

          <div className={RULE} />

          <div className="px-2 py-1.5">
            <p className={`mb-2 ${SECTION}`}>Linked sign-in</p>
            <div className="space-y-1.5">
              <ProviderRow label="Apple" linked={hasApple} onLink={linkApple} />
              <ProviderRow label="Google" linked={hasGoogle} onLink={linkGoogle} />
              <PasswordRow linked={hasPassword} onSet={setPassword} />
            </div>
          </div>

          <div className={RULE} />

          <MenuItem onClick={() => { close(); void signOut(); }}>Sign out</MenuItem>
          <MenuItem danger onClick={() => { close(); setDeleting(true); }}>Delete account…</MenuItem>
        </>
      )}
    </Menu>
    {deleting && <DeleteAccountDialog onClose={() => setDeleting(false)} />}
    </>
  );
}

function UsernameForm({ current, highlight, onSaved }: { current: string; highlight: boolean; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(highlight);
  const [value, setValue] = useState(highlight ? "" : current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">@{current}</span>
        <button onClick={() => { setValue(current); setEditing(true); }} className={LINK}>Edit</button>
      </div>
    );
  }

  const save = async () => {
    const invalid = validateUsername(value);
    if (invalid) { setErr(invalid); return; }
    setBusy(true); setErr(null);
    try {
      await setUsername(value);
      await onSaved();
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {highlight && <p className="mb-1 text-xs text-warning">Pick a username so others can share with you.</p>}
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted">@</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="username"
          className={INPUT}
        />
        <button onClick={save} disabled={busy} className={PRIMARY}>Save</button>
      </div>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </div>
  );
}

function ProviderRow({ label, linked, onLink }: { label: string; linked: boolean; onLink: () => Promise<void> }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      {linked ? (
        <span className="text-xs text-success">Linked</span>
      ) : (
        <button onClick={() => void onLink()} className={LINK}>Link</button>
      )}
    </div>
  );
}

function PasswordRow({ linked, onSet }: { linked: boolean; onSet: (pw: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (linked) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span>Email &amp; password</span>
        <span className="text-xs text-success">Linked</span>
      </div>
    );
  }
  return (
    <div className="text-sm">
      <div className="flex items-center justify-between">
        <span>Email &amp; password</span>
        <button onClick={() => setOpen((v) => !v)} className={LINK}>Add</button>
      </div>
      {open && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="password"
            value={pw}
            minLength={6}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password"
            className={INPUT}
          />
          <button
            disabled={busy || pw.length < 6}
            onClick={async () => {
              setBusy(true); setMsg(null);
              try { await onSet(pw); setMsg("Password set."); setPw(""); setOpen(false); }
              catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
              finally { setBusy(false); }
            }}
            className={PRIMARY}
          >
            Set
          </button>
        </div>
      )}
      {msg && <p className="mt-1 text-xs text-muted">{msg}</p>}
    </div>
  );
}
