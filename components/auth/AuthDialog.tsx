"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";

/** Sign-in / sign-up modal: Google OAuth + email & password. */
export function AuthDialog({ onClose }: { onClose: () => void }) {
  const { signInWithGoogle, signInWithPassword, signUpWithPassword, resetPassword } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(fn: () => Promise<void>, onSuccess?: () => void) {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await fn();
      onSuccess?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "in") {
      run(() => signInWithPassword(email, password), onClose);
    } else {
      run(
        () => signUpWithPassword(email, password),
        () => setInfo("Account created. If your project requires email confirmation, check your inbox, then sign in."),
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{mode === "in" ? "Sign in" : "Create account"}</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">✕</button>
        </div>

        <button
          onClick={() => run(signInWithGoogle)}
          disabled={busy}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
        >
          <GoogleMark /> Continue with Google
        </button>

        <div className="mb-4 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />

          {err && <p className="text-xs text-red-500">{err}</p>}
          {info && <p className="text-xs text-emerald-600">{info}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          {mode === "in" ? (
            <button onClick={() => { setMode("up"); setErr(null); setInfo(null); }} className="hover:text-accent">
              Create an account
            </button>
          ) : (
            <button onClick={() => { setMode("in"); setErr(null); setInfo(null); }} className="hover:text-accent">
              Have an account? Sign in
            </button>
          )}
          {mode === "in" && (
            <button
              onClick={() =>
                email
                  ? run(() => resetPassword(email), () => setInfo("Password reset email sent."))
                  : setErr("Enter your email first.")
              }
              className="hover:text-accent"
            >
              Forgot password?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.3C41.1 35.5 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
