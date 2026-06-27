/**
 * Y.Doc ⇄ DocumentTree mapping — the heart of block-level co-editing.
 *
 * PURE module: imports only `yjs` (runtime) and block TYPES. No Supabase, no
 * React, no DOM — so it is trivially unit-testable and reusable on either side
 * of the wire. The realtime transport lives in `./provider.ts`; the React glue
 * in `./useCollab.ts`.
 *
 * ── Shared-type shape (block-level granularity) ──────────────────────────────
 *   doc.getMap("blocks")    : Y.Map<Y.Map>   — flat registry keyed by BlockId.
 *                                               THE merge unit; presence of an id
 *                                               = block exists.
 *   doc.getArray("rootOrder"): Y.Array<string> — order of top-level block ids.
 *   doc.getMap("docMeta")   : Y.Map           — "mode" (string) + "style" (object).
 *
 * Each YBlock (Y.Map):
 *   "type"  : string           — BlockType.
 *   "value" : string           — leaf payload; a whole-string `set` is block-level
 *                                LWW (NOT a Y.Text — char-level merge is a future
 *                                follow-up).
 *   "attrs" : object           — BlockAttrs stored as ONE plain JSON value =
 *                                atomic LWW replace. (attrs is a loose bag that
 *                                may itself embed Block subtrees in `runs`; those
 *                                ride along inside the blob and are NOT separately
 *                                mergeable — fine under block-level granularity.)
 *   "slots" : Y.Map<Y.Array<string>> — container children, referenced BY ID into
 *                                the flat registry (not nested), so per-slot order
 *                                merges independently.
 *
 * Children live in the flat `blocks` registry and are reached by id from order
 * arrays; an id that falls out of every order array is an orphan and is dropped
 * at materialization (and swept by the structural diff).
 */

import * as Y from "yjs";

import type { Block, BlockAttrs, CanvasMode, DocumentStyle, DocumentTree } from "@/lib/blocks/types";

/** Transaction origins, used to break the local⇄remote feedback loop. */
export const ORIGIN_LOCAL = Symbol("aquarius-local"); // our own editor writes
export const ORIGIN_REMOTE = Symbol("aquarius-remote"); // applied remote updates

/**
 * Canonical clientID used ONLY for seeding a fresh doc from a tree. Every client
 * seeds under this same id, so two independent seedings of the SAME tree produce
 * byte-identical Yjs items (same clientID + clocks) and merge idempotently — no
 * duplicated blocks. Live edits must switch back to a unique random clientID.
 */
export const SEED_CLIENT_ID = 0;

type YBlock = Y.Map<unknown>;

const BLOCKS = "blocks";
const ROOT_ORDER = "rootOrder";
const DOC_META = "docMeta";

function getBlocks(doc: Y.Doc): Y.Map<YBlock> {
  return doc.getMap<YBlock>(BLOCKS);
}
function getRootOrder(doc: Y.Doc): Y.Array<string> {
  return doc.getArray<string>(ROOT_ORDER);
}
function getDocMeta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(DOC_META);
}

function clone<T>(v: T): T {
  // Decouple materialized values from the data Yjs holds internally.
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}
function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// ─── Seed: DocumentTree → Y.Doc ──────────────────────────────────────────────

/** Populate (or create) a Y.Doc from a tree. Idempotent for identical trees. */
export function seedYDoc(tree: DocumentTree, doc: Y.Doc = new Y.Doc()): Y.Doc {
  doc.transact(() => {
    const meta = getDocMeta(doc);
    meta.set("mode", tree.mode);
    if (tree.style) meta.set("style", clone(tree.style));
    const blocks = getBlocks(doc);
    const order = getRootOrder(doc);
    for (const block of tree.blocks) {
      registerBlock(blocks, block);
      order.push([block.id]);
    }
  }, ORIGIN_LOCAL);
  return doc;
}

/** Create + integrate a fresh YBlock for `block` (recursing into slots). */
function registerBlock(blocks: Y.Map<YBlock>, block: Block): void {
  const yb: YBlock = new Y.Map();
  blocks.set(block.id, yb); // integrate before populating
  yb.set("type", block.type);
  if (block.value !== undefined) yb.set("value", block.value);
  if (block.attrs !== undefined) yb.set("attrs", clone(block.attrs));
  if (block.slots) {
    const ySlots = new Y.Map<Y.Array<string>>();
    yb.set("slots", ySlots);
    for (const [name, children] of Object.entries(block.slots)) {
      const arr = new Y.Array<string>();
      ySlots.set(name, arr);
      for (const child of children) registerBlock(blocks, child);
      arr.push(children.map((c) => c.id));
    }
  }
}

// ─── Materialize: Y.Doc → DocumentTree ───────────────────────────────────────

/** Project the Y.Doc back to a plain DocumentTree (pure; prunes orphans + dupes). */
export function yDocToTree(doc: Y.Doc): DocumentTree {
  const meta = getDocMeta(doc);
  const blocks = getBlocks(doc);
  const order = getRootOrder(doc);
  const mode = (meta.get("mode") as CanvasMode | undefined) ?? "flow";
  const style = meta.get("style") as DocumentStyle | undefined;
  const top = materializeList(blocks, order.toArray(), new Set<string>());
  const tree: DocumentTree = { schema: 1, mode, blocks: top };
  if (style !== undefined) tree.style = clone(style);
  return tree;
}

/**
 * Materialize an ordered id list into blocks, skipping ids missing from the
 * registry OR already materialized elsewhere. The dedupe (`seen`) is essential:
 * a merge can leave the same id in an order array more than once (two clients
 * that independently seeded identical content, or concurrent reorders), which
 * would otherwise yield duplicate-id blocks and crash React's keyed list.
 */
