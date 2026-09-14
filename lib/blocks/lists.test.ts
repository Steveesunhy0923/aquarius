import { describe, expect, it } from "vitest";
import { isEmptyBlock } from "./empty";
import { listItems, listMarker, listOrdered, makeList, withList } from "./lists";
import { blockToLatex } from "./serialize";

describe("makeList", () => {
  it("starts empty — one item, nothing typed in it", () => {
    expect(listItems(makeList(false))).toEqual([""]);
    expect(listItems(makeList(true))).toEqual([""]);
  });

  it("counts as an empty block, so an abandoned list is cleaned up", () => {
    expect(isEmptyBlock(makeList(false))).toBe(true);
    expect(isEmptyBlock(withList(makeList(false), ["milk"]))).toBe(false);
  });

  it("still carries its kind and marker", () => {
    expect(listOrdered(makeList(true))).toBe(true);
    expect(listMarker(makeList(false, "square"))).toBe("square");
    expect(listMarker(makeList(true))).toBe("decimal");
  });

  it("exports nothing for the empty item — no stray \\item in the .tex", () => {
    expect(blockToLatex(makeList(false))).toBe("\\begin{itemize}\n\n\\end{itemize}");
    expect(blockToLatex(withList(makeList(false), ["milk", ""]))).toBe(
      "\\begin{itemize}\n  \\item milk\n\\end{itemize}",
    );
  });
});

describe("maths in a list item", () => {
  const tex = (items: string[]): string => blockToLatex(withList(makeList(false), items));

  it("exports an inline formula as maths, not as escaped prose", () => {
    // A list item is stored as one SOURCE string (no `attrs.runs`), so the
    // serializer has to split it itself — it used to hand the whole item to the
    // prose escaper, which shipped \$E = mc\textasciicircum{}2\$.
    expect(tex(["energy is $E = mc^2$"])).toContain("\\item energy is \\(E = mc^2\\)");
  });

  it("keeps prose either side of the formula, and its formatting", () => {
    expect(tex(["**mass** $m$ times $c^2$"])).toContain(
      "\\item \\textbf{mass} \\(m\\) times \\(c^2\\)",
    );
  });

  it("leaves an item with no maths exactly as it was", () => {
    expect(tex(["plain bullet, 100% of it"])).toContain("\\item plain bullet, 100\\% of it");
  });
});
