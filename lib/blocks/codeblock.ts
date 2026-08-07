/**
 * Runnable code block — the data model behind the mini-IDE (CodeBlockView).
 *
 * A code block is `{ type: "code", value: source, attrs: { lang, outputs?,
 * execCount? } }`. The SOURCE is the document content; OUTPUTS are a bounded,
 * serializable capture of the last run (Jupyter-style), committed once when a
 * run finishes — never streamed into attrs (streaming state lives in the
 * kernel manager, lib/run/manager.ts, and must stay out of the tree so it is
 * not autosaved/synced/snapshotted).
 *
 * Pure module (no React/DOM) — used by the serializer and tests. Accessors
 * follow the graph.ts contract: read attrs defensively and NEVER throw, since
 * trees arrive from sync/collab/imports/old versions.
 */

import type { Block } from "@/lib/blocks/types";

const uid = (): string => crypto.randomUUID();

// ── languages ────────────────────────────────────────────────────────────────

/** How a language executes: a JS worker kernel, the Pyodide kernel, or not at all. */
export type KernelFamily = "js" | "py";

export interface CodeLangInfo {
  id: string;
  label: string;
  /** Which kernel can run it (null = highlight-only). */
  kernel: KernelFamily | null;
  /** Language name for @codemirror/language-data lookup (null = plain text). */
  cm: string | null;
  /** `listings` language name for LaTeX export (null = omit [language=…]). */
  listings: string | null;
}

/** The curated language set. Order = menu order; runnable languages first. */
export const CODE_LANGS: readonly CodeLangInfo[] = [
  { id: "python", label: "Python", kernel: "py", cm: "Python", listings: "Python" },
  { id: "javascript", label: "JavaScript", kernel: "js", cm: "JavaScript", listings: "javascript" },
  { id: "typescript", label: "TypeScript", kernel: null, cm: "TypeScript", listings: "typescript" },
  { id: "c", label: "C", kernel: null, cm: "C", listings: "C" },
  { id: "cpp", label: "C++", kernel: null, cm: "C++", listings: "C++" },
  { id: "java", label: "Java", kernel: null, cm: "Java", listings: "Java" },
  { id: "matlab", label: "MATLAB", kernel: null, cm: "Octave", listings: "Matlab" },
  { id: "julia", label: "Julia", kernel: null, cm: "Julia", listings: "julia" },
  { id: "r", label: "R", kernel: null, cm: "R", listings: "R" },
  { id: "sql", label: "SQL", kernel: null, cm: "SQL", listings: "SQL" },
  { id: "html", label: "HTML", kernel: null, cm: "HTML", listings: "HTML" },
  { id: "css", label: "CSS", kernel: null, cm: "CSS", listings: "css" },
  { id: "json", label: "JSON", kernel: null, cm: "JSON", listings: "json" },
  { id: "bash", label: "Shell", kernel: null, cm: "Shell", listings: "bash" },
  { id: "text", label: "Plain text", kernel: null, cm: null, listings: null },
] as const;

const LANG_BY_ID = new Map(CODE_LANGS.map((l) => [l.id, l]));

/** Language info for a block (unknown/legacy ids fall back to plain text). */
export function codeLangInfo(block: Block): CodeLangInfo {
  const id = typeof block.attrs?.lang === "string" ? block.attrs.lang : "text";
  return LANG_BY_ID.get(id) ?? (LANG_BY_ID.get("text") as CodeLangInfo);
}

export function codeSource(block: Block): string {
  return typeof block.value === "string" ? block.value : "";
}

// ── outputs ──────────────────────────────────────────────────────────────────

/** One captured output segment of a run, in arrival order. */
export interface CodeOutput {
  kind: "stdout" | "stderr" | "result" | "error";
  text: string;
}

const OUTPUT_KINDS = new Set(["stdout", "stderr", "result", "error"]);

/** Bounded so persisted outputs stay cheap: attrs are copied whole into every
 *  undo step, 4-min version snapshot, sync push and Yjs update. */
