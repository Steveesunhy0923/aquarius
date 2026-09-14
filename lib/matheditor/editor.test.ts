import { describe, expect, it } from "vitest";

import { blockToLatex } from "@/lib/blocks/serialize";
import { fraction as makeFraction, integral as makeIntegral, math } from "@/lib/blocks/factory";

import { type EditState } from "./model";
import { moveDown, moveLeft, moveRight, moveUp } from "./nav";
import { addGridRow, backspace, initialCursor, insertContainer, insertSnippet, removeGridRow, typeChar } from "./ops";

/** Fresh editor: an empty math block with the caret in its body. */
function start(): EditState {
  const tree = math();
  return { tree, cursor: { rowOwnerId: tree.id, slot: "body", index: 0 } };
}
function type(s: EditState, str: string): EditState {
  return [...str].reduce((acc, ch) => typeChar(acc.tree, acc.cursor, ch), s);
}
const insertInt = (s: EditState) => insertContainer(s.tree, s.cursor, () => makeIntegral());
const insertFrac = (s: EditState) => insertContainer(s.tree, s.cursor, () => makeFraction());
const latex = (s: EditState) => blockToLatex(s.tree);

describe("integral bound navigation (the headline)", () => {
  it("inserts with the caret in the LOWER bound", () => {
    const s = insertInt(start());
    expect(s.cursor.slot).toBe("lower");
    expect(s.cursor.index).toBe(0);
  });

  it("Up moves lower→upper, Down moves upper→lower", () => {
    const s = insertInt(start());
    const up = moveUp(s.tree, s.cursor);
    expect(up.slot).toBe("upper");
    expect(moveDown(s.tree, up).slot).toBe("lower");
  });

  it("Right moves upper→lower, Left moves lower→upper (both directions work)", () => {
    const s = insertInt(start()); // caret in lower
    const upper = moveLeft(s.tree, s.cursor); // lower → upper (also what Shift+Tab does)
    expect(upper.slot).toBe("upper");
    expect(moveRight(s.tree, upper).slot).toBe("lower"); // upper → lower (also what Tab does)
  });

  it("Right from the lower bound continues into the integrand", () => {
    const s = insertInt(start()); // caret in lower
    expect(moveRight(s.tree, s.cursor).slot).toBe("integrand");
  });

  it("fills lower then (via Up) upper → \\int_{1}^{2}", () => {
    let s = insertInt(start());
    s = typeChar(s.tree, s.cursor, "1"); // lower = 1
    const up = moveUp(s.tree, s.cursor);
    s = typeChar(s.tree, up, "2"); // upper = 2
    expect(latex(s)).toContain("\\int_{1}^{2}");
  });
});

describe("fraction navigation", () => {
  it("inserts with the caret in the numerator; Down→den, Up→num", () => {
    const s = insertFrac(start());
    expect(s.cursor.slot).toBe("num");
    const den = moveDown(s.tree, s.cursor);
    expect(den.slot).toBe("den");
    expect(moveUp(s.tree, den).slot).toBe("num");
  });

  it("typing a/b wraps the preceding atom as numerator → \\frac{a}{b}", () => {
    let s = type(start(), "a"); // body: a
    s = typeChar(s.tree, s.cursor, "/"); // wraps a as numerator, caret in den
    s = typeChar(s.tree, s.cursor, "b"); // den = b
    expect(latex(s)).toBe("\\frac{a}{b}");
  });

  it("Right from the numerator end exits the fraction (den reached via Down)", () => {
    let s = insertFrac(start());
    s = typeChar(s.tree, s.cursor, "x"); // num = x, caret at num end
    const out = moveRight(s.tree, s.cursor);
    expect(out.slot).toBe("body"); // exited the fraction into the math body
  });
});

