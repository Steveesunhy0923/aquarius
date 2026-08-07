/**
 * Code-execution kernels — shared protocol types.
 *
 * A KERNEL is one Web Worker holding a live language session for one note
 * (Jupyter semantics: variables persist across that note's code blocks until
 * the kernel is restarted). Kernels are transient, purely client-side state —
 * they must never be serialized into the block tree (see lib/blocks/codeblock.ts).
 *
 * Worker protocol (structured-clone messages):
 *   main → worker  { type: "run", id, code }
 *   worker → main  { type: "ready" }                       kernel can accept runs
 *                  { type: "boot-error", text }            kernel can never run
 *                  { type: "out", id, kind, text }         streamed output
 *                  { type: "done", id }                    run finished
 *
 * `id` echoes the run it belongs to; the manager drops replies that do not
 * match the run currently in flight (late timer output, stale workers).
 */

import type { CodeOutput, KernelFamily } from "@/lib/blocks/codeblock";

export type { CodeOutput, KernelFamily };

export type KernelStatus =
  | "off" // no worker yet (created lazily on first run)
  | "starting" // worker booting (Pyodide download/compile — can take seconds)
  | "idle"
  | "busy"
  | "failed"; // boot failed; the next run retries from scratch

/** Live, transient run state for one block (replaced immutably on change). */
export interface RunState {
  /** `queued` → waiting for the kernel; `done` → finished, awaiting commit. */
  phase: "queued" | "running" | "done";
  outputs: CodeOutput[];
  /** The `[n]` counter assigned when the run actually starts (0 while queued). */
  execCount: number;
}

export interface WorkerRunMsg {
  type: "run";
  id: number;
  code: string;
}

export type WorkerReplyMsg =
  | { type: "ready" }
  | { type: "boot-error"; text: string }
  | { type: "out"; id: number; kind: CodeOutput["kind"]; text: string }
  | { type: "done"; id: number };
