import { describe, expect, it } from "vitest";
import {
  boxCssVars,
  boxEdges,
  boxFrameColor,
  boxOf,
  boxRun,
  boxTitleInk,
  extendBoxRun,
  newBox,
  renewBoxIds,
  restyleBoxRun,
  withBox,
} from "./boxes";
import { documentToLatex } from "./serialize";
import { displayFromSource, paragraphFromSource } from "./source";
import { emptyDocument, type Block } from "./types";

const doc = (blocks: Block[]) => ({ ...emptyDocument(), blocks });

describe("coloured boxes (tcolorbox)", () => {
  it("is an attribute every block of the box carries", () => {
    const box = newBox("#2563EB", "Definition");
    const p = withBox(paragraphFromSource("a"), box);
    expect(boxOf(p)).toEqual({ id: box.id, color: "#2563eb", title: "Definition" });
    expect(withBox(p, boxOf(p))).toBe(p); // nothing to change → same block
    expect(withBox(p, null).attrs?.box).toBeUndefined();
    const plain = paragraphFromSource("b");
    expect(withBox(plain, null)).toBe(plain);
    expect(boxOf({ ...plain, attrs: { box: { id: "x", color: "blue" } } })).toBeNull();
    expect(newBox("#2563eb", "").title).toBeUndefined();
  });

  it("is the run of adjacent blocks sharing an id, and only that run", () => {
    const a = newBox("#2563eb");
    const c = newBox("#dc2626");
    const bs = [
      paragraphFromSource("out"),
      withBox(paragraphFromSource("1"), a),
      withBox(displayFromSource("x"), a),
      withBox(paragraphFromSource("2"), c),
      paragraphFromSource("out"),
    ];
    expect(boxRun(bs, 0)).toBeNull();
    expect(boxRun(bs, 2)).toEqual([1, 2]);
    expect(boxRun(bs, 3)).toEqual([3, 3]);
    const edges = boxEdges(bs);
    expect(edges.has(bs[0].id)).toBe(false);
    expect(edges.get(bs[1].id)).toMatchObject({ start: true, end: false });
    expect(edges.get(bs[2].id)).toMatchObject({ start: false, end: true });
    expect(edges.get(bs[3].id)).toMatchObject({ box: { color: "#dc2626" }, start: true, end: true });
  });

  it("restyles, grows and removes one box as a whole", () => {
    const a = newBox("#2563eb");
    const bs = [withBox(paragraphFromSource("1"), a), withBox(paragraphFromSource("2"), a), paragraphFromSource("3")];
    const red = restyleBoxRun(bs, bs[1].id, { color: "#dc2626", title: "Note" });
    expect(red.slice(0, 2).map(boxOf)).toEqual([
      { id: a.id, color: "#dc2626", title: "Note" },
      { id: a.id, color: "#dc2626", title: "Note" },
    ]);
    expect(red[2]).toBe(bs[2]);
    expect(boxOf(restyleBoxRun(red, bs[0].id, { title: "" })[1])?.title).toBeUndefined();
    const grown = extendBoxRun(bs, bs[0].id);
    expect(boxRun(grown, 0)).toEqual([0, 2]);
    expect(extendBoxRun(grown, grown[0].id)).toBe(grown); // nothing below to take in
    expect(restyleBoxRun(bs, bs[0].id, null).every((b) => boxOf(b) === null)).toBe(true);
  });

  it("gives a copied fragment boxes of its own, still whole", () => {
    const a = newBox("#2563eb", "Note");
    const bs = [withBox(paragraphFromSource("1"), a), withBox(paragraphFromSource("2"), a), paragraphFromSource("3")];
    const copy = renewBoxIds(bs);
    expect(boxOf(copy[0])?.id).not.toBe(a.id);
    expect(boxRun(copy, 0)).toEqual([0, 1]);
    expect(boxOf(copy[1])).toMatchObject({ color: "#2563eb", title: "Note" });
    expect(copy[2]).toBe(bs[2]);
  });

  it("darkens the frame and picks title ink as tcolorbox does", () => {
    expect(boxFrameColor("#2563eb")).toBe("#1e4fbc"); // blue!80!black
    expect(boxTitleInk("#2563eb")).toBe("#ffffff");
    expect(boxTitleInk("#fde047")).toBe("#1f2937"); // a yellow frame is too light for white
    expect(boxCssVars(newBox("#2563eb"))).toEqual({
      "--box-color": "#2563eb",
      "--box-frame": "#1e4fbc",
      "--box-title-ink": "#ffffff",
    });
  });

  it("exports a run as ONE tcolorbox around all its blocks", () => {
    const a = newBox("#2563eb", "Groups & rings");
    const tex = documentToLatex(
      doc([
        paragraphFromSource("before"),
        withBox(paragraphFromSource("A group"), a),
        withBox(displayFromSource("e g = g"), a),
        paragraphFromSource("after"),
      ]),
    );
    expect(tex).toContain("\\definecolor{aqbox2563eb}{HTML}{2563EB}");
    expect(tex).toContain(
      "\\begin{tcolorbox}[enhanced,breakable,colback=aqbox2563eb!6!white,colframe=aqbox2563eb!80!black,coltitle=white,fonttitle=\\bfseries,title={Groups \\& rings}]",
    );
    expect(tex.match(/\\begin\{tcolorbox\}/g)).toHaveLength(1);
    const open = tex.indexOf("\\begin{tcolorbox}");
    const close = tex.indexOf("\\end{tcolorbox}");
    expect(tex.indexOf("before")).toBeLessThan(open);
    expect(tex.indexOf("A group")).toBeGreaterThan(open);
    expect(tex.indexOf("e g = g")).toBeLessThan(close);
    expect(tex.indexOf("after")).toBeGreaterThan(close);
  });

  it("exports neighbouring boxes separately, and an untitled box with no bar", () => {
    const tex = documentToLatex(
      doc([withBox(paragraphFromSource("x"), newBox("#fde047")), withBox(paragraphFromSource("y"), newBox("#2563eb"))]),
    );
    expect(tex.match(/\\begin\{tcolorbox\}/g)).toHaveLength(2);
    expect(tex).toContain("colframe=aqboxfde047!80!black]");
    expect(tex).not.toContain("title=");
  });
});
