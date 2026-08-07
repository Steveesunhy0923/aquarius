import { describe, expect, it } from "vitest";

import { resolveNoteAccess } from "./access";

describe("resolveNoteAccess", () => {
  it("treats a note in our own mirror as ours even before it reaches the cloud", () => {
    // The regression this guards: SyncedStore.createNote writes locally and
    // pushes on a debounce, so a brand-new note is absent from Supabase for a
    // couple of seconds. Asking the sharing layer then answers "no such note".
    expect(resolveNoteAccess({ mirroredLocally: true, cloudAccess: null })).toEqual({
      kind: "access",
      access: "owner",
    });
    expect(resolveNoteAccess({ mirroredLocally: true })).toEqual({
      kind: "access",
      access: "owner",
    });
  });

  it("uses the sharing layer's answer for notes we don't hold locally", () => {
    for (const access of ["owner", "editor", "commenter", "viewer"] as const) {
      expect(resolveNoteAccess({ mirroredLocally: false, cloudAccess: access })).toEqual({
        kind: "access",
        access,
      });
    }
  });

  it("is gone only when it is neither ours locally nor visible in the cloud", () => {
    expect(resolveNoteAccess({ mirroredLocally: false, cloudAccess: null })).toEqual({ kind: "gone" });
  });

  it("a local copy wins over a cloud role (we own it; the role is stale)", () => {
    expect(resolveNoteAccess({ mirroredLocally: true, cloudAccess: "viewer" })).toEqual({
      kind: "access",
      access: "owner",
    });
  });
});
