/**
 * Modules — named, insertable Block[] fragments (usually one heading + body =
 * a section). They are the unit the modular-notes system composes:
 *
 *   Module = a reusable section fragment
 *   Preset = an ordered stack of modules → produces a DocumentTree
 *
 * Built-in modules form the catalog; user-saved modules ("save section as
 * module") live in localStorage next to saved templates. Every insertion goes
 * through `freshBlocks` so ids never collide with the receiving document.
 */

import { withCalloutColor } from "@/lib/blocks/callouts";
import { fillFieldText, scanFieldNames } from "@/lib/blocks/fields";
import { makeHeading, withHeading, type HeadingLevel } from "@/lib/blocks/headings";
import { makeList } from "@/lib/blocks/lists";
import { displayFromSource, paragraphFromSource } from "@/lib/blocks/source";
import { makeTableBlock, type TableStyle } from "@/lib/blocks/tables";
import { emptyDocument } from "@/lib/blocks/types";
import type { Block, DocumentTree, InlineRun, Slots } from "@/lib/blocks/types";
import type { IconName } from "@/components/Icon";

const uid = (): string => crypto.randomUUID();

// ─── Block builders (thin wrappers over the same constructors the editor uses) ─
export const heading = (level: HeadingLevel, text: string): Block => makeHeading(level, text);
export const para = (src: string): Block => paragraphFromSource(src);
export const eq = (latex: string): Block => displayFromSource(latex);
export const table = (style: TableStyle, rows: string[][]): Block => makeTableBlock(style, rows);
export function bullets(items: string[]): Block {
  const b = makeList(false);
  b.attrs = { ...b.attrs, items };
  return b;
}
export function numbered(items: string[]): Block {
  const b = makeList(true);
  b.attrs = { ...b.attrs, items };
  return b;
}
export const centerHeading = (level: HeadingLevel, text: string): Block =>
  withHeading(makeHeading(level, text), { align: "center" });
export const banner = (text: string, color: string): Block => withCalloutColor(para(text), color);

// ─── Fresh ids (so inserting a module never collides with existing blocks) ────
export function freshBlock(b: Block): Block {
  const nb: Block = { ...b, id: uid() };
  if (b.slots) {
    const slots: Slots = {};
    for (const [k, kids] of Object.entries(b.slots)) slots[k] = kids.map(freshBlock);
    nb.slots = slots;
  }
  const runs = b.attrs?.runs as InlineRun[] | undefined;
  if (Array.isArray(runs)) {
    nb.attrs = {
      ...b.attrs,
      runs: runs.map((r) => (r.kind === "math" ? { kind: "math" as const, block: freshBlock(r.block) } : r)),
    };
  }
  return nb;
}
/** Deep-clone a fragment with brand-new block ids throughout. */
export const freshBlocks = (blocks: Block[]): Block[] => blocks.map(freshBlock);

// ─── Fillable fields ({{Name}} tokens in module prose) ────────────────────────
// Tokens live as literal text in run strings / heading values / list items /
// table cells (see lib/blocks/fields.ts), so they survive save/round-trips.

/** All `{{field}}` names in a fragment, deduped in first-appearance order. */
export function moduleFields(blocks: Block[]): string[] {
  const names: string[] = [];
  const scanTable = (t: unknown): void => {
    const d = t as { rows?: string[][]; caption?: string };
    scanFieldNames(d.caption, names);
    for (const row of d.rows ?? []) for (const cell of row) scanFieldNames(cell, names);
  };
  const visit = (b: Block): void => {
    scanFieldNames(b.value, names);
    const runs = b.attrs?.runs as InlineRun[] | undefined;
    if (Array.isArray(runs)) for (const r of runs) if (r.kind === "text") scanFieldNames(r.text, names);
    const items = b.attrs?.items as string[] | undefined;
    if (Array.isArray(items)) for (const it of items) scanFieldNames(it, names);
    const tables = b.attrs?.tables as unknown[] | undefined;
    if (Array.isArray(tables)) tables.forEach(scanTable);
    if (b.slots) for (const kids of Object.values(b.slots)) kids.forEach(visit);
  };
  blocks.forEach(visit);
  return names;
}

/** Substitute filled field values throughout a fragment. Pure — freshBlock
 *  shares run/item objects with the memoized catalog, so this never mutates;
 *  blank values keep their `{{…}}` placeholder. */
