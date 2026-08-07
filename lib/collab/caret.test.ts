import { describe, expect, it } from "vitest";

import { shiftCaret } from "./caret";

describe("shiftCaret", () => {
  it("leaves the caret alone when the text is unchanged", () => {
    expect(shiftCaret("hello", "hello", 3)).toBe(3);
  });

  it("leaves the caret alone for an edit AFTER it", () => {
    // peer appends " world"; our caret sits inside "hello"
    expect(shiftCaret("hello", "hello world", 2)).toBe(2);
  });

  it("slides the caret right for an insertion BEFORE it", () => {
    // peer prepends "Oh " (3 chars); we were at index 5 ("hello|")
    expect(shiftCaret("hello", "Oh hello", 5)).toBe(8);
  });

  it("slides the caret left for a deletion BEFORE it", () => {
    expect(shiftCaret("Oh hello", "hello", 8)).toBe(5);
  });

  it("never lands before the edit point or past the end", () => {
    // peer deleted everything before us
    expect(shiftCaret("abcdef", "f", 4)).toBe(0);
    expect(shiftCaret("abc", "ab", 3)).toBe(2);
  });

  it("handles a caret at 0 and an empty document", () => {
    expect(shiftCaret("", "typed", 0)).toBe(0);
    expect(shiftCaret("gone", "", 4)).toBe(0);
  });
});
