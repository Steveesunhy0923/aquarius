/**
 * SupabaseYjsProvider — binds one Y.Doc to a Supabase Realtime channel so edits
 * flow peer↔peer in real time, with presence for avatars.
 *
 * Transport: a per-note channel `note:<id>`. Three broadcast events:
 *   • "sync"       {from, sv, state} — sent on every (re)subscribe. Carries the
 *                  sender's FULL state (so receivers merge anything they lack,
 *                  including edits made while a peer was offline) plus its state
 *                  vector (so receivers can reply with the diff the sender lacks).
 *   • "sync-reply" {update}          — the diff a syncing peer was missing.
 *   • "update"     {update}          — an incremental live edit.
 * Yjs merges are commutative + idempotent, so this push+pull-on-join handshake
 * converges under any message order and any join race — no leader election.
 *
 * Feedback loop is broken by transaction origins (see ./ydoc.ts): we apply every
 * remote update with ORIGIN_REMOTE and never rebroadcast ORIGIN_REMOTE updates.
 *
 * Channel auth: defaults to a PRIVATE channel (RLS on realtime.messages — see
 * migration 0008). Pass `isPrivate:false` to fall back to a public channel.
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";

import { base64ToBytes, bytesToBase64 } from "./bytes";
import type { PeerInfo } from "./presence";
import { ORIGIN_REMOTE } from "./ydoc";

export interface CollabCallbacks {
  onPeers(peers: PeerInfo[]): void;
  onConnected(connected: boolean): void;
}

export interface ProviderOpts {
  supabase: SupabaseClient;
  noteId: string;
  doc: Y.Doc;
  self: PeerInfo;
  callbacks: CollabCallbacks;
  /** Use a private (RLS-authorized) channel. Default true. */
  isPrivate?: boolean;
}

// Empty Yjs updates encode to 2 bytes; skip replying with "nothing to send".
const EMPTY_UPDATE_LEN = 2;
// Soft warning threshold for a single broadcast payload (Realtime caps ~256 KB).
const PAYLOAD_WARN_BYTES = 180_000;

export class SupabaseYjsProvider {
  private channel: RealtimeChannel | null = null;
  private _connected = false;
  // Mutable copy of our presence payload — updated as we move our "typing line".
  private readonly selfState: PeerInfo;
  private readonly onUpdate: (update: Uint8Array, origin: unknown) => void;

  constructor(private readonly opts: ProviderOpts) {
    this.selfState = { ...opts.self };
    this.onUpdate = (update, origin) => {
      // Don't rebroadcast what we just applied from a peer.
      if (origin === ORIGIN_REMOTE) return;
      if (!this._connected) return; // offline edits ship via the next "sync"
      this.send("update", { update: bytesToBase64(update) });
    };
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    const { supabase, noteId, doc, self } = this.opts;
    doc.on("update", this.onUpdate);

    const channel = supabase.channel(`note:${noteId}`, {
      config: {
        private: this.opts.isPrivate ?? true,
        broadcast: { self: false, ack: false },
        presence: { key: self.userId },
      },
    });
    this.channel = channel;

    channel.on("broadcast", { event: "update" }, ({ payload }) => {
      this.applyRemote(payload?.update);
    });
    channel.on("broadcast", { event: "sync-reply" }, ({ payload }) => {
      this.applyRemote(payload?.update);
    });
    channel.on("broadcast", { event: "sync" }, ({ payload }) => {
      // Merge the sender's full state (covers their offline edits)…
      this.applyRemote(payload?.state);
      // …then reply with whatever the sender is still missing relative to us.
      if (typeof payload?.sv === "string") {
        const diff = Y.encodeStateAsUpdate(doc, base64ToBytes(payload.sv));
        if (diff.length > EMPTY_UPDATE_LEN) this.send("sync-reply", { update: bytesToBase64(diff) });
      }
    });

    const emitPeers = () => this.emitPeers();
    channel.on("presence", { event: "sync" }, emitPeers);
    channel.on("presence", { event: "join" }, emitPeers);
    channel.on("presence", { event: "leave" }, emitPeers);

    void this.authorizeAndSubscribe(channel, doc);
  }

  /** Update our presence payload (e.g. which block we're editing) and re-track. */
  updatePresence(patch: Partial<PeerInfo>): void {
    Object.assign(this.selfState, patch);
    if (this._connected) void this.channel?.track(this.selfState);
  }

  /**
   * Private channels authorize via RLS on `realtime.messages` (migration 0008),
   * so the realtime socket must carry the user's JWT. Set it before subscribing.
   */
  private async authorizeAndSubscribe(channel: RealtimeChannel, doc: Y.Doc): Promise<void> {
    if (this.opts.isPrivate ?? true) {
      try {
        const { data } = await this.opts.supabase.auth.getSession();
        await this.opts.supabase.realtime.setAuth(data.session?.access_token ?? null);
      } catch (e) {
        console.error("collab: realtime setAuth failed", e);
      }
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        this.setConnected(true);
        void channel.track(this.selfState);
        // Announce: push our full state + SV. Re-runs on every reconnect, so a
        // peer that edited while offline both pushes and pulls on return.
        this.send("sync", {
          from: this.selfState.clientId,
          sv: bytesToBase64(Y.encodeStateVector(doc)),
          state: bytesToBase64(Y.encodeStateAsUpdate(doc)),
        });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        this.setConnected(false);
      }
    });
  }

  destroy(): void {
    const { supabase, doc } = this.opts;
    doc.off("update", this.onUpdate);
    if (this.channel) {
      void this.channel.untrack();
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.setConnected(false);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private applyRemote(b64: unknown): void {
    if (typeof b64 !== "string" || b64.length === 0) return;
    try {
      Y.applyUpdate(this.opts.doc, base64ToBytes(b64), ORIGIN_REMOTE);
    } catch (e) {
      console.error("collab: failed to apply remote update", e);
    }
  }

  private send(event: string, payload: Record<string, unknown>): void {
    const ch = this.channel;
    if (!ch) return;
    for (const v of Object.values(payload)) {
      if (typeof v === "string" && v.length > PAYLOAD_WARN_BYTES) {
        console.warn(`collab: ${event} payload ~${v.length}B exceeds the realtime budget; large notes may need chunking`);
      }
    }
    void ch.send({ type: "broadcast", event, payload });
  }

  private setConnected(value: boolean): void {
    if (this._connected === value) return;
    this._connected = value;
    this.opts.callbacks.onConnected(value);
  }

  private emitPeers(): void {
    const ch = this.channel;
    if (!ch) return;
    const state = ch.presenceState<Partial<PeerInfo>>();
    const byUser = new Map<string, PeerInfo>();
    for (const entries of Object.values(state)) {
      for (const e of entries) {
        if (!e.userId) continue;
        byUser.set(e.userId, {
          userId: e.userId,
          username: e.username ?? "user",
          color: e.color ?? "#888",
          clientId: e.clientId ?? 0,
          editingId: e.editingId ?? null,
        });
      }
    }
    this.opts.callbacks.onPeers([...byUser.values()]);
  }
}
