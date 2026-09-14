import { describe, expect, it } from "vitest";

import { makeHeading } from "./headings";
import { para } from "@/lib/templates/modules";
import {
  addShortcut,
  documentShortcuts,
  mergeShortcuts,
  moveShortcut,
  removeShortcut,
  renameShortcut,
  resolveShortcut,
  shortcutsFromBlocks,
  type SectionShortcut,
} from "./shortcuts";
import { emptyDocument } from "./types";

/** A "Notes" design: a title, then the sections it comes with. */
const notesDesign = () => [
  makeHeading(1, "Notes"),
  para("**Course:** Physics"),
  makeHeading(2, "Key concepts"),
  para("…"),
  makeHeading(2, "Worked example"),
  para("…"),
  makeHeading(2, "Open questions"),
];

describe("shortcutsFromBlocks", () => {
  it("takes the design's sections, in order", () => {
    expect(shortcutsFromBlocks(notesDesign()).map((s) => s.label)).toEqual([
      "Key concepts", "Worked example", "Open questions",
    ]);
  });

  it("skips the document title — a level-1 heading is not a section", () => {
    expect(shortcutsFromBlocks(notesDesign()).some((s) => s.label === "Notes")).toBe(false);
  });

  it("remembers the heading each one came from", () => {
    const blocks = notesDesign();
    const worked = shortcutsFromBlocks(blocks).find((s) => s.label === "Worked example")!;
    expect(worked.blockId).toBe(blocks.find((b) => b.value === "Worked example")!.id);
  });

  it("collapses repeats — a jump list wants one entry per destination", () => {
    const blocks = [makeHeading(2, "Solution"), makeHeading(2, "Solution"), makeHeading(2, "solution")];
    expect(shortcutsFromBlocks(blocks)).toHaveLength(1);
  });

  it("ignores blank headings and returns nothing for a blank note", () => {
    expect(shortcutsFromBlocks([makeHeading(2, "   "), para("x")])).toEqual([]);
    expect(shortcutsFromBlocks([])).toEqual([]);
  });
});

describe("resolveShortcut", () => {
  it("finds the section by the heading it was made from", () => {
    const blocks = notesDesign();
    const [first] = shortcutsFromBlocks(blocks);
    expect(resolveShortcut(blocks, first)?.value).toBe("Key concepts");
  });

  it("falls back to the name when that heading is gone — deleted and rewritten", () => {
    const blocks = notesDesign();
    const sc = shortcutsFromBlocks(blocks).find((s) => s.label === "Worked example")!;
    const rewritten = blocks.filter((b) => b.value !== "Worked example").concat(makeHeading(2, "worked example"));
    const found = resolveShortcut(rewritten, sc);
    expect(found?.value).toBe("worked example"); // matched case-insensitively
  });

  it("returns null when the note has no such section — the caller offers to add it", () => {
    const sc: SectionShortcut = { id: "s1", label: "Summary" };
    expect(resolveShortcut(notesDesign(), sc)).toBeNull();
  });
});

describe("editing the list", () => {
  const list = (): SectionShortcut[] => [
    { id: "a", label: "Key concepts" },
    { id: "b", label: "Worked example" },
    { id: "c", label: "Summary" },
  ];

  it("adds, ignoring blanks and names it already has", () => {
    expect(addShortcut(list(), "Practice").map((s) => s.label)).toEqual(["Key concepts", "Worked example", "Summary", "Practice"]);
    expect(addShortcut(list(), "  ")).toHaveLength(3);
    expect(addShortcut(list(), "summary")).toHaveLength(3);
  });

  it("removes by id", () => {
    expect(removeShortcut(list(), "b").map((s) => s.label)).toEqual(["Key concepts", "Summary"]);
  });

  it("renames, and drops the remembered heading (the name is what it means now)", () => {
    const withBlock: SectionShortcut[] = [{ id: "a", label: "Worked example", blockId: "blk1" }];
    const renamed = renameShortcut(withBlock, "a", "Worked examples");
    expect(renamed[0]).toEqual({ id: "a", label: "Worked examples" });
    expect(renameShortcut(withBlock, "a", "   ")).toBe(withBlock); // blank rejected
  });

  it("reorders by dropping one before another, or at the end", () => {
    expect(moveShortcut(list(), "c", "a").map((s) => s.label)).toEqual(["Summary", "Key concepts", "Worked example"]);
    expect(moveShortcut(list(), "a", null).map((s) => s.label)).toEqual(["Worked example", "Summary", "Key concepts"]);
    expect(moveShortcut(list(), "a", "a")).toEqual(list()); // onto itself: no change
  });

  it("merges a newly applied design into the list without duplicating names", () => {
    const incoming = shortcutsFromBlocks([makeHeading(2, "Summary"), makeHeading(2, "References")]);
    expect(mergeShortcuts(list(), incoming).map((s) => s.label)).toEqual([
      "Key concepts", "Worked example", "Summary", "References",
    ]);
  });
});

describe("documentShortcuts", () => {
  it("is empty for a note that never had a design", () => {
    expect(documentShortcuts(emptyDocument())).toEqual([]);
    expect(documentShortcuts(null)).toEqual([]);
  });

  it("reads a stamped tree back, dropping malformed entries", () => {
    const tree = { ...emptyDocument(), shortcuts: [{ id: "a", label: "Key concepts" }, { id: 4 }, null] as never };
    expect(documentShortcuts(tree).map((s) => s.label)).toEqual(["Key concepts"]);
  });
});