function materializeList(blocks: Y.Map<YBlock>, ids: string[], seen: Set<string>): Block[] {
  const out: Block[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const yb = blocks.get(id);
    if (!yb) continue; // order references a not-yet-synced/orphaned id → skip
    seen.add(id);
    out.push(materializeBlock(blocks, id, yb, seen));
  }
  return out;
}

function materializeBlock(blocks: Y.Map<YBlock>, id: string, yb: YBlock, seen: Set<string>): Block {
  const block: Block = { id, type: yb.get("type") as Block["type"] };
  const value = yb.get("value");
  if (value !== undefined) block.value = value as string;
  const attrs = yb.get("attrs");
  if (attrs !== undefined) block.attrs = clone(attrs as BlockAttrs);
  const ySlots = yb.get("slots") as Y.Map<Y.Array<string>> | undefined;
  if (ySlots instanceof Y.Map) {
    const slots: Record<string, Block[]> = {};
    for (const name of [...ySlots.keys()]) {
      const arr = ySlots.get(name);
      if (arr instanceof Y.Array) slots[name] = materializeList(blocks, arr.toArray(), seen);
    }
    block.slots = slots;
  }
  return block;
}

// ─── Local edit: structural diff DocumentTree → Y.Doc ────────────────────────

/**
 * Reconcile a whole new tree into the Y.Doc as MINIMAL ops in one ORIGIN_LOCAL
 * transaction. The editor's ~15 mutators all funnel into `setPkg`, so diffing
 * the resulting tree here captures every edit path with a single integration
 * point. Only changed leaf fields are `set`; order arrays are diffed (not
 * cleared) so a peer's concurrent reorder isn't needlessly clobbered; ids absent
 * from the new tree are deleted from the registry.
 */
export function applyTreeToYDoc(doc: Y.Doc, next: DocumentTree): void {
  doc.transact(() => {
    const meta = getDocMeta(doc);
    if (meta.get("mode") !== next.mode) meta.set("mode", next.mode);
    if (!jsonEq(meta.get("style"), next.style)) {
      if (next.style === undefined) meta.delete("style");
      else meta.set("style", clone(next.style));
    }

    const blocks = getBlocks(doc);
    // Reconcile every block reachable in `next` (top-level + nested slots).
    for (const block of next.blocks) reconcileBlock(blocks, block);
    reconcileOrder(getRootOrder(doc), next.blocks.map((b) => b.id));

    // Sweep orphans: registry ids no longer reachable from `next`.
    const reachable = new Set<string>();
    collectIds(next.blocks, reachable);
    for (const id of [...blocks.keys()]) {
      if (!reachable.has(id)) blocks.delete(id);
    }
  }, ORIGIN_LOCAL);
}

function collectIds(list: Block[], into: Set<string>): void {
  for (const b of list) {
    into.add(b.id);
    if (b.slots) for (const children of Object.values(b.slots)) collectIds(children, into);
  }
}

function reconcileBlock(blocks: Y.Map<YBlock>, block: Block): void {
  const yb = blocks.get(block.id);
  if (!yb) {
    registerBlock(blocks, block);
    return;
  }
  if (yb.get("type") !== block.type) yb.set("type", block.type);

  // value (block-level LWW)
  if (block.value === undefined) {
    if (yb.has("value")) yb.delete("value");
  } else if (yb.get("value") !== block.value) {
    yb.set("value", block.value);
  }

  // attrs (atomic LWW replace)
  if (block.attrs === undefined) {
    if (yb.has("attrs")) yb.delete("attrs");
  } else if (!jsonEq(yb.get("attrs"), block.attrs)) {
    yb.set("attrs", clone(block.attrs));
  }

  // slots
  if (!block.slots) {
    if (yb.has("slots")) yb.delete("slots");
    return;
  }
  let ySlots = yb.get("slots") as Y.Map<Y.Array<string>> | undefined;
  if (!(ySlots instanceof Y.Map)) {
    ySlots = new Y.Map<Y.Array<string>>();
    yb.set("slots", ySlots);
  }
  for (const [name, children] of Object.entries(block.slots)) {
    for (const child of children) reconcileBlock(blocks, child); // register/update children first
    let arr = ySlots.get(name);
    if (!(arr instanceof Y.Array)) {
      arr = new Y.Array<string>();
      ySlots.set(name, arr);
    }
    reconcileOrder(arr, children.map((c) => c.id));
  }
  for (const name of [...ySlots.keys()]) {
    if (!(name in block.slots)) ySlots.delete(name);
  }
}

/**
 * Converge a Y.Array<string> to `target` with small in-place edits (delete
 * stale, then move/insert into position, then trim). Arrays are tiny (a handful
 * of blocks), so the O(n²) `toArray()` re-reads are negligible and keep the code
 * obviously correct.
 */
function reconcileOrder(yarr: Y.Array<string>, target: string[]): void {
  let cur = yarr.toArray();
  if (cur.length === target.length && cur.every((v, i) => v === target[i])) return;

  const targetSet = new Set(target);
  for (let i = cur.length - 1; i >= 0; i--) {
    if (!targetSet.has(cur[i])) yarr.delete(i, 1);
  }
  cur = yarr.toArray();
  for (let i = 0; i < target.length; i++) {
    if (cur[i] === target[i]) continue;
    const at = cur.indexOf(target[i], i);
    if (at !== -1) yarr.delete(at, 1);
    yarr.insert(i, [target[i]]);
    cur = yarr.toArray();
  }
  if (yarr.length > target.length) yarr.delete(target.length, yarr.length - target.length);
}
