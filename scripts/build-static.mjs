#!/usr/bin/env node
/**
 * Static-export build for the Capacitor iOS shell (and future desktop shells).
 *
 * `output: "export"` cannot include dynamic API route handlers, and the /api/*
 * routes (unfurl, pdf) are server-only conveniences — shell builds reach the
 * hosted ones via NEXT_PUBLIC_API_ORIGIN or degrade gracefully (lib/api.ts).
 * So: park app/api outside the app tree, run `next build` with CAP_STATIC=1,
 * and restore app/api afterwards — including on build failure or Ctrl-C.
 *
 * Usage: npm run build:static   (output lands in out/)
 */
import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "app", "api");
const parked = path.join(root, ".api-excluded"); // gitignored

const restore = () => {
  if (existsSync(parked)) renameSync(parked, apiDir);
};

// A previous run that died mid-build leaves app/api parked; recover first.
restore();

if (!existsSync(apiDir)) {
  console.error("build-static: app/api not found; refusing to build.");
  process.exit(1);
}

process.on("exit", restore);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

renameSync(apiDir, parked);
const res = spawnSync(path.join(root, "node_modules", ".bin", "next"), ["build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CAP_STATIC: "1" },
});
process.exit(res.status ?? 1);
