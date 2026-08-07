"use client";

/**
 * Auth context for Aquarius — now backed by the shared Orka account.
 *
 * This project's Supabase instance is THE Orka project: one `auth.users` row is
 * one Orka account, shared with Virgo. Signing in here and signing in there
 * reach the same identity. Nothing about Aquarius's data moved; only the
 * plumbing under the sign-in methods is now shared code (`@orka/auth`), so the
 * two apps cannot drift on PKCE handling, identity linking, or callback
 * exchange.
 *
 * The public contract is UNCHANGED. `useAuth()` exposes exactly the same
 * members it always did, with the same signatures, so none of the seven
 * consumers needed touching. Two of them are still implemented here rather than
 * in the package:
 *
 *   - `profile` / `refreshProfile` — the `profiles` table is Aquarius's, not
 *     Orka's, and Virgo has no use for it.
 *   - `deleteAccount` — the Storage purge below is specific to this app's
 *     `assets` table and `note-assets` bucket. The shared half (the RPC, the
 *     local sign-out) is the package's.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { OrkaAuthCore } from "@orka/auth";

import { getMyProfile, type Profile } from "@/lib/profile/profile";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { setCachedUserId } from "@/lib/supabase/session";

/** Exported now: the shape is worth being able to name from a consumer. */
export interface AuthState {
  /** True when Supabase env keys are present (cloud available). */
  configured: boolean;
  /** True until the initial session lookup resolves. */
  loading: boolean;
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** Distinct identity providers on this account, e.g. ["google", "email"]. */
  linkedProviders: string[];
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Set (or add) an email/password credential on the current account. */
  setPassword: (password: string) => Promise<void>;
  /** Link a Google identity to the current account. */
  linkGoogle: () => Promise<void>;
  /** Link an Apple identity to the current account. */
  linkApple: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Permanently delete the account and all cloud data (irreversible). */
  deleteAccount: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const callbackUrl = (): string | undefined =>
  typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [profile, setProfile] = useState<Profile | null>(null);

  // One core for the lifetime of the provider, over the SAME client singleton
  // every other module gets from `getSupabaseClient()`.
  const core = useMemo(
    () => new OrkaAuthCore(getSupabaseClient(), { redirectTo: callbackUrl() }),
    [],
  );
  const [snapshot, setSnapshot] = useState(() => core.getSnapshot());

  const user = snapshot.user;
  const userId = user?.id ?? null;

  const refreshProfile = useCallback(async () => {
    try {
      setProfile(await getMyProfile());
    } catch {
      setProfile(null);
    }
  }, []);

  /**
   * Track the session, and keep the synchronous user-id cache in step.
   *
   * THE ORDERING IS LOAD-BEARING. `getStore()` (lib/storage/index.ts) is
   * synchronous and picks the cloud or the local store by reading
   * `getCachedUserId()`. `setCachedUserId` therefore has to be written in the
   * same tick as the React state, before any render can observe a signed-in
   * session with a stale (null) cache — otherwise app/page.tsx loads the local
   * guest library for a signed-in user, and their notes appear to be gone.
   *
   * That is also why `lib/supabase/session.ts` stays a plain Aquarius module
   * and was not moved into @orka/auth: two copies of that module (the classic
   * dual-package hazard) would leave the cache permanently null.
   */
  useEffect(() => {
    const sync = () => {
      const next = core.getSnapshot();
      setCachedUserId(next.user?.id ?? null);
      setSnapshot(next);
    };
    const unsubscribe = core.subscribe(sync);
    const stop = core.start();
    sync();
    return () => {
      unsubscribe();
      stop();
    };
  }, [core]);

  // Load the profile whenever the signed-in user changes.
  useEffect(() => {
    if (userId) void refreshProfile();
    else setProfile(null);
  }, [userId, refreshProfile]);

  // ─── Method adapters ───────────────────────────────────────────────────────
  // The core returns richer values (the OAuth URL; whether a signup needs email
  // confirmation). Aquarius's contract is `Promise<void>`, so the extra is
  // dropped here rather than rippling through the dialogs.

  const signInWithGoogle = useCallback(async () => {
    await core.signInWithGoogle();
  }, [core]);

  const signInWithApple = useCallback(async () => {
    await core.signInWithApple();
  }, [core]);

  const signUpWithPassword = useCallback(
    async (email: string, password: string) => {
      await core.signUpWithPassword(email, password);
    },
    [core],
  );

  const linkGoogle = useCallback(async () => {
    await core.linkGoogle();
  }, [core]);

  const linkApple = useCallback(async () => {
    await core.linkApple();
  }, [core]);

  /**
   * Sign out. DELIBERATELY DOES NOT REJECT.
   *
   * The package's `signOut()` throws on error, which is right for a library —
   * but AccountMenu calls this as `void signOut()`, exactly as it always has,
   * so rejecting here would be an unhandled promise rejection rather than a
   * message anyone sees. supabase-js clears the local session even when the
   * server call fails, so the user IS signed out locally either way; swallowing
   * matches both the old behaviour and what actually happened.
   */
  const signOut = useCallback(async () => {
    try {
      await core.signOut();
    } catch {
      /* the local session is gone regardless — see above */
    }
    setCachedUserId(null);
  }, [core]);

  /**
   * Delete the account. IRREVERSIBLE — and, under Orka, NOT app-scoped: this
   * removes the shared Orka account across every Orka app.
   *
   * Storage bytes first: `storage.objects` does not cascade from `auth.users`,
   * and only the Storage API removes the underlying bytes (a SQL delete would
   * just unlink the rows). Then the package's `deleteAccount()` calls
   * `delete_account()` (migration 0012), which drops the auth user and cascades
   * through every application table — Aquarius's and Orka's alike — and clears
   * the local session.
   */
  const deleteAccount = useCallback(async () => {
    const sb: SupabaseClient | null = core.client;
    if (!sb) throw new Error("Cloud is not configured.");
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData.user) throw userErr ?? new Error("Not signed in.");
    const uid = userData.user.id;

    // PAGINATE. A bare `.select()` is capped by PostgREST's `max_rows`, which
    // config.toml sets to 1000 (also the hosted default) — and it truncates
    // SILENTLY, with no error and no indication the list is short. An account
    // with more than 1000 assets would have the rest of its images left in the
    // bucket, orphaned and unreachable, after a dialog that promised permanent
    // deletion.
    const PAGE = 1000;
    const paths: string[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await sb
        .from("assets")
        .select("storage_path")
        .eq("owner_id", uid)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const page = (rows ?? []) as { storage_path: string }[];
      paths.push(...page.map((r) => r.storage_path));
      if (page.length < PAGE) break;
    }

    for (let i = 0; i < paths.length; i += 100) {
      await sb.storage.from("note-assets").remove(paths.slice(i, i + 100));
    }
    await core.deleteAccount();
    setCachedUserId(null);
  }, [core]);

  const value: AuthState = {
    configured,
    loading: snapshot.loading,
    user,
    session: snapshot.session,
    profile,
    linkedProviders: snapshot.linkedProviders,
    signInWithGoogle,
    signInWithApple,
    signInWithPassword: core.signInWithPassword,
    signUpWithPassword,
    resetPassword: core.resetPassword,
    setPassword: core.setPassword,
    linkGoogle,
    linkApple,
    signOut,
    deleteAccount,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
