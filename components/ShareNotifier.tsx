"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { useAuth } from "@/lib/auth/AuthProvider";
import { listSharedWithMe, SHARES_CHANGED_EVENT } from "@/lib/sharing/sharing";
import { isCloudActive } from "@/lib/storage";
import { getSupabaseClient } from "@/lib/supabase/client";
import { uiToast } from "@/components/ui/toast";

/**
 * Watches for notes newly shared with the signed-in user and pops a toast
 * ("A note was shared with you…"). Mounted once in Providers so it runs on every
 * page, including the editor.
 *
 * Delivery is push-first: a Realtime subscription on our OWN `note_collaborators`
 * rows (migration 0014; scoped by the table's existing RLS) fires within about a
 * second of the owner clicking Share. The timer below is only a fallback for a
 * dropped socket, a deployment whose migration hasn't been applied, or a tab that
 * was asleep — hence the slow interval.
 *
 * Everything is derived from existing data (shares with `openedAt === null`) — no
 * notifications table. A per-user localStorage "seen" set dedupes so the same
 * pending share isn't re-toasted on every reload; the first run for a user adopts
 * the current state silently so we don't retro-notify already-pending shares.
 * Each refresh also broadcasts the fresh list (SHARES_CHANGED_EVENT) so the
 * library updates its unread badge and panes without polling on its own.
 */
const POLL_MS = 120_000;
const seenKey = (uid: string) => `aquarius.shares.seen.${uid}`;

export function ShareNotifier() {
  const { user } = useAuth();
  const router = useRouter();
  const uid = user?.id ?? null;

  useEffect(() => {
    if (!uid || !isCloudActive()) return;
    let alive = true;
    let inFlight = false;
    let again = false; // a refresh was requested while one was already running
    let timer: ReturnType<typeof setTimeout> | undefined;

    const loadSeen = (): Set<string> | null => {
      try {
        const raw = localStorage.getItem(seenKey(uid));
        return raw ? new Set(JSON.parse(raw) as string[]) : null;
      } catch {
        return null;
      }
    };
    const saveSeen = (ids: string[]) => {
      try {
        localStorage.setItem(seenKey(uid), JSON.stringify(ids));
      } catch {
        /* storage full / unavailable — dedupe just resets next load */
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (alive) timer = setTimeout(() => void tick(), POLL_MS);
    };

    const tick = async () => {
      if (!alive) return;
      // A push event that lands mid-read must not be swallowed by the in-flight
      // guard — the running query may predate the row it is telling us about.
      if (inFlight) { again = true; return; }
      inFlight = true;
      try {
        const shares = await listSharedWithMe();
        if (!alive) return;
        window.dispatchEvent(new CustomEvent(SHARES_CHANGED_EVENT, { detail: { shares } }));

        const unopened = shares.filter((s) => !s.openedAt);
        const unopenedIds = unopened.map((s) => s.note.id);
        const seen = loadSeen();
        if (seen !== null) {
          for (const s of unopened) {
            if (seen.has(s.note.id)) continue;
            uiToast({
              title: "A note was shared with you",
              message: `“${s.note.title}” — ${s.role} access`,
              action: { label: "Open", onClick: () => router.push(`/editor?id=${s.note.id}`) },
            });
          }
        }
        saveSeen(unopenedIds);
      } catch {
        // Best-effort: offline / not configured / signed out mid-flight.
      } finally {
        inFlight = false;
        schedule();
        if (again && alive) { again = false; void tick(); }
      }
    };

    void tick();
    // Pick up new shares quickly when the user returns to the tab.
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);

    // Push path: our own collaborator rows. RLS (0006) scopes the stream to
    // shares addressed to us; the filter keeps the socket quiet otherwise. Any
    // event — a new share, a role change, an unshare — just re-reads the list,
    // so the toast text always comes from the database rather than the payload.
    const supabase = getSupabaseClient();
    let channel: RealtimeChannel | null = null;
    void (async () => {
      if (!supabase) return;
      try {
        const { data } = await supabase.auth.getSession();
        await supabase.realtime.setAuth(data.session?.access_token ?? null);
      } catch {
        // Fall through: an unauthorized socket simply won't deliver events, and
        // the fallback timer still catches the share.
      }
      if (!alive) return;
      channel = supabase
        .channel(`shares:${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "note_collaborators", filter: `user_id=eq.${uid}` },
          () => void tick(),
        )
        .subscribe();
    })();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [uid, router]);

  return null;
}
