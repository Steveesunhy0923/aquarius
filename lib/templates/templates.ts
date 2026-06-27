/**
 * Document templates — Canva-style starting points for a note.
 *
 * A template is just a `DocumentTree` (blocks + style). Built-ins are *factories*
 * so every "use" produces fresh block ids; user-saved templates store a tree and
 * are id-refreshed on use (see `freshTree`). User templates live in localStorage
 * (browser-only) — small, structural starting points, not the user's content.
 */

import { displayFromSource, paragraphFromSource } from "@/lib/blocks/source";
import { makeHeading, type HeadingLevel } from "@/lib/blocks/headings";
import { makeList } from "@/lib/blocks/lists";
import { makeTableBlock, type TableStyle } from "@/lib/blocks/tables";
import { emptyDocument } from "@/lib/blocks/types";
import type { Block, DocumentTree, InlineRun, Slots } from "@/lib/blocks/types";

const uid = (): string => crypto.randomUUID();

// ─── Block builders (thin wrappers over the same constructors the editor uses) ─
const heading = (level: HeadingLevel, text: string): Block => makeHeading(level, text);
const para = (src: string): Block => paragraphFromSource(src);
const eq = (latex: string): Block => displayFromSource(latex);
const table = (style: TableStyle, rows: string[][]): Block => makeTableBlock(style, rows);
function bullets(items: string[]): Block {
  const b = makeList(false);
  b.attrs = { ...b.attrs, items };
  return b;
}
function numbered(items: string[]): Block {
  const b = makeList(true);
  b.attrs = { ...b.attrs, items };
  return b;
}
function tree(blocks: Block[]): DocumentTree {
  const t = emptyDocument("flow");
  t.blocks = blocks;
  return t;
}

// ─── Fresh ids (so applying a template never collides with existing blocks) ────
function freshBlock(b: Block): Block {
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
/** Deep-clone a tree with brand-new block ids throughout. */
export function freshTree(t: DocumentTree): DocumentTree {
  return { ...t, blocks: t.blocks.map(freshBlock) };
}

// ─── Built-in templates ───────────────────────────────────────────────────────

export interface BuiltInTemplate {
  id: string;
  name: string;
  scenario: string;
  icon: string;
  build: () => DocumentTree;
}

export const BUILTIN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: "lecture-notes",
    name: "Lecture Notes",
    scenario: "Capture a class: key concepts, a worked example, and a summary.",
    icon: "📓",
    build: () =>
      tree([
        heading(1, "Lecture Notes"),
        para("**Course:** ___    **Date:** ___    **Topic:** ___"),
        heading(2, "Key Concepts"),
        bullets(["Concept 1 — definition", "Concept 2 — definition", "Concept 3 — definition"]),
        heading(2, "Worked Example"),
        para("State the problem, then solve it below."),
        eq("a^2 + b^2 = c^2"),
        heading(2, "Summary"),
        para("Two or three sentences capturing today's main ideas."),
      ]),
  },
  {
    id: "problem-set",
    name: "Problem Set",
    scenario: "Homework layout: numbered problems with room to work.",
    icon: "📝",
    build: () =>
      tree([
        heading(1, "Problem Set"),
        para("**Name:** ___    **Course:** ___    **Due:** ___"),
        heading(2, "Problem 1"),
        para("State the problem here, then show your work."),
        eq("\\int_{0}^{1} f(x)\\,dx = "),
        heading(2, "Problem 2"),
        para("State the problem here, then show your work."),
        heading(2, "Problem 3"),
        para("State the problem here, then show your work."),
      ]),
  },
  {
    id: "lab-report",
    name: "Lab Report",
    scenario: "Objective → materials → procedure → data table → analysis.",
    icon: "🧪",
    build: () =>
      tree([
        heading(1, "Lab Report"),
        para("**Experiment:** ___    **Date:** ___    **Partners:** ___"),
        heading(2, "Objective"),
        para("What are you trying to measure or determine?"),
        heading(2, "Materials"),
        bullets(["Apparatus 1", "Apparatus 2", "Apparatus 3"]),
        heading(2, "Procedure"),
        numbered(["First step…", "Second step…", "Third step…"]),
        heading(2, "Data"),
        table("lines", [
          ["Trial", "Measurement", "Uncertainty"],
          ["1", "", ""],
          ["2", "", ""],
          ["3", "", ""],
        ]),
        heading(2, "Analysis"),
        para("Relate your data to the governing relationship:"),
        eq("y = m x + b"),
        heading(2, "Conclusion"),
        para("Did the results match the prediction? Discuss sources of error."),
      ]),
  },
  {
    id: "formula-sheet",
    name: "Formula Sheet",
    scenario: "A dense reference of key formulas, grouped by topic.",
    icon: "📐",
    build: () =>
      tree([
        heading(1, "Formula Sheet"),
        heading(2, "Algebra"),
        eq("(a+b)^2 = a^2 + 2ab + b^2"),
        eq("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"),
        heading(2, "Calculus"),
        eq("\\frac{d}{dx} x^n = n\\,x^{n-1}"),
        eq("\\int x^n\\,dx = \\frac{x^{n+1}}{n+1} + C \\quad (n \\neq -1)"),
        heading(2, "Trigonometry"),
        eq("\\sin^2\\theta + \\cos^2\\theta = 1"),
      ]),
  },
  {
    id: "cornell-notes",
    name: "Cornell Notes",
    scenario: "Cues & questions, a notes column, and a summary at the foot.",
    icon: "🗂️",
    build: () =>
      tree([
        heading(1, "Cornell Notes"),
        para("**Topic:** ___    **Date:** ___"),
        heading(2, "Cues & Questions"),
        bullets(["Key question 1?", "Important term?", "Key question 2?"]),
        heading(2, "Notes"),
        para("Main notes here — expand on each cue with details, examples, and diagrams."),
        heading(2, "Summary"),
        para("In two or three sentences, summarize the big idea of this page."),
      ]),
  },
];

// ─── User-saved templates (localStorage) ──────────────────────────────────────

export interface SavedTemplate {
  id: string;
  name: string;
  scenario: string;
  tree: DocumentTree;
  createdAt: string;
}

const LS_KEY = "aquarius.templates.v1";

export function listSavedTemplates(): SavedTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (t): t is SavedTemplate =>
        !!t && typeof (t as SavedTemplate).id === "string" && !!(t as SavedTemplate).tree,
    );
  } catch {
    return [];
  }
}

function writeSaved(list: SavedTemplate[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(list));
}

/** Save a tree as a reusable template; returns the stored record. */
export function saveTemplate(name: string, scenario: string, t: DocumentTree, createdAt: string): SavedTemplate {
  const record: SavedTemplate = { id: uid(), name, scenario, tree: t, createdAt };
  writeSaved([record, ...listSavedTemplates()]);
  return record;
}

export function deleteTemplate(id: string): void {
  writeSaved(listSavedTemplates().filter((t) => t.id !== id));
}
