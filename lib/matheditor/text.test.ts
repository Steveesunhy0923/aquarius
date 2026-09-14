import { describe, expect, it } from "vitest";
import { math } from "@/lib/blocks/factory";
import { blockToLatex } from "@/lib/blocks/serialize";
import { type EditState } from "./model";
import { backspace, initialCursor, inTextRun, typeChar, typeText } from "./ops";

const start = (): EditState => {
  const tree = math();
  return { tree, cursor: initialCursor(tree) };
};
const typeMath = (s: EditState, str: string): EditState => [...str].reduce((acc, ch) => typeChar(acc.tree, acc.cursor, ch), s);
const typeWords = (s: EditState, str: string): EditState => [...str].reduce((acc, ch) => typeText(acc.tree, acc.cursor, ch), s);

describe("words inside a structural formula", () => {
  it("serializes a run of words as one \\text{…}, spaces kept", () => {
    let s = typeMath(start(), "x");
    s = typeWords(s, " if ");
    s = typeMath(s, "y");
    expect(blockToLatex(s.tree)).toContain("x\\text{ if }y");
  });

  it("keeps maths typed after the words as maths", () => {
    let s = typeWords(start(), "for all ");
    s = typeMath(s, "x");
    expect(blockToLatex(s.tree)).toContain("\\text{for all }x");
  });

  it("knows when the caret is inside a run of words", () => {
    const s = typeWords(start(), "ab");
    expect(inTextRun(s.tree, { ...s.cursor, index: 1 })).toBe(true);
    expect(inTextRun(s.tree, s.cursor)).toBe(false); // at the end of the run
  });

  it("deletes words one character at a time", () => {
    let s = typeWords(start(), "if");
    s = backspace(s.tree, s.cursor);
    expect(blockToLatex(s.tree)).toContain("\\text{i}");
  });

  it("escapes LaTeX specials inside the words", () => {
    const s = typeWords(start(), "a_b");
    expect(blockToLatex(s.tree)).not.toContain("\\text{a_b}");
  });
});
