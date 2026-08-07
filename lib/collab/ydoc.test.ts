import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { paragraphFromSource } from "@/lib/blocks/source";
import type { Block, DocumentTree } from "@/lib/blocks/types";

import { SEED_CLIENT_ID, applyTreeToYDoc, seedYDoc, yDocToTree } from "./ydoc";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function b(id: string, type: Block["type"], extra: Partial<Block> = {}): Block {
  return { id, type, ...extra };
}

/**
 * A paragraph exactly as the editor writes one: `attrs.runs` is authoritative
 * for the text (that's what `blockEditSource` reads) and `value` is its
 * text-only projection. Paragraph text merges per CHARACTER, so tests must edit
 * paragraphs through this helper rather than poking `.value` alone.
 */
function para(id: string, text: string): Block {
  return { ...paragraphFromSource(text, id) };
}

/** A doc with prose, a heading (attrs), and a nested fraction (slots). */
function sampleTree(): DocumentTree {
  return {
    schema: 1,
    mode: "flow",
    style: { fontSize: 16, fontFamily: "Computer Modern", background: "#fff" },
    blocks: [
      b("h1", "heading", { value: "Title", attrs: { level: 1, numbered: false } }),
      para("p1", "hello"),
      b("m1", "math", {
        slots: {
          body: [
            b("fr", "fraction", {
              slots: {
                num: [b("n1", "number", { value: "1" })],
                den: [b("d1", "identifier", { value: "x" })],
              },
            }),
          ],
        },
      }),
    ],
  };
}

/** Normalize for structural comparison (ignore key order, undefined). */
function norm(t: DocumentTree): unknown {
  return JSON.parse(JSON.stringify(t));
}

// ─── Round-trip ──────────────────────────────────────────────────────────────

describe("seedYDoc / yDocToTree round-trip", () => {
  it("preserves blocks, values, attrs, nested slots, mode and style", () => {
    const tree = sampleTree();
    const doc = seedYDoc(tree);
    expect(norm(yDocToTree(doc))).toEqual(norm(tree));
  });

  it("round-trips an empty document", () => {
    const tree: DocumentTree = { schema: 1, mode: "flow", blocks: [] };
    expect(norm(yDocToTree(seedYDoc(tree)))).toEqual(norm(tree));
  });
});

// ─── Structural diff ───────────────────────────────────────────────────────-

describe("applyTreeToYDoc", () => {
  it("is a no-op (emits no update) for an identical tree", () => {
    const doc = seedYDoc(sampleTree());
    let touched = false;
    doc.on("update", () => {
      touched = true;
    });
    applyTreeToYDoc(doc, sampleTree());
    expect(touched).toBe(false);
  });

  it("applies a value edit, a new block, and a reorder", () => {
    const doc = seedYDoc(sampleTree());
    const next = sampleTree();
    next.blocks[1] = para("p1", "goodbye"); // edit p1
    next.blocks.unshift(para("p0", "intro")); // insert at front
    // swap heading and math order
    const [, , math] = next.blocks; // after unshift: [p0, h1, p1, m1]
    void math;
    const reordered = [next.blocks[0], next.blocks[3], next.blocks[1], next.blocks[2]];
    next.blocks = reordered;
    applyTreeToYDoc(doc, next);
    expect(norm(yDocToTree(doc))).toEqual(norm(next));
  });

  it("prunes orphaned registry blocks when a container is removed", () => {
    const doc = seedYDoc(sampleTree());
    const next = sampleTree();
    next.blocks = next.blocks.filter((blk) => blk.id !== "m1"); // drop the math subtree
    applyTreeToYDoc(doc, next);
    const registry = doc.getMap("blocks");
    expect(registry.has("m1")).toBe(false);
    expect(registry.has("fr")).toBe(false); // nested children swept too
    expect(registry.has("n1")).toBe(false);
    expect(norm(yDocToTree(doc))).toEqual(norm(next));
  });

  it("edits a deeply nested slot child", () => {
    const doc = seedYDoc(sampleTree());
    const next = sampleTree();
    next.blocks[2].slots!.body[0].slots!.num[0].value = "42";
    applyTreeToYDoc(doc, next);
    expect(norm(yDocToTree(doc))).toEqual(norm(next));
  });
});

// ─── Concurrent merge (two-peer simulation) ──────────────────────────────────

/** Bidirectional full-state exchange — converges two docs. */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
}

