"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { BTN_PRIMARY_SM as PRIMARY, FIELD } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth/AuthProvider";

/** Sign-in / sign-up modal: Apple + Google OAuth + email & password. */
export function AuthDialog({ onClose }: { onClose: () => void }) {
  const { signInWithApple, signInWithGoogle, signInWithPassword, signUpWithPassword, resetPassword } = useAuth();
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
    <Dialog title={mode === "in" ? "Sign in" : "Create account"} onClose={onClose} maxWidth="max-w-sm">
      <div className="px-5 py-4">
        {/* Apple first: Guideline 4.8 wants Sign in with Apple offered at least
            as prominently as other third-party logins. */}
        <button
          onClick={() => run(signInWithApple)}
          disabled={busy}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-control border border-border px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
        >
          <AppleMark /> Continue with Apple
        </button>
        <button
          onClick={() => run(signInWithGoogle)}
          disabled={busy}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-control border border-border px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
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
            className={FIELD}
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            className={FIELD}
          />

          {err && <p className="text-xs text-danger">{err}</p>}
          {info && <p className="text-xs text-success">{info}</p>}

          <button type="submit" disabled={busy} className={`w-full ${PRIMARY}`}>
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
    </Dialog>
  );
}

function AppleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.03 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.701" />
    </svg>
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
