import { describe, expect, it } from "vitest";
import { fillFieldText, scanFieldNames, splitFieldTokens } from "./fields";
import { builtinModules, fillFields, moduleFields } from "@/lib/templates/modules";

describe("splitFieldTokens", () => {
  it("splits literals and tokens in order", () => {
    expect(splitFieldTokens("**Course:** {{Course}} — {{Date}}")).toEqual([
      "**Course:** ",
      { field: "Course" },
      " — ",
      { field: "Date" },
    ]);
  });
  it("passes token-free text through as one literal", () => {
    expect(splitFieldTokens("plain text")).toEqual(["plain text"]);
  });
  it("ignores unclosed/empty braces", () => {
    expect(splitFieldTokens("{{not closed")).toEqual(["{{not closed"]);
    expect(splitFieldTokens("a {{}} b")).toEqual(["a {{}} b"]);
  });
});

describe("scanFieldNames", () => {
  it("dedupes in first-appearance order", () => {
    const out: string[] = [];
    scanFieldNames("{{B}} {{A}} {{B}}", out);
    scanFieldNames("{{A}} {{C}}", out);
    expect(out).toEqual(["B", "A", "C"]);
  });
});

describe("fillFieldText", () => {
  it("replaces filled values and keeps blank ones as placeholders", () => {
    expect(fillFieldText("{{Course}} / {{Date}}", { Course: "Physics", Date: "  " })).toBe(
      "Physics / {{Date}}",
    );
  });
});

describe("module fields", () => {
  it("scans the title-block module's tokens", () => {
    const title = builtinModules().find((m) => m.id === "title-block")!;
    expect(moduleFields(title.blocks)).toEqual(["Course", "Date", "Topic"]);
  });
  it("fills without mutating the catalog module", () => {
    const title = builtinModules().find((m) => m.id === "title-block")!;
    const before = JSON.stringify(title.blocks);
    const filled = fillFields(title.blocks, { Course: "PHYS 101" });
    expect(JSON.stringify(filled)).toContain("PHYS 101");
    expect(JSON.stringify(filled)).toContain("{{Date}}"); // unfilled stays
    expect(JSON.stringify(title.blocks)).toBe(before); // catalog untouched
  });
});
