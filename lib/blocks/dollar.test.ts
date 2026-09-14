import { describe, expect, it } from "vitest";
import { blocksFromSource, displayMathSource, inlineMathSpans, runsFromSource, runsToSource } from "./source";
import { blockToKatex } from "./index";

const latexOf = (src: string) => inlineMathSpans(src).map((s) => s.latex);

describe("$…$ inline maths", () => {
  it("reads a formula written between dollars", () => {
    expect(latexOf("energy is $E = mc^2$ exactly")).toEqual(["E = mc^2"]);
    const runs = runsFromSource("a $x^2$ b");
    expect(runs.map((r) => r.kind)).toEqual(["text", "math", "text"]);
    const math = runs[1];
    expect(math.kind === "math" && blockToKatex(math.block)).toBe("x^2");
  });

  it("still reads the legacy \\(…\\) delimiter, and both together", () => {
    expect(latexOf("old \\(a+b\\) style")).toEqual(["a+b"]);
    expect(latexOf("$x$ and \\(y\\)")).toEqual(["x", "y"]);
  });

  it("leaves prose about money alone", () => {
    for (const src of ["it costs $5, not $10", "$5 and $10", "pay $20 today", "a $ b $ c"]) {
      expect(latexOf(src), src).toEqual([]);
    }
  });

  it("treats \\$ as a literal dollar sign", () => {
    expect(latexOf("\\$5 to \\$9")).toEqual([]);
    // An escaped dollar inside maths stays part of the maths.
    expect(latexOf("$a \\$ b$")).toEqual(["a \\$ b"]);
  });

  it("never spans a line break or an empty pair", () => {
    expect(latexOf("open $x\nand y$ close")).toEqual([]);
    expect(latexOf("$$")).toEqual([]);
    expect(latexOf("nothing $$ here")).toEqual([]);
  });

  it("writes the new convention back out", () => {
    expect(runsToSource(runsFromSource("a $x^2$ b"))).toBe("a $x^2$ b");
    // A note written with the old delimiter comes back in the new one.
    expect(runsToSource(runsFromSource("a \\(x^2\\) b"))).toBe("a $x^2$ b");
  });
});

describe("$$…$$ display equations", () => {
  it("recognises a paragraph that is nothing but an equation", () => {
    expect(displayMathSource("$$E = mc^2$$")).toBe("E = mc^2");
    expect(displayMathSource("  $$ \\int_0^1 f $$  ")).toBe("\\int_0^1 f");
  });

  it("is not fooled by inline maths or prose around it", () => {
    for (const src of ["$x$", "text $$x$$ more", "$$", "$$$$", "$$ $$", "$$a$$ and $$b$$"]) {
      expect(displayMathSource(src), src).toBeNull();
    }
  });

  it("becomes a display block when a payload is split into blocks", () => {
    const blocks = blocksFromSource("Before.\n\n$$a^2 + b^2 = c^2$$\n\nAfter.");
    expect(blocks.map((b) => b.type)).toEqual(["text", "math", "text"]);
    expect(blockToKatex(blocks[1])).toBe("a^2 + b^2 = c^2");
  });

  it("keeps `$…$` inline instead of promoting it to a block", () => {
    const blocks = blocksFromSource("$x + 1$");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
  });
});