describe("typing, scripts, and serialization", () => {
  it("classifies digits/letters/operators", () => {
    expect(latex(type(start(), "2x+1"))).toBe("2x+1");
  });

  it("^ wraps the preceding atom as a superscript base", () => {
    let s = type(start(), "x");
    s = typeChar(s.tree, s.cursor, "^"); // wrap x into a script, caret in sup
    s = typeChar(s.tree, s.cursor, "2"); // sup = 2
    expect(latex(s)).toBe("x^{2}");
  });

  it("insertSnippet maps structures and falls back to a symbol atom", () => {
    const s = start();
    const i = insertSnippet(s.tree, s.cursor, "\\int_{}^{}");
    expect(i.cursor.slot).toBe("lower"); // structural integral, caret in lower
    const s2 = start();
    expect(latex(insertSnippet(s2.tree, s2.cursor, "\\alpha"))).toBe("\\alpha");
  });

  it("builds a real matrix block from an environment template, caret in r0c0", () => {
    const s = start();
    const m = insertSnippet(s.tree, s.cursor, "\\begin{bmatrix}\\end{bmatrix}");
    expect(m.cursor.slot).toBe("r0c0"); // typing lands in the first cell
    const block = m.tree.slots?.body?.[0];
    expect(block?.type).toBe("matrix");
    expect(block?.attrs?.env).toBe("bmatrix");
    expect(block?.attrs?.rows).toBe(2);
    expect(block?.attrs?.cols).toBe(2);
  });

  it("fills the cells of an environment it has no block for", () => {
    // \begin{aligned} is not a `matrix` env, so it stays an opaque atom — but an
    // EMPTY one renders as nothing at all, which is the bug being fixed.
    const s = start();
    expect(latex(insertSnippet(s.tree, s.cursor, "\\begin{aligned}\\end{aligned}"))).toBe(
      "\\begin{aligned} & \\\\ & \\end{aligned}",
    );
  });
});

describe("growing a grid (a `cases` system of equations)", () => {
  /** A fresh 2×2 `cases`, caret in its first cell. */
  const cases = () => {
    const s = start();
    return insertSnippet(s.tree, s.cursor, "\\begin{cases}\\end{cases}");
  };

  it("Enter adds a case below, caret into its first cell", () => {
    let s = cases();
    s = type(s, "x");
    s = addGridRow(s.tree, s.cursor);
    expect(s.cursor.slot).toBe("r1c0");
    const grid = s.tree.slots?.body?.[0];
    expect(grid?.attrs?.rows).toBe(3);
    expect(grid?.attrs?.cols).toBe(2);
    expect(latex(s)).toBe("\\begin{cases} x &  \\\\  &  \\\\  &  \\end{cases}");
  });

  it("adds the row after the caret's row, keeping the rows in order", () => {
    let s = cases();
    s = type(s, "a"); // r0c0
    s = { tree: s.tree, cursor: { ...s.cursor, slot: "r1c0", index: 0 } };
    s = type(s, "b"); // r1c0
    s = { tree: s.tree, cursor: { ...s.cursor, slot: "r0c0", index: 1 } };
    s = addGridRow(s.tree, s.cursor); // new row between a and b
    expect(latex(s)).toBe("\\begin{cases} a &  \\\\  &  \\\\ b &  \\end{cases}");
  });

  it("⇧Enter removes the caret's case but never the last one", () => {
    let s = cases();
    s = type(s, "a");
    s = removeGridRow(s.tree, s.cursor);
    expect((s.tree.slots?.body?.[0])?.attrs?.rows).toBe(1);
    const only = removeGridRow(s.tree, s.cursor); // the last row stays
    expect((only.tree.slots?.body?.[0])?.attrs?.rows).toBe(1);
    expect(only.tree).toBe(s.tree); // untouched, not rebuilt
  });

  it("leaves the formula alone when the caret is not in a grid", () => {
    const s = type(start(), "x");
    expect(addGridRow(s.tree, s.cursor).tree).toBe(s.tree);
    expect(removeGridRow(s.tree, s.cursor).tree).toBe(s.tree);
  });
});

describe("initialCursor", () => {
  it("opens inside the first cell of a template, not before it", () => {
    // The bug: a formula created from a `cases` template opened with the caret
    // in `body`, so the first thing typed landed beside the brace.
    const tree = insertSnippet(math(), { rowOwnerId: "", slot: "body", index: 0 }, "x").tree;
    expect(initialCursor(tree).slot).toBe("body");

    const m = math();
    const withCases = insertSnippet(m, { rowOwnerId: m.id, slot: "body", index: 0 }, "\\begin{cases}\\end{cases}").tree;
    const c = initialCursor(withCases);
    expect(c.slot).toBe("r0c0");
    expect(c.rowOwnerId).toBe(withCases.slots?.body?.[0]?.id);
  });

  it("falls back to the end of the body when nothing is empty", () => {
    const s = type(start(), "abc");
    const c = initialCursor(s.tree);
    expect(c.slot).toBe("body");
    expect(c.index).toBe(3);
  });
});

describe("backspace", () => {
  it("deletes the leaf to the left", () => {
    let s = type(start(), "ab");
    s = backspace(s.tree, s.cursor);
    expect(latex(s)).toBe("a");
    expect(s.cursor.index).toBe(1);
  });

  it("at the start of an empty slot, removes the empty container", () => {
    const ins = insertFrac(start());
    const s = backspace(ins.tree, ins.cursor); // caret at start of empty num
    expect(latex(s)).toBe(""); // fraction removed
    expect(s.cursor.slot).toBe("body");
  });
});
