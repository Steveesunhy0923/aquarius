import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Mirror the tsconfig `@/* -> ./*` path alias so unit tests can import app
// modules. Tests are pure (no DOM needed) — the default node environment is fine.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
  test: {
    include: ["lib/**/*.test.ts"],
  },
});