export function fillFields(blocks: Block[], values: Record<string, string>): Block[] {
  if (!Object.values(values).some((v) => v && v.trim())) return blocks;
  const fill = (s: string): string => fillFieldText(s, values);
  const fillTable = (t: unknown): unknown => {
    const d = t as { rows?: string[][]; caption?: string };
    return {
      ...d,
      ...(typeof d.caption === "string" ? { caption: fill(d.caption) } : null),
      ...(Array.isArray(d.rows) ? { rows: d.rows.map((row) => row.map(fill)) } : null),
    };
  };
  const visit = (b: Block): Block => {
    const nb: Block = { ...b };
    if (typeof b.value === "string") nb.value = fill(b.value);
    if (b.attrs) {
      const attrs = { ...b.attrs };
      const runs = attrs.runs as InlineRun[] | undefined;
      if (Array.isArray(runs)) {
        attrs.runs = runs.map((r) => (r.kind === "text" ? { kind: "text" as const, text: fill(r.text) } : r));
      }
      const items = attrs.items as string[] | undefined;
      if (Array.isArray(items)) attrs.items = items.map(fill);
      const tables = attrs.tables as unknown[] | undefined;
      if (Array.isArray(tables)) attrs.tables = tables.map(fillTable);
      nb.attrs = attrs;
    }
    if (b.slots) {
      const slots: Slots = {};
      for (const [k, kids] of Object.entries(b.slots)) slots[k] = kids.map(visit);
      nb.slots = slots;
    }
    return nb;
  };
  return blocks.map(visit);
}

// ─── The Module type ──────────────────────────────────────────────────────────

export type ModuleCategory = "structural" | "study" | "science" | "planning" | "custom";

export const MODULE_CATEGORY_NAMES: Record<ModuleCategory, string> = {
  structural: "Structure",
  study: "Study",
  science: "Math & science",
  planning: "Planning",
  custom: "My modules",
};

export interface Module {
  id: string;
  name: string;
  icon: IconName;
  category: ModuleCategory;
  /** One line shown in the inserter. */
  description: string;
  /** Extra search terms for the slash-menu filter. */
  keywords?: string[];
  // Fillable `{{field}}` tokens are not declared here — they are scanned from
  // `blocks` (moduleFields), so save-section and hand-built modules get them free.
  blocks: Block[];
}

const mod = (
  id: string,
  name: string,
  icon: IconName,
  category: ModuleCategory,
  description: string,
  blocks: Block[],
  keywords?: string[],
): Module => ({ id, name, icon, category, description, keywords, blocks });

// ─── Built-in catalog ─────────────────────────────────────────────────────────
// Built lazily (block ids are minted by the builders) and memoized; insertion
// always re-freshens ids, so sharing one catalog instance is safe.

let catalog: Module[] | null = null;