export const MAX_OUTPUT_CHARS = 20_000;
export const TRUNCATION_NOTICE = "… output truncated";

/** Defensive read of the persisted outputs (never throws, filters junk). */
export function codeOutputs(block: Block): CodeOutput[] {
  const raw = block.attrs?.outputs;
  if (!Array.isArray(raw)) return [];
  const out: CodeOutput[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const { kind, text } = o as Record<string, unknown>;
    if (typeof kind !== "string" || !OUTPUT_KINDS.has(kind)) continue;
    if (typeof text !== "string") continue;
    out.push({ kind: kind as CodeOutput["kind"], text });
  }
  return out;
}

/** The run counter shown as `[n]` (0 = never run). */
export function codeExecCount(block: Block): number {
  const n = block.attrs?.execCount;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Cut to `n` chars without splitting a surrogate pair — a lone surrogate is
 *  not valid UTF-8 and Postgres rejects it when the note syncs to the cloud. */
function sliceChars(s: string, n: number): string {
  const cut = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Merge adjacent same-kind segments and cap total size (keeps the head — the
 *  first lines of runaway output are the informative ones). Truncation is
 *  always signposted, including when the budget runs out exactly. */
export function normalizeOutputs(outputs: CodeOutput[]): CodeOutput[] {
  const merged: CodeOutput[] = [];
  for (const o of outputs) {
    if (!o.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.kind === o.kind && (o.kind === "stdout" || o.kind === "stderr")) {
      // Copy rather than mutate: the caller's array is the live run state.
      merged[merged.length - 1] = { kind: last.kind, text: last.text + o.text };
    } else {
      merged.push({ ...o });
    }
  }
  let budget = MAX_OUTPUT_CHARS;
  const capped: CodeOutput[] = [];
  let dropped = false;
  for (const o of merged) {
    if (budget <= 0) {
      dropped = true;
      break;
    }
    if (o.text.length <= budget) {
      capped.push(o);
      budget -= o.text.length;
    } else {
      capped.push({ kind: o.kind, text: sliceChars(o.text, budget) + "\n" + TRUNCATION_NOTICE });
      budget = 0;
      dropped = true;
    }
  }
  // An exact-fit budget leaves later segments (e.g. the trailing error) unsaid.
  const lastCapped = capped[capped.length - 1];
  if (dropped && lastCapped && !lastCapped.text.endsWith(TRUNCATION_NOTICE)) {
    capped.push({ kind: "stderr", text: TRUNCATION_NOTICE });
  }
  return capped;
}

// ── writers / factory ────────────────────────────────────────────────────────

export function withCodeSource(block: Block, source: string): Block {
  return { ...block, value: source };
}

/** Changing language clears outputs — they belong to the old language's run. */
export function withCodeLang(block: Block, lang: string): Block {
  const attrs = { ...block.attrs, lang: lang as NonNullable<Block["attrs"]>["lang"] };
  delete attrs.outputs;
  delete attrs.execCount;
  return { ...block, attrs };
}

/** Commit a finished run: bounded outputs + the run counter, in one write. */
export function withCodeRun(block: Block, outputs: CodeOutput[], execCount: number): Block {
  const normalized = normalizeOutputs(outputs);
  const attrs = { ...block.attrs } as NonNullable<Block["attrs"]>;
  if (normalized.length) attrs.outputs = normalized;
  else delete attrs.outputs;
  attrs.execCount = execCount;
  return { ...block, attrs };
}

export function withCodeOutputsCleared(block: Block): Block {
  const attrs = { ...block.attrs };
  delete attrs.outputs;
  delete attrs.execCount;
  return { ...block, attrs };
}

export function makeCodeBlock(lang = "python", source = ""): Block {
  return {
    id: uid(),
    type: "code",
    value: source,
    attrs: { lang: lang as NonNullable<Block["attrs"]>["lang"] },
  };
}
