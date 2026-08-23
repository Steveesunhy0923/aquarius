import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "./templates";
import { builtinModules, builtinPresets, moduleFields, presetTree } from "./modules";

describe("built-in presets", () => {
  const presets = builtinPresets();

  it("every stack materializes into blocks", () => {
    for (const p of presets) expect(presetTree(p).blocks.length, p.id).toBeGreaterThan(0);
  });

  it("module ids are unique within a stack", () => {
    // PresetCard keys its chips by module id, and usage ranking is per id.
    for (const p of presets) {
      const ids = p.stack.map((m) => m.id);
      expect(new Set(ids).size, p.id).toBe(ids.length);
    }
  });

  it("preset and catalog ids are each unique", () => {
    const pids = presets.map((p) => p.id);
    expect(new Set(pids).size).toBe(pids.length);
    const mids = builtinModules().map((m) => m.id);
    expect(new Set(mids).size).toBe(mids.length);
  });

  it("fields a template asks for are never blank-named", () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const f of moduleFields(t.build().blocks)) expect(f.trim(), t.id).not.toBe("");
    }
  });
});
