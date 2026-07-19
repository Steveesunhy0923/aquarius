/**
 * Presence types + deterministic per-user color. Pure (no Supabase/React) so the
 * color/initials helpers are reusable by the avatars UI and unit-testable.
 */

export interface PeerInfo {
  /** Auth user id — the presence key (a user open in two tabs collapses to one). */
  userId: string;
  username: string;
  /** Stable display color derived from the user id. */
  color: string;
  /** Y.Doc clientID — distinguishes tabs/devices of the same user if needed. */
  clientId: number;
  /** Block id this peer is currently editing (their "typing line"), or null. */
  editingId?: string | null;
  /**
   * Live caret / selection within `editingId`, as character offsets into the
   * block's source text. `start === end` (or `end` omitted) is a plain caret;
   * a range is a selection. Drives the collaborator cursor overlay.
   */
  cursor?: { blockId: string; start: number; end: number } | null;
}

/** Deterministic, stable HSL color for a user id (same id → same color everywhere). */
export function colorForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 45%)`;
}

/** 1–2 letter avatar label from a username. */
export function initials(username: string): string {
  const clean = (username || "?").trim();
  const parts = clean.split(/[\s_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}
