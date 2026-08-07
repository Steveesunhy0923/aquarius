/**
 * SupabaseYjsProvider — binds one Y.Doc to a Supabase Realtime channel so edits
 * flow peer↔peer in real time, with presence for avatars.
 *
 * Transport: a per-note channel `note:<id>`. Broadcast events:
 *   • "sync"       {from, sv, state} — sent on every (re)subscribe. Carries the
 *                  sender's FULL state (so receivers merge anything they lack,
 *                  including edits made while a peer was offline) plus its state
 *                  vector (so receivers can reply with the diff the sender lacks).
 *   • "sync-reply" {update}          — the diff a syncing peer was missing.
 *   • "update"     {update}          — incremental live edits, COALESCED: rapid
 *                  keystrokes are merged (Y.mergeUpdates) and flushed on a short
 *                  timer so a fast typist sends a few messages/sec, not dozens,
 *                  keeping under the realtime event-rate budget.
 *   • "chunk"      {id, event, i, n, piece} — any payload over the ~256 KB
 *                  realtime frame cap is split and reassembled, so large notes'
 *                  initial "sync" state can't be silently dropped.
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
// Coalesce outgoing live updates over this window before broadcasting one merged
// message — smooths fast typing under the realtime event-rate budget.
const UPDATE_FLUSH_MS = 30;
// Leading-edge throttle for presence (cursor/editing) tracking.
const TRACK_THROTTLE_MS = 50;
// Max characters per broadcast payload; larger payloads are chunked. Realtime's
// hard frame cap is ~256 KB — stay well under it to leave room for envelope JSON.
const MAX_FRAME = 180_000;

export class SupabaseYjsProvider {
  private channel: RealtimeChannel | null = null;
  private _connected = false;
  // Mutable copy of our presence payload — updated as we move our "typing line".
  private readonly selfState: PeerInfo;
  private readonly onUpdate: (update: Uint8Array, origin: unknown) => void;

  // Outgoing update coalescing.
  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  // Presence track throttling.
  private trackTimer: ReturnType<typeof setTimeout> | null = null;
  private trackPending = false;
  // Inbound chunk reassembly, keyed by sender-scoped id.
  private chunkSeq = 0;
  private readonly chunks = new Map<string, { n: number; parts: string[] }>();

  constructor(private readonly opts: ProviderOpts) {
    this.selfState = { ...opts.self };
    this.onUpdate = (update, origin) => {
      // Don't rebroadcast what we just applied from a peer.
      if (origin === ORIGIN_REMOTE) return;
      if (!this._connected) return; // offline edits ship via the next "sync"
      this.queueUpdate(update);
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

    channel.on("broadcast", { event: "update" }, ({ payload }) => this.handleEvent("update", payload));
    channel.on("broadcast", { event: "sync-reply" }, ({ payload }) => this.handleEvent("sync-reply", payload));
    channel.on("broadcast", { event: "sync" }, ({ payload }) => this.handleEvent("sync", payload));
    channel.on("broadcast", { event: "chunk" }, ({ payload }) => this.onChunk(payload));

    const emitPeers = () => this.emitPeers();
    channel.on("presence", { event: "sync" }, emitPeers);
    channel.on("presence", { event: "join" }, emitPeers);
    channel.on("presence", { event: "leave" }, emitPeers);

    void this.authorizeAndSubscribe(channel, doc);
  }

  /** Update our presence payload (e.g. which block we're editing) and re-track. */
  updatePresence(patch: Partial<PeerInfo>): void {
    Object.assign(this.selfState, patch);
    this.scheduleTrack();
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
    this.flushUpdates(); // ship any coalesced keystrokes before we tear down
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.trackTimer) { clearTimeout(this.trackTimer); this.trackTimer = null; }
    this.chunks.clear();
    if (this.channel) {
      void this.channel.untrack();
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.setConnected(false);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Route a (possibly reassembled) broadcast to its handler. */
  private handleEvent(event: string, payload: unknown): void {
    const p = payload as Record<string, unknown> | null | undefined;
    if (event === "update" || event === "sync-reply") {
      this.applyRemote(p?.update);
    } else if (event === "sync") {
      // Merge the sender's full state (covers their offline edits)…
      this.applyRemote(p?.state);
      // …then reply with whatever the sender is still missing relative to us.
      if (typeof p?.sv === "string") {
        const diff = Y.encodeStateAsUpdate(this.opts.doc, base64ToBytes(p.sv));
        if (diff.length > EMPTY_UPDATE_LEN) this.send("sync-reply", { update: bytesToBase64(diff) });
      }
    }
  }

  private queueUpdate(update: Uint8Array): void {
    this.pendingUpdates.push(update);
    if (this.flushTimer == null) {
      this.flushTimer = setTimeout(() => this.flushUpdates(), UPDATE_FLUSH_MS);
    }
  }

  private flushUpdates(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.pendingUpdates.length === 0) return;
    const merged =
      this.pendingUpdates.length === 1 ? this.pendingUpdates[0] : Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];
    this.send("update", { update: bytesToBase64(merged) });
  }

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
    const json = JSON.stringify(payload);
    if (json.length <= MAX_FRAME) {
      void ch.send({ type: "broadcast", event, payload });
      return;
    }
    // Oversized: frame into ordered chunks reassembled by the receiver.
    const id = `${this.selfState.clientId}-${this.chunkSeq++}`;
    const n = Math.ceil(json.length / MAX_FRAME);
    for (let i = 0; i < n; i++) {
      void ch.send({
        type: "broadcast",
        event: "chunk",
        payload: { id, event, i, n, piece: json.slice(i * MAX_FRAME, (i + 1) * MAX_FRAME) },
      });
    }
  }

  private onChunk(payload: unknown): void {
    const p = payload as { id?: unknown; event?: unknown; i?: unknown; n?: unknown; piece?: unknown };
    if (typeof p?.id !== "string" || typeof p.event !== "string" || typeof p.i !== "number" ||
        typeof p.n !== "number" || typeof p.piece !== "string") return;
    // Defensive cap: drop stale partials if a sender vanished mid-transmission.
    if (this.chunks.size > 16 && !this.chunks.has(p.id)) this.chunks.clear();
    let buf = this.chunks.get(p.id);
    if (!buf) { buf = { n: p.n, parts: [] }; this.chunks.set(p.id, buf); }
    buf.parts[p.i] = p.piece;
    if (buf.parts.filter((x) => x !== undefined).length < buf.n) return;
    this.chunks.delete(p.id);
    try {
      this.handleEvent(p.event, JSON.parse(buf.parts.join("")));
    } catch (e) {
      console.error("collab: failed to reassemble chunked payload", e);
    }
  }

  /** Leading-edge-throttled presence track; always sends the latest selfState. */
  private scheduleTrack(): void {
    if (!this._connected) return;
    if (this.trackTimer != null) { this.trackPending = true; return; }
    void this.channel?.track(this.selfState);
    this.trackTimer = setTimeout(() => {
      this.trackTimer = null;
      if (this.trackPending) { this.trackPending = false; this.scheduleTrack(); }
    }, TRACK_THROTTLE_MS);
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
