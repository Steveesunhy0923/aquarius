/**
 * PresenceAvatars — overlapping colored initials for the people currently in a
 * note (live co-editing). Self is shown first and labeled "(you)". A muted dot
 * appears when the realtime channel is disconnected. Print-hidden.
 */

"use client";

import { initials, type PeerInfo } from "@/lib/collab";

export function PresenceAvatars({
  peers,
  selfId,
  connected,
}: {
  peers: PeerInfo[];
  selfId: string | null;
  connected: boolean;
}) {
  if (peers.length === 0) return null;
  // Self first, then everyone else by a stable key.
  const ordered = [...peers].sort((a, b) => {
    if (a.userId === selfId) return -1;
    if (b.userId === selfId) return 1;
    return a.userId < b.userId ? -1 : 1;
  });

  return (
    <div className="print-hide flex items-center" title={connected ? "Live" : "Reconnecting…"}>
      <div className="flex -space-x-2">
        {ordered.map((p) => {
          const you = p.userId === selfId;
          return (
            <span
              key={p.userId}
              title={you ? `${p.username} (you)` : p.username}
              className="grid h-7 w-7 place-items-center rounded-full border-2 border-surface text-[10px] font-semibold text-white"
              style={{ backgroundColor: p.color }}
            >
              {initials(p.username)}
            </span>
          );
        })}
      </div>
      <span
        className={`ml-2 h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-muted"}`}
        aria-hidden
      />
    </div>
  );
}
