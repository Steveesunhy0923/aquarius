/**
 * Y.Doc ⇄ DocumentTree mapping — the heart of live co-editing.
 *
 * PURE module: imports `yjs`, block TYPES, and the block↔editor-source codec
 * (lib/blocks/source, itself pure). No Supabase, no React, no DOM — so it is
 * trivially unit-testable and reusable on either side of the wire. The realtime
 * transport lives in `./provider.ts`; the React glue in `./useCollab.ts`.
 *
 * ── Shared-type shape ────────────────────────────────────────────────────────
 *   doc.getMap("blocks")    : Y.Map<Y.Map>   — flat registry keyed by BlockId.
 *                                               THE structural merge unit;
 *                                               presence of an id = block exists.
 *   doc.getArray("rootOrder"): Y.Array<string> — order of top-level block ids.
 *   doc.getMap("docMeta")   : Y.Map           — "mode" (string) + "style" (object).
 *
 * Each YBlock (Y.Map):
 *   "type"  : string           — BlockType.
 *   "src"   : Y.Text           — PARAGRAPHS ONLY: the editable source (prose with
 *                                inline math written `\(…\)`), merged at CHARACTER
 *                                level. This is what makes two people typing in the
 *                                same paragraph feel like Google Docs instead of
 *                                clobbering each other. `value` + `attrs.runs` are
 *                                DERIVED from it at materialization, so a paragraph
 *                                never stores its text twice.
 *   "value" : string           — non-paragraph leaf payload; a whole-string `set`
 *                                is block-level LWW. Formulas/captions are short and
 *                                edited in a focused box, where LWW is a fine merge.
 *   "attrs" : object           — BlockAttrs stored as ONE plain JSON value =
 *                                atomic LWW replace (callout color, alignment,
 *                                figure placement…). For paragraphs the `runs` key
 *                                is stripped — "src" is authoritative for text, and
 *                                keeping both would fight over every keystroke.
 *   "slots" : Y.Map<Y.Array<string>> — container children, referenced BY ID into
 *                                the flat registry (not nested), so per-slot order
 *                                merges independently.
 *
 * Children live in the flat `blocks` registry and are reached by id from order
 * arrays; an id that falls out of every order array is an orphan and is dropped
 * at materialization (and swept by the structural diff).
 */

import * as Y from "yjs";

import { blockEditSource, isParagraph, paragraphFromSource } from "@/lib/blocks/source";
import type { Block, BlockAttrs, CanvasMode, DocumentSource, DocumentStyle, DocumentTree, InlineRun } from "@/lib/blocks/types";

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
const SRC = "src";

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

// ─── Paragraph text: the character-level merge unit ──────────────────────────

/**
 * Attrs minus `runs`, or undefined when nothing is left. Paragraph text lives in
 * the "src" Y.Text; `runs` is its derived projection and must NOT also ride in
 * the LWW attrs blob (it would re-broadcast the whole paragraph on every
 * keystroke and race the character merge).
 */
function attrsWithoutRuns(attrs: BlockAttrs | undefined): BlockAttrs | undefined {
  if (attrs === undefined) return undefined;
  const rest: Record<string, unknown> = { ...(attrs as Record<string, unknown>) };
  delete rest.runs;
  return Object.keys(rest).length > 0 ? (clone(rest) as BlockAttrs) : undefined;
}

/**
 * Converge a Y.Text to `next` with ONE minimal splice: keep the common prefix
 * and suffix, replace the middle. For typing (a character at a time) that is a
 * single 1-char insert, so concurrent edits by two people commute the way Yjs
 * intends — each keystroke is its own item, and neither side's text is rewritten.
 * Indices are UTF-16 code units on both sides (Y.Text and JS strings agree).
 */
function spliceText(ytext: Y.Text, next: string): void {
  const cur = ytext.toString();
  if (cur === next) return;
  const max = Math.min(cur.length, next.length);
  let p = 0;
  while (p < max && cur[p] === next[p]) p++;
  let s = 0;
  while (s < max - p && cur[cur.length - 1 - s] === next[next.length - 1 - s]) s++;
  const del = cur.length - p - s;
  if (del > 0) ytext.delete(p, del);
  const ins = next.slice(p, next.length - s);
  if (ins.length > 0) ytext.insert(p, ins);
}