export function builtinModules(): Module[] {
  if (catalog) return catalog;
  catalog = [
    // Universal / structural
    mod("title-block", "Title block", "heading", "structural", "Document title with a course / date / topic line.", [
      heading(1, "Title"),
      para("**Course:** {{Course}}    **Date:** {{Date}}    **Topic:** {{Topic}}"),
    ], ["header", "top"]),
    mod("section", "Section", "paragraph", "structural", "A subtitle with an empty body to write in.", [
      heading(2, "New section"),
      para("Write here…"),
    ], ["heading", "body"]),
    mod("summary", "Summary", "list", "structural", "A short wrap-up of the main ideas.", [
      heading(2, "Summary"),
      para("Two or three sentences capturing the main ideas."),
    ], ["tldr", "conclusion", "recap"]),
    // Study & learning
    mod("key-concepts", "Key concepts", "list", "study", "Bulleted definitions of the core ideas.", [
      heading(2, "Key Concepts"),
      bullets(["Concept 1 — definition", "Concept 2 — definition", "Concept 3 — definition"]),
    ], ["definitions", "ideas", "vocabulary"]),
    mod("worked-example", "Worked example", "displayeq", "study", "A problem statement with a worked solution.", [
      heading(2, "Worked Example"),
      para("State the problem, then solve it below."),
      eq("a^2 + b^2 = c^2"),
    ], ["example", "solution"]),
    mod("practice-problems", "Practice problems", "listnumber", "study", "Numbered problems with room to work.", [
      heading(2, "Practice Problems"),
      numbered(["Problem 1 — …", "Problem 2 — …", "Problem 3 — …"]),
    ], ["exercises", "homework"]),
    mod("cornell-cues", "Cues & questions", "tag", "study", "The Cornell cue column: prompts and key terms.", [
      heading(2, "Cues & Questions"),
      bullets(["Key question 1?", "Important term?", "Key question 2?"]),
    ], ["cornell", "prompts"]),
    mod("notes-column", "Notes", "paragraph", "study", "The main notes body — details, examples, diagrams.", [
      heading(2, "Notes"),
      para("Main notes here — expand on each cue with details, examples, and diagrams."),
    ], ["cornell", "body"]),
    mod("vocab-table", "Vocabulary table", "table", "study", "A term → definition table.", [
      heading(2, "Vocabulary"),
      table("lines", [
        ["Term", "Definition"],
        ["", ""],
        ["", ""],
      ]),
    ], ["glossary", "terms", "definitions"]),
    // Math & science
    mod("objective", "Objective", "eye", "science", "What the experiment sets out to determine.", [
      heading(2, "Objective"),
      para("What are you trying to measure or determine?"),
    ], ["aim", "goal", "lab"]),
    mod("materials", "Materials", "list", "science", "The apparatus list.", [
      heading(2, "Materials"),
      bullets(["Apparatus 1", "Apparatus 2", "Apparatus 3"]),
    ], ["equipment", "apparatus", "lab"]),
    mod("procedure", "Procedure", "listnumber", "science", "Numbered experimental steps.", [
      heading(2, "Procedure"),
      numbered(["First step…", "Second step…", "Third step…"]),
    ], ["method", "steps", "lab"]),
    mod("data-table", "Data table", "table", "science", "A measurement table with an uncertainty column.", [
      heading(2, "Data"),
      table("lines", [
        ["Trial", "Measurement", "Uncertainty"],
        ["1", "", ""],
        ["2", "", ""],
        ["3", "", ""],
      ]),
    ], ["measurements", "results", "lab"]),
    mod("analysis", "Analysis", "plot", "science", "Relate the data to the governing relationship.", [
      heading(2, "Analysis"),
      para("Relate your data to the governing relationship:"),
      eq("y = m x + b"),
    ], ["discussion", "fit", "lab"]),
    mod("conclusion", "Conclusion", "paragraph", "science", "Did the results match the prediction?", [
      heading(2, "Conclusion"),
      para("Did the results match the prediction? Discuss sources of error."),
    ], ["errors", "lab"]),
    mod("derivation", "Derivation", "integral", "science", "A step-by-step derivation from first principles.", [
      heading(2, "Derivation"),
      para("Start from the definition and work step by step."),
      eq("f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}"),
    ], ["proof", "steps"]),
    mod("formula-group", "Formula group", "functions", "science", "A topic heading with its key formulas.", [
      heading(2, "Formulas"),
      eq("(a+b)^2 = a^2 + 2ab + b^2"),
      eq("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"),
    ], ["equations", "reference", "cheat sheet"]),
    // Planning & productivity
    mod("checklist", "Checklist", "list", "planning", "A task list to tick off.", [
      heading(2, "Checklist"),
      bullets(["First task", "Second task", "Third task"]),
    ], ["tasks", "todo"]),
  ];
  return catalog;
}

// ─── Presets: ordered module stacks ───────────────────────────────────────────
// A preset's stack mixes catalog modules (by reference) with preset-private
// modules (title blocks, topic-specific sections) that aren't in the catalog.

export interface Preset {
  id: string;
  name: string;
  scenario: string;
  /** The ordered module stack this preset is built from. */
  stack: Module[];
}

/** A preset-private title module: H1 + optional fill-in meta line. */
const titleModule = (id: string, title: string, meta?: string): Module =>
  mod(`${id}-title`, `${title} title`, "heading", "structural", `Title block for ${title}.`,
    meta ? [heading(1, title), para(meta)] : [heading(1, title)]);

let presets: Preset[] | null = null;

