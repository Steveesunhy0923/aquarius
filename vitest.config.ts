import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Mirror the tsconfig `@/* -> ./*` path alias so unit tests can import app
// modules. Tests are pure (no DOM needed) — the default node environment is fine.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
  test: {
    // components/ too: not for React, but for the pure logic that lives beside
    // it — stroke packing and training-sample shaping decide what lands in the
    // corpus permanently, so it is tested at the same level as lib/.
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
  },
});
