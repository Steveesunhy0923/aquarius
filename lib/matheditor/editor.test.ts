import { describe, expect, it } from "vitest";

import { blockToLatex } from "@/lib/blocks/serialize";
import { fraction as makeFraction, integral as makeIntegral, math } from "@/lib/blocks/factory";

import { type EditState } from "./model";
import { moveDown, moveLeft, moveRight, moveUp } from "./nav";
import { backspace, insertContainer, insertSnippet, typeChar } from "./ops";

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
