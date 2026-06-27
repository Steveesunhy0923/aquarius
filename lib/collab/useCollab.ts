/**
 * useCollab — React glue that owns the per-note Y.Doc + provider lifecycle.
 *
 * Responsibilities:
 *   • Create one Y.Doc when collab becomes eligible, seeding it from the note's
 *     persisted `ydoc` (authoritative) or, on a first co-edit, from its `tree`.
 *   • Project REMOTE changes back to the editor via `applyRemoteTree` (the doc's
 *     `observeDeep`, ignoring our own ORIGIN_LOCAL transactions).
 *   • Expose `pushLocalTree` (the editor's bridge effect calls it on every local
 *     tree change) and `snapshot` (autosave attaches it to the package).
 *
 * The Y.Doc is the source of truth while collab is active; `pkg.tree` is a
 * projection. Feedback loops are prevented by ORIGIN tags here + an
 * `applyingRemote` ref on the editor side.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";

import { useAuth } from "@/lib/auth/AuthProvider";
import type { DocumentTree } from "@/lib/blocks/types";
import type { Access } from "@/lib/sharing/sharing";
import type { NotePackage } from "@/lib/storage/types";
import { getSupabaseClient } from "@/lib/supabase/client";

import { colorForUser, type PeerInfo } from "./presence";
import { SupabaseYjsProvider } from "./provider";
import { ORIGIN_LOCAL, ORIGIN_REMOTE, SEED_CLIENT_ID, applyTreeToYDoc, seedYDoc, yDocToTree } from "./ydoc";

export interface UseCollab {
  /** Other participants present on the channel (includes self). */
  peers: PeerInfo[];
  /** True while the realtime channel is subscribed. */
  connected: boolean;
  /** True when a live Y.Doc exists for this note. */
  active: boolean;
  /** Reconcile a locally-edited tree into the Y.Doc (no-op for read-only roles). */
  pushLocalTree: (tree: DocumentTree) => void;
  /** Encoded authoritative state for persistence, or null when inactive. */
  snapshot: () => Uint8Array | null;
  /** Announce which block this user is editing (their "typing line"), for peers. */
  setEditing: (blockId: string | null) => void;
}

export interface UseCollabOpts {
  noteId: string;
  access: Access | null;
  /** Eligible = cloud-active AND the note is shared. Computed by the editor. */
  enabled: boolean;
  /** The loaded package (used once to seed the Y.Doc). */
  pkg: NotePackage | null;
  /** Apply a remote-originated tree to editor state (guarded, no undo push). */
  applyRemoteTree: (tree: DocumentTree) => void;
}

export function useCollab({ noteId, access, enabled, pkg, applyRemoteTree }: UseCollabOpts): UseCollab {
  const { user, profile } = useAuth();
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(false);

  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<SupabaseYjsProvider | null>(null);
  // Last encoded state, kept current so a final flush-save can still read the
  // authoritative snapshot AFTER the Y.Doc has been torn down on unmount.
  const lastSnapshotRef = useRef<Uint8Array | null>(null);
  const writable = access === "owner" || access === "editor";
  const writableRef = useRef(writable);
  writableRef.current = writable;

  // Refs so the long-lived effect always sees the latest callbacks/seed without
  // tearing down and recreating the Y.Doc on every render.
  const applyRemoteRef = useRef(applyRemoteTree);
  applyRemoteRef.current = applyRemoteTree;
  const seedRef = useRef<NotePackage | null>(pkg);
  seedRef.current = pkg;

  // Gate the doc's creation on having both eligibility and a loaded package.
  const ready = enabled && pkg !== null && getSupabaseClient() !== null && !!user;

  useEffect(() => {
    if (!ready) return;
    const supabase = getSupabaseClient();
    const seed = seedRef.current;
    if (!supabase || !seed) return;

    const doc = new Y.Doc();
    // Seed from the authoritative snapshot if present, else from the tree (a
    // first co-edit). When seeding from the tree, seed under the CANONICAL
    // clientID so two clients that race to seed the same fresh note produce
    // identical Yjs items (idempotent merge) instead of duplicating every block;
    // then switch to a unique clientID for live edits.
    if (seed.ydoc && seed.ydoc.length > 0) {
      Y.applyUpdate(doc, seed.ydoc, ORIGIN_REMOTE);
    } else {
      const liveId = doc.clientID;
      doc.clientID = SEED_CLIENT_ID;
      seedYDoc(seed.tree, doc);
      doc.clientID = liveId;
    }
    docRef.current = doc;
    setActive(true);

    // Remote path: any update NOT originating from our own editor write projects
    // back into React. (Provider applies remote updates with ORIGIN_REMOTE; our
    // local edits use ORIGIN_LOCAL.) The update event fires only on real changes,
    // so idempotent re-applies don't trigger a redundant re-render.
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_LOCAL) return; // our own write; editor already current
      applyRemoteRef.current(yDocToTree(doc));
    };
    doc.on("update", onUpdate);

    // Project the freshly-seeded doc into the editor once. When seeded from the
    // authoritative `ydoc` this aligns editor state to the (possibly newer) CRDT
    // state; when seeded from `tree` it's a structurally-identical no-op. Either
    // way it stamps the editor's remote-tree guard so the bridge effect does NOT
    // immediately push the stale tree back and clobber the doc.
    applyRemoteRef.current(yDocToTree(doc));

    const self: PeerInfo = {
      userId: user!.id,
      username: profile?.username ?? profile?.displayName ?? "user",
      color: colorForUser(user!.id),
      clientId: doc.clientID,
      editingId: null,
    };
    const provider = new SupabaseYjsProvider({
      supabase,
      noteId,
      doc,
      self,
      callbacks: { onPeers: setPeers, onConnected: setConnected },
    });
    providerRef.current = provider;
    provider.connect();

    return () => {
      lastSnapshotRef.current = Y.encodeStateAsUpdate(doc); // capture before teardown
      provider.destroy();
      providerRef.current = null;
      doc.destroy();
      docRef.current = null;
      setActive(false);
      setConnected(false);
      setPeers([]);
    };
    // user.id is stable for a session; profile/applyRemoteTree go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, ready]);

  const pushLocalTree = useCallback((tree: DocumentTree) => {
    if (!writableRef.current) return;
    const doc = docRef.current;
    if (doc) applyTreeToYDoc(doc, tree);
  }, []);

  const snapshot = useCallback((): Uint8Array | null => {
    const doc = docRef.current;
    if (doc) {
      const u = Y.encodeStateAsUpdate(doc);
      lastSnapshotRef.current = u;
      return u;
    }
    return lastSnapshotRef.current; // doc torn down (unmount flush) — use last captured
  }, []);

  const setEditing = useCallback((blockId: string | null) => {
    providerRef.current?.updatePresence({ editingId: blockId });
  }, []);

  return { peers, connected, active, pushLocalTree, snapshot, setEditing };
}
