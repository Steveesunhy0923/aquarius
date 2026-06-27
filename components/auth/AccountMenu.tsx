"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isDefaultUsername, setUsername, validateUsername } from "@/lib/profile/profile";
import { AuthDialog } from "./AuthDialog";

/**
 * Library-header account control. Hidden entirely when Supabase isn't configured
 * (local-only deployment). Signed out → a "Sign in" button. Signed in → an
 * avatar that opens a menu to set a username, link providers, push local notes
 * to the cloud, and sign out.
 */
export function AccountMenu({ onUploadLocal }: { onUploadLocal?: () => Promise<void> }) {
  const { configured, loading, user, profile, linkedProviders, signOut, setPassword, linkGoogle, refreshProfile } = useAuth();
  const [dialog, setDialog] = useState(false);
  const [open, setOpen] = useState(false);

  if (!configured || loading) return null;

  if (!user) {
    return (
      <>
        <button onClick={() => setDialog(true)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent">
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
  const hasPassword = linkedProviders.includes("email");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-sm hover:border-accent"
      >
        <span className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-accent/15 text-xs font-semibold text-accent">
          {profile?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote avatar
            <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
          {needsUsername && <span className="absolute -right-0 -top-0 h-2 w-2 rounded-full bg-amber-500" />}
        </span>
        <span className="max-w-[10rem] truncate">{username}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-surface p-3 shadow-xl">
            <p className="mb-1 px-1 text-xs text-muted">Signed in as</p>
            <UsernameForm
              current={username}
              highlight={needsUsername}
              onSaved={refreshProfile}
            />

            <div className="my-3 border-t border-border" />

            <p className="mb-2 px-1 text-xs text-muted">Linked sign-in</p>
            <div className="space-y-1.5">
              <ProviderRow label="Google" linked={hasGoogle} onLink={linkGoogle} />
              <PasswordRow linked={hasPassword} onSet={setPassword} />
            </div>

            <div className="my-3 border-t border-border" />

            {onUploadLocal && (
              <UploadRow onUpload={onUploadLocal} />
            )}
            <button
              onClick={() => { setOpen(false); void signOut(); }}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-foreground/[0.05]"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function UsernameForm({ current, highlight, onSaved }: { current: string; highlight: boolean; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(highlight);
  const [value, setValue] = useState(highlight ? "" : current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="truncate text-sm font-medium">@{current}</span>
        <button onClick={() => { setValue(current); setEditing(true); }} className="text-xs text-accent hover:underline">Edit</button>
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
    <div className="px-1">
      {highlight && <p className="mb-1 text-xs text-amber-600">Pick a username so others can share with you.</p>}
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted">@</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="username"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent"
        />
        <button onClick={save} disabled={busy} className="rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50">Save</button>
      </div>
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </div>
  );
}

function ProviderRow({ label, linked, onLink }: { label: string; linked: boolean; onLink: () => Promise<void> }) {
  return (
    <div className="flex items-center justify-between px-1 text-sm">
      <span>{label}</span>
      {linked ? (
        <span className="text-xs text-emerald-600">Linked</span>
      ) : (
        <button onClick={() => void onLink()} className="text-xs text-accent hover:underline">Link</button>
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
      <div className="flex items-center justify-between px-1 text-sm">
        <span>Email &amp; password</span>
        <span className="text-xs text-emerald-600">Linked</span>
      </div>
    );
  }
  return (
    <div className="px-1 text-sm">
      <div className="flex items-center justify-between">
        <span>Email &amp; password</span>
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-accent hover:underline">Add</button>
      </div>
      {open && (
        <div className="mt-1 flex items-center gap-1">
          <input
            type="password"
            value={pw}
            minLength={6}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <button
            disabled={busy || pw.length < 6}
            onClick={async () => {
              setBusy(true); setMsg(null);
              try { await onSet(pw); setMsg("Password set."); setPw(""); setOpen(false); }
              catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
              finally { setBusy(false); }
            }}
            className="rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Set
          </button>
        </div>
      )}
      {msg && <p className="mt-1 text-xs text-muted">{msg}</p>}
    </div>
  );
}

function UploadRow({ onUpload }: { onUpload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true); setMsg(null);
          try { await onUpload(); setMsg("Local notes uploaded."); }
          catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
          finally { setBusy(false); }
        }}
        className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-foreground/[0.05] disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload local notes to cloud"}
      </button>
      {msg && <p className="px-2 text-xs text-muted">{msg}</p>}
    </div>
  );
}