export function builtinPresets(): Preset[] {
  if (presets) return presets;
  const by = new Map(builtinModules().map((m) => [m.id, m]));
  const use = (id: string): Module => {
    const m = by.get(id);
    if (!m) throw new Error(`unknown module: ${id}`);
    return m;
  };
  presets = [
    {
      id: "lecture-notes",
      name: "Lecture Notes",
      scenario: "Capture a class: key concepts, a worked example, and a summary.",
      stack: [
        titleModule("lecture-notes", "Lecture Notes", "**Course:** {{Course}}    **Date:** {{Date}}    **Topic:** {{Topic}}"),
        use("key-concepts"),
        use("worked-example"),
        use("summary"),
      ],
    },
    {
      id: "problem-set",
      name: "Problem Set",
      scenario: "Homework layout: numbered problems with room to work.",
      stack: [
        titleModule("problem-set", "Problem Set", "**Name:** {{Name}}    **Course:** {{Course}}    **Due:** {{Due}}"),
        mod("problem-1", "Problem 1", "displayeq", "study", "A problem with room to work.", [
          heading(2, "Problem 1"),
          para("State the problem here, then show your work."),
          eq("\\int_{0}^{1} f(x)\\,dx = "),
        ]),
        mod("problem-2", "Problem 2", "displayeq", "study", "A problem with room to work.", [
          heading(2, "Problem 2"),
          para("State the problem here, then show your work."),
        ]),
        mod("problem-3", "Problem 3", "displayeq", "study", "A problem with room to work.", [
          heading(2, "Problem 3"),
          para("State the problem here, then show your work."),
        ]),
      ],
    },
    {
      id: "lab-report",
      name: "Lab Report",
      scenario: "Objective → materials → procedure → data table → analysis.",
      stack: [
        titleModule("lab-report", "Lab Report", "**Experiment:** {{Experiment}}    **Date:** {{Date}}    **Partners:** {{Partners}}"),
        use("objective"),
        use("materials"),
        use("procedure"),
        use("data-table"),
        use("analysis"),
        use("conclusion"),
      ],
    },
    {
      id: "formula-sheet",
      name: "Formula Sheet",
      scenario: "A dense reference of key formulas, grouped by topic.",
      stack: [
        titleModule("formula-sheet", "Formula Sheet"),
        mod("formulas-algebra", "Algebra formulas", "functions", "science", "Key algebra identities.", [
          heading(2, "Algebra"),
          eq("(a+b)^2 = a^2 + 2ab + b^2"),
          eq("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"),
        ]),
        mod("formulas-calculus", "Calculus formulas", "integral", "science", "Key calculus rules.", [
          heading(2, "Calculus"),
          eq("\\frac{d}{dx} x^n = n\\,x^{n-1}"),
          eq("\\int x^n\\,dx = \\frac{x^{n+1}}{n+1} + C \\quad (n \\neq -1)"),
        ]),
        mod("formulas-trig", "Trigonometry formulas", "sum", "science", "Key trig identities.", [
          heading(2, "Trigonometry"),
          eq("\\sin^2\\theta + \\cos^2\\theta = 1"),
        ]),
      ],
    },
    {
      id: "cornell-notes",
      name: "Cornell Notes",
      scenario: "Cues & questions, a notes column, and a summary at the foot.",
      stack: [
        titleModule("cornell-notes", "Cornell Notes", "**Topic:** {{Topic}}    **Date:** {{Date}}"),
        use("cornell-cues"),
        use("notes-column"),
        use("summary"),
      ],
    },
  ];
  return presets;
}

/** Materialize an ordered module stack: concatenate with fresh block ids. */
export function stackTree(stack: Module[]): DocumentTree {
  const t = emptyDocument("flow");
  t.blocks = stack.flatMap((m) => freshBlocks(m.blocks));
  return t;
}

/** Materialize a preset from its stack. */
export const presetTree = (p: Preset): DocumentTree => stackTree(p.stack);

// ─── User-saved modules (localStorage, like saved templates) ──────────────────

export interface SavedModule {
  id: string;
  name: string;
  blocks: Block[];
  createdAt: string;
}

const LS_MODULES = "aquarius.modules.v1";

function readSavedModules(): SavedModule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_MODULES);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (m): m is SavedModule =>
        !!m &&
        typeof (m as SavedModule).id === "string" &&
        typeof (m as SavedModule).name === "string" &&
        Array.isArray((m as SavedModule).blocks),
    );
  } catch {
    return [];
  }
}

function writeSavedModules(list: SavedModule[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_MODULES, JSON.stringify(list));
}

// Collapse is view state, not content — a module captured from a hidden
// section must not insert as "section hidden".
function stripCollapsed(b: Block): Block {
  if (b.type !== "heading" || !b.attrs?.collapsed) return b;
  const attrs = { ...b.attrs };
  delete attrs.collapsed;
  return { ...b, attrs };
}

