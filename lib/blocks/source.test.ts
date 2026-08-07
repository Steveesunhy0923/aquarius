import { describe, expect, it } from "vitest";

import { isChemBlock } from "./chem";
import { documentToLatex } from "./serialize";
import {
  blockEditSource,
  blocksFromSource,
  inlineMathSpans,
  replaceInlineMathSpan,
  runsFromSource,
  runsToSource,
} from "./source";
import { emptyDocument } from "./types";

const SRC = "before \\(a+b\\) middle \\(\\frac{1}{2}\\) after";

/** The run kinds a source string parses into — the grammar in one line. */
const kinds = (src: string) => runsFromSource(src).map((r) => r.kind);

describe("inline-math span helpers", () => {
  it("enumerates spans 1:1 with runsFromSource math runs", () => {
    const spans = inlineMathSpans(SRC);
    const mathRuns = runsFromSource(SRC).filter((r) => r.kind === "math");
    expect(spans.map((s) => s.latex)).toEqual(["a+b", "\\frac{1}{2}"]);
    expect(spans.length).toBe(mathRuns.length);
  });

  it("replaces the nth span and keeps the source re-parseable", () => {
    const next = replaceInlineMathSpan(SRC, 1, "\\sqrt{2}");
    expect(next).toBe("before \\(a+b\\) middle \\(\\sqrt{2}\\) after");
    // The edit survives the round-trip the editor uses on every keystroke.
    const spans = inlineMathSpans(next);
    expect(spans.map((s) => s.latex)).toEqual(["a+b", "\\sqrt{2}"]);
  });

  it("removes a span entirely when the new latex is empty", () => {
    const next = replaceInlineMathSpan(SRC, 0, "   ");
    expect(next).toBe("before  middle \\(\\frac{1}{2}\\) after");
    expect(inlineMathSpans(next).map((s) => s.latex)).toEqual(["\\frac{1}{2}"]);
  });

  it("is a no-op for an out-of-range index", () => {
    expect(replaceInlineMathSpan(SRC, 5, "x")).toBe(SRC);
  });
});

describe("runsToSource ∘ runsFromSource is the identity", () => {
  // A recognizer emits this grammar; every hop through the editor re-parses and
  // re-prints it, so any loss here is silent corruption of the user's note.
  const MIXED = "LET \\(\\nabla I=(I_{x},I_{y})\\)\nBE TRUE\n\nso \\(x^{2}+1\\) holds";

  it("survives mixed multi-line source verbatim", () => {
    expect(runsToSource(runsFromSource(MIXED))).toBe(MIXED);
    expect(kinds(MIXED)).toEqual(["text", "math", "text", "math", "text"]);
  });

  it("survives the edge shapes (empty, math-only, adjacent spans, unclosed)", () => {
    for (const s of [
      "",
      "   ",
      "\\(x\\)",
      "\\(a\\)\\(b\\)",
      "\\(\\)", // empty formula
      "a \\( b", // unclosed delimiter stays literal prose
      "\\(a\n b\\)", // a span may cross a newline ([\s\S] in INLINE_MATH)
      "100% \\& $ffff", // characters that only get escaped at export time
    ]) {
      expect(runsToSource(runsFromSource(s))).toBe(s);
    }
  });
});

