import { describe, expect, it } from "vitest";
import { itemSource, listLevels, listRows, listTrigger, makeList, normalizeLevels, withList } from "./lists";
import { blockToLatex } from "./serialize";

const bullets = (items: string[], levels?: number[]) => withList(makeList(false), items, undefined, levels);
const numbered = (items: string[], levels?: number[]) => withList(makeList(true), items, undefined, levels);

describe("list nesting (Google Docs model)", () => {
  it("clamps levels into an outline: first item at the top, one step at a time", () => {
    expect(normalizeLevels([2, 3, 1, 9], 4)).toEqual([0, 1, 1, 2]);
    expect(normalizeLevels([], 3)).toEqual([0, 0, 0]);
    expect(normalizeLevels([1, "x", null], 3)).toEqual([0, 0, 0]);
    expect(normalizeLevels([0, 1, 2, 3, 4], 5)).toEqual([0, 1, 2, 3, 3]); // LaTeX stops at four deep
  });

  it("a flat list stores no levels at all", () => {
    expect(bullets(["a", "b"], [0, 0]).attrs?.levels).toBeUndefined();
    expect(listLevels(bullets(["a", "b"]))).toEqual([0, 0]);
  });

  it("keeps the nesting when the items stay put, and drops it when they are reshaped", () => {
    const nested = bullets(["a", "b"], [0, 1]);
    expect(listLevels(withList(nested, ["a", "b"], true))).toEqual([0, 1]); // bulleted → numbered
    expect(listLevels(withList(nested, ["a", "b", "c"]))).toEqual([0, 0, 0]);
  });

  it("cycles the marker per level and restarts numbering under each parent", () => {
    const rows = listRows(numbered(["one", "sub a", "sub b", "two", "sub a"], [0, 1, 1, 0, 1]));
    expect(rows.map((r) => r.marker)).toEqual(["1.", "a.", "b.", "2.", "a."]);
    expect(listRows(bullets(["x", "y", "z"], [0, 1, 2])).map((r) => r.marker)).toEqual(["•", "◦", "▪"]);
  });

  it("the read view skips blank items but keeps their indices", () => {
    const rows = listRows(bullets(["a", "", "c"]), true);
    expect(rows.map((r) => r.index)).toEqual([0, 2]);
  });

  it("exports nested itemize with the on-screen markers", () => {
    expect(blockToLatex(bullets(["a", "b", "c"], [0, 1, 0]))).toBe(
      [
        "\\begin{itemize}",
        "  \\item a",
        "  \\begin{itemize}[label=$\\circ$]",
        "    \\item b",
        "  \\end{itemize}",
        "  \\item c",
        "\\end{itemize}",
      ].join("\n"),
    );
  });

  it("closes every nested list at the end, and never nests before an item", () => {
    const tex = blockToLatex(numbered(["", "b", "c"], [0, 1, 2]));
    // The blank first item is skipped, so "b" has no parent to hang off.
    expect(tex).toBe(
      [
        "\\begin{enumerate}",
        "  \\item b",
        "  \\begin{enumerate}[label=\\alph*.]",
        "    \\item c",
        "  \\end{enumerate}",
        "\\end{enumerate}",
      ].join("\n"),
    );
  });
});

describe("an equation in a list item", () => {
  it("reads $$…$$ as display-style maths beside the bullet", () => {
    expect(itemSource("so $$E = mc^2$$ holds")).toBe("so $\\displaystyle E = mc^2$ holds");
    expect(itemSource("no maths")).toBe("no maths");
    expect(blockToLatex(bullets(["so $$x$$"]))).toContain("\\item so \\(\\displaystyle x\\)");
  });
});

describe("list autoformat (typing a bullet in front of a line)", () => {
  it("turns a leading '- ', '* ' or '• ' into a bullet holding the rest of the line", () => {
    expect(listTrigger("- existing line", 2)).toEqual({ ordered: false, rest: "existing line" });
    expect(listTrigger("* x", 2)).toEqual({ ordered: false, rest: "x" });
    expect(listTrigger("\u2022 ", 2)).toEqual({ ordered: false, rest: "" });
  });

  it("turns a leading '1. ' or '1) ' into a numbered item", () => {
    expect(listTrigger("1. first", 3)).toEqual({ ordered: true, rest: "first" });
    expect(listTrigger("1) first", 3)).toEqual({ ordered: true, rest: "first" });
  });

  it("ignores triggers that are not at the start, or not where the caret is", () => {
    expect(listTrigger("a - b", 4)).toBeNull();
    expect(listTrigger("-1 is negative", 2)).toBeNull();
    expect(listTrigger("- x", 1)).toBeNull();
    expect(listTrigger("2. second", 3)).toBeNull();
    expect(listTrigger("-  x", 3)).toBeNull();
  });
});
