"use client";

/**
 * Auth context for Aquarius.
 *
 * Wraps Supabase Auth (browser session, localStorage) and exposes the sign-in
 * methods the UI needs: Google OAuth, email/password, password reset, and
 * identity LINKING so Google + email/password collapse onto one account. Keeps
 * the synchronous `getStore()` seam informed via the session cache
 * (lib/supabase/session.ts) so the right store (cloud vs local) is chosen
 * without awaiting. When Supabase is unconfigured, `configured` is false and the
 * whole app stays in local guest mode — nothing here throws on its own.
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

import { getMyProfile, type Profile } from "@/lib/profile/profile";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { setCachedUserId } from "@/lib/supabase/session";

interface AuthState {
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
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Set (or add) an email/password credential on the current account. */
  setPassword: (password: string) => Promise<void>;
  /** Link a Google identity to the current account. */
  linkGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const callbackUrl = (): string | undefined =>
  typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const user = session?.user ?? null;
  const userId = user?.id ?? null;

  const refreshProfile = useCallback(async () => {
    try {
      setProfile(await getMyProfile());
    } catch {
      setProfile(null);
    }
  }, []);

  // Track the session: initial lookup + every subsequent auth change.
  useEffect(() => {
    const sb = getSupabaseClient();
    if (!sb) {
      setLoading(false);
      return;
    }
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setCachedUserId(data.session?.user.id ?? null);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setCachedUserId(s?.user.id ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load the profile whenever the signed-in user changes.
  useEffect(() => {
    if (userId) void refreshProfile();
    else setProfile(null);
  }, [userId, refreshProfile]);

  const linkedProviders = useMemo(
    () => Array.from(new Set((user?.identities ?? []).map((i) => i.provider))),
    [user],
  );

  const client = (): SupabaseClient => {
    const sb = getSupabaseClient();
    if (!sb) throw new Error("Cloud is not configured.");
    return sb;
  };

  const signInWithGoogle = useCallback(async () => {
    const { error } = await client().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) throw error;
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await client().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUpWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await client().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: callbackUrl() },
    });
    if (error) throw error;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await client().auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl(),
    });
    if (error) throw error;
  }, []);

  const setPassword = useCallback(async (password: string) => {
    const { error } = await client().auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const linkGoogle = useCallback(async () => {
    const { error } = await client().auth.linkIdentity({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await client().auth.signOut();
    setCachedUserId(null);
  }, []);

  const value: AuthState = {
    configured,
    loading,
    user,
    session,
    profile,
    linkedProviders,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    resetPassword,
    setPassword,
    linkGoogle,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
