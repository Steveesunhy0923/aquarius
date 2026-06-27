/**
 * Pure byte codecs for the collab layer — NO Yjs, NO Supabase, NO React imports.
 *
 * Kept dependency-free on purpose so the storage layer (`lib/storage/cloud.ts`)
 * can round-trip the `ydoc` bytea column without pulling the Yjs runtime into
 * every cloud-store import. The Yjs-aware mapping lives in `./ydoc.ts`.
 *
 * Two encodings are needed:
 *   • Postgres `bytea` text format is HEX with a leading `\x` (PostgREST returns
 *     and accepts `"\\x0a1b…"`). Used for the persisted Y.Doc snapshot.
 *   • Supabase Realtime broadcast payloads are JSON, so a `Uint8Array` update is
 *     shipped as BASE64. Used for the live wire (see ./provider.ts).
 */

const HEX = "0123456789abcdef";

/** `Uint8Array` → Postgres bytea hex literal, e.g. `\x0a1bff`. */
export function bytesToPgHex(u8: Uint8Array): string {
  let out = "\\x";
  for (let i = 0; i < u8.length; i++) {
    const b = u8[i];
    out += HEX[b >> 4] + HEX[b & 0x0f];
  }
  return out;
}

/**
 * Postgres bytea hex literal → `Uint8Array`. Tolerates a missing `\x` prefix and
 * an odd-length tail (drops the dangling nibble). Returns an empty array for
 * empty/whitespace input so callers can treat `null`/`""` as "no snapshot".
 */
export function pgHexToBytes(s: string): Uint8Array {
  let hex = s.trim();
  if (hex.startsWith("\\x") || hex.startsWith("\\X")) hex = hex.slice(2);
  const len = hex.length >> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

// btoa/atob operate on binary strings; chunk to stay clear of arg-count limits
// when encoding large arrays via String.fromCharCode(...chunk).
const CHUNK = 0x8000;

/** `Uint8Array` → base64 (browser-safe, chunked). */
export function bytesToBase64(u8: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    const slice = u8.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

/** base64 → `Uint8Array`. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
