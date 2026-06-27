/**
 * User profiles — the social handle (username), display name, and avatar.
 *
 * Backed by the `profiles` table (supabase/migrations/0003_profiles.sql), which
 * any authenticated user can read (for share-by-username lookups) but only the
 * owner can write. A row is auto-created on signup by a DB trigger; this module
 * reads it, lets the user pick a username, and looks up other users by username.
 */

import { getSupabaseClient } from "@/lib/supabase/client";

export interface Profile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface ProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

const COLS = "id,username,display_name,avatar_url";

const fromRow = (r: ProfileRow): Profile => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
});

// ─── Pure validators (mirror the DB constraints; unit-tested) ─────────────────

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

/** Returns an error message for an invalid username, or null when valid. */
export function validateUsername(name: string): string | null {
  if (!USERNAME_RE.test(name)) {
    return "3–30 characters; letters, numbers, and underscores only.";
  }
  return null;
}

/** True when a username is still the auto-generated default (`user_<12 hex>`). */
export function isDefaultUsername(name: string): boolean {
  return /^user_[0-9a-f]{12}$/i.test(name);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** The signed-in user's profile, or null (not configured / signed out). */
export async function getMyProfile(): Promise<Profile | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const { data: auth } = await sb.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data, error } = await sb
    .from("profiles")
    .select(COLS)
    .eq("id", uid)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as ProfileRow) : null;
}

/** Set the signed-in user's username. Throws a friendly error if taken/invalid. */
export async function setUsername(username: string): Promise<Profile> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error("Cloud is not configured.");
  const invalid = validateUsername(username);
  if (invalid) throw new Error(invalid);
  const { data: auth } = await sb.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("You are not signed in.");
  const { data, error } = await sb
    .from("profiles")
    .update({ username })
    .eq("id", uid)
    .select(COLS)
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("That username is already taken.");
    throw error;
  }
  return fromRow(data as ProfileRow);
}

/** Find a user by exact username (case-insensitive via citext). Null if none. */
export async function lookupByUsername(username: string): Promise<Profile | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("profiles")
    .select(COLS)
    .eq("username", username)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as ProfileRow) : null;
}