describe("concurrent merge", () => {
  it("merges edits to DIFFERENT blocks (both survive)", () => {
    const a = seedYDoc(sampleTree());
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // b mirrors a

    const ta = sampleTree();
    ta.blocks[0].value = "A-edited-title"; // A edits heading
    applyTreeToYDoc(a, ta);

    const tb = sampleTree();
    tb.blocks[1] = para("p1", "B-edited-para"); // B edits paragraph
    applyTreeToYDoc(b, tb);

    sync(a, b);

    const ra = yDocToTree(a);
    const rb = yDocToTree(b);
    expect(norm(ra)).toEqual(norm(rb)); // converged
    expect(ra.blocks.find((x) => x.id === "h1")!.value).toBe("A-edited-title");
    expect(ra.blocks.find((x) => x.id === "p1")!.value).toBe("B-edited-para");
  });

  it("two INDEPENDENT seeds of the same tree merge without duplicating blocks", () => {
    // The real-world crash: two clients open a freshly-shared note (no persisted
    // ydoc) and both seed from `tree`. Under the canonical seed clientID the
    // items are identical, so the merge dedupes instead of concatenating.
    const tree = sampleTree();
    const seedAs = (live: number) => {
      const d = new Y.Doc();
      d.clientID = SEED_CLIENT_ID;
      seedYDoc(tree, d);
      d.clientID = live;
      return d;
    };
    const a = seedAs(111);
    const b = seedAs(222);
    sync(a, b);
    const ids = yDocToTree(a).blocks.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(norm(yDocToTree(a))).toEqual(norm(tree));
    expect(norm(yDocToTree(b))).toEqual(norm(tree));
  });

  it("yDocToTree dedupes a duplicated id in an order array", () => {
    const doc = seedYDoc(sampleTree());
    const order = doc.getArray<string>("rootOrder");
    order.push([order.toArray()[0]]); // force a duplicate id at the tail
    const ids = yDocToTree(doc).blocks.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("delete-vs-edit on the SAME block: deletion wins (block absent for both)", () => {
    const a = seedYDoc(sampleTree());
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const ta = sampleTree();
    ta.blocks = ta.blocks.filter((x) => x.id !== "p1"); // A deletes the paragraph
    applyTreeToYDoc(a, ta);

    const tb = sampleTree();
    tb.blocks[1] = para("p1", "B-still-typing"); // B edits the same paragraph
    applyTreeToYDoc(b, tb);

    sync(a, b);

    const ra = yDocToTree(a);
    const rb = yDocToTree(b);
    expect(norm(ra)).toEqual(norm(rb)); // converged
    expect(ra.blocks.some((x) => x.id === "p1")).toBe(false); // deletion wins
  });
});

// ─── Character-level merge inside ONE paragraph (the Google-Docs case) ───────

/** The text of paragraph `id` as materialized from `doc`. */
function textOf(doc: Y.Doc, id: string): string {
  return yDocToTree(doc).blocks.find((x) => x.id === id)!.value ?? "";
}
/** Type `text` into paragraph `id` at `at`, the way the editor commits a draft. */
function typeInto(doc: Y.Doc, id: string, at: number, text: string): void {
  const tree = yDocToTree(doc);
  const i = tree.blocks.findIndex((x) => x.id === id);
  const cur = tree.blocks[i].value ?? "";
  tree.blocks[i] = para(id, cur.slice(0, at) + text + cur.slice(at));
  applyTreeToYDoc(doc, tree);
}

describe("character-level merge within one paragraph", () => {
  /** Two peers mirroring the same seeded doc. */
  function pair(): [Y.Doc, Y.Doc] {
    const a = seedYDoc(sampleTree());
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    return [a, b];
  }

  it("keeps BOTH insertions when two people type in the same paragraph", () => {
    const [a, b] = pair();
    typeInto(a, "p1", 0, "A says "); // A types at the start…
    typeInto(b, "p1", 5, " world"); // …B at the end, concurrently
    sync(a, b);
    expect(textOf(a, "p1")).toBe(textOf(b, "p1")); // converged
    expect(textOf(a, "p1")).toContain("A says");
    expect(textOf(a, "p1")).toContain("world"); // neither edit was clobbered
    expect(textOf(a, "p1")).toContain("hello");
  });

  it("merges interleaved keystrokes typed one character at a time", () => {
    const [a, b] = pair();
    for (const ch of "abc") {
      typeInto(a, "p1", textOf(a, "p1").length, ch);
      sync(a, b);
    }
    for (const ch of "xyz") {
      typeInto(b, "p1", 0, ch);
      sync(a, b);
    }
    expect(textOf(a, "p1")).toBe(textOf(b, "p1"));
    expect(textOf(a, "p1")).toBe("zyxhelloabc");
  });

  it("a peer's concurrent deletion survives the other's insertion", () => {
    const [a, b] = pair();
    const tree = yDocToTree(a);
    tree.blocks[1] = para("p1", "hell"); // A backspaces the trailing "o"
    applyTreeToYDoc(a, tree);
    typeInto(b, "p1", 0, "Oh "); // B prepends, concurrently
    sync(a, b);
    expect(textOf(a, "p1")).toBe(textOf(b, "p1"));
    expect(textOf(a, "p1")).toBe("Oh hell");
  });

  it("only the typed characters go on the wire, not the whole paragraph", () => {
    const [a] = pair();
    let bytes = 0;
    a.on("update", (u: Uint8Array) => { bytes += u.length; });
    typeInto(a, "p1", 5, "!"); // one keystroke into "hello"
    // A whole-paragraph LWW replace would carry the full string plus its runs
    // blob; a character splice is a handful of bytes.
    expect(bytes).toBeLessThan(40);
  });

  it("inline math keeps stable run ids across materializations", () => {
    const [a] = pair();
    const tree = yDocToTree(a);
    tree.blocks[1] = para("p1", "see \\(x^2\\) here");
    applyTreeToYDoc(a, tree);
    const first = yDocToTree(a).blocks.find((x) => x.id === "p1")!;
    const second = yDocToTree(a).blocks.find((x) => x.id === "p1")!;
    expect(norm({ schema: 1, mode: "flow", blocks: [first] })).toEqual(
      norm({ schema: 1, mode: "flow", blocks: [second] }),
    );
  });

  it("preserves a callout color (LWW attrs) alongside a character edit", () => {
    const [a, b] = pair();
    const ta = yDocToTree(a);
    ta.blocks[1] = { ...para("p1", "hello"), attrs: { ...para("p1", "hello").attrs, color: "#f00" } };
    applyTreeToYDoc(a, ta);
    typeInto(b, "p1", 5, "!");
    sync(a, b);
    const merged = yDocToTree(a).blocks.find((x) => x.id === "p1")!;
    expect(merged.value).toBe("hello!");
    expect(merged.attrs?.color).toBe("#f00");
  });
});
