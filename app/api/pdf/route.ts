/**
 * POST /api/pdf — typeset a LaTeX document to PDF with Tectonic.
 *
 * Body: { latex: string, assets?: [{ name: "<assetId>.<ext>", base64 }] }.
 * 200 → application/pdf bytes. 422 → { error: "compile_failed", log } with the
 * tail of the TeX log. 501 → { error: "tectonic_missing" } when no Tectonic
 * binary is installed (clients fall back to print-to-PDF).
 *
 * Tectonic (https://tectonic-typesetting.github.io) is a self-contained XeTeX:
 * `brew install tectonic` locally; on a server, bundle the binary or set
 * TECTONIC_PATH. First compile downloads TeX packages into ~/.cache/Tectonic,
 * so the server needs outbound network once per new package.
 *
 * Safety: --untrusted disables shell-escape and unsafe primitives; the compile
 * runs in a throwaway temp dir with validated asset filenames (no separators,
 * no dotfiles), a hard timeout, and request-size caps.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 90; // typesetting + first-run package fetches

const MAX_LATEX = 2 * 1024 * 1024; // 2 MB of source
const MAX_ASSET = 15 * 1024 * 1024; // decoded, per asset
const MAX_TOTAL = 40 * 1024 * 1024; // decoded, whole request
const TIMEOUT_MS = 75_000;
const LOG_TAIL = 4_000;

const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/; // no separators, no dotfiles

interface PdfRequest {
  latex?: unknown;
  assets?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: PdfRequest;
  try {
    body = (await req.json()) as PdfRequest;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const latex = typeof body.latex === "string" ? body.latex : "";
  if (!latex || latex.length > MAX_LATEX) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const rawAssets = Array.isArray(body.assets) ? body.assets : [];
  const assets: { name: string; data: Buffer }[] = [];
  let total = 0;
  for (const a of rawAssets) {
    const name = (a as { name?: unknown })?.name;
    const base64 = (a as { base64?: unknown })?.base64;
    if (typeof name !== "string" || typeof base64 !== "string" || !SAFE_ASSET_NAME.test(name)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const data = Buffer.from(base64, "base64");
    total += data.length;
    if (data.length > MAX_ASSET || total > MAX_TOTAL) {
      return NextResponse.json({ error: "too_large" }, { status: 413 });
    }
    assets.push({ name, data });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "aquarius-pdf-"));
  try {
    await writeFile(path.join(dir, "main.tex"), latex, "utf8");
    for (const a of assets) await writeFile(path.join(dir, a.name), a.data);

    const run = await runTectonic(dir);
    if (run.missing) {
      return NextResponse.json(
        { error: "tectonic_missing", message: "Tectonic is not installed on the server." },
        { status: 501 },
      );
    }
    if (run.code !== 0) {
      return NextResponse.json(
        { error: "compile_failed", log: run.output.slice(-LOG_TAIL) },
        { status: 422 },
      );
    }
    const pdf = await readFile(path.join(dir, "main.pdf"));
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("pdf route failed", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runTectonic(
  dir: string,
): Promise<{ missing: boolean; code: number; output: string }> {
  const bin = process.env.TECTONIC_PATH || "tectonic";
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      ["--untrusted", "--chatter", "minimal", "--outdir", dir, path.join(dir, "main.tex")],
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    const collect = (chunk: Buffer) => {
      if (output.length < 64_000) output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      output += "\n[timeout: compile killed]";
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ missing: err.code === "ENOENT", code: 1, output: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ missing: false, code: code ?? 1, output });
    });
  });
}