/** Save a section as a reusable module (ids freshened so it detaches from the note). */
export function saveModule(name: string, blocks: Block[], createdAt: string): SavedModule {
  const record: SavedModule = { id: uid(), name, blocks: freshBlocks(blocks.map(stripCollapsed)), createdAt };
  writeSavedModules([record, ...readSavedModules()]);
  return record;
}

/** Replace a saved module's name and blocks (ids freshened like saveModule).
 *  Upserts: if the record vanished meanwhile (deleted in another tab/menu),
 *  the edit is still preserved by re-creating the module under the same id. */
export function updateModule(id: string, name: string, blocks: Block[]): void {
  const list = readSavedModules();
  const cleaned = freshBlocks(blocks.map(stripCollapsed));
  if (list.some((m) => m.id === id)) {
    writeSavedModules(list.map((m) => (m.id === id ? { ...m, name, blocks: cleaned } : m)));
  } else {
    writeSavedModules([{ id, name, blocks: cleaned, createdAt: new Date().toISOString() }, ...list]);
  }
}

export function deleteSavedModule(id: string): void {
  writeSavedModules(readSavedModules().filter((m) => m.id !== id));
}

/** Saved modules, viewed through the Module interface (category "custom"). */
export function listSavedModules(): Module[] {
  return readSavedModules().map((m) => ({
    id: m.id,
    name: m.name,
    icon: "module" as IconName,
    category: "custom" as ModuleCategory,
    description: "Saved from a note.",
    blocks: m.blocks,
  }));
}

// ─── Usage ranking (recent / frequent, localStorage) ──────────────────────────

const LS_USAGE = "aquarius.modules.usage.v1";
const DAY = 24 * 60 * 60 * 1000;

type UsageMap = Record<string, { count: number; lastUsed: string }>;

function readUsage(): UsageMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_USAGE);
    const obj = raw ? (JSON.parse(raw) as unknown) : {};
    return obj && typeof obj === "object" ? (obj as UsageMap) : {};
  } catch {
    return {};
  }
}

/** Record that a module was inserted (drives the inserter's default order). */
export function recordModuleUse(id: string): void {
  if (typeof window === "undefined") return;
  const usage = readUsage();
  const prev = usage[id];
  usage[id] = { count: (prev?.count ?? 0) + 1, lastUsed: new Date().toISOString() };
  window.localStorage.setItem(LS_USAGE, JSON.stringify(usage));
}

/** Frequency with a recency boost: recently-used modules float to the top. */
function usageScore(usage: UsageMap, id: string): number {
  const u = usage[id];
  if (!u) return 0;
  const age = Date.now() - new Date(u.lastUsed).getTime();
  return u.count + (age < 3 * DAY ? 3 : age < 14 * DAY ? 1 : 0);
}

// ─── The inserter's list: saved + built-in, filtered & ranked ─────────────────

/** Match `q` against a candidate string; higher is better, 0 = no match. */
function matchScore(q: string, s: string): number {
  const t = s.toLowerCase();
  if (t.startsWith(q)) return 100;
  const at = t.indexOf(q);
  if (at > 0) return t[at - 1] === " " ? 80 : 60;
  // Subsequence match (e.g. "wex" → "Worked example").
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 30 : 0;
}

function moduleScore(q: string, m: Module): number {
  let best = matchScore(q, m.name);
  for (const k of m.keywords ?? []) best = Math.max(best, matchScore(q, k) * 0.8);
  best = Math.max(best, matchScore(q, MODULE_CATEGORY_NAMES[m.category]) * 0.5);
  return best;
}

/**
 * The slash-menu list: user-saved modules first, then the catalog. An empty
 * query returns everything ranked by recent/frequent use; a query fuzzy-filters
 * (name, keywords, category) and ranks by match quality, usage breaking ties.
 */
export function searchModules(query: string): Module[] {
  const all = [...listSavedModules(), ...builtinModules()];
  const usage = readUsage();
  const q = query.trim().toLowerCase();
  if (!q) {
    return all
      .map((m, i) => ({ m, i, u: usageScore(usage, m.id) }))
      .sort((a, b) => b.u - a.u || a.i - b.i)
      .map((x) => x.m);
  }
  return all
    .map((m, i) => ({ m, i, s: moduleScore(q, m), u: usageScore(usage, m.id) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.u - a.u || a.i - b.i)
    .map((x) => x.m);
}