/** Create + integrate the "src" Y.Text for a paragraph (integrate, then fill). */
function setSource(yb: YBlock, src: string): void {
  const ytext = new Y.Text();
  yb.set(SRC, ytext);
  if (src.length > 0) ytext.insert(0, src);
}

/**
 * Re-id the inline-math runs derived from a paragraph's source so they depend
 * only on the paragraph id and run index. `paragraphFromSource` mints random
 * ids, which would make materialization non-deterministic — every remote
 * keystroke would hand React new keys and remount every inline formula in the
 * document. Run blocks live inside `attrs.runs` and are never entered in the flat
 * registry, so these ids can't collide with real block ids.
 */
function withStableRunIds(runs: InlineRun[], paraId: string): InlineRun[] {
  return runs.map((run, i) =>
    run.kind === "math" ? { ...run, block: stampIds(run.block, `${paraId}~r${i}`) } : run,
  );
}
function stampIds(block: Block, id: string): Block {
  const out: Block = { ...block, id };
  if (block.slots) {
    out.slots = Object.fromEntries(
      Object.entries(block.slots).map(([name, kids]) => [
        name,
        kids.map((kid, i) => stampIds(kid, `${id}.${name}${i}`)),
      ]),
    );
  }
  return out;
}

// ─── Seed: DocumentTree → Y.Doc ──────────────────────────────────────────────

/** Populate (or create) a Y.Doc from a tree. Idempotent for identical trees. */
export function seedYDoc(tree: DocumentTree, doc: Y.Doc = new Y.Doc()): Y.Doc {
  doc.transact(() => {
    const meta = getDocMeta(doc);
    meta.set("mode", tree.mode);
    if (tree.style) meta.set("style", clone(tree.style));
    // `source` marks the note as an IMPORT, which is what locks editing to
    // annotation only. Dropping it here would silently unlock a shared PDF on
    // the first co-edit round trip.
    if (tree.source) meta.set("source", clone(tree.source));
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
  if (isParagraph(block)) {
    // Text goes in the Y.Text; value/runs are derived back out on materialize.
    setSource(yb, blockEditSource(block));
    const rest = attrsWithoutRuns(block.attrs);
    if (rest !== undefined) yb.set("attrs", rest);
  } else {
    if (block.value !== undefined) yb.set("value", block.value);
    if (block.attrs !== undefined) yb.set("attrs", clone(block.attrs));
  }
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
  const source = meta.get("source") as DocumentSource | undefined;
  const top = materializeList(blocks, order.toArray(), new Set<string>());
  const tree: DocumentTree = { schema: 1, mode, blocks: top };
  if (style !== undefined) tree.style = clone(style);
  if (source !== undefined) tree.source = clone(source);
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
  const attrs = yb.get("attrs");
  const ysrc = yb.get(SRC);
  if (block.type === "text" && ysrc instanceof Y.Text) {
    // Paragraph: rebuild value + runs from the merged source, keeping the LWW
    // attrs (callout color, alignment…) that "src" doesn't own.
    const para = paragraphFromSource(ysrc.toString(), id);
    const derived = { runs: withStableRunIds((para.attrs?.runs ?? []) as InlineRun[], id) };
    block.value = para.value;
    block.attrs = attrs !== undefined ? { ...clone(attrs as BlockAttrs), ...derived } : derived;
    return block; // paragraphs carry no slots
  }
  const value = yb.get("value");
  if (value !== undefined) block.value = value as string;
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
    if (!jsonEq(meta.get("source"), next.source)) {
      if (next.source === undefined) meta.delete("source");
      else meta.set("source", clone(next.source));
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

  if (isParagraph(block)) {
    // Text (character-level merge). A block that just BECAME a paragraph — or one
    // stored by an older client as a plain string — gets its Y.Text created here.
    const ysrc = yb.get(SRC);
    if (ysrc instanceof Y.Text) spliceText(ysrc, blockEditSource(block));
    else setSource(yb, blockEditSource(block));
    if (yb.has("value")) yb.delete("value"); // derived from "src" now

    // attrs minus the derived `runs` (atomic LWW replace)
    const rest = attrsWithoutRuns(block.attrs);
    if (rest === undefined) {
      if (yb.has("attrs")) yb.delete("attrs");
    } else if (!jsonEq(yb.get("attrs"), rest)) {
      yb.set("attrs", rest);
    }
  } else {
    if (yb.has(SRC)) yb.delete(SRC); // no longer a paragraph (e.g. turned into a heading)

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
