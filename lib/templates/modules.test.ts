/**
 * The Modules section is the user's own library: a starter set is seeded into
 * it once, every entry is an ordinary editable module, and the inserters offer
 * nothing else. localStorage is stubbed per test, since that is where the
 * library lives.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InlineRun } from "@/lib/blocks/types";
import {
  appendToModule,
  builtinModules,
  deleteSavedModule,
  listSavedModules,
  replaceModuleBlocks,
  sampleModules,
  saveModule,
  searchModules,
  updateModule,
} from "./modules";

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as { window?: unknown }).window = { localStorage };
  return store;
}

describe("sample modules", () => {
  it("are skeletons — no sentence of sample prose anywhere", () => {
    for (const s of sampleModules()) {
      for (const b of s.blocks) {
        if (b.type === "heading") {
          expect(b.value?.trim(), `${s.name}: heading`).toBeTruthy();
          expect(b.value!.split(/\s+/).length, `${s.name}: "${b.value}" reads as prose`).toBeLessThanOrEqual(3);
        }
        const runs = (b.attrs?.runs as InlineRun[] | undefined) ?? [];
        for (const r of runs) {
          if (r.kind !== "text") continue;
          // Bold labels and {{field}} tokens are structure; anything left is prose.
          const leftover = r.text.replace(/\*\*[^*]+:\*\*/g, "").replace(/\{\{[^{}]+\}\}/g, "").trim();
          expect(leftover, `${s.name}: text "${r.text}"`).toBe("");
        }
        const items = (b.attrs?.items as string[] | undefined) ?? [];
        for (const it of items) expect(it, `${s.name}: list item`).toBe("");
      }
    }
  });

  it("each has a name, an icon and a heading to find it by", () => {
    const samples = sampleModules();
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(new Set(samples.map((s) => s.name)).size).toBe(samples.length);
    for (const s of samples) {
      expect(s.icon, s.name).toBeTruthy();
      expect(s.blocks.some((b) => b.type === "heading"), s.name).toBe(true);
    }
  });
});

describe("the user's module library", () => {
  let store: Map<string, string>;
  beforeEach(() => { store = installStorage(); });
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });

  it("is seeded with the samples on first use, as ordinary editable modules", () => {
    const mods = listSavedModules();
    expect(mods.map((m) => m.name)).toEqual(sampleModules().map((s) => s.name));
    for (const m of mods) {
      expect(m.category).toBe("custom"); // editable + deletable everywhere
      expect(m.icon).not.toBe("module"); // samples keep their own icons
    }
  });

  it("never re-seeds once the samples are deleted", () => {
    for (const m of listSavedModules()) deleteSavedModule(m.id);
    expect(listSavedModules()).toEqual([]);
    expect(listSavedModules()).toEqual([]); // and stays empty on every later read
  });

  it("appends the samples after a library the user already had", () => {
    // A library from before seeding existed: written without the seeded flag.
    store.set("aquarius.modules.v1", JSON.stringify([
      { id: "mine", name: "My theorem box", blocks: [], createdAt: "2026-01-01T00:00:00.000Z" },
    ]));
    const names = listSavedModules().map((m) => m.name);
    expect(names[0]).toBe("My theorem box");
    expect(names.slice(1)).toEqual(sampleModules().map((s) => s.name));
  });

  it("puts a newly made module ahead of the samples", () => {
    listSavedModules(); // seed
    saveModule("Proof skeleton", [], "2026-09-15T00:00:00.000Z");
    expect(listSavedModules()[0].name).toBe("Proof skeleton");
  });

  it("keeps a sample's icon through an edit", () => {
    const keyTerms = listSavedModules().find((m) => m.name === "Key terms")!;
    updateModule(keyTerms.id, "Vocabulary", keyTerms.blocks);
    const edited = listSavedModules().find((m) => m.id === keyTerms.id)!;
    expect(edited.name).toBe("Vocabulary");
    expect(edited.icon).toBe("table");
  });

  it("is all the inserters offer — no built-in catalog", () => {
    const builtinIds = new Set(builtinModules().map((m) => m.id));
    const offered = searchModules("");
    expect(offered.length).toBe(sampleModules().length);
    expect(offered.some((m) => builtinIds.has(m.id))).toBe(false);
    expect(searchModules("key").map((m) => m.name)).toEqual(["Key terms"]);
    expect(searchModules("vocabulary")).toEqual([]); // a catalog-only name finds nothing
  });
});

describe("saving a section into an existing module", () => {
  let store: Map<string, string>;
  beforeEach(() => { store = installStorage(); });
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });

  const section = () => [
    { id: "s1", type: "heading" as const, value: "Proof", attrs: { level: 2 } },
    { id: "s2", type: "text" as const, attrs: { runs: [{ kind: "text" as const, text: "" }] } },
  ];

  it("adds the section to the end, keeping what was there", () => {
    const target = listSavedModules().find((m) => m.name === "Key terms")!;
    const before = target.blocks.length;
    appendToModule(target.id, section());
    const after = listSavedModules().find((m) => m.id === target.id)!;
    expect(after.blocks.length).toBe(before + 2);
    expect(after.blocks.slice(0, before)).toEqual(target.blocks); // untouched
    expect(after.blocks[before].value).toBe("Proof");
    expect(after.name).toBe("Key terms");
  });

  it("replaces the content but keeps the module's name and icon", () => {
    const target = listSavedModules().find((m) => m.name === "Key terms")!;
    replaceModuleBlocks(target.id, section());
    const after = listSavedModules().find((m) => m.id === target.id)!;
    expect(after.blocks.length).toBe(2);
    expect(after.blocks[0].value).toBe("Proof");
    expect(after.name).toBe("Key terms");
    expect(after.icon).toBe("table");
  });

  it("gives the copied blocks new ids, so the module detaches from the note", () => {
    const target = listSavedModules().find((m) => m.name === "Example")!;
    replaceModuleBlocks(target.id, section());
    const ids = listSavedModules().find((m) => m.id === target.id)!.blocks.map((b) => b.id);
    expect(ids).not.toContain("s1");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ignores a module that is no longer there", () => {
    const before = JSON.stringify(listSavedModules());
    appendToModule("gone", section());
    replaceModuleBlocks("gone", section());
    expect(JSON.stringify(listSavedModules())).toBe(before);
    expect(store.get("aquarius.modules.v1")).toBeTruthy();
  });
});
