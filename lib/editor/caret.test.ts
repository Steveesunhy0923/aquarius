import { describe, expect, it } from "vitest";
import { sourceOffsetFor } from "./caret";

describe("sourceOffsetFor", () => {
  it("is the identity for prose with no markup", () => {
    const s = "The quick brown fox";
    for (const i of [0, 4, 10, s.length]) expect(sourceOffsetFor(s, s, i)).toBe(i);
  });

  it("skips the markers that never render", () => {
    const src = "a **bold** word";
    const rendered = "a bold word";
    // Clicking just before "word" (rendered 7) is just before "word" in source.
    expect(src.slice(sourceOffsetFor(src, rendered, 7))).toBe("word");
    // At the left edge of a bold word the caret sits OUTSIDE its markers, so
    // typing there is unbolded — the same choice every editor makes at a
    // formatting boundary.
    expect(src.slice(sourceOffsetFor(src, rendered, 2))).toBe("**bold** word");
    // One character in, it is inside the bold text.
    expect(src.slice(sourceOffsetFor(src, rendered, 3))).toBe("old** word");
  });

  it("lands inside a formula's source when the formula is clicked", () => {
    const src = "before $x^2$ after";
    const rendered = "before x2 after"; // KaTeX renders the maths, not the source
    const at = sourceOffsetFor(src, rendered, 8); // one character into the maths
    expect(at).toBeGreaterThan(src.indexOf("$"));
    expect(at).toBeLessThanOrEqual(src.indexOf("$", 8) + 1);
  });

  it("clamps to the ends instead of running off them", () => {
    expect(sourceOffsetFor("abc", "abc", -5)).toBe(0);
    expect(sourceOffsetFor("abc", "abc", 99)).toBe(3);
    expect(sourceOffsetFor("", "", 0)).toBe(0);
  });

  it("puts the caret at the end when the rendering has run out", () => {
    // Trailing source-only characters (an unclosed marker) still resolve.
    expect(sourceOffsetFor("hi **", "hi ", 3)).toBe(3);
  });
});
