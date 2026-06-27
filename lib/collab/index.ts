/**
 * Real-time co-editing layer (block-level Yjs over Supabase Realtime).
 *
 * Public surface — the editor imports from here:
 *   import { useCollab, type PeerInfo } from "@/lib/collab";
 *
 * Concern boundary: this is per-open-note LIVE co-editing (browser-only, hard
 * Yjs dependency). It is deliberately separate from `lib/sync` (the server-safe
 * whole-library background reconciler).
 */

export { ORIGIN_LOCAL, ORIGIN_REMOTE, applyTreeToYDoc, seedYDoc, yDocToTree } from "./ydoc";
export { SupabaseYjsProvider, type CollabCallbacks, type ProviderOpts } from "./provider";
export { colorForUser, initials, type PeerInfo } from "./presence";
export { base64ToBytes, bytesToBase64, bytesToPgHex, pgHexToBytes } from "./bytes";
export { useCollab, type UseCollab } from "./useCollab";