describe("blocksFromSource", () => {
  it("keeps prose with inline math as ONE paragraph block", () => {
    const blocks = blocksFromSource("let \\(x^{2}\\) be");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].value).toBe("let  be"); // prose-only projection
    expect(kinds(blockEditSource(blocks[0]))).toEqual(["text", "math", "text"]);
  });

  it("treats a single newline as a line break, a blank line as a block break", () => {
    // whitespace-pre-wrap renders the \n; only a blank line means "new block".
    const one = blocksFromSource("a\nb");
    expect(one).toHaveLength(1);
    expect(one[0].value).toBe("a\nb");

    const two = blocksFromSource("a\n\nb");
    expect(two).toHaveLength(2);
    expect(two.map((b) => b.value)).toEqual(["a", "b"]);

    // Any run of blank lines is one break, and CRLF is normalized first.
    expect(blocksFromSource("a\n\n\n\nb")).toHaveLength(2);
    expect(blocksFromSource("a\r\n\r\nb").map((b) => b.value)).toEqual(["a", "b"]);
    // A whitespace-only line is NOT a break — the gap is content, kept in-block.
    expect(blocksFromSource("a\n \nb")).toHaveLength(1);
  });

  it("promotes a chunk that is nothing but one \\(…\\) span to a display formula", () => {
    const blocks = blocksFromSource("\\(\\frac{a}{b}\\)");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("math");
    expect(blockEditSource(blocks[0])).toBe("\\frac{a}{b}");
    // Surrounding whitespace/newlines don't stop the promotion.
    expect(blocksFromSource("  \\(x^{2}\\)  ")[0].type).toBe("math");
  });

  it("leaves a chunk with anything besides that one span a paragraph", () => {
    // One stray word, two spans, or a trailing period each keep it inline.
    expect(blocksFromSource("so \\(x\\)")[0].type).toBe("text");
    expect(blocksFromSource("\\(a\\)\\(b\\)")[0].type).toBe("text");
    expect(blocksFromSource("\\(a\\).")[0].type).toBe("text");
  });

  it("tags a lone pure-\\ce formula as chemistry (identity is stored, not sniffed)", () => {
    const blocks = blocksFromSource("\\(\\ce{2H2 + O2 -> 2H2O}\\)");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.kind).toBe("chem");
    expect(isChemBlock(blocks[0])).toBe(true);
    // Math that merely CONTAINS \ce is not a chemistry block (ceInner is exact).
    expect(blocksFromSource("\\(K=\\frac{[\\ce{H+}]}{c}\\)")[0].attrs?.kind).toBeUndefined();
    // Inline \ce inside prose needs no tag — EditBox re-detects it per span.
    expect(blocksFromSource("water is \\(\\ce{H2O}\\)")[0].attrs?.kind).toBeUndefined();
  });

  it("returns no blocks for empty or whitespace-only input", () => {
    // An insert that recognized nothing must not push a blank paragraph.
    expect(blocksFromSource("")).toEqual([]);
    expect(blocksFromSource("   \n\n  \n ")).toEqual([]);
  });

  it("splits a whole page into paragraphs and display equations, with unique ids", () => {
    const page = "Let \\(f\\) be smooth.\nThen:\n\n\\(\\nabla f=0\\)\n\nat every extremum.";
    const blocks = blocksFromSource(page);
    expect(blocks.map((b) => b.type)).toEqual(["text", "math", "text"]);
    expect(blocks[0].value).toBe("Let  be smooth.\nThen:");
    expect(new Set(blocks.map((b) => b.id)).size).toBe(3);
  });

  it("round-trips through the editable source of each block it built", () => {
    // The inverse is per-block, and it is NOT uniformly blockEditSource: a
    // paragraph is edited in this grammar, a display formula is edited as bare
    // LaTeX, so re-assembling a payload has to re-wrap the formulas.
    const page = "LET \\(\\nabla I=(I_{x},I_{y})\\) BE TRUE\n\n\\(x^{2}+1\\)\n\ndone";
    const back = blocksFromSource(page)
      .map((b) => (b.type === "text" ? blockEditSource(b) : `\\(${blockEditSource(b)}\\)`))
      .join("\n\n");
    expect(back).toBe(page);
  });

  it("exports promoted formulas as display math and inline ones inline", () => {
    // This is what the promotion buys: a centred display equation, versus the
    // same LaTeX staying in-sentence when it shared a line with prose.
    const display = documentToLatex({
      ...emptyDocument(),
      blocks: blocksFromSource("\\(E=mc^{2}\\)"),
    });
    expect(display).toBe("$$ E=mc^{2} $$");

    const inline = documentToLatex({
      ...emptyDocument(),
      blocks: blocksFromSource("so \\(E=mc^{2}\\)"),
    });
    expect(inline).toBe("so \\(E=mc^{2}\\)");
  });
});
